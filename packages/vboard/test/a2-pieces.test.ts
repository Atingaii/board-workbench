import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slack } from '../src/sync/slack.ts'
import { fakePlatform } from './sync-fixtures.ts'
import { BOARD_URL, caller, personToken, testBoard } from './harness.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

/** A board on a2() with only a store, a watcher, and Slack synced to `firehose`, in the environment `env`. */
function bare(env: string) {
  vi.stubEnv('NODE_ENV', env)
  const s = fakePlatform('slack')
  const seen: string[] = []
  const board = testBoard({
    blob: undefined,
    sync: { slack: slack({ adapter: s.adapter, channels: { C1: 'firehose' } }) },
    watch: {
      ack: {
        tail: 'firehose',
        run: async ({ event, board }) => {
          if (event.type !== 'message.posted' || event.message?.re !== null) return
          seen.push(event.message.text)
          await board.reply(event.message.id, 'on it')
        },
      },
    },
  })
  const webhook = (body: unknown) =>
    board.fetch(new Request(`${BOARD_URL}/webhooks/slack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { board, s, seen, webhook }
}

afterEach(() => vi.unstubAllEnvs())

/**
 * Whether a directory chmodded to 555 refuses this process a write: not for root, nor for a process
 * that may override file permissions (`CAP_DAC_OVERRIDE`), as some CI containers run.
 */
function readOnlyHolds(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'vboard-probe-'))
  chmodSync(dir, 0o555)
  try {
    writeFileSync(join(dir, 'probe'), '')
    return false
  } catch {
    return true
  } finally {
    chmodSync(dir, 0o755)
  }
}

describe('a2() with no store', () => {
  /** Runs `body` with the working directory at a new temporary directory, prepared by `setup`. */
  async function inDir(body: (dir: string) => Promise<void>, setup: (dir: string) => Promise<void> = async () => {}) {
    const dir = await mkdtemp(join(tmpdir(), 'vboard-store-'))
    const cwd = process.cwd()
    await setup(dir)
    process.chdir(dir)
    try {
      await body(dir)
    } finally {
      process.chdir(cwd)
      await chmod(dir, 0o755)
      if (existsSync(join(dir, '.a2'))) await chmod(join(dir, '.a2'), 0o755)
    }
  }

  it.each(['development', 'production', 'test'])('in %s, keeps the board in SQLite at .a2/dev.db in the working directory', async (env) => {
    vi.stubEnv('NODE_ENV', env)
    await inDir(async (dir) => {
      const first = testBoard({ store: undefined })
      const { body } = await caller(first.fetch, await personToken())('POST', '/messages', { channel: 'dev', text: 'kept on disk' })
      expect(existsSync(join(dir, '.a2', 'dev.db'))).toBe(true)
      // Another board on the file, as after a restart, has it: it was never in memory.
      const again = testBoard({ store: undefined })
      expect((await caller(again.fetch, await personToken())('GET', `/messages/${body.message.id}`)).body.message.text).toBe('kept on disk')
      await Promise.all([first.backend.store.close(), again.backend.store.close()])
    })
  })

  // Where a deployment's files are read-only, as on Vercel outside /tmp: none, or a `.a2` it can't write in.
  const readOnly = {
    'a read-only working directory': async (dir: string) => chmod(dir, 0o555),
    'a read-only .a2': async (dir: string) => {
      await mkdir(join(dir, '.a2'))
      await chmod(join(dir, '.a2'), 0o555)
    },
  }
  it.skipIf(!readOnlyHolds()).each(Object.entries(readOnly))('says what to pass on every request where SQLite can\'t open: %s', async (_, setup) => {
    vi.stubEnv('NODE_ENV', 'production')
    await inDir(async (dir) => {
      const board = testBoard({ store: undefined })
      const julian = caller(board.fetch, await personToken())
      const refused = {
        status: 500,
        body: { error: { code: 'no_store', message: "can't open SQLite at .a2/dev.db: this filesystem isn't writable here, so pass a store to a2()" } },
      }
      expect(await julian('POST', '/messages', { channel: 'dev', text: 'lost?' })).toEqual(refused)
      // Nothing took the post somewhere else: every call after says the same.
      expect(await julian('GET', '/messages?channel=dev')).toEqual(refused)
      expect(await julian('GET', '/me')).toEqual(refused)
      await expect(board.post('dev', 'from the handle')).rejects.toMatchObject({ status: 500, code: 'no_store' })
      expect(existsSync(join(dir, '.a2', 'dev.db'))).toBe(false)
    }, setup)
  })
})

describe('a2() takes a scheduler and a blob store only if you pass them', () => {
  it.each(['development', 'production'])('in %s, runs watchers and sync in the request that wrote, and refuses to schedule', async (env) => {
    const { board, s, seen, webhook } = bare(env)
    const julian = caller(board.fetch, await personToken())
    // Nothing arms a timer: the consumers run in the request that appended, here and in production alike.
    const { body } = await julian('POST', '/messages', { channel: 'firehose', text: 'deploy failed' })
    await vi.waitFor(() => expect(seen).toEqual(['deploy failed']))
    // The watcher's reply, and the root before it, go out to Slack: sync delivers in the request too.
    await vi.waitFor(() => expect(s.channelPosts.map((post) => post.text)).toEqual([expect.stringContaining('deploy failed')]))
    await vi.waitFor(() => expect(s.posts.map((post) => post.text)).toEqual([expect.stringContaining('on it')]))
    // And a Slack message, through the inbox.
    expect((await webhook({ type: 'message', threadId: 'slack:C1:200', id: '200', text: 'export is broken', user: 'U_ADA' })).status).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['deploy failed', 'export is broken']))

    const scheduled = await julian('POST', '/schedules', { re: body.message.id, text: 'still broken?', in: '1d' })
    expect(scheduled).toEqual({
      status: 501,
      body: { error: { code: 'no_scheduler', message: 'this board has no scheduler: pass `scheduler` to `a2()` to send later' } },
    })
    expect((await julian('GET', '/schedules')).body).toEqual({ schedules: [] })
    // Its scheduler route has nothing to run.
    expect((await board.scheduler(new Request(`${BOARD_URL}/a2/scheduler`, { method: 'POST' }))).status).toBe(404)
  })

  it.each(['development', 'production'])('in %s, keeps no files without a blob store, and links the ones sync brings', async (env) => {
    const { board, s, webhook } = bare(env)
    const julian = caller(board.fetch, await personToken())
    const noFiles = { code: 'no_files', message: 'this board keeps no files: pass `blob` to `a2()`' }

    const upload = await board.fetch(
      new Request(`${BOARD_URL}/attachments`, { method: 'POST', headers: { authorization: `Bearer ${await personToken()}`, 'content-type': 'image/png' }, body: PNG }),
    )
    expect(upload.status).toBe(501)
    expect(await upload.json()).toEqual({ error: noFiles })
    expect(await julian('POST', '/messages', { channel: 'dev', text: 'see attached', attachments: ['AAAAAAAAAAAAAAAAAAAAAA'] })).toEqual({ status: 501, body: { error: noFiles } })
    expect(await julian('GET', '/attachments/AAAAAAAAAAAAAAAAAAAAAA')).toEqual({ status: 501, body: { error: noFiles } })
    await expect(board.upload({ data: PNG, name: 'shot.png' })).rejects.toMatchObject({ status: 501, code: 'no_files' })

    // A file posted in Slack comes over as a link to where it lives, with nothing fetched past the first.
    s.served.set('https://files.slack.test/shot.png', PNG)
    await webhook({
      type: 'message', threadId: 'slack:C1:300', id: '300', text: 'the export page', user: 'U_ADA',
      files: [
        { name: 'shot.png', mimeType: 'image/png', url: 'https://files.slack.test/shot.png', size: PNG.byteLength },
        { name: 'run (2).mov', mimeType: 'video/quicktime', url: 'https://files.slack.test/run (2).mov', size: 2048 },
      ],
    })
    await vi.waitFor(async () => {
      const { body } = await julian('GET', '/messages?channel=firehose')
      expect(body.messages.find((message: { from: string | null }) => message.from === 'slack')).toMatchObject({
        text:
          'the export page\n\n' +
          "📎 [shot.png](https://files.slack.test/shot.png) (7 B) didn't come over: this board keeps no files\n" +
          "📎 [run (2).mov](https://files.slack.test/run%20%282%29.mov) (2 KB) didn't come over: this board keeps no files",
        attachments: [],
      })
    })
    expect(s.fetches).toEqual(['https://files.slack.test/shot.png'])
  })
})

describe('localScheduler()', () => {
  it('comes from vboard/backend-a2/scheduler-local, and sends a scheduled message', async () => {
    // Resolved as an app resolves it, through the package's exports, to what the build put there.
    const entry = createRequire(import.meta.url).resolve('@vercel/board/backend-a2/scheduler-local')
    expect(entry).toMatch(/dist\/backend-a2\/scheduler-local\.mjs$/)
    const { localScheduler } = (await import(pathToFileURL(entry).href)) as typeof import('../src/scheduler/local.ts')
    const board = testBoard({ scheduler: localScheduler() })
    const julian = caller(board.fetch, await personToken())
    const { body } = await julian('POST', '/messages', { channel: 'dev', text: 'PR #12 is open' })
    expect((await julian('POST', '/schedules', { re: body.message.id, text: 'friendly ping: review?', in: '1s' })).status).toBe(201)
    await vi.waitFor(
      async () => expect((await julian('GET', `/messages/${body.message.id}`)).body.replies).toEqual([expect.objectContaining({ text: 'friendly ping: review?', schedule: { id: expect.anything(), n: 0 } })]),
      { timeout: 5000 },
    )
  })
})
