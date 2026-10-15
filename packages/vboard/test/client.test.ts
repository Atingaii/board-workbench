import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client/index.ts'
import { BOARD_URL, personToken, testBoard } from './harness.ts'
import { detectAgent } from '../src/client/node.ts'

async function setup(userId = 'u_julian', handle = 'julian', profile: string | null = null) {
  const board = testBoard()
  const token = await personToken(userId)
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    board.fetch(new Request(input, init))) as typeof globalThis.fetch
  const client = createClient({ url: BOARD_URL, token, handle, profile, fetch })
  return { board, client, fetch }
}

describe('client', () => {
  it('posts, replies, and reads threads', async () => {
    const { client } = await setup()
    const root = await client.post('errors-www', { text: 'deploy failed', labels: { status: 'open' } })
    await client.reply(root.id, 'rolled back')
    const thread = await client.thread(root.id)
    expect(thread.message.labels).toEqual({ status: 'open' })
    expect(thread.replies.map((m) => m.text)).toEqual(['rolled back'])
    expect(thread.message.author).toMatchObject({ handle: 'julian' })
  })

  it('lists threads by latest activity, each with its root, reply count, and latest reply', async () => {
    const { client } = await setup()
    const old = await client.post('triage', { text: 'old bug', labels: { state: 'open' } })
    const quiet = await client.post('triage', 'quiet question')
    const busy = await client.post('triage', { text: 'busy bug', labels: { state: 'open' } })
    let latest = 0
    for (const n of [1, 2, 3]) latest = (await client.reply(busy.id, `busy ${n}`)).id
    const gone = await client.reply(busy.id, 'oops')
    await client.delete(gone.id)
    const late = await client.reply(old.id, 'still broken')

    const page = await client.threads({ channel: 'triage' })
    expect(page.threads.map((t) => [t.message.id, t.replies, t.last?.id ?? null])).toEqual([
      [quiet.id, 0, null],
      [busy.id, 3, latest],
      [old.id, 1, late.id],
    ])
    // `limit` counts threads, and a reply's activity keeps its thread's root in view.
    expect((await client.threads({ channel: 'triage', limit: 1 })).threads.map((t) => t.message.text)).toEqual(['old bug'])
    // A label on the root matches its replies, so a thread is in once.
    expect((await client.threads({ channel: 'triage', label: { state: 'open' } })).threads.map((t) => t.message.id)).toEqual([busy.id, old.id])
    expect((await client.threads({ channel: 'triage', after: late.id - 1 })).threads.map((t) => t.message.id)).toEqual([old.id])
    expect((await client.threads({ text: 'busy 2' })).threads.map((t) => t.message.id)).toEqual([busy.id])
  })

  it('throws BoardError with the server code', async () => {
    const { client } = await setup()
    await expect(client.thread(999)).rejects.toMatchObject({
      name: 'BoardError',
      code: 'message_not_found',
      status: 404,
    })
    await expect(client.post('Bad Channel', 'x')).rejects.toMatchObject({ name: 'BoardError', code: 'invalid_request', status: 400 })
  })

  it('waits for the next matching event, or times out with null', async () => {
    const { client } = await setup()
    const root = await client.post('x', 'question')
    const waiting = client.wait({ re: root.id }, { timeout: '5s' })
    setTimeout(() => void client.reply(root.id, 'answer'), 50)
    const event = await waiting
    expect(event?.message?.text).toBe('answer')
    expect(await client.wait({ re: root.id }, { timeout: 200 })).toBeNull()
  })

  it('streams live events and resumes after the server closes the stream', async () => {
    const board = testBoard({ streamMaxMs: 150 })
    const token = await personToken()
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      board.fetch(new Request(input, init))) as typeof globalThis.fetch
    const client = createClient({ url: BOARD_URL, token, fetch })
    const controller = new AbortController()
    const seen: string[] = []
    const reading = (async () => {
      for await (const event of client.events({ channel: 'x' }, { signal: controller.signal })) {
        seen.push(event.message!.text)
        if (seen.length === 3) controller.abort()
      }
    })()
    await new Promise((r) => setTimeout(r, 50))
    await client.post('x', 'one')
    await new Promise((r) => setTimeout(r, 300)) // the server closes and the client reconnects
    await client.post('y', 'elsewhere')
    await client.post('x', 'two')
    await new Promise((r) => setTimeout(r, 300))
    await client.post('x', 'three')
    await reading
    expect(seen).toEqual(['one', 'two', 'three'])
  })
})

describe('agent detection', () => {
  it('knows Claude Code, Codex, Grok, and pi, and any agent that sets AI_AGENT', () => {
    expect(detectAgent({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's1' })).toEqual({ profile: 'claude', session: 's1' })
    expect(detectAgent({ CODEX_THREAD_ID: 't1' })).toEqual({ profile: 'codex', session: 't1' })
    expect(detectAgent({ PI_CODING_AGENT: 'true', AI_AGENT: 'pi', PI_SESSION_ID: 'p1' })).toEqual({ profile: 'pi', session: 'p1' })
    expect(detectAgent({ AI_AGENT: 'OpenCode' })).toEqual({ profile: 'opencode', session: null })
    expect(detectAgent({ AI_AGENT: 'not a name!' })).toBeNull()
    expect(detectAgent({})).toBeNull()
  })
})
