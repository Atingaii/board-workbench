import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from './http.ts'
import { personToken, testBoard } from './harness.ts'

const CLI = join(import.meta.dirname, '../src/cli/main.ts')
const TEMP = realpathSync(tmpdir())

let server: Awaited<ReturnType<typeof serve>>
let url: string
let env: NodeJS.ProcessEnv

beforeAll(async () => {
  // No fixed URL: the board infers its own from requests, as when mounted.
  server = await serve(testBoard({ url: undefined }).fetch)
  url = `${server.origin}/api/board`
  // Every variable `detectAgent` reads, so the suite passes inside an agent's session too (Pi's included).
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(CLAUDE|CODEX|GROK|PI_|AI_AGENT|VBOARD|VERCEL|ACTIONS_ID_TOKEN)/.test(key),
    ),
  )
  env = {
    ...clean,
    VBOARD_URL: url,
    VBOARD_TOKEN: await personToken('u_julian', url),
    VBOARD_HANDLE: 'julian',
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'vboard-')),
  }
})
afterAll(() => server.close())

function vb(args: string[], extra: NodeJS.ProcessEnv = {}, stdin?: string, cwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...env, ...extra }, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

function vb_in(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...env, ...extra } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    child.stdin.end()
  })
}

describe('cli', () => {
  it('links a checkout from a subdirectory, ignores the link, and reads it from other subdirectories', async () => {
    const root = await mkdtemp(join(TEMP, 'vboard-link-'))
    const directory = join(root, 'packages', 'app')
    const global = await mkdtemp(join(tmpdir(), 'vboard-global-'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(root, '.git'), 'gitdir: /worktree')
    await writeFile(join(root, '.gitignore'), 'node_modules')
    await mkdir(join(global, 'vboard'))
    await writeFile(join(global, 'vboard', 'config.json'), JSON.stringify({ url: 'http://global.invalid/api/board' }))
    const local = { VBOARD_URL: undefined, XDG_CONFIG_HOME: global }

    expect(await vb(['link', `${url}/`], local, undefined, directory)).toMatchObject({
      code: 0, stderr: '', stdout: `linked ${root} to ${url}\n`,
    })
    expect(JSON.parse(await readFile(join(root, '.vboard', 'config.json'), 'utf8'))).toEqual({ url })
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('node_modules\n.vboard/\n')
    expect(JSON.parse(await readFile(join(global, 'vboard', 'config.json'), 'utf8'))).toEqual({ url: 'http://global.invalid/api/board' })
    expect(await vb(['whoami', '--json'], local, undefined, directory)).toMatchObject({ code: 0, stderr: '' })

    expect((await vb(['link', url], local, undefined, root)).code).toBe(0)
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('node_modules\n.vboard/\n')
  }, 20_000)

  it('links a directory without Git in place', async () => {
    const root = await mkdtemp(join(TEMP, 'vboard-link-'))
    expect((await vb(['link', url], {}, undefined, root)).code).toBe(0)
    expect(JSON.parse(await readFile(join(root, '.vboard', 'config.json'), 'utf8'))).toEqual({ url })
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.vboard/\n')
  })

  it('lets explicit and environment URLs override the project link', async () => {
    const root = await mkdtemp(join(TEMP, 'vboard-link-'))
    await mkdir(join(root, '.vboard'))
    await writeFile(join(root, '.vboard', 'config.json'), JSON.stringify({ url: 'http://project.invalid/api/board' }))
    const fromEnv = await vb(['whoami', '--json'], {}, undefined, root)
    expect(fromEnv.code).toBe(0)
    expect(JSON.parse(fromEnv.stdout).board).toBe(url)
    const explicit = await vb(['whoami', '--url', url, '--json'], { VBOARD_URL: 'http://env.invalid/api/board' }, undefined, root)
    expect(explicit.code).toBe(0)
    expect(JSON.parse(explicit.stdout).board).toBe(url)
  }, 20_000)

  it('stops at a nested Git checkout and falls back to the global board', async () => {
    const root = await mkdtemp(join(TEMP, 'vboard-link-'))
    const nested = join(root, 'other-project')
    const global = await mkdtemp(join(tmpdir(), 'vboard-global-'))
    await mkdir(join(root, '.vboard'))
    await writeFile(join(root, '.vboard', 'config.json'), JSON.stringify({ url: 'http://parent.invalid/api/board' }))
    await mkdir(join(nested, '.git'), { recursive: true })
    const local = { VBOARD_URL: undefined, XDG_CONFIG_HOME: global }
    expect((await vb(['use', url], local, undefined, nested)).code).toBe(0)
    const me = await vb(['whoami', '--json'], local, undefined, nested)
    expect(me.code).toBe(0)
    expect(JSON.parse(me.stdout).board).toBe(url)
  }, 20_000)

  it('reports a malformed project link instead of using the global board', async () => {
    const root = await mkdtemp(join(TEMP, 'vboard-link-'))
    const global = await mkdtemp(join(tmpdir(), 'vboard-global-'))
    await mkdir(join(root, '.vboard'))
    const local = { VBOARD_URL: undefined, XDG_CONFIG_HOME: global }
    expect((await vb(['use', url], local, undefined, root)).code).toBe(0)
    for (const contents of ['{', '{"url":12}', '{"url":"ftp://board.test"}']) {
      await writeFile(join(root, '.vboard', 'config.json'), contents)
      expect(await vb(['whoami'], local, undefined, root)).toMatchObject({
        code: 1,
        stderr: `error: invalid board link at ${join(root, '.vboard', 'config.json')}: expected an http(s) url\n`,
      })
    }
    expect((await vb(['whoami', '--url', url], local, undefined, root)).code).toBe(0)
  }, 20_000)

  it('keeps the link when discovery fails and rejects missing or extra arguments', async () => {
    const root = await mkdtemp(join(TEMP, 'vboard-link-'))
    expect((await vb(['link', url], {}, undefined, root)).code).toBe(0)
    const path = join(root, '.vboard', 'config.json')
    const before = await readFile(path, 'utf8')
    const unavailable = await serve(async () => new Response('unavailable', { status: 503 }))
    try {
      expect((await vb(['link', unavailable.origin], {}, undefined, root)).code).toBe(1)
    } finally {
      await unavailable.close()
    }
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(await vb(['link'], {}, undefined, root)).toMatchObject({ code: 2, stderr: 'error: usage: vboard link <url>\n' })
    expect(await vb(['link', url, 'dev'], {}, undefined, root)).toMatchObject({ code: 2, stderr: 'error: usage: vboard link <url>\n' })
  }, 20_000)

  it('posts, replies, reacts, labels, and reads a thread', async () => {
    const posted = await vb(['post', 'errors-www', 'deploy failed on a1b2c3', '--label', 'status=open'])
    expect(posted).toMatchObject({ code: 0, stderr: '' })
    const id = posted.stdout.trim()
    expect(id).toMatch(/^\d+$/)

    const reply = await vb(['reply', id, '-', '--as', 'claude'], {}, 'rolled back to d4e5f6\n')
    expect(reply.code).toBe(0)
    expect((await vb(['react', id, '👀'])).code).toBe(0)
    // This board syncs nowhere, so typing shows nowhere, and that's fine.
    expect(await vb(['typing', id])).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect((await vb(['label', id, 'status=investigating'])).code).toBe(0)

    const read = await vb(['read', 'errors-www'])
    expect(read.code).toBe(0)
    expect(read.stdout).toContain(`#${id}  julian`)
    expect(read.stdout).toContain('[status=investigating]')
    expect(read.stdout).toContain('deploy failed on a1b2c3')
    expect(read.stdout).toContain('👀 julian')
    expect(read.stdout).toContain('↳ #')
    expect(read.stdout).toContain('claude via julian')
    expect(read.stdout).toContain('rolled back to d4e5f6')

    const json = await vb(['read', id, '--json'])
    const lines = json.stdout.trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.map((m: { text: string }) => m.text)).toEqual(['deploy failed on a1b2c3', 'rolled back to d4e5f6'])
  })

  it('filters by mentions of me, or of a handle', async () => {
    await vb(['post', 'pings', 'hello'])
    await vb(['post', 'pings', 'hey @julian, look', '--as', 'claude'])
    const texts = async (args: string[]) => {
      const { stdout } = await vb(['read', 'pings', ...args, '--json'])
      return stdout.trim().split('\n').map((line) => (JSON.parse(line) as { text: string }).text)
    }
    expect(await texts(['--mentions'])).toEqual(['hey @julian, look'])
    expect(await texts(['--mentions', '@julian'])).toEqual(['hey @julian, look'])
  })

  it('reports who you are', async () => {
    const { stdout, code } = await vb(['whoami', '--as', 'codex'])
    expect(code).toBe(0)
    expect(stdout).toContain('codex via julian (vercel:user:u_julian+codex)')
    expect(stdout).toContain(`board  ${url}`)
  })

  it('picks up the profile of a detected agent', async () => {
    const { stdout } = await vb(['whoami', '--json'], { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-1' })
    expect(JSON.parse(stdout)).toMatchObject({ actor: 'vercel:user:u_julian+claude', session: 's-1' })
    const human = await vb(['whoami', '--json', '--human'], { CLAUDECODE: '1' })
    expect(JSON.parse(human.stdout)).toMatchObject({ actor: 'vercel:user:u_julian', profile: null })
  })

  it('waits for a reply, or exits 124 on timeout', async () => {
    const id = (await vb(['post', 'questions', 'anyone?'])).stdout.trim()
    const timedOut = await vb(['wait', '--re', id, '--timeout', '300ms'])
    expect(timedOut).toMatchObject({ code: 124, stderr: 'timed out\n' })

    const waiting = vb(['wait', '--re', id, '--timeout', '10s', '--json'])
    await new Promise((resolve) => setTimeout(resolve, 500))
    await vb(['reply', id, 'me!'])
    const answered = await waiting
    expect(answered.code).toBe(0)
    expect(JSON.parse(answered.stdout).message.text).toBe('me!')
  })

  it('attaches files, shows them, and downloads them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vboard-files-'))
    const shot = join(dir, 'after.png')
    await writeFile(shot, Buffer.from([137, 80, 78, 71]))
    const posted = await vb(['post', 'proofs', '--attach', shot])
    expect(posted).toMatchObject({ code: 0, stderr: '' })
    const id = posted.stdout.trim()
    const reply = await vb(['reply', id, 'and the log', '--attach', shot, '--json'])
    const [attachment] = JSON.parse(reply.stdout).attachments
    expect(attachment).toMatchObject({ name: 'after.png', type: 'image/png', size: 4 })

    const read = await vb(['read', id])
    expect(read.stdout).toContain(`📎 after.png · image/png · 4 B · ${attachment.id}`)

    const saved = join(dir, 'copy.png')
    expect(await vb(['download', attachment.id, saved])).toMatchObject({ code: 0, stdout: `${saved}\n` })
    expect(await readFile(saved)).toEqual(Buffer.from([137, 80, 78, 71]))
    expect(await vb(['post', 'proofs', 'x', '--attach', join(dir, 'missing.png')])).toMatchObject({ code: 2, stderr: `error: no such file: ${join(dir, 'missing.png')}\n` })
  }, 20_000) // five CLI runs: a cold start right after install can pass the default 5s

  it('installs turn-end hooks for Claude Code and Codex, keeping what else is there', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vboard-home-'))
    const at = { HOME: home, CODEX_HOME: join(home, '.codex') }
    await mkdir(join(home, '.claude'), { recursive: true })
    const settings = join(home, '.claude', 'settings.json')
    const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }], PreToolUse: [] } }
    await writeFile(settings, JSON.stringify(theirs))

    const installed = await vb(['hooks', 'install'], at)
    expect(installed).toMatchObject({ code: 0, stderr: '' })
    expect(installed.stdout).toContain('Codex: added the turn-end hook')
    expect((await vb(['hooks', 'install', 'claude'], at)).stdout).toContain('Claude Code: already installed')
    const claude = JSON.parse(await readFile(settings, 'utf8'))
    expect(claude.model).toBe('opus')
    expect(claude.hooks.PreToolUse).toEqual([])
    expect(claude.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'say done' }] },
      { hooks: [{ type: 'command', command: expect.stringMatching(/ hook stop --agent claude$/), timeout: 10 }] },
    ])
    const codex = JSON.parse(await readFile(join(home, '.codex', 'hooks.json'), 'utf8'))
    expect(codex.hooks.Stop[0].hooks[0].command).toMatch(/ hook stop --agent codex$/)
    expect((await vb(['hooks', 'status'], at)).stdout).toMatch(/Claude Code: .* hook stop --agent claude\nCodex: .* hook stop --agent codex/)

    expect((await vb(['hooks', 'uninstall', 'claude'], at)).stdout).toContain('removed')
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual(theirs)
    expect((await vb(['hooks', 'install', 'cursor'], at))).toMatchObject({ code: 2, stderr: 'error: unknown agent: cursor (known: claude, codex)\n' })
  })

  it("asks an agent once to update the board when its turn didn't, and posts updates to the branch's work thread", async () => {
    const repo = await mkdtemp(join(tmpdir(), 'vboard-repo-'))
    execFileSync('git', ['init', '-q', '-b', 'feat/hooks'], { cwd: repo })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], { cwd: repo })
    // Markers live in the temp directory: fresh session IDs keep runs apart.
    const s1 = `s1-${Date.now()}`
    const stop = (session: string, continuing = false, extra: NodeJS.ProcessEnv = {}) =>
      vb(['hook', 'stop', '--agent', 'claude'], extra, JSON.stringify({ session_id: session, cwd: repo, hook_event_name: 'Stop', stop_hook_active: continuing }))
    const asks = async (result: Promise<{ stdout: string; code: number }>) => {
      const { stdout, code } = await result
      expect(code).toBe(0)
      return stdout ? (JSON.parse(stdout) as { decision: string; reason: string }) : null
    }

    // A turn that didn't touch the board is asked once; the agent's follow-up stops freely.
    const asked = await asks(stop(s1))
    expect(asked).toMatchObject({ decision: 'block', reason: expect.stringContaining(' update "<summary>"') })
    expect(asked!.reason).toContain('update --skip')
    expect(await asks(stop(s1, true))).toBeNull()

    // The agent updates: the next turn end doesn't ask. The one after, with no update, does.
    const claude = { CLAUDE_CODE_SESSION_ID: s1 }
    const first = await vb_in(repo, ['update', 'Added the hooks; tests next.'], claude)
    expect(first).toMatchObject({ code: 0, stderr: '' })
    expect(await asks(stop(s1))).toBeNull()
    expect(await asks(stop(s1))).not.toBeNull()
    expect(await asks(stop(s1))).toBeNull() // asked already this turn
    await vb_in(repo, ['update', '--skip'], claude)
    expect(await asks(stop(s1))).toBeNull()

    // Another agent's update on the same branch joins the same thread.
    await vb_in(repo, ['update', 'Picked it up in Codex; tests pass.'], { CODEX_THREAD_ID: 't1' })
    const thread = await vb(['read', first.stdout.trim(), '--json'])
    const [root, ...replies] = thread.stdout.trim().split('\n').map((line) => JSON.parse(line))
    expect(root).toMatchObject({ channel: 'work', noSync: true, labels: { work: 'acme/app@feat/hooks', repo: 'acme/app', branch: 'feat/hooks' } })
    expect(replies.map((r: { text: string; by: { profile: string; session: string } }) => [r.by.profile, r.by.session, r.text])).toEqual([
      ['claude', s1, 'Added the hooks; tests next.'],
      ['codex', 't1', 'Picked it up in Codex; tests pass.'],
    ])

    // Outside a linked project, the hook stays out of the way.
    expect(await asks(stop(`s2-${Date.now()}`, false, { VBOARD_URL: '' }))).toBeNull()
  })

  it('prints one error line and exits 1 on failure, 2 on misuse', async () => {
    expect(await vb(['read', '99999'])).toMatchObject({ code: 1, stderr: 'error: message not found: #99999\n' })
    expect(await vb(['post', 'x', '@nobody'])).toMatchObject({ code: 1, stderr: 'error: unknown mention @nobody\n' })
    expect((await vb(['react', '1', 'not an emoji'])).code).toBe(2)
    expect((await vb(['typing'])).code).toBe(2)
    expect((await vb(['frobnicate'])).code).toBe(2)
    expect((await vb(['inspect', '--port', 'nope'])).code).toBe(2)
  })

  it('serves the inspector until Ctrl-C', async () => {
    const child = spawn(process.execPath, [CLI, 'inspect', '--port', '0', '--no-open'], { env })
    const exited = new Promise<number | null>((resolve) => child.on('close', resolve))
    let stdout = ''
    const address = await new Promise<string>((resolve) =>
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const found = /at (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)
        if (found) resolve(found[1]!)
      }),
    )
    expect(stdout).toContain(`inspecting ${url} as julian`)
    expect(await (await fetch(address)).text()).toContain('<div id="root"></div>')
    child.kill('SIGINT')
    expect(await exited).toBe(0)
  })
})
