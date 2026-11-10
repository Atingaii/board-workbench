import { describe, expect, it, vi } from 'vitest'
import { createSlackAdapter } from '@chat-adapter/slack'
import { slack, slackIcon, withoutLabel, type SlackClient } from '../src/sync/slack.ts'
import { channels } from '../src/sync/fn.ts'
import { fakePlatform, withSlackClient } from './sync-fixtures.ts'
import { caller, deploymentToken, personToken, testBoard } from './harness.ts'

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
  /** A board whose Slack sync mirrors firehose into C1, through an app with these scopes. */
  function mirrored(scopes: string[]) {
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
    const team = testBoard({ sync: { slack: slack({ adapter: s.adapter, client: async () => client as never }, channels({ C1: 'firehose' })) } })
    return { team, s, posted }
  }

  /** Julián, his agent, and a Malte support's preview imports through its own Slack key, each posting a thread in firehose. */
  async function post(team: ReturnType<typeof testBoard>) {
    const token = await personToken('u_julian')
    const julian = caller(team.fetch, token, { 'x-board-handle': 'julian', 'x-board-name': encodeURIComponent('Julián Benegas'), 'x-board-avatar': 'https://example.com/julian.png' })
    const claude = caller(team.fetch, token, { 'x-board-handle': 'julian', 'x-board-profile': 'claude', 'x-board-avatar': 'https://example.com/claude.png' })
    const support = caller(team.fetch, await deploymentToken('support', 'prj_support', 'preview'))
    expect((await support('POST', '/watchers', { watch: {}, sync: [{ key: 'slack-eu', platform: 'slack' }] })).status).toBe(200)
    const malte = { id: 'slack-eu:user:U_MALTE', handle: 'malte', name: 'Malte', avatar: 'https://example.com/malte.png', isBot: false }
    expect((await julian('POST', '/messages', { channel: 'firehose', text: 'the deploy is red' })).status).toBe(201)
    expect((await claude('POST', '/messages', { channel: 'firehose', text: 'looking' })).status).toBe(201)
    expect((await support('POST', '/sync/imports', { op: 'post', author: malte, from: 'slack-eu', channel: 'firehose', text: 'same for us' })).status).toBe(200)
  }

  it("go out under their author's name and picture: a person as themselves, and anyone else via the principal they write for", async () => {
    const { team, s, posted } = mirrored(['chat:write', 'chat:write.customize'])
    await post(team)
    await vi.waitFor(() => expect(posted).toHaveLength(3))
    expect(posted.map(({ username, icon_url, markdown_text }) => [username, icon_url, markdown_text])).toEqual([
      ['Julián Benegas', 'https://example.com/julian.png', 'the deploy is red'],
      ['claude via julian', 'https://example.com/claude.png', 'looking'],
      ['Malte via support (preview) (slack)', 'https://example.com/malte.png', 'same for us'],
    ])
    expect(s.channelPosts).toEqual([])
  })

  it('go out as the app, each labeled with its author, when the app lacks chat:write.customize', async () => {
    const { team, s, posted } = mirrored(['chat:write'])
    await post(team)
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
