import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'tsdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/cli/embedded.ts'
import { main } from '../src/cli/main.ts'
import { local } from '../src/cli/local.ts'
import { env, url, useBoard } from './cli-harness.ts'
import { fakeMessageboard } from './messageboard.ts'

/** What `run` printed, and the exit code it answered. */
async function capture(run: () => Promise<number>) {
  let stdout = ''
  let stderr = ''
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true))
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true))
  try {
    return { code: await run(), stdout, stderr }
  } finally {
    out.mockRestore()
    err.mockRestore()
  }
}

/**
 * This process's environment as a fresh machine's, for the CLI: no board, agent, Vercel, or Actions
 * variables, as the subprocess tests clear them, and an empty home, so no cached token answers.
 */
async function isolated(): Promise<string> {
  for (const key of Object.keys(process.env)) if (/^(CLAUDE|CODEX|GROK|PI_|AI_AGENT|BOARD|VERCEL|ACTIONS_ID_TOKEN)/.test(key)) vi.stubEnv(key, undefined)
  const home = await mkdtemp(join(tmpdir(), 'board-home-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('XDG_CONFIG_HOME', home)
  return home
}

/** Markers only the inspector, `serve`, and A2's stores have. */
const MARKERS = { inspector: 'x-inspect-token', serve: 'serving a local board', a2: 'board-tables' }

/** `entry`, bundled as the Vercel CLI bundles what it imports: for Node, every dependency inlined. */
async function bundled(entry: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'board-cli-'))
  const file = join(import.meta.dirname, `.cli-entry-${process.pid}-${Math.random().toString(36).slice(2)}.ts`)
  await writeFile(file, entry)
  try {
    await build({ config: false, entry: { app: file }, outDir: dir, platform: 'node', format: 'esm', dts: false, clean: false, logLevel: 'silent', deps: { alwaysBundle: [/.*/], onlyBundle: false } })
    const names = (await readdir(dir, { recursive: true })).filter((name) => /\.m?js$/.test(name))
    return (await Promise.all(names.map((name) => readFile(join(dir, name), 'utf8')))).join('\n')
  } finally {
    await rm(file, { force: true })
    await rm(dir, { recursive: true, force: true })
  }
}

describe('the embedded CLI', () => {
  useBoard()

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('names the app that runs it in help, usage, and errors, and has no serve or inspect', async () => {
    const app = createApp({ appName: 'vercel board' })
    const help = await capture(() => app.run(['help']))
    expect(help.code).toBe(0)
    expect(help.stdout).toMatch(/^vercel board \d+\.\d+\.\d+\S*: a message board you mount in one route\n\nusage: vercel board <command> \[options\]\n/)
    expect(help.stdout).not.toMatch(/also installed as|^\s+(serve|inspect) \[/m)
    expect(await capture(() => app.run(['serve']))).toMatchObject({ code: 2, stderr: 'error: unknown command: serve (run `vercel board help`)\n' })
    expect(await capture(() => app.run(['inspect']))).toMatchObject({ code: 2 })
    expect(await capture(() => app.run(['conformance', 'extra']))).toMatchObject({ code: 2, stderr: 'error: usage: vercel board conformance [--channel <c>]\n' })
    expect(await capture(() => app.run(['--nope']))).toMatchObject({ code: 2, stderr: expect.stringContaining('(run `vercel board help`;') })
  })

  it("talks to the team's board in Vercel's API when nothing points at another: the linked project's team's, or --scope's", async () => {
    const home = await isolated()
    await mkdir(join(home, '.vercel'))
    await writeFile(join(home, '.vercel', 'project.json'), JSON.stringify({ orgId: 'team_test', projectId: 'prj_app' }))
    vi.stubEnv('VERCEL_AUTH_TOKEN', 'user:u_jb')
    const api = fakeMessageboard({ slug: 'acme' })
    const asked: string[] = []
    const fetching = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      asked.push(String(input instanceof Request ? input.url : input))
      return api.fetch(input, init)
    })
    const cwd = process.cwd()
    process.chdir(home)
    try {
      const app = createApp({ appName: 'vercel board' })
      expect(await capture(() => app.run(['post', 'general', 'on the team board']))).toMatchObject({ code: 0 })
      const whoami = await capture(() => app.run(['whoami']))
      expect(whoami.code).toBe(0)
      expect(whoami.stdout).toContain('board   https://api.vercel.com/v1/messageboard/boards/brd_test\nsource  the Vercel CLI\n')
      const read = await capture(() => app.run(['read', 'general', '--scope', 'acme', '--json']))
      expect(read.code).toBe(0)
      expect(JSON.parse(read.stdout.trim().split('\n')[0]!)).toMatchObject({ message: { text: 'on the team board' } })
    } finally {
      fetching.mockRestore()
      process.chdir(cwd)
      await rm(home, { recursive: true, force: true })
    }
    const teams = asked.map((at) => {
      const { origin, searchParams } = new URL(at)
      return `${origin} ${searchParams.get('teamId') ?? `slug=${searchParams.get('slug')}`}`
    })
    expect(new Set(teams)).toEqual(new Set(['https://api.vercel.com team_test', 'https://api.vercel.com slug=acme']))
  })

  it('says how to point it at a board with the commands it has, standalone, where there is no team board', async () => {
    const home = await isolated()
    const cwd = process.cwd()
    process.chdir(home)
    try {
      expect(await capture(() => main(['read', 'dev'], { name: 'board', commands: local }))).toMatchObject({
        code: 1,
        stderr: 'error: no board URL: run `board link <url>`, set BOARD_URL, run `board use <url>`, or `board serve` for a local one\n',
      })
    } finally {
      process.chdir(cwd)
      await rm(home, { recursive: true, force: true })
    }
  })

  it('leaves the standalone board as it was: serve and inspect in its help, after wait', async () => {
    const help = await capture(() => main(['help'], { name: 'board', commands: local }))
    expect(help.stdout).toMatch(/^usage: board <command> \[options\]      \(also installed as `vb`\)$/m)
    expect(help.stdout).toContain('(124 on timeout)\n\n  inspect [--port N] [--no-open]')
    expect(help.stdout).toContain('(or --handle)\n\nfilters:')
  })

  it("takes the login the Vercel CLI hands it in VERCEL_AUTH_TOKEN, never a token cached for someone else's", async () => {
    const home = await isolated()
    // A token `vercel login`'s account minted for this board, cached as board caches them.
    const tokens = join(home, 'board', 'tokens')
    await mkdir(tokens, { recursive: true })
    const audience = 'https://board.example/api/board'
    await writeFile(join(tokens, `${createHash('sha256').update(audience).digest('hex').slice(0, 32)}.json`), JSON.stringify({ token: 'someone-elses', expiresAt: Date.now() + 3_600_000, name: null, avatar: null }))
    vi.stubEnv('VERCEL_AUTH_TOKEN', 'vca_from_the_vercel_cli')
    vi.stubEnv('BOARD_URL', 'https://board.example/api/board')
    const asked: string[] = []
    const fetching = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      asked.push(`${url} ${new Headers(init?.headers).get('authorization') ?? ''}`)
      if (url.replace(/\/$/, '') === 'https://board.example/api/board') return Response.json({ version: '0', url: 'https://board.example/api/board', audience: 'https://board.example/api/board', team_id: 'team_1', project_id: 'prj_board', sync: [] })
      return Response.json({ error: { code: 'forbidden', message: 'no' } }, { status: 403 })
    })
    try {
      await capture(() => createApp({ appName: 'vercel board' }).run(['whoami']))
    } finally {
      fetching.mockRestore()
      await rm(home, { recursive: true, force: true })
    }
    expect(asked.filter((line) => line.startsWith('https://api.vercel.com/')).every((line) => line.endsWith('Bearer vca_from_the_vercel_cli'))).toBe(true)
    expect(asked.some((line) => line.startsWith('https://api.vercel.com/'))).toBe(true)
  })

  it('leaves no Ctrl-C handler behind once wait or tail is done, since the process it runs in goes on', async () => {
    await isolated()
    vi.stubEnv('BOARD_URL', url)
    vi.stubEnv('BOARD_TOKEN', env.BOARD_TOKEN)
    const before = process.listenerCount('SIGINT')
    const app = createApp({ appName: 'vercel board' })
    expect((await capture(() => app.run(['wait', 'quiet', '--timeout', '1s']))).code).toBe(124)
    // No board answers there, so tail fails before it reads anything.
    vi.stubEnv('BOARD_URL', url.replace(/\/api\/board$/, '/nowhere'))
    expect((await capture(() => app.run(['tail', 'quiet']))).code).toBe(1)
    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  it('never brings the inspector, serve, or A2 into an app that bundles it', async () => {
    const embedded = await bundled("import { createApp } from '../src/cli/embedded.ts'\nawait createApp({ appName: 'vercel board' }).run(process.argv.slice(2))")
    for (const [what, marker] of Object.entries(MARKERS)) expect(embedded.includes(marker), `${what} in the embedded CLI`).toBe(false)
    // The standalone CLI has all three, so the markers find what they look for.
    const standalone = await bundled("import '../src/cli/bin.ts'")
    for (const [what, marker] of Object.entries(MARKERS)) expect(standalone.includes(marker), `${what} in the standalone CLI`).toBe(true)
  }, 120_000)
})
