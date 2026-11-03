import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createKapsoAdapter } from '@kapso/chat-adapter'
import { chatSdk, channels, type ChatSdkEvent, type ChatSdkOptions } from '../src/sync/chat-sdk.ts'
import type { SyncUnit } from '../src/sync/fn.ts'
import { BOARD_URL, caller, personToken, testBoard } from './harness.ts'

const SECRET = 'kapso-test-secret'
const NUMBER = '16315558151'
const JANE = '15551234567'
// Kapso's adapter writes each part of an ID in base64url. With no hooks, the board's IDs are the adapter's.
const id = (...parts: string[]) => parts.map((part) => Buffer.from(part).toString('base64url')).join(':')

/** Kapso's real adapter, through `chatSdk()`, sending through a fake WhatsApp client that records what it sends. */
function setup(numbers: Record<string, SyncUnit<ChatSdkEvent>>, hooks: Omit<ChatSdkOptions, 'adapter'> = {}) {
  const texts: { phoneNumberId: string; to: string; body: string }[] = []
  const client = {
    isKapsoProxy: () => true,
    messages: {
      markRead: async () => ({ success: true }),
      sendText: async (input: (typeof texts)[number]) => {
        texts.push(input)
        return { messages: [{ id: `wamid.out${texts.length}` }] }
      },
    },
  }
  const adapter = createKapsoAdapter({ client: client as never, webhookSecret: SECRET, phoneNumberId: NUMBER })
  const board = testBoard({ sync: { whatsapp: chatSdk({ adapter, ...hooks }, channels(numbers)) } })
  /** A `whatsapp.message.received` delivery, signed as Kapso signs it. The same message is the same body. */
  const deliver = (message: Record<string, unknown>) => {
    const body = JSON.stringify({
      message: { timestamp: '1735689600', from: JANE, kapso: { direction: 'inbound' }, ...message },
      conversation: { id: 'conv_1', contact_name: 'Jane Doe', phone_number_id: NUMBER, status: 'active' },
      phone_number_id: NUMBER,
    })
    return board.fetch(new Request(`${BOARD_URL}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-event': 'whatsapp.message.received',
        'x-webhook-signature': createHmac('sha256', SECRET).update(body).digest('hex'),
      },
      body,
    }))
  }
  return { board, texts, deliver }
}

type Read = { id: number; text: string; from: string | null; reactions: Record<string, string[]>; by: { actor: string } }
const read = async (call: ReturnType<typeof caller>, channel: string) =>
  (await call('GET', `/messages?channel=${channel}`)).body.messages as Read[]

describe('chatSdk() on a real adapter, with no hooks', () => {
  it('mirrors a conversation both ways', async () => {
    const { board, texts, deliver } = setup({ [id(NUMBER)]: 'support' })
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })

    expect((await deliver({ id: 'wamid.1', type: 'text', text: { body: 'export is *broken*' } })).status).toBe(200)
    await vi.waitFor(async () => expect(await read(julian, 'support')).toHaveLength(1))
    const [root] = await read(julian, 'support')
    expect(root).toMatchObject({ text: 'export is **broken**', from: 'whatsapp', by: { actor: `kapso:user:${JANE}` } })

    await julian('POST', '/messages', { re: root!.id, text: 'looking **into** it' })
    await vi.waitFor(() => expect(texts).toEqual([{ phoneNumberId: NUMBER, to: JANE, body: '*julian*: looking *into* it' }]))
  })

  it("keeps a board root on the board where the adapter can't start a thread", async () => {
    const { board, texts } = setup({ [id(NUMBER)]: 'support' })
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })
    const { body } = await julian('POST', '/messages', { channel: 'support', text: 'board only' })

    // The number is a channel, and Kapso's adapter can't post to one. A conversation is a thread it can post in.
    expect((await julian('POST', `/messages/${body.message.id}/sync`, { target: `whatsapp:${id(NUMBER)}` })).status).toBe(400)
    expect((await julian('POST', `/messages/${body.message.id}/sync`, { target: `whatsapp:${id(NUMBER, JANE, 'conv_1')}` })).status).toBe(200)
    await julian('POST', '/messages', { re: body.message.id, text: 'following up' })
    await vi.waitFor(() => expect(texts.at(-1)).toEqual({ phoneNumberId: NUMBER, to: JANE, body: '*julian*: following up' }))
  })

  it('knows a reaction by its payload: a redelivery is the same reaction, a new one is another', async () => {
    const { board, deliver } = setup({ [id(NUMBER)]: 'support' })
    const julian = caller(board.fetch, await personToken())
    await deliver({ id: 'wamid.1', type: 'text', text: { body: 'export is broken' } })
    await vi.waitFor(async () => expect(await read(julian, 'support')).toHaveLength(1))

    const thumbs = { type: 'reaction', reaction: { message_id: 'wamid.1', emoji: '👍' } }
    await deliver({ id: 'wamid.r1', ...thumbs })
    await deliver({ id: 'wamid.r1', ...thumbs }) // Kapso retries it
    await deliver({ id: 'wamid.r2', ...thumbs }) // Jane reacts again
    // Each delivery is stored before its webhook answers.
    const { body: inbox } = await julian('GET', '/inbox/whatsapp')
    expect((inbox.events as { event: { kind: string } }[]).filter((record) => record.event.kind === 'reaction')).toHaveLength(2)
    await vi.waitFor(async () => expect((await read(julian, 'support'))[0]!.reactions).toEqual({ thumbs_up: [`kapso:user:${JANE}`] }))
  })
})

describe('chatSdk() hooks', () => {
  it("name channels and the platform where the adapter can't, under a sync function of your own", async () => {
    const { board, texts, deliver } = setup({
      'support line': async (sync) => {
        if (sync.direction === 'out') return sync.deliver()
        if (sync.event.kind !== 'message') return
        await sync.import('leads', { text: `${sync.event.author.name} on ${sync.event.platform}: ${sync.event.text}` })
      },
    }, { platform: 'whatsapp', resolveChannel: async (name) => (name === 'support line' ? id(NUMBER) : name) })
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })

    await deliver({ id: 'wamid.1', type: 'text', text: { body: 'do you ship to Lima?' } })
    await vi.waitFor(async () => expect(await read(julian, 'leads')).toHaveLength(1))
    const [root] = await read(julian, 'leads')
    expect(root).toMatchObject({ text: 'Jane Doe on whatsapp: do you ship to Lima?', by: { actor: `whatsapp:user:${JANE}` } })

    await julian('POST', '/messages', { re: root!.id, text: 'we do' })
    await vi.waitFor(() => expect(texts).toEqual([{ phoneNumberId: NUMBER, to: JANE, body: '*julian*: we do' }]))
  })
})
