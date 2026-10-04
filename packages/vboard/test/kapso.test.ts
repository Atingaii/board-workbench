import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createKapsoAdapter } from '@kapso/chat-adapter'
import { kapso } from '../src/sync/kapso.ts'
import { BOARD_URL, caller, personToken, testBoard } from './harness.ts'

const SECRET = 'kapso-test-secret'
const NUMBER = '16315558151'
const JANE = '15551234567'

/** The real Kapso adapter, sending through a fake WhatsApp client that records what it sends. */
function setup(numbers: Parameters<typeof kapso>[0]['numbers'] = { [NUMBER]: 'support' }) {
  const texts: { phoneNumberId: string; to: string; body: string }[] = []
  const reactions: { phoneNumberId: string; to: string; reaction: { messageId: string; emoji?: string } }[] = []
  const client = {
    isKapsoProxy: () => true,
    messages: {
      sendText: async (input: (typeof texts)[number]) => {
        texts.push(input)
        return { messages: [{ id: `wamid.out${texts.length}` }] }
      },
      sendReaction: async (input: (typeof reactions)[number]) => {
        reactions.push(input)
        return { messages: [{ id: `wamid.react${reactions.length}` }] }
      },
    },
  }
  const adapter = createKapsoAdapter({ client: client as never, webhookSecret: SECRET, phoneNumberId: NUMBER })
  const board = testBoard({ sync: { kapso: kapso({ adapter, numbers }) } })

  let next = 0
  /** A `whatsapp.message.received` delivery, signed as Kapso signs it. */
  const receive = (message: Record<string, unknown>, options: { conversation?: string; signature?: string } = {}) => {
    const body = JSON.stringify({
      message: { timestamp: String(1735689600 + next++), from: JANE, kapso: { direction: 'inbound' }, ...message },
      conversation: { id: options.conversation ?? 'conv_1', contact_name: 'Jane Doe', phone_number_id: NUMBER, status: 'active' },
      phone_number_id: NUMBER,
    })
    return board.fetch(
      new Request(`${BOARD_URL}/webhooks/kapso`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-event': 'whatsapp.message.received',
          'x-webhook-signature': options.signature ?? createHmac('sha256', SECRET).update(body).digest('hex'),
        },
        body,
      }),
    )
  }
  const text = (id: string, body: string, conversation?: string) =>
    receive({ id, type: 'text', text: { body } }, conversation ? { conversation } : {})
  const react = (id: string, target: string, emoji: string) => receive({ id, type: 'reaction', reaction: { message_id: target, emoji } })
  return { board, texts, reactions, receive, text, react }
}

type Read = { id: number; text: string; re: number | null; from: string | null; reactions: Record<string, string[]>; by: { actor: string } }
const read = async (call: ReturnType<typeof caller>, channel: string) =>
  (await call('GET', `/messages?channel=${channel}`)).body.messages as Read[]

describe('kapso sync', () => {
  it('mirrors a WhatsApp conversation into the board, and board replies back to the contact', async () => {
    const { board, texts, text } = setup()
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })

    expect((await text('wamid.1', 'export is *broken*')).status).toBe(200)
    await vi.waitFor(async () => expect(await read(julian, 'support')).toHaveLength(1))
    const [root] = await read(julian, 'support')
    expect(root).toMatchObject({ text: 'export is **broken**', from: 'kapso', by: { actor: `whatsapp:user:${JANE}` } })
    const { body: inbox } = await julian('GET', '/inbox/kapso')
    expect(inbox.events[0]).toMatchObject({
      channel: `kapso:${NUMBER}`,
      event: { thread: `kapso:${NUMBER}:${JANE}:conv_1`, author: { name: 'Jane Doe' } },
    })

    await text('wamid.2', 'since this morning')
    await vi.waitFor(async () => expect(await read(julian, 'support')).toHaveLength(2))

    await julian('POST', '/messages', { re: root!.id, text: 'looking **into** it' })
    await vi.waitFor(() => expect(texts).toEqual([{ phoneNumberId: NUMBER, to: JANE, body: '*julian*: looking *into* it' }]))
  })

  it('starts a thread for each Kapso conversation', async () => {
    const { board, text } = setup()
    const julian = caller(board.fetch, await personToken())
    await text('wamid.1', 'export is broken')
    await text('wamid.2', 'new question', 'conv_2')
    await vi.waitFor(async () => expect((await read(julian, 'support')).map((m) => m.re)).toEqual([null, null]))
  })

  it("rejects webhooks Kapso didn't sign", async () => {
    const { board, receive } = setup()
    const julian = caller(board.fetch, await personToken())
    const response = await receive({ id: 'wamid.1', type: 'text', text: { body: 'hi' } }, { signature: 'f00d' })
    expect(response.status).toBe(401)
    expect((await julian('GET', '/inbox/kapso')).body.events).toEqual([])
  })

  it('keeps one reaction per person on a message, as WhatsApp does', async () => {
    const { board, reactions, texts, text, react } = setup()
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })
    await text('wamid.1', 'export is broken')
    await vi.waitFor(async () => expect(await read(julian, 'support')).toHaveLength(1))
    const [root] = await read(julian, 'support')

    await julian('POST', `/messages/${root!.id}/reactions`, { emoji: 'eyes' })
    await vi.waitFor(() =>
      expect(reactions).toEqual([{ phoneNumberId: NUMBER, to: JANE, reaction: { messageId: 'wamid.1', emoji: '👀' } }]),
    )

    const { body } = await julian('POST', '/messages', { re: root!.id, text: 'fixed' })
    await vi.waitFor(() => expect(texts).toHaveLength(1))
    const reactionsOn = async () => (await julian('GET', `/messages/${root!.id}`)).body.replies[0].reactions
    await react('wamid.r1', 'wamid.out1', '👍')
    await vi.waitFor(async () => expect(await reactionsOn()).toEqual({ thumbs_up: [`whatsapp:user:${JANE}`] }))
    await react('wamid.r2', 'wamid.out1', '❤️')
    await vi.waitFor(async () => expect(await reactionsOn()).toEqual({ heart: [`whatsapp:user:${JANE}`] }))
    await react('wamid.r3', 'wamid.out1', '') // a removal names no emoji
    await vi.waitFor(async () => expect(await reactionsOn()).toEqual({}))
    expect(body.message.id).toBeGreaterThan(root!.id)
    expect(reactions).toHaveLength(1) // Jane's reactions aren't echoed back
  })

  it('keeps captions and links media Kapso mirrored', async () => {
    const { board, receive } = setup()
    const julian = caller(board.fetch, await personToken())
    await receive({
      id: 'wamid.1',
      type: 'image',
      image: { id: 'MEDIA_1', caption: 'my receipt' },
      kapso: { direction: 'inbound', media_url: 'https://media.kapso.test/receipt.jpg' },
    })
    await vi.waitFor(async () =>
      expect((await read(julian, 'support'))[0]?.text).toBe('my receipt\n\n[image](https://media.kapso.test/receipt.jpg)'),
    )
  })

  it('hands new conversations on a function-mapped number to the function, which can join them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { board, texts, text } = setup({
      '+1 631-555-8151': 'support',
      [NUMBER]: async ({ message, board }) => {
        await board.post('leads', { text: `${message.author.name}: ${message.text}`, sync: [message.thread] })
      },
    })
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })
    await text('wamid.1', 'do you ship to Lima?')
    await vi.waitFor(async () => expect(await read(julian, 'leads')).toHaveLength(1))
    const [root] = await read(julian, 'leads')
    expect(root!.text).toBe('Jane Doe: do you ship to Lima?')

    await julian('POST', '/messages', { re: root!.id, text: 'we do' })
    await vi.waitFor(() => expect(texts.map((t) => t.to)).toEqual([JANE]))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("+1 631-555-8151 isn't a phone number ID"))
    warn.mockRestore()
  })
})
