import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from './http.ts'
import { personToken, testBoard } from './harness.ts'

const CLI = join(import.meta.dirname, '../src/cli/main.ts')

let server: Awaited<ReturnType<typeof serve>>
let url: string
let env: NodeJS.ProcessEnv

beforeAll(async () => {
  // No fixed URL: the board infers its own from requests, as when mounted.
  server = await serve(testBoard({ url: undefined }).fetch)
  url = `${server.origin}/api/board`
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(CLAUDE|CODEX|GROK|JUST_BOARD|VERCEL|ACTIONS_ID_TOKEN)/.test(key),
    ),
  )
  env = {
    ...clean,
    JUST_BOARD_URL: url,
    JUST_BOARD_TOKEN: await personToken('u_julian', url),
    JUST_BOARD_HANDLE: 'julian',
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'just-board-')),
  }
})
afterAll(() => server.close())

function jb(args: string[], extra: NodeJS.ProcessEnv = {}, stdin?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...env, ...extra } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

describe('cli', () => {
  it('posts, replies, reacts, labels, and reads a thread', async () => {
    const posted = await jb(['post', 'errors-www', 'deploy failed on a1b2c3', '--label', 'status=open'])
    expect(posted).toMatchObject({ code: 0, stderr: '' })
    const id = posted.stdout.trim()
    expect(id).toMatch(/^\d+$/)

    const reply = await jb(['reply', id, '-', '--as', 'claude'], {}, 'rolled back to d4e5f6\n')
    expect(reply.code).toBe(0)
    expect((await jb(['react', id, '👀'])).code).toBe(0)
    expect((await jb(['label', id, 'status=investigating'])).code).toBe(0)

    const read = await jb(['read', 'errors-www'])
    expect(read.code).toBe(0)
    expect(read.stdout).toContain(`#${id}  julian`)
    expect(read.stdout).toContain('[status=investigating]')
    expect(read.stdout).toContain('deploy failed on a1b2c3')
    expect(read.stdout).toContain('👀 julian')
    expect(read.stdout).toContain('↳ #')
    expect(read.stdout).toContain('claude via julian')
    expect(read.stdout).toContain('rolled back to d4e5f6')

    const json = await jb(['read', id, '--json'])
    const lines = json.stdout.trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.map((m: { text: string }) => m.text)).toEqual(['deploy failed on a1b2c3', 'rolled back to d4e5f6'])
  })

  it('reports who you are', async () => {
    const { stdout, code } = await jb(['whoami', '--as', 'codex'])
    expect(code).toBe(0)
    expect(stdout).toContain('codex via julian (vercel:user:u_julian+codex)')
    expect(stdout).toContain(`board  ${url}`)
  })

  it('picks up the profile of a detected agent', async () => {
    const { stdout } = await jb(['whoami', '--json'], { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-1' })
    expect(JSON.parse(stdout)).toMatchObject({ actor: 'vercel:user:u_julian+claude', session: 's-1' })
    const human = await jb(['whoami', '--json', '--human'], { CLAUDECODE: '1' })
    expect(JSON.parse(human.stdout)).toMatchObject({ actor: 'vercel:user:u_julian', profile: null })
  })

  it('waits for a reply, or exits 124 on timeout', async () => {
    const id = (await jb(['post', 'questions', 'anyone?'])).stdout.trim()
    const timedOut = await jb(['wait', '--re', id, '--timeout', '300ms'])
    expect(timedOut).toMatchObject({ code: 124, stderr: 'timed out\n' })

    const waiting = jb(['wait', '--re', id, '--timeout', '10s', '--json'])
    await new Promise((resolve) => setTimeout(resolve, 500))
    await jb(['reply', id, 'me!'])
    const answered = await waiting
    expect(answered.code).toBe(0)
    expect(JSON.parse(answered.stdout).message.text).toBe('me!')
  })

  it('prints one error line and exits 1 on failure, 2 on misuse', async () => {
    expect(await jb(['read', '99999'])).toMatchObject({ code: 1, stderr: 'error: message not found: #99999\n' })
    expect(await jb(['post', 'x', '@nobody'])).toMatchObject({ code: 1, stderr: 'error: unknown mention @nobody\n' })
    expect((await jb(['react', '1', 'not an emoji'])).code).toBe(2)
    expect((await jb(['frobnicate'])).code).toBe(2)
    expect((await jb(['inspect', '--port', 'nope'])).code).toBe(2)
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
    expect(await (await fetch(address)).text()).toContain('as julian')
    child.kill('SIGINT')
    expect(await exited).toBe(0)
  })
})
