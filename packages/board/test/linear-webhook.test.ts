import { createHmac } from 'node:crypto'
import { createLinearAdapter } from '@chat-adapter/linear'
import type { Adapter } from 'chat'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { linear, teams } from '../src/sync/linear.ts'
import type { ReceivedEvent } from '../src/sync/provider.ts'

const secret = 'test-secret'
const BOT = 'bot-user'
const ISSUE = '6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const OPENED = '7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const ada = { id: 'user-ada', name: 'Ada Lovelace', url: 'https://linear.app/acme/profiles/ada', avatarUrl: 'https://avatars.test/ada.png', type: 'user' }
const board = { id: BOT, name: 'board', url: 'https://linear.app/acme/profiles/board', type: 'OauthClient' }
const issue = { id: ISSUE, identifier: 'ENG-12', title: 'Sync Linear to the board', url: 'https://linear.app/acme/issue/ENG-12/sync-linear-to-the-board' }
const thread = `linear:issue:${ISSUE}`

// Linear's GraphQL API, answering by operation: who the app is, its teams, its issues, and what it creates.
const calls: { query: string; variables: Record<string, unknown> }[] = []
beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
    calls.push({ query, variables })
    const answer = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
    if (query.includes('LinearAdapterViewerOrganization')) return answer({ viewer: { id: BOT, displayName: 'board', organization: { id: 'org-1' } } })
    if (/query teams/i.test(query)) return answer({ teams: { nodes: [{ id: 'team-eng', key: 'ENG', name: 'Engineering' }], pageInfo: { hasNextPage: false } } })
    if (/^\s*query issue\(/i.test(query)) {
      return answer({ issue: { ...issue, team: { id: 'team-eng' }, state: { id: 'state-todo' }, reactions: [], sharedAccess: { isShared: false, sharedWithCount: 0, viewerHasOnlySharedAccess: false, sharedWithUsers: [], disallowedIssueFields: [] } } })
    }
    if (/^\s*query workflowState\(/i.test(query)) return answer({ workflowState: { id: 'state-todo', name: 'Todo', type: 'unstarted', color: '#ccc', position: 1, team: { id: 'team-eng' } } })
    if (/issueCreate\(/.test(query)) return answer({ issueCreate: { success: true, lastSyncId: 1, issue: { id: OPENED } } })
    if (/issueUpdate\(/.test(query)) return answer({ issueUpdate: { success: true, lastSyncId: 2, issue: { id: OPENED } } })
    throw new Error(`unexpected Linear call: ${query.slice(0, 80)}`)
  })
})
afterEach(() => vi.unstubAllGlobals())

const apiCalls = () => calls.filter((call) => !call.query.includes('LinearAdapterViewerOrganization'))

function setup(adapter: Adapter = createLinearAdapter({ apiKey: 'lin_api_test', webhookSecret: secret, userName: 'board' }) as unknown as Adapter) {
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
  id, body, issueId: ISSUE, createdAt: '2026-10-26T22:00:00Z', updatedAt: '2026-10-26T22:00:00Z', user: ada,
  issue: { id: ISSUE, title: issue.title }, ...extra,
})

it('imports a comment into its issue thread, in its team channel', async () => {
  const { send } = setup()
  const { status, received } = await send({ type: 'Comment', action: 'create', url: `${issue.url}#comment-1`, data: comment('comment-1', 'Looks **good**') })
  expect(status).toBe(200)
  expect(received).toHaveLength(1)
  expect(received[0]!.event).toMatchObject({
    kind: 'message', channel: 'linear:ENG', thread, subthread: `${thread}:c:comment-1`,
    message: 'comment-1', text: 'Looks **good**',
    author: { id: 'linear:user:user-ada', handle: 'ada', name: 'Ada Lovelace', avatar: 'https://avatars.test/ada.png', isBot: false },
  })
})

it('keeps a reply in the comment thread it answers', async () => {
  const { send } = setup()
  const { received } = await send({ type: 'Comment', action: 'create', url: `${issue.url}#comment-2`, data: comment('comment-2', 'agreed', { parentId: 'comment-1' }) })
  expect(received[0]!.event).toMatchObject({ thread, subthread: `${thread}:c:comment-1`, message: 'comment-2' })
})

it('keeps the thread when an issue moves teams: only its channel follows', async () => {
  const { send } = setup()
  const { received } = await send({ type: 'Comment', action: 'create', url: 'https://linear.app/acme/issue/OPS-3/sync-linear-to-the-board#comment-3', data: comment('comment-3', 'moved') })
  expect(received[0]!.event).toMatchObject({ channel: 'linear:OPS', thread })
})

it('syncs edited and deleted comments, which the adapter does not emit', async () => {
  const { send } = setup()
  const edited = await send({ type: 'Comment', action: 'update', url: `${issue.url}#comment-1`, data: comment('comment-1', 'Looks great') })
  expect(edited.received.map((r) => r.event)).toMatchObject([{ kind: 'edited', thread, message: 'comment-1', text: 'Looks great' }])
  const deleted = await send({ type: 'Comment', action: 'remove', url: `${issue.url}#comment-1`, data: comment('comment-1', 'Looks great') })
  expect(deleted.received.map((r) => r.event)).toMatchObject([{ kind: 'deleted', channel: 'linear:ENG', thread, message: 'comment-1' }])
})

it("ignores edits to the board's own comments, which it already has", async () => {
  const { send } = setup()
  const { received } = await send({ type: 'Comment', action: 'update', url: `${issue.url}#comment-9`, data: comment('comment-9', 'on it', { user: board }) })
  expect(received).toEqual([])
})

it('opens a thread for a new issue and labels its state', async () => {
  const { send } = setup()
  const data = { ...issue, team: { key: 'ENG' }, state: { name: 'Todo', type: 'unstarted' } }
  const { received } = await send({ type: 'Issue', action: 'create', url: issue.url, data, actor: ada })
  expect(received.map((r) => r.event)).toMatchObject([{
    kind: 'lifecycle', type: 'issue.created', channel: 'linear:ENG', thread,
    title: 'ENG-12: Sync Linear to the board', url: issue.url, labels: { issue: 'ENG-12', state: 'unstarted' }, createRoot: true,
    author: { isBot: false },
  }])
  const moved = await send({ type: 'Issue', action: 'update', url: issue.url, data: { ...data, state: { name: 'Done', type: 'completed' } }, updatedFrom: { stateId: 'state-todo' }, actor: ada })
  expect(moved.received.map((r) => r.event)).toMatchObject([{ type: 'issue.updated', labels: { issue: 'ENG-12', state: 'completed' }, createRoot: false }])
  const other = await send({ type: 'Issue', action: 'update', url: issue.url, data, updatedFrom: { priority: 2 }, actor: ada })
  expect(other.received).toEqual([])
})

it('never opens a second root for an issue the board opened', async () => {
  const { send } = setup()
  const data = { ...issue, id: OPENED, team: { key: 'ENG' }, state: { name: 'Todo', type: 'unstarted' } }
  const { received } = await send({ type: 'Issue', action: 'create', url: issue.url, data, actor: board })
  expect(received.map((r) => r.event)).toMatchObject([{ type: 'issue.created', thread: `linear:issue:${OPENED}`, labels: { issue: 'ENG-12' }, createRoot: false, author: { isBot: true } }])
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

it('resolves teams by key and issues by UUID or identifier', async () => {
  const { provider } = setup()
  await expect(provider.resolveChannel('eng')).resolves.toBe('ENG')
  await expect(provider.resolveTarget('eng')).resolves.toEqual({ target: 'ENG', channel: 'ENG', kind: 'channel' })
  const target = { target: `issue:${ISSUE}`, channel: 'ENG', kind: 'thread' }
  await expect(provider.resolveTarget(`issue:${ISSUE}`)).resolves.toEqual(target)
  await expect(provider.resolveTarget(ISSUE)).resolves.toEqual(target)
  await expect(provider.resolveTarget('ENG-12')).resolves.toEqual(target)
  await expect(provider.resolveTarget(`issue:${ISSUE}:c:comment-1`)).rejects.toThrow(`sync its issue, issue:${ISSUE}`)
  await expect(provider.resolveTarget('not a target')).rejects.toThrow('invalid Linear target')
})

it('opens an issue for a board root, titled with its first line', async () => {
  const { provider } = setup()
  const sent = await provider.post('ENG', 'channel', { markdown: '**ada**: Flaky snake_case_name test\n\nIt fails one run in ten.' })
  expect(sent).toEqual({ thread: `issue:${OPENED}`, message: 'issue' })
  const created = calls.find((call) => /issueCreate\(/.test(call.query))!
  expect(created.variables.input).toEqual({ teamId: 'team-eng', title: 'ada: Flaky snake_case_name test', description: '**ada**: Flaky snake_case_name test\n\nIt fails one run in ten.' })
})

it("edits only the description of an issue the board opened, and leaves the issue alone for its root's reactions and deletes", async () => {
  const { provider } = setup()
  await provider.edit(`issue:${OPENED}`, 'issue', { markdown: 'Flaky checkout test, now with logs' })
  const updated = apiCalls().filter((call) => /issueUpdate\(/.test(call.query))
  expect(updated.map((call) => call.variables)).toEqual([{ id: OPENED, input: { description: 'Flaky checkout test, now with logs' } }])
  calls.length = 0
  for (const root of ['issue', 'lifecycle:812', 'root:812']) {
    await provider.react(`issue:${ISSUE}`, root, 'eyes', true)
    await provider.delete(`issue:${ISSUE}`, root)
  }
  for (const root of ['lifecycle:812', 'root:812']) await provider.edit(`issue:${ISSUE}`, root, { markdown: 'ENG-12: Sync Linear to the board' })
  expect(apiCalls()).toEqual([])
})

it('reaches Linear outside a webhook with a Connect token', async () => {
  const connect = createLinearAdapter({ accessToken: async () => 'connect-token', webhookVerifier: async () => true, userName: 'board', mode: 'comments' }) as unknown as Adapter
  const { provider } = setup(connect)
  await expect(provider.resolveChannel('ENG')).resolves.toBe('ENG')
  await expect(provider.resolveTarget('ENG-12')).resolves.toEqual({ target: `issue:${ISSUE}`, channel: 'ENG', kind: 'thread' })
  await expect(provider.post('ENG', 'channel', { markdown: 'From Connect' })).resolves.toEqual({ thread: `issue:${OPENED}`, message: 'issue' })
  await expect(provider.fetchRoot(`issue:${ISSUE}`)).resolves.toMatchObject({ text: `ENG-12: Sync Linear to the board\n${issue.url}`, labels: { issue: 'ENG-12', state: 'unstarted' } })
})
