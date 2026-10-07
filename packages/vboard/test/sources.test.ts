import { describe, expect, it, vi } from 'vitest'
import { fakePlatform, withSlackClient } from './sync-fixtures.ts'
import { slack, type SlackClient } from '../src/sync/slack.ts'
import { formatSourceRead } from '../src/cli/format.ts'
import { BOARD_URL, caller, personToken, testBoard, workflowToken } from './harness.ts'
import { githubActions } from '../src/server/auth.ts'

const ROOT = '1791389583.493629'
const REPLY = '1791393976.415219'
const PERMALINK = `https://vercel.slack.com/archives/CKIT/p${REPLY.replace('.', '')}?thread_ts=${ROOT}&cid=CKIT`

type Channel = { id: string; name: string; is_member: boolean; is_private?: boolean }
const CHANNELS: Record<string, Channel> = {
  CKIT: { id: 'CKIT', name: 'project-vercel-kit', is_member: true },
  CPRIV: { id: 'CPRIV', name: 'secret', is_member: true, is_private: true },
  COUT: { id: 'COUT', name: 'elsewhere', is_member: false },
}

function setup() {
  const history = vi.fn(async ({ limit }: { channel: string; limit: number }) => ({
    messages: [
      { ts: '1791399999.000002', user: 'U_JB', text: 'latest' },
      { ts: ROOT, user: 'U_ADA', text: 'kit maps slack users to vercel ids', reply_count: 2, thread_ts: ROOT, files: [{ name: 'map.png', permalink: 'https://vercel.slack.com/files/map' }] },
    ].slice(0, limit),
  }))
  const replies = vi.fn(async () => ({
    messages: [
      { ts: ROOT, user: 'U_ADA', text: 'kit maps slack users to vercel ids', reply_count: 1, thread_ts: ROOT },
      { ts: REPLY, bot_profile: { name: 'pi' }, text: 'nice', thread_ts: ROOT },
    ],
  }))
  const join = vi.fn(async () => ({}))
  const web = {
    conversations: {
      list: async () => ({ channels: Object.values(CHANNELS) }),
      info: async ({ channel }: { channel: string }) => ({ channel: CHANNELS[channel] }),
      join, history, replies,
    },
    users: { info: async ({ user }: { user: string }) => ({ user: { id: user, real_name: user === 'U_ADA' ? 'Ada Lovelace' : 'Julian' } }) },
  }
  const s = fakePlatform('slack', withSlackClient(web, false))
  const board = testBoard({
    trustedSources: [githubActions({ repository: 'basehub-ai/www', workflow: '.github/workflows/deploy.yml', can: ['post'] })],
    sync: { slack: slack({ adapter: s.adapter, client: async () => web as unknown as SlackClient, channels: { C1: 'firehose' } }) },
  })
  const webhook = (body: unknown) =>
    board.fetch(new Request(`${BOARD_URL}/webhooks/slack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { board, history, replies, join, webhook }
}

const read = (call: ReturnType<typeof caller>, target: string, limit?: number) =>
  call('GET', `/sources/slack/read?target=${encodeURIComponent(target)}${limit ? `&limit=${limit}` : ''}`)

describe('reading a platform on demand (vb sources <key> read)', () => {
  it('reads a public channel the app is in, oldest first, by name or ID', async () => {
    const { board, history, join } = setup()
    const julian = caller(board.fetch, await personToken())
    const { status, body } = await read(julian, '#project-vercel-kit')
    expect(status).toBe(200)
    expect(body).toEqual({
      channel: 'CKIT', name: 'project-vercel-kit', thread: null,
      messages: [
        { id: ROOT, thread: `CKIT:${ROOT}`, author: 'Ada Lovelace', text: 'kit maps slack users to vercel ids', createdAt: new Date(Number(ROOT) * 1000).toISOString(), replies: 2, files: [{ name: 'map.png', url: 'https://vercel.slack.com/files/map' }] },
        { id: '1791399999.000002', thread: 'CKIT:1791399999.000002', author: 'Julian', text: 'latest', createdAt: new Date(1791399999.000002 * 1000).toISOString(), replies: 0, files: [] },
      ],
    })
    expect((await read(julian, 'CKIT', 1)).body.messages.map((m: { id: string }) => m.id)).toEqual(['1791399999.000002'])
    expect(history).toHaveBeenLastCalledWith({ channel: 'CKIT', limit: 1 })
    expect(join).not.toHaveBeenCalled()
  })

  it('reads the thread a permalink points into, or a channel:ts thread', async () => {
    const { board, replies } = setup()
    const julian = caller(board.fetch, await personToken())
    const { body } = await read(julian, PERMALINK)
    expect(replies).toHaveBeenCalledWith({ channel: 'CKIT', ts: ROOT, limit: 50 })
    expect(body.thread).toBe(ROOT)
    expect(body.messages.map((m: { author: string; text: string }) => `${m.author}: ${m.text}`)).toEqual(['Ada Lovelace: kit maps slack users to vercel ids', 'pi: nice'])
    expect((await read(julian, `CKIT:${ROOT}`)).body.thread).toBe(ROOT)
  })

  it("won't read private channels or channels the app isn't in, and never joins", async () => {
    const { board, history, join } = setup()
    const julian = caller(board.fetch, await personToken())
    const secret = await read(julian, 'CPRIV')
    expect(secret.status).toBe(403)
    expect(secret.body.error).toMatchObject({ code: 'private_channel' })
    const outside = await read(julian, '#elsewhere')
    expect(outside.status).toBe(403)
    expect(outside.body.error.code).toBe('not_in_channel')
    expect(outside.body.error.message).toContain("won't join on its own")
    expect(history).not.toHaveBeenCalled()
    expect(join).not.toHaveBeenCalled()
    const nonsense = await read(julian, 'not a channel')
    expect(nonsense.status).toBe(400)
    expect(nonsense.body.error.code).toBe('invalid_target')
  })

  it('stores nothing, and the board still only listens to configured channels', async () => {
    const { board, webhook } = setup()
    const julian = caller(board.fetch, await personToken())
    await read(julian, '#project-vercel-kit')
    await webhook({ type: 'message', threadId: `slack:CKIT:${ROOT}`, id: ROOT, text: 'should not sync', user: 'U_ADA' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await julian('GET', '/messages')).body.messages).toEqual([])
    expect((await julian('GET', '/inbox/slack?channel=CKIT')).body.events ?? []).toEqual([])
  })

  it('needs full access, since the app reads more than the caller may', async () => {
    const { board } = setup()
    const workflow = caller(board.fetch, await workflowToken())
    const denied = await read(workflow, '#project-vercel-kit')
    expect(denied.status).toBe(403)
    expect(denied.body.error.message).toContain('full access')
  })

  it('prints a channel with how to open each thread', () => {
    const now = Number(ROOT) * 1000 + 3_600_000
    const channel = formatSourceRead('slack', {
      channel: 'CKIT', name: 'project-vercel-kit', thread: null,
      messages: [{ id: ROOT, thread: `CKIT:${ROOT}`, author: 'Ada', text: 'kit maps users\nto vercel ids', createdAt: new Date(Number(ROOT) * 1000).toISOString(), replies: 2, files: [{ name: 'map.png', url: null }] }],
    }, now)
    expect(channel.split('\n')).toEqual([
      'slack:CKIT (#project-vercel-kit)',
      `${ROOT}  Ada · 1h  (2 replies: vb sources slack read CKIT:${ROOT})`,
      '      kit maps users',
      '      to vercel ids',
      '      📎 map.png',
    ])
    const thread = formatSourceRead('slack', {
      channel: 'CKIT', name: null, thread: ROOT,
      messages: [
        { id: ROOT, thread: `CKIT:${ROOT}`, author: 'Ada', text: 'root', createdAt: null, replies: 1, files: [] },
        { id: REPLY, thread: `CKIT:${ROOT}`, author: 'pi', text: 'nice', createdAt: null, replies: 0, files: [] },
      ],
    })
    expect(thread.split('\n')).toEqual([`slack:CKIT, thread ${ROOT}`, `${ROOT}  Ada`, '      root', `  ↳ ${REPLY}  pi`, '    nice'])
  })
})
