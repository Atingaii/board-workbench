import { describe, expect, it, vi } from 'vitest'
import { createSlackAdapter } from '@chat-adapter/slack'
import { slack, slackIcon, withoutLabel, type SlackClient } from '../src/sync/slack.ts'
import { channels } from '../src/sync/fn.ts'
import { fakePlatform, withSlackClient } from './sync-fixtures.ts'
import { caller, deploymentToken, personToken, testBoard } from './harness.ts'
import type { CallerRequest, HostPrincipal } from '../src/access/index.ts'

/** A host's own verifier, which names Julián and support's preview deployment by their tokens. */
const PEOPLE: Record<string, HostPrincipal> = {
  pt_julian: { id: 'vercel:user:u_julian', kind: 'person', handle: 'julian' },
  pt_support: { id: 'vercel:project:prj_support:preview', kind: 'deployment', handle: 'support@preview' },
}
const hostVerifier = (request: CallerRequest) =>
  PEOPLE[request.credential ?? ''] ?? Response.json({ error: { code: 'unauthorized', message: 'who are you?' } }, { status: 401 })

const thread = 'C1:1700000000.000100'
const as = { name: 'clever-lemur via vboard-factory', avatar: 'https://cdn.example.com/lemur.png' }
const markdown = `**${as.name}**: on it`

/** The real Slack adapter, kept off the network: board's own client is a fake, and so is the adapter's post. */
function slackWith(scopes: string[] | null, existing: { ts: string; username?: string }[] = []) {
  const adapter = createSlackAdapter({ signingSecret: 'secret', botToken: 'xoxb-test' })
  const internals = adapter as unknown as { initialize(chat: unknown): Promise<void>; chat: unknown }
  internals.initialize = async function (chat) {
    internals.chat = chat
  }
  const viaAdapter: { threadId: string; message: unknown }[] = []
  adapter.postMessage = async (threadId, message) => {
    viaAdapter.push({ threadId, message })
    return { id: '1700000000.000300', threadId, raw: {} }
  }
  const edits: { threadId: string; id: string; message: unknown }[] = []
  adapter.editMessage = async (threadId, id, message) => {
    edits.push({ threadId, id, message })
    return { id, threadId, raw: {} }
  }
  const posted: Record<string, unknown>[] = []
  const client: SlackClient = {
    conversations: {
      list: async () => ({}),
      info: async () => ({}),
      replies: vi.fn(async ({ ts }: { ts: string }) => ({ messages: existing.filter((m) => m.ts === ts) })),
    },
    chat: {
      postMessage: async (args) => {
        posted.push(args)
        return { ts: '1700000000.000200' }
      },
    },
    auth: { test: vi.fn(async () => (scopes ? { response_metadata: { scopes } } : {})) },
  }
  const provider = slack({ adapter, client: async () => client }, channels({}))
  return { provider, posted, viaAdapter, edits, client }
}

describe('messages in Slack', () => {
  it('go out under its own name, with its picture, and without the name repeated in the text', async () => {
    const { provider, posted, viaAdapter } = slackWith(['chat:write', 'chat:write.customize'])
    const sent = await provider.post(thread, 'thread', { markdown, as })
    expect(posted).toEqual([
      expect.objectContaining({
        channel: 'C1',
        thread_ts: '1700000000.000100',
        markdown_text: 'on it',
        username: as.name,
        icon_url: as.avatar,
      }),
    ])
    expect(viaAdapter).toEqual([])
    expect(sent).toEqual({ thread, message: '1700000000.000200' })
  })

  it('start a thread in a channel under its name', async () => {
    const { provider, posted } = slackWith(['chat:write.customize'])
    const sent = await provider.post('C1', 'channel', { markdown, as })
    expect(posted[0]).not.toHaveProperty('thread_ts')
    expect(sent).toEqual({ thread: 'C1:1700000000.000200', message: '1700000000.000200' })
  })

  it('go out as the app, label and all, when the app lacks chat:write.customize; asking Slack only once', async () => {
    const { provider, posted, viaAdapter, client } = slackWith(['chat:write'])
    await provider.post(thread, 'thread', { markdown, as })
    await provider.post(thread, 'thread', { markdown, as })
    expect(posted).toEqual([])
    expect(viaAdapter.map((p) => p.message)).toEqual([{ markdown }, { markdown }])
    expect(client.auth!.test).toHaveBeenCalledTimes(1)
  })

  it("keep going through the adapter, label and all, with files, which can't go out under a name", async () => {
    const { provider, posted, viaAdapter } = slackWith(['chat:write.customize'])
    await provider.post(thread, 'thread', { markdown, as, files: [{ data: Buffer.from('x'), filename: 'a.txt' }] })
    expect(posted).toEqual([])
    expect(viaAdapter.map((p) => p.message)).toEqual([{ markdown, files: [{ data: Buffer.from('x'), filename: 'a.txt' }] }])
  })

  it("keep the label on an edit, without asking Slack how it went out, when the app can't name a sender", async () => {
    const { provider, edits, client } = slackWith(['chat:write'], [{ ts: '1700000000.000200', username: as.name }])
    await provider.edit(thread, '1700000000.000200', { markdown, as })
    expect(edits.map((e) => e.message)).toEqual([{ markdown }])
    expect(client.conversations.replies).not.toHaveBeenCalled()
  })

  it('go out as the app, label and all, when whose word it is would not fit in a Slack username', async () => {
    const { provider, posted, viaAdapter } = slackWith(['chat:write.customize'])
    const attribution = ` via ${'p'.repeat(80)}`
    const long = { name: `Malte${attribution}`, avatar: null, attribution }
    await provider.post(thread, 'thread', { markdown: `**${long.name}**: hi`, as: long })
    expect(posted).toEqual([])
    expect(viaAdapter.map((p) => p.message)).toEqual([{ markdown: `**${long.name}**: hi` }])
  })

  it('drop the label on an edit only when Slack shows the message under that name', async () => {
    const { provider, edits } = slackWith(['chat:write.customize'], [
      { ts: '1700000000.000200', username: as.name },
      { ts: '1700000000.000201' },
    ])
    await provider.edit(thread, '1700000000.000200', { markdown, as })
    await provider.edit(thread, '1700000000.000201', { markdown, as })
    expect(edits.map((e) => e.message)).toEqual([{ markdown: 'on it' }, { markdown }])
  })
})

describe('what board copies to Slack', () => {
  /**
   * A board whose Slack sync mirrors firehose into C1, through an app with these scopes: one whose
   * host's verifier names who's who, or with `verified: false`, one Vercel logins use.
   */
  function mirrored(scopes: string[], verified = true) {
    const posted: Record<string, unknown>[] = []
    const client = {
      conversations: { list: async () => ({}), info: async () => ({}), replies: async () => ({ messages: [] }) },
      chat: { postMessage: async (args: Record<string, unknown>) => (posted.push(args), { ts: `1700000000.00010${posted.length}` }) },
      auth: { test: async () => ({ response_metadata: { scopes } }) },
    }
    const s = fakePlatform('slack', (adapter) => {
      withSlackClient(client, false)(adapter)
      Object.assign(adapter, {
        formatConverter: { toSlackPayload: (message: { markdown: string }) => ({ markdown_text: message.markdown }) },
        decodeThreadId: (id: string) => ({ channel: id.split(':')[1], threadTs: id.split(':')[2] ?? '' }),
      })
    })
    const team = testBoard({ sync: { slack: slack({ adapter: s.adapter, client: async () => client as never }, channels({ C1: 'firehose' })) }, ...(verified ? { authenticate: hostVerifier } : {}) })
    return { team, s, posted, verified }
  }

  /** Who's who on a board `mirrored` made: Julián, his agent, and support's preview deployment. */
  async function callers({ team, verified }: ReturnType<typeof mirrored>) {
    if (verified) await team.createGrant({ principals: [{ kind: 'project', project: 'prj_support', environments: ['preview'] }], can: { '*': 'all' } })
    const token = verified ? 'pt_julian' : await personToken('u_julian')
    return {
      julian: caller(team.fetch, token, { 'x-board-handle': 'julian', 'x-board-name': encodeURIComponent('Julián Benegas'), 'x-board-avatar': 'https://example.com/julian.png' }),
      claude: caller(team.fetch, token, { 'x-board-handle': 'julian', 'x-board-profile': 'claude', 'x-board-avatar': 'https://example.com/claude.png' }),
      support: caller(team.fetch, verified ? 'pt_support' : await deploymentToken('support', 'prj_support', 'preview')),
    }
  }

  /** Julián, his agent, and a Malte support's preview imports through its own Slack key, each posting a thread in firehose. */
  async function post(board: ReturnType<typeof mirrored>) {
    const { julian, claude, support } = await callers(board)
    expect((await support('POST', '/watchers', { watch: {}, sync: [{ key: 'slack-eu', platform: 'slack' }] })).status).toBe(200)
    const malte = { id: 'slack-eu:user:U_MALTE', handle: 'malte', name: 'Malte', avatar: 'https://example.com/malte.png', isBot: false }
    expect((await julian('POST', '/messages', { channel: 'firehose', text: 'the deploy is red' })).status).toBe(201)
    expect((await claude('POST', '/messages', { channel: 'firehose', text: 'looking' })).status).toBe(201)
    expect((await support('POST', '/sync/imports', { op: 'post', author: malte, from: 'slack-eu', channel: 'firehose', text: 'same for us' })).status).toBe(200)
  }

  it("go out under their author's name and picture: a person as themselves, and anyone else via the principal they write for", async () => {
    const board = mirrored(['chat:write', 'chat:write.customize'])
    const { s, posted } = board
    await post(board)
    await vi.waitFor(() => expect(posted).toHaveLength(3))
    expect(posted.map(({ username, icon_url, markdown_text }) => [username, icon_url, markdown_text])).toEqual([
      ['Julián Benegas', 'https://example.com/julian.png', 'the deploy is red'],
      ['claude via julian', 'https://example.com/claude.png', 'looking'],
      ['Malte via support (preview) (slack)', 'https://example.com/malte.png', 'same for us'],
    ])
    expect(s.channelPosts).toEqual([])
  })

  it("cut a long name to fit Slack's username, and keep whose word it is whole", async () => {
    const board = mirrored(['chat:write.customize'])
    const { posted } = board
    const { support } = await callers(board)
    expect((await support('POST', '/watchers', { watch: {}, sync: [{ key: 'slack-eu', platform: 'slack' }] })).status).toBe(200)
    const name = `Malte ${'the very important '.repeat(6)}person`
    const malte = { id: 'slack-eu:user:U_MALTE', handle: 'malte', name, avatar: null, isBot: false }
    expect((await support('POST', '/sync/imports', { op: 'post', author: malte, from: 'slack-eu', channel: 'firehose', text: 'same for us' })).status).toBe(200)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const { username, markdown_text } = posted[0] as { username: string; markdown_text: string }
    expect(Array.from(username).length).toBeLessThanOrEqual(80)
    expect(username).toMatch(/^Malte the very important .*… via support \(preview\) \(slack\)$/)
    expect(markdown_text).toBe('same for us')
  })

  it("go out as the app, each labeled with its author, when the board didn't verify them: a name a caller sent is no sender", async () => {
    const board = mirrored(['chat:write', 'chat:write.customize'], false)
    const { s, posted } = board
    await post(board)
    await vi.waitFor(() => expect(s.channelPosts).toHaveLength(3))
    expect(s.channelPosts.map((p) => JSON.parse(p.text).markdown)).toEqual([
      '**Julián Benegas**: the deploy is red',
      '**claude via julian**: looking',
      '**Malte via support (preview) (slack)**: same for us',
    ])
    expect(posted).toEqual([])
  })

  it('go out as the app, each labeled with its author, when the app lacks chat:write.customize', async () => {
    const board = mirrored(['chat:write'])
    const { s, posted } = board
    await post(board)
    await vi.waitFor(() => expect(s.channelPosts).toHaveLength(3))
    expect(s.channelPosts.map((p) => JSON.parse(p.text).markdown)).toEqual([
      '**Julián Benegas**: the deploy is red',
      '**claude via julian**: looking',
      '**Malte via support (preview) (slack)**: same for us',
    ])
    expect(posted).toEqual([])
  })
})

describe('Slack sender details', () => {
  it('takes out just the label it opens with', () => {
    expect(withoutLabel(markdown, as.name)).toBe('on it')
    expect(withoutLabel(`hi\n${markdown}`, as.name)).toBe(`hi\n${markdown}`)
    expect(withoutLabel('**Ada**: hi', as.name)).toBe('**Ada**: hi')
    expect(withoutLabel('**a.b (x)**: hi', 'a.b (x)')).toBe('hi')
  })

  it("uses only https images Slack can show as the icon, not the board's SVG avatars", () => {
    expect(slackIcon('https://cdn.example.com/lemur.png')).toBe('https://cdn.example.com/lemur.png')
    expect(slackIcon('https://board.example.com/api/board/avatars/pi')).toBeNull()
    expect(slackIcon('https://cdn.example.com/lemur.svg')).toBeNull()
    expect(slackIcon('http://localhost/lemur.png')).toBeNull()
    expect(slackIcon(null)).toBeNull()
  })
})
