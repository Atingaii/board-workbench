import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBoardClient, type BoardClient } from '../src/client/client.ts'
import { startInspector, type Inspector } from '../src/inspect/server.ts'
import { serve } from './http.ts'
import { personToken, testBoard } from './harness.ts'

let server: Awaited<ReturnType<typeof serve>>
let client: BoardClient
let inspector: Inspector
let token: string

beforeAll(async () => {
  server = await serve(testBoard({ url: undefined }).fetch)
  const url = `${server.origin}/api/board`
  client = createBoardClient({ url, token: await personToken('u_julian', url), handle: 'julian', profile: null })
  inspector = await startInspector({ client, port: 0 })
  const page = await (await fetch(`${inspector.url}/`)).text()
  token = /<meta name="inspect-token" content="([^"]+)">/.exec(page)![1]!
})
afterAll(async () => {
  await inspector.close()
  server.close()
})

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${inspector.url}${path}`, { headers })

function act(action: string, body: unknown, headers: Record<string, string> = { origin: inspector.url, 'x-inspect-token': token }) {
  return fetch(`${inspector.url}/do/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** A request with a Host header fetch won't let us forge. */
function withHost(host: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request(`${inspector.url}/`, { headers: { host } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

describe('inspect', () => {
  it('shows the board as you', async () => {
    const root = await client.post('errors-www', 'deploy failed: https://example.com/runs/1.')
    await client.reply(root.id, 'rolling back <now>')

    const home = await get('/')
    expect(home.status).toBe(200)
    expect(home.headers.get('content-security-policy')).toContain("script-src 'nonce-")
    const body = await home.text()
    expect(body).toContain('as julian')
    expect(body).toContain('href="/c/errors-www"')
    expect(body).toContain('<a href="https://example.com/runs/1" target="_blank" rel="noreferrer">https://example.com/runs/1</a>.')

    const channel = await (await get('/c/errors-www')).text()
    expect(channel).toContain('rolling back &lt;now&gt;')
    expect(channel).toContain('placeholder="message #errors-www"')

    const thread = await (await get(`/t/${root.id}`)).text()
    expect(thread).toContain(`thread #${root.id}`)
    expect(thread).toContain(`placeholder="reply in thread #${root.id}"`)

    const fragment = await (await get('/c/errors-www', { 'x-inspect-fragment': '1' })).text()
    expect(fragment).toContain('rolling back')
    expect(fragment).not.toContain('<html')

    expect((await get('/t/9999')).status).toBe(404)
  })

  it('posts, replies, reacts, labels, edits, and deletes as you', async () => {
    const posted = await act('post', { channel: '#ops', text: 'standup in 5' })
    expect(posted.status).toBe(200)
    const { id } = (await posted.json()) as { id: number }
    const { id: replyId } = (await (await act('reply', { id, text: 'on my way', noSync: 'on' })).json()) as { id: number }
    expect((await act('react', { id, emoji: 'eyes' })).status).toBe(200)
    expect((await act('label', { id, label: 'status=open' })).status).toBe(200)
    expect((await act('edit', { id, text: 'standup in 10' })).status).toBe(200)
    expect((await act('delete', { id: replyId })).status).toBe(200)

    const thread = await client.thread(id)
    expect(thread.message).toMatchObject({
      channel: 'ops',
      text: 'standup in 10',
      labels: { status: 'open' },
      reactions: { eyes: ['vercel:user:u_julian'] },
      by: { actor: 'vercel:user:u_julian' },
    })
    expect(thread.replies[0]).toMatchObject({ deleted: true, noSync: true })

    expect((await act('label', { id, label: '-status' })).status).toBe(200)
    expect((await act('react', { id, emoji: 'eyes', remove: true })).status).toBe(200)
    expect((await client.thread(id)).message).toMatchObject({ labels: {}, reactions: {} })
  })

  it('says why a write failed', async () => {
    const missing = await act('reply', { id: 9999, text: 'hello?' })
    expect(missing.status).toBe(404)
    const bad = await act('label', { id: 1, label: 'nope' })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain('key=value')
  })

  it('takes writes only from its own pages', async () => {
    expect((await act('post', { channel: 'ops', text: 'x' }, { origin: inspector.url })).status).toBe(403)
    expect((await act('post', { channel: 'ops', text: 'x' }, { origin: 'https://evil.example', 'x-inspect-token': token })).status).toBe(403)
    expect((await act('post', { channel: 'ops', text: 'x' }, { 'x-inspect-token': token })).status).toBe(403)
    expect(await withHost('evil.example')).toBe(421) // DNS rebinding
    expect(await withHost(new URL(inspector.url).host)).toBe(200)
  })

  it('relays board events to the page', async () => {
    const controller = new AbortController()
    const response = await fetch(`${inspector.url}/events?channel=live`, { signal: controller.signal })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes(': live')) seen += decoder.decode((await reader.read()).value)
    await client.post('live', 'hello')
    while (!seen.includes('"type":"message.posted"')) seen += decoder.decode((await reader.read()).value)
    controller.abort()
  })
})
