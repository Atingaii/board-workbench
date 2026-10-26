import { createHmac } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { createSlackAdapter } from '@chat-adapter/slack'
import { afterEach, expect, it, vi } from 'vitest'
import { slack } from '../src/sync/slack.ts'
import type { ReceivedEvent } from '../src/sync/provider.ts'

afterEach(() => vi.restoreAllMocks())

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

it('waits for reaction intake registered after the Slack webhook returns', async () => {
  const config = { botToken: 'xoxb-test', botUserId: 'U_BOT', signingSecret: 'test-secret' }
  const lookupStarted = gate()
  const lookup = gate()
  vi.spyOn(Object.getPrototypeOf(createSlackAdapter(config).webClient), 'apiCall').mockImplementation(async (method: unknown) => {
    if (method === 'conversations.replies') {
      lookupStarted.resolve()
      await lookup.promise
      return { ok: true, messages: [] }
    }
    if (method === 'users.info') return { ok: true, user: { id: 'U_HUMAN', name: 'ada' } }
    throw new Error(`Unexpected Slack API call: ${method}`)
  })
  const adapter = createSlackAdapter(config)
  const provider = slack({ adapter, channels: { C1: 'dev' } })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = JSON.stringify({
    type: 'event_callback', team_id: 'T1', event_id: 'Ev1',
    event: { type: 'reaction_added', user: 'U_HUMAN', reaction: 'squirrel',
      item: { type: 'message', channel: 'C1', ts: '100.1' }, event_ts: '102.1' },
  })
  const signature = createHmac('sha256', 'test-secret').update(`v0:${timestamp}:${body}`).digest('hex')
  const request = new Request('https://board.test/webhooks/slack', {
    method: 'POST', body, headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${signature}` },
  })
  const intakeStarted = gate()
  const persist = gate()
  const received: ReceivedEvent[] = []
  let acknowledged = false
  const response = provider.receive('slack', request, async (event) => {
    intakeStarted.resolve()
    await persist.promise
    received.push(event)
  }).then(response => {
    acknowledged = true
    return response
  })
  await Promise.race([
    lookupStarted.promise,
    response.then(async response => { throw new Error(`Webhook returned ${response.status}: ${await response.text()}`) }),
  ])
  await setImmediate()
  lookup.resolve()
  await intakeStarted.promise
  await setImmediate()
  try {
    expect(acknowledged).toBe(false)
  } finally {
    persist.resolve()
    await response
  }
  expect((await response).status).toBe(200)
  expect(received).toHaveLength(1)
  expect(received[0]?.event).toMatchObject({ kind: 'reaction', added: true, emoji: 'squirrel', message: '100.1' })
})
