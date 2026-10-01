import { describe, expect, it, vi } from 'vitest'
import { getEmoji, type Adapter, type AdapterPostableMessage, type ChatInstance, type WebhookOptions } from 'chat'
import { createMockAdapter, createTestMessage } from '@chat-adapter/tests'
import { slack } from '../src/sync/slack.ts'
import { github } from '../src/sync/github.ts'
import { BOARD_URL, caller, personToken, testBoard } from './harness.ts'

const textOf = (message: AdapterPostableMessage) =>
  typeof message === 'string' ? message : JSON.stringify(message)

type WebhookPayload =
  | { type: 'message'; threadId: string; id: string; text: string; user: string }
  | { type: 'reaction'; threadId: string; messageId: string; emoji: string; added: boolean; user: string }

/** A platform adapter driven by test payloads, recording everything posted to it. */
function fakePlatform(name: 'slack' | 'github', extra: Record<string, unknown> = {}) {
  let chat!: ChatInstance
  let next = 0
  const posts: { threadId: string; text: string; id: string }[] = []
  const channelPosts: { channelId: string; text: string; id: string }[] = []
  const reactions: { threadId: string; messageId: string; emoji: string; added: boolean }[] = []
  const author = (user: string) => ({ userId: user, userName: user, fullName: user, isBot: false, isMe: false })
  const adapter: Adapter = createMockAdapter(name, {
    name,
    userName: 'just-board',
    initialize: async (instance: ChatInstance) => {
      chat = instance
    },
    channelIdFromThreadId: (threadId: string) => threadId.split(':').slice(0, 2).join(':'),
    handleWebhook: async (request: Request, options?: WebhookOptions) => {
      if (request.headers.get('x-github-event')) return new Response('ok')
      const body = (await request.json()) as WebhookPayload
      if (body.type === 'message')
        await chat.processMessage(
          adapter,
          body.threadId,
          createTestMessage(body.id, body.text, { threadId: body.threadId, author: author(body.user) }),
          options,
        )
      else
        await chat.processReaction(
          {
            adapter,
            threadId: body.threadId,
            messageId: body.messageId,
            emoji: getEmoji(body.emoji),
            rawEmoji: body.emoji,
            added: body.added,
            user: author(body.user),
            raw: { event_ts: `${next++}` },
          },
          options,
        )
      return new Response('ok')
    },
    postMessage: async (threadId: string, message: AdapterPostableMessage) => {
      const id = `m${++next}`
      posts.push({ threadId, text: textOf(message), id })
      return { id, threadId, raw: {} }
    },
    postChannelMessage: async (channelId: string, message: AdapterPostableMessage) => {
      const id = `t${++next}`
      channelPosts.push({ channelId, text: textOf(message), id })
      return { id, threadId: `${channelId}:${id}`, raw: {} }
    },
    addReaction: async (threadId: string, messageId: string, emoji: unknown) => {
      reactions.push({ threadId, messageId, emoji: String(emoji), added: true })
    },
    removeReaction: async (threadId: string, messageId: string, emoji: unknown) => {
      reactions.push({ threadId, messageId, emoji: String(emoji), added: false })
    },
    ...extra,
  } as Partial<Adapter>)
  return { adapter, posts, channelPosts, reactions }
}

type SlackChannels = Parameters<typeof slack>[0]['channels']

function setup(options: { alerts?: SlackChannels[string]; channels?: SlackChannels; slackClient?: unknown } = {}) {
  const s = fakePlatform('slack', options.slackClient ? { webClient: options.slackClient } : {})
  const g = fakePlatform('github')
  const board = testBoard({
    sync: {
      slack: slack({
        adapter: s.adapter,
        channels: { C1: 'firehose', C2: 'prs', ...(options.alerts ? { C3: options.alerts } : {}), ...options.channels },
      }),
      github: github({ adapter: g.adapter, repos: { 'basehub-ai/just-board': 'prs' } }),
    },
  })
  const webhook = (key: string, body: unknown, headers: Record<string, string> = {}) =>
    board.fetch(
      new Request(`${BOARD_URL}/webhooks/${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    )
  return { board, s, g, webhook }
}

const read = async (call: ReturnType<typeof caller>, channel: string) =>
  (await call('GET', `/messages?channel=${channel}`)).body.messages as {
    id: number
    text: string
    re: number | null
    from: string | null
    labels: Record<string, string>
    reactions: Record<string, string[]>
    by: { actor: string }
  }[]

describe('sync', () => {
  it('mirrors a Slack thread into the board, and board replies back into Slack', async () => {
    const { board, s, webhook } = setup()
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })

    expect((await webhook('slack', { type: 'message', threadId: 'slack:C1:100', id: '100', text: 'export is broken', user: 'U_ADA' })).status).toBe(200)
    await vi.waitFor(async () => expect(await read(julian, 'firehose')).toHaveLength(1))
    const [root] = await read(julian, 'firehose')
    expect(root).toMatchObject({ text: 'export is broken', from: 'slack', by: { actor: 'slack:user:U_ADA' } })

    await webhook('slack', { type: 'message', threadId: 'slack:C1:100', id: '101', text: 'same here', user: 'U_BOB' })
    await vi.waitFor(async () => expect(await read(julian, 'firehose')).toHaveLength(2))

    await julian('POST', '/messages', { re: root!.id, text: 'looking into it' })
    await vi.waitFor(() => expect(s.posts).toHaveLength(1))
    expect(s.posts[0]).toMatchObject({ threadId: 'slack:C1:100' })
    expect(s.posts[0]!.text).toContain('looking into it')
    expect(s.channelPosts).toHaveLength(0) // a thread that came from Slack is never re-posted to its channel
  })

  it('starts a Slack thread for a board root in a mirrored channel, then follows it', async () => {
    const { board, s, webhook } = setup()
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })

    const { body } = await julian('POST', '/messages', { channel: 'firehose', text: 'deploy failed' })
    await vi.waitFor(() => expect(s.channelPosts).toHaveLength(1))
    const started = s.channelPosts[0]!
    expect(started.channelId).toBe('slack:C1')
    expect(started.text).toContain('deploy failed')

    await julian('POST', '/messages', { re: body.message.id, text: 'rolled back' })
    await vi.waitFor(() => expect(s.posts).toHaveLength(1))
    expect(s.posts[0]!.threadId).toBe(`slack:C1:${started.id}`)

    // A Slack reply in that thread comes back to the board thread.
    await webhook('slack', { type: 'message', threadId: `slack:C1:${started.id}`, id: 'r1', text: 'thanks', user: 'U_ADA' })
    await vi.waitFor(async () =>
      expect((await julian('GET', `/messages/${body.message.id}`)).body.replies.map((m: { text: string }) => m.text)).toEqual([
        'rolled back',
        'thanks',
      ]),
    )
    expect(s.posts).toHaveLength(1) // and isn't echoed back
  })

  it('keeps `noSync` roots on the board', async () => {
    const { board, s } = setup()
    const julian = caller(board.fetch, await personToken())
    await julian('POST', '/messages', { channel: 'firehose', text: 'scratch', noSync: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(s.channelPosts).toHaveLength(0)
  })

  it('syncs reactions both ways', async () => {
    const { board, s, webhook } = setup()
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })
    await webhook('slack', { type: 'message', threadId: 'slack:C1:200', id: '200', text: 'bug', user: 'U_ADA' })
    await vi.waitFor(async () => expect(await read(julian, 'firehose')).toHaveLength(1))
    const [message] = await read(julian, 'firehose')

    await julian('POST', `/messages/${message!.id}/reactions`, { emoji: 'eyes' })
    await vi.waitFor(() => expect(s.reactions).toEqual([{ threadId: 'slack:C1:200', messageId: '200', emoji: 'eyes', added: true }]))

    await webhook('slack', { type: 'reaction', threadId: 'slack:C1:200', messageId: '200', emoji: 'white_check_mark', added: true, user: 'U_ADA' })
    await vi.waitFor(async () => {
      const [after] = await read(julian, 'firehose')
      expect(after!.reactions).toMatchObject({ eyes: ['vercel:user:u_julian'], white_check_mark: ['slack:user:U_ADA'] })
    })
    expect(s.reactions).toHaveLength(1) // the Slack reaction isn't echoed back
  })

  it('hands unsynced threads in a function-mapped channel to the function, once', async () => {
    const seen: string[] = []
    const { board, s, webhook } = setup({
      alerts: async ({ message, board }) => {
        seen.push(message.text)
        const project = message.text.match(/project: (\S+)/)?.[1] ?? 'unknown'
        await board.post(`alerts/${project}`, { text: message.text, sync: [message.thread] })
      },
    })
    const julian = caller(board.fetch, await personToken())
    const payload = { type: 'message', threadId: 'slack:C3:300', id: '300', text: 'TypeError in checkout, project: www', user: 'B_SENTRY' }
    await webhook('slack', payload)
    await webhook('slack', payload) // a platform retry
    await vi.waitFor(async () => expect(await read(julian, 'alerts/www')).toHaveLength(1))
    expect(seen).toHaveLength(1)
    const [root] = await read(julian, 'alerts/www')
    expect(root!.by.actor).toBe('slack:user:B_SENTRY')
    expect(s.channelPosts).toHaveLength(0) // joining a thread doesn't re-post the root

    // The thread is synced now: replies flow both ways without the function.
    await julian('POST', '/messages', { re: root!.id, text: 'on it' })
    await vi.waitFor(() => expect(s.posts.map((p) => p.threadId)).toEqual(['slack:C3:300']))
    await webhook('slack', { type: 'message', threadId: 'slack:C3:300', id: '301', text: 'thanks', user: 'U_ADA' })
    await vi.waitFor(async () => expect(await read(julian, 'alerts/www')).toHaveLength(3))
    expect(seen).toHaveLength(1)
  })

  it('turns a PR into a thread with state labels, and starts a Slack thread for it', async () => {
    const { board, s, g, webhook } = setup()
    const julian = caller(board.fetch, await personToken())
    const pr = (action: string, extra: Record<string, unknown> = {}) => ({
      action,
      repository: { full_name: 'basehub-ai/just-board' },
      sender: { login: 'julianbenegas', id: 42 },
      pull_request: { number: 7, title: 'Add sync', html_url: 'https://github.com/basehub-ai/just-board/pull/7', draft: false, merged: false, ...extra },
    })
    const event = (body: unknown, delivery: string) =>
      webhook('github', body, { 'x-github-event': 'pull_request', 'x-github-delivery': delivery })

    await event(pr('opened'), 'd1')
    await vi.waitFor(async () => expect(await read(julian, 'prs')).toHaveLength(1))
    const [root] = await read(julian, 'prs')
    expect(root).toMatchObject({ from: 'github', labels: { pr: 'basehub-ai/just-board#7', state: 'open' } })
    expect(root!.text).toContain('PR #7: Add sync')
    await vi.waitFor(() => expect(s.channelPosts.map((p) => p.channelId)).toEqual(['slack:C2']))

    await event(pr('closed', { merged: true }), 'd2')
    await event(pr('closed', { merged: true }), 'd2') // redelivered
    await vi.waitFor(async () => {
      const thread = (await julian('GET', `/messages/${root!.id}`)).body
      expect(thread.message.labels.state).toBe('merged')
      expect(thread.replies.map((m: { text: string }) => m.text)).toEqual(['merged by julianbenegas'])
    })
    await vi.waitFor(() => expect(s.posts.map((p) => p.text)).toEqual([expect.stringContaining('merged by julianbenegas')]))
    expect(g.posts).toHaveLength(0) // GitHub's own reply never goes back to GitHub
  })

  it('attaches an existing thread to a new target and backfills it', async () => {
    const { board, s } = setup()
    const julian = caller(board.fetch, await personToken())
    const { body } = await julian('POST', '/messages', { channel: 'deploys', text: 'rollback in progress' })
    await julian('POST', '/messages', { re: body.message.id, text: 'db restored' })
    const attached = await julian('POST', `/messages/${body.message.id}/sync`, { target: 'slack:C9' })
    expect(attached.body).toEqual({ target: 'slack:C9', attached: true })
    await vi.waitFor(() => expect(s.posts).toHaveLength(1))
    expect(s.channelPosts.map((p) => p.channelId)).toEqual(['slack:C9'])
    expect(s.posts[0]!.text).toContain('db restored')
    const again = await julian('POST', `/messages/${body.message.id}/sync`, { target: 'slack:C9' })
    expect(again.body.attached).toBe(false)
  })

  it('skips a Slack channel name that does not resolve, and syncs the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const conversations = { list: vi.fn(async () => ({ channels: [] })), info: vi.fn(async () => ({})), join: vi.fn() }
    const { board, s, webhook } = setup({ channels: { '#missing': 'alerts' }, slackClient: { conversations } })
    const julian = caller(board.fetch, await personToken())

    await webhook('slack', { type: 'message', threadId: 'slack:C1:500', id: '500', text: 'still syncing', user: 'U_ADA' })
    await vi.waitFor(async () => expect(await read(julian, 'firehose')).toHaveLength(1))
    await julian('POST', '/messages', { channel: 'prs', text: 'and outbound too' })
    await vi.waitFor(() => expect(s.channelPosts).toHaveLength(1))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping #missing: no Slack channel named #missing'))
    warn.mockRestore()
  })

  it('joins mapped Slack channels by name, and says which private ones need an invite', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const conversations = {
      list: vi.fn(async () => ({
        channels: [
          { id: 'C9', name: 'sf-prs', is_member: false, is_private: false },
          { id: 'C8', name: 'sf-secret', is_member: false, is_private: true },
        ],
      })),
      info: vi.fn(async ({ channel }: { channel: string }) => ({ channel: { id: channel, is_member: true } })),
      join: vi.fn(async () => ({ ok: true })),
    }
    const { board, s } = setup({ channels: { '#sf-prs': 'deploys', '#sf-secret': 'secret' }, slackClient: { conversations } })
    const julian = caller(board.fetch, await personToken())

    await julian('POST', '/messages', { channel: 'deploys', text: 'shipped' })
    await vi.waitFor(() => expect(s.channelPosts).toHaveLength(1))
    expect(s.channelPosts[0]!.channelId).toBe('slack:C9')
    expect(conversations.join).toHaveBeenCalledTimes(1)
    expect(conversations.join).toHaveBeenCalledWith({ channel: 'C9' })
    expect(conversations.list).toHaveBeenCalledTimes(1) // one listing resolves every name
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invite the app to #sf-secret'))
    warn.mockRestore()
  })

  it('shows raw platform events in the inbox', async () => {
    const { board, webhook } = setup()
    const julian = caller(board.fetch, await personToken())
    await webhook('slack', { type: 'message', threadId: 'slack:C1:400', id: '400', text: 'hello', user: 'U_ADA' })
    await webhook('slack', { type: 'message', threadId: 'slack:C7:1', id: '1', text: 'unmapped', user: 'U_ADA' })
    const { body } = await julian('GET', '/inbox/slack')
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({ channel: 'slack:C1', sync: 'slack', event: { kind: 'message', text: 'hello' } })
  })
})
