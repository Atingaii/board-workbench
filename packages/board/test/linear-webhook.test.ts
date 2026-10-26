import { createHmac } from 'node:crypto'
import { createLinearAdapter } from '@chat-adapter/linear'
import type { Adapter } from 'chat'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { linear, teams } from '../src/sync/linear.ts'
import type { ReceivedEvent } from '../src/sync/provider.ts'

const secret = 'test-secret'
const BOT = 'bot-user'
const ada = { id: 'user-ada', name: 'Ada Lovelace', url: 'https://linear.app/acme/profiles/ada', avatarUrl: 'https://avatars.test/ada.png' }
const issue = { id: 'issue-1', identifier: 'ENG-12', title: 'Sync Linear to the board', url: 'https://linear.app/acme/issue/ENG-12/sync-linear-to-the-board' }

// Linear's GraphQL API, answering by operation: who the app is, its teams, and what it creates.
const calls: { query: string; variables: Record<string, unknown> }[] = []
beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
    calls.push({ query, variables })
    const answer = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
    if (query.includes('LinearAdapterViewerOrganization')) return answer({ viewer: { id: BOT, displayName: 'board', organization: { id: 'org-1' } } })
    if (/query teams/i.test(query)) return answer({ teams: { nodes: [{ id: 'team-eng', key: 'ENG', name: 'Engineering' }], pageInfo: { hasNextPage: false } } })
    if (/issueCreate\(/.test(query)) return answer({ issueCreate: { success: true, lastSyncId: 1, issue: { id: 'issue-2' } } })
    throw new Error(`unexpected Linear call: ${query.slice(0, 80)}`)
  })
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const adapter = createLinearAdapter({ apiKey: 'lin_api_test', webhookSecret: secret, userName: 'board' }) as unknown as Adapter
  const provider = linear({ adapter }, teams({ ENG: 'dev' }))
  const send = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify({ organizationId: 'org-1', webhookId: 'hook-1', webhookTimestamp: Date.now(), ...payload })
    const request = new Request('https://board.test/webhooks/linear', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'linear-delivery': `delivery-${Math.random()}`, 'linear-signature': createHmac('sha256', secret).update(body).digest('hex') },
    })
    const received: ReceivedEvent[] = []
    const response = await provider.receive('linear', request, async (event) => void received.push(event))
    return { status: response.status, received }
  }
  return { provider, send }
}

const comment = (id: string, body: string, extra: Record<string, unknown> = {}) => ({
  id, body, issueId: issue.id, createdAt: '2026-10-26T22:00:00Z', updatedAt: '2026-10-26T22:00:00Z', user: ada,
  issue: { id: issue.id, title: issue.title }, ...extra,
})

it('imports a comment into its issue thread, in its team channel', async () => {
  const { send } = setup()
  const { status, received } = await send({ type: 'Comment', action: 'create', url: `${issue.url}#comment-1`, data: comment('comment-1', 'Looks **good**') })
  expect(status).toBe(200)
  expect(received).toHaveLength(1)
  expect(received[0]!.event).toMatchObject({
    kind: 'message', channel: 'linear:ENG', thread: 'linear:ENG:issue-1', subthread: 'linear:ENG:issue-1:c:comment-1',
    message: 'comment-1', text: 'Looks **good**',
    author: { id: 'linear:user:user-ada', handle: 'ada', name: 'Ada Lovelace', avatar: 'https://avatars.test/ada.png', isBot: false },
  })
})

it('keeps a reply in the comment thread it answers', async () => {
  const { send } = setup()
  const { received } = await send({ type: 'Comment', action: 'create', url: `${issue.url}#comment-2`, data: comment('comment-2', 'agreed', { parentId: 'comment-1' }) })
  expect(received[0]!.event).toMatchObject({ thread: 'linear:ENG:issue-1', subthread: 'linear:ENG:issue-1:c:comment-1', message: 'comment-2' })
})

it('syncs edited and deleted comments, which the adapter does not emit', async () => {
  const { send } = setup()
  const edited = await send({ type: 'Comment', action: 'update', url: `${issue.url}#comment-1`, data: comment('comment-1', 'Looks great') })
  expect(edited.received.map((r) => r.event)).toMatchObject([{ kind: 'edited', thread: 'linear:ENG:issue-1', message: 'comment-1', text: 'Looks great' }])
  const deleted = await send({ type: 'Comment', action: 'remove', url: `${issue.url}#comment-1`, data: comment('comment-1', 'Looks great') })
  expect(deleted.received.map((r) => r.event)).toMatchObject([{ kind: 'deleted', channel: 'linear:ENG', thread: 'linear:ENG:issue-1', message: 'comment-1' }])
})

it("ignores edits to the board's own comments, which it already has", async () => {
  const { send } = setup()
  const { received } = await send({ type: 'Comment', action: 'update', url: `${issue.url}#comment-9`, data: comment('comment-9', 'on it', { user: { id: BOT, name: 'board', url: 'https://linear.app/acme/profiles/board' } }) })
  expect(received).toEqual([])
})

it('opens a thread for a new issue and labels its state', async () => {
  const { send } = setup()
  const data = { ...issue, team: { key: 'ENG' }, state: { name: 'Todo', type: 'unstarted' } }
  const { received } = await send({ type: 'Issue', action: 'create', url: issue.url, data, actor: ada })
  expect(received.map((r) => r.event)).toMatchObject([{
    kind: 'lifecycle', type: 'issue.created', channel: 'linear:ENG', thread: 'linear:ENG:issue-1',
    title: 'ENG-12: Sync Linear to the board', url: issue.url, labels: { issue: 'ENG-12', state: 'unstarted' }, createRoot: true,
  }])
  const moved = await send({ type: 'Issue', action: 'update', url: issue.url, data: { ...data, state: { name: 'Done', type: 'completed' } }, updatedFrom: { stateId: 'state-todo' }, actor: ada })
  expect(moved.received.map((r) => r.event)).toMatchObject([{ type: 'issue.updated', labels: { state: 'completed' }, createRoot: false }])
  const other = await send({ type: 'Issue', action: 'update', url: issue.url, data, updatedFrom: { priority: 2 }, actor: ada })
  expect(other.received).toEqual([])
})

it('refuses a webhook that Linear did not sign', async () => {
  const { provider } = setup()
  const body = JSON.stringify({ type: 'Comment', action: 'create', organizationId: 'org-1', webhookTimestamp: Date.now(), data: comment('comment-1', 'hi') })
  const request = new Request('https://board.test/webhooks/linear', { method: 'POST', body, headers: { 'linear-signature': 'nope' } })
  const received: ReceivedEvent[] = []
  const response = await provider.receive('linear', request, async (event) => void received.push(event))
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(received).toEqual([])
})

it('opens an issue for a board root, titled with its first line, and resolves teams by key', async () => {
  const { provider } = setup()
  await expect(provider.resolveChannel('eng')).resolves.toBe('ENG')
  await expect(provider.resolveTarget('ENG:issue-1')).resolves.toEqual({ target: 'ENG:issue-1', channel: 'ENG', kind: 'thread' })
  await expect(provider.resolveTarget('ENG:issue-1:c:comment-1')).rejects.toThrow('sync its issue, ENG:issue-1')
  const sent = await provider.post('ENG', 'channel', { markdown: '**ada**: Flaky checkout test\n\nIt fails one run in ten.' })
  expect(sent).toEqual({ thread: 'ENG:issue-2', message: 'issue' })
  const created = calls.find((call) => /issueCreate\(/.test(call.query))!
  expect(created.variables.input).toEqual({ teamId: 'team-eng', title: 'ada: Flaky checkout test', description: '**ada**: Flaky checkout test\n\nIt fails one run in ten.' })
})

it('leaves the issue alone for reactions and deletes on its root, wherever the root came from', async () => {
  const { provider } = setup()
  for (const root of ['issue', 'lifecycle:812', 'root:812']) {
    await provider.react('ENG:issue-1', root, 'eyes', true)
    await provider.delete('ENG:issue-1', root)
  }
  expect(calls.filter((call) => !call.query.includes('LinearAdapterViewerOrganization'))).toEqual([])
})
