import { describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { http } from '../src/backend-http/index.ts'
import { vb } from '../src/cli/embedded.ts'
import { personToken, testBoard, BOARD_URL } from './harness.ts'

// vb() on a handle over HTTP to an in-process board: the CLI's commands, output, and exit codes,
// with files from its options. The CLI itself runs through the same code (cli*.test.ts).
async function handle() {
  const served = testBoard()
  const token = await personToken('u_ada', BOARD_URL)
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set('authorization', `Bearer ${token}`)
    return served.fetch(request)
  }) as typeof globalThis.fetch
  return board({ backend: http(BOARD_URL, { fetch }) }).as(null)
}

describe('vb()', () => {
  it('posts, replies, and reads a thread as the CLI prints it', async () => {
    const team = await handle()
    const posted = await vb(team, ['post', 'dev', 'the build is red', '--no-sync'])
    expect(posted).toMatchObject({ code: 0, stderr: '' })
    const id = posted.stdout.trim()
    expect(id).toMatch(/^\d+$/)
    expect((await vb(team, ['reply', id, 'on it', '--no-sync'])).code).toBe(0)
    expect((await vb(team, ['label', id, 'kind=bug'])).code).toBe(0)
    const read = await vb(team, ['read', `#${id}`])
    expect(read.code).toBe(0)
    expect(read.stdout).toMatch(new RegExp(`^#${id} .*\\[kind=bug\\]\\n\\s+the build is red\\n\\s+↳ #\\d+ .*\\n\\s+on it\\n$`))
    const json = (await vb(team, ['read', id, '--json'])).stdout.trim().split('\n').map((line: string) => JSON.parse(line))
    expect(json.map((m: { text: string }) => m.text)).toEqual(['the build is red', 'on it'])
    expect((await vb(team, ['read', 'dev', '--text', 'build'])).stdout).toMatch(/^dev · 1 thread · cursor/)
  })

  it("takes the Vercel CLI's short letters and aliases, and refuses an alias as the command it is", async () => {
    const team = await handle()
    for (const text of ['one', 'two']) await vb(team, ['post', 'dev', text, '--no-sync'])
    expect((await vb(team, ['read', 'dev', '-n', '1', '--json'])).stdout.trim().split('\n')).toHaveLength(1)
    const first = (await vb(team, ['post', 'dev', 'gone soon', '--no-sync'])).stdout.trim()
    // A caller that doesn't delete doesn't by another name either.
    expect(await vb(team, ['rm', first], { refuse: ['delete'] })).toMatchObject({ code: 2, stderr: "error: delete isn't available here\n" })
    // However its flags are grouped: -a and -n with its value, before the command.
    expect(await vb(team, ['-an', '1', 'delete', first], { refuse: ['delete'] })).toMatchObject({ code: 2, stderr: "error: delete isn't available here\n" })
    expect(JSON.parse((await vb(team, ['read', first, '--json'])).stdout).deleted).toBe(false)
    expect((await vb(team, ['rm', first])).code).toBe(0)
    expect(JSON.parse((await vb(team, ['read', first, '--json'])).stdout).deleted).toBe(true)
    const second = (await vb(team, ['post', 'dev', 'gone too', '--no-sync'])).stdout.trim()
    expect((await vb(team, ['del', second])).code).toBe(0)
    expect(JSON.parse((await vb(team, ['read', second, '--json'])).stdout).deleted).toBe(true)
  })

  it('says what the CLI says when something is wrong, with its exit codes', async () => {
    const team = await handle()
    expect(await vb(team, ['read', 'dve'])).toEqual({ code: 1, stdout: '', stderr: 'error: no channel dve: board channels lists them\n' })
    expect(await vb(team, ['label', '1', 'nope'])).toMatchObject({ code: 2, stderr: 'error: labels look like key=value, got: nope\n' })
    expect(await vb(team, ['frobnicate'])).toMatchObject({ code: 2, stderr: 'error: unknown command: frobnicate (run `board help`)\n' })
    expect((await vb(team, ['read', '--bogus'])).stderr).toMatch(/^error: unknown option: --bogus/)
    expect((await vb(team, ['help'])).stdout).toMatch(/^board \S+: a message board/)
    // --help is help, never the command it's on: that command's page.
    const id = (await vb(team, ['post', 'dev', 'keep me', '--no-sync'])).stdout.trim()
    for (const flag of ['--help', '-h']) expect((await vb(team, ['delete', id, flag])).stdout).toMatch(/^usage: board delete <id>\n/)
    expect(JSON.parse((await vb(team, ['read', id, '--json'])).stdout).deleted).toBe(false)
  })

  it("refuses what's the CLI's: another board or handle, and the commands about its machine", async () => {
    const team = await handle()
    expect(await vb(team, ['read', '--url', 'https://elsewhere.test/api/board'])).toMatchObject({ code: 2, stderr: expect.stringMatching(/--url doesn't apply/) })
    // tail and wait hold every later call: only with a signal to stop them.
    for (const args of [['tail', 'dev'], ['wait', 'dev'], ['--as', 'triage', 'tail', 'dev'], ['--timeout', '1m', 'wait']])
      expect(await vb(team, args)).toMatchObject({ code: 2, stderr: expect.stringMatching(/pass a signal/) })
    for (const args of [['--as', 'x', 'tail', 'dev'], ['--mentions', 'tail', 'dev'], ['--mentions', '@ada', 'tail', 'dev']])
      expect(await vb(team, args, { signal: new AbortController().signal, refuse: ['tail'] })).toEqual({ code: 2, stdout: '', stderr: "error: tail isn't available here\n" })
    expect((await vb(team, ['read', 'dev', '--text', 'tail'], { refuse: ['tail'] })).stderr).not.toMatch(/isn't available here/)
    const controller = new AbortController()
    const tail = vb(team, ['tail', 'dev'], { signal: controller.signal })
    controller.abort()
    await tail
    expect(await vb(team, ['channels'])).toMatchObject({ code: 0, stdout: 'no channels yet\n' })
    for (const command of ['whoami', 'serve', 'hooks', 'inspect'])
      expect(await vb(team, [command])).toMatchObject({ code: 2, stderr: expect.stringMatching(new RegExp(`${command} isn't available in-process`)) })
  })

  it('attaches and downloads through its readFile and writeFile, and - reads its stdin', async () => {
    const team = await handle()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const saved = new Map<string, Uint8Array>()
    const files = {
      readFile: async (path: string) => (path === '/work/shot.png' ? png : null),
      writeFile: async (path: string, data: Uint8Array) => void saved.set(path, data),
    }
    expect(await vb(team, ['post', 'dev', 'x', '--attach', '/work/shot.png'])).toMatchObject({ code: 1, stderr: "error: --attach reads files: pass it in vb()'s options\n" })
    expect(await vb(team, ['post', 'dev', 'x', '--attach', '/work/missing.png'], files)).toMatchObject({ code: 2, stderr: 'error: no such file: /work/missing.png\n' })
    const id = (await vb(team, ['post', 'dev', 'proof', '--attach', '/work/shot.png', '--no-sync'], files)).stdout.trim()
    const [root] = (await vb(team, ['read', id, '--json'])).stdout.trim().split('\n').map((line: string) => JSON.parse(line))
    expect(root.attachments).toMatchObject([{ name: 'shot.png', size: png.byteLength }])
    expect(await vb(team, ['download', root.attachments[0].id, '/work/copy.png'], files)).toMatchObject({ code: 0, stdout: '/work/copy.png\n' })
    expect(saved.get('/work/copy.png')).toEqual(png)
    const piped = await vb(team, ['post', 'dev', '-', '--no-sync'], { stdin: 'from stdin\n' })
    expect(JSON.parse((await vb(team, ['read', piped.stdout.trim(), '--json'])).stdout).text).toBe('from stdin')
  })
})
