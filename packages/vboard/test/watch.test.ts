import { describe, expect, it, vi } from 'vitest'
import type { BoardEventView } from '../src/api/routes.ts'
import { parseTail, words } from '../src/api/tail.ts'
import type { Watcher } from '../src/server/index.ts'
import { caller, personToken, testBoard } from './harness.ts'

/** A watcher that records every event it runs on. */
function recorder(tail: string) {
  const events: BoardEventView[] = []
  const watcher: Watcher = { tail, run: ({ event }) => void events.push(event) }
  return { watcher, events, types: () => events.map((event) => event.type) }
}

describe('tail expressions', () => {
  it('split like a shell and parse like the CLI', () => {
    expect(words(`firehose --text "deploy failed" --label 'state=open|draft' a\\ b`)).toEqual([
      'firehose',
      '--text',
      'deploy failed',
      '--label',
      'state=open|draft',
      'a b',
    ])
    expect(parseTail('prs/ --label pr --mentions @claude --re #12')).toEqual({
      channel: 'prs/',
      label: [['pr', null]],
      mentions: 'claude',
      re: 12,
    })
    expect(parseTail('--mentions')).toEqual({ mentions: 'me' })
    expect(parseTail('')).toEqual({})
  })

  it('reject what a filter is not', () => {
    expect(() => parseTail('firehose --after 3')).toThrow("--after isn't a filter")
    expect(() => parseTail('firehose prs')).toThrow('expected one channel, got: firehose prs')
    expect(() => parseTail('--re nope')).toThrow('--re:')
    expect(() => parseTail('--text "open')).toThrow('unterminated "')
  })
})

describe('watchers', () => {
  it('run on what the same `vb tail` prints, exactly as it prints it', async () => {
    const triage = recorder('firehose')
    const { fetch } = testBoard({ watch: { triage: triage.watcher } })
    const julian = caller(fetch, await personToken(), { 'x-board-handle': 'julian' })

    const root = await julian('POST', '/messages', { channel: 'firehose', text: 'export is broken' })
    await julian('POST', '/messages', { channel: 'other', text: 'unrelated' })
    await julian('POST', `/messages/${root.body.message.id}/reactions`, { emoji: 'eyes' })

    await vi.waitFor(() => expect(triage.types()).toEqual(['message.posted', 'reaction.added']))
    const tail = await julian('GET', '/events?channel=firehose&after=0')
    expect(triage.events).toEqual(tail.body.events)
  })

  it('wake when a thread enters their view, then on its replies', async () => {
    const wake = recorder('--label status=needs-agent')
    const { fetch } = testBoard({ watch: { wake: wake.watcher } })
    const julian = caller(fetch, await personToken(), { 'x-board-handle': 'julian' })

    const root = (await julian('POST', '/messages', { channel: 'firehose', text: 'export is broken' })).body.message
    await julian('POST', `/messages/${root.id}/labels`, { set: { status: 'needs-agent' } })
    await julian('POST', '/messages', { re: root.id, text: 'still broken' })

    await vi.waitFor(() => expect(wake.types()).toEqual(['labels.changed', 'message.posted']))
    expect(wake.events[1]!.message).toMatchObject({ text: 'still broken', re: root.id })
  })

  it('wake for any of a label\'s values, and not for others', async () => {
    const wake = recorder('--label kind=bug|feature|question')
    const { fetch } = testBoard({ watch: { wake: wake.watcher } })
    const julian = caller(fetch, await personToken(), { 'x-board-handle': 'julian' })

    const noise = (await julian('POST', '/messages', { channel: 'firehose', text: 'lunch?' })).body.message
    await julian('POST', `/messages/${noise.id}/labels`, { set: { kind: 'noise' } })
    await julian('POST', '/messages', { re: noise.id, text: 'pizza' })
    const feature = (await julian('POST', '/messages', { channel: 'firehose', text: 'add exports' })).body.message
    await julian('POST', `/messages/${feature.id}/labels`, { set: { kind: 'feature' } })
    await julian('POST', '/messages', { re: feature.id, text: 'csv please' })

    await vi.waitFor(() => expect(wake.types()).toEqual(['labels.changed', 'message.posted']))
    expect(wake.events.map((event) => event.message?.re ?? event.message?.id)).toEqual([feature.id, feature.id])
  })

  it('match mentions by handle', async () => {
    const pinged = recorder('--mentions @ada')
    const { fetch } = testBoard({ watch: { pinged: pinged.watcher } })
    const ada = caller(fetch, await personToken('u_ada'), { 'x-board-handle': 'ada' })
    const julian = caller(fetch, await personToken(), { 'x-board-handle': 'julian' })

    await ada('POST', '/messages', { channel: 'firehose', text: 'hi' })
    await julian('POST', '/messages', { channel: 'firehose', text: '@ada can you look?' })

    await vi.waitFor(() => expect(pinged.events.map((event) => event.message?.text)).toEqual(['@ada can you look?']))
  })

  it("write as themselves, and their own writes don't wake them", async () => {
    const seen = recorder('firehose')
    const board = testBoard({
      watch: {
        triage: {
          tail: 'firehose',
          run: async ({ event, board }) => {
            if (event.type === 'message.posted') await board.reply(event.message!.id, 'Thanks! Tracking it.')
          },
        },
        seen: seen.watcher,
      },
    })
    const julian = caller(board.fetch, await personToken(), { 'x-board-handle': 'julian' })

    await julian('POST', '/messages', { channel: 'firehose', text: 'export is broken' })
    await vi.waitFor(() => expect(seen.types()).toEqual(['message.posted', 'message.posted']))
    expect(seen.events[1]!.message).toMatchObject({
      text: 'Thanks! Tracking it.',
      by: { actor: 'vboard:watch:triage' },
      author: { handle: 'triage', kind: 'deployment' },
    })
    // Matches are recorded before anything runs, so triage's session is final: one match, not two.
    const watchServer = board.servers.at(-1)!
    expect(await watchServer.session('watch:triage').history()).toHaveLength(1)
  })

  it("fail on their own: a broken watcher doesn't hold up writes or other watchers", async () => {
    const ok = recorder('firehose')
    const { fetch } = testBoard({
      watch: {
        broken: {
          tail: 'firehose',
          run: () => {
            throw new Error('boom')
          },
        },
        ok: ok.watcher,
      },
    })
    const julian = caller(fetch, await personToken(), { 'x-board-handle': 'julian' })

    const root = await julian('POST', '/messages', { channel: 'firehose', text: 'export is broken' })
    expect(root.status).toBe(201)
    expect((await julian('POST', '/messages', { re: root.body.message.id, text: 'still broken' })).status).toBe(201)
    await vi.waitFor(() => expect(ok.types()).toEqual(['message.posted', 'message.posted']))
  })

  it('fail the boot when one is misconfigured', () => {
    const run = () => {}
    expect(() => testBoard({ watch: { triage: { tail: 'firehose --after 3', run } } })).toThrow(
      "watch triage: --after isn't a filter",
    )
    expect(() => testBoard({ watch: { triage: { tail: '--mentions', run } } })).toThrow(
      'watch triage: a watcher has no "me": use --mentions @handle',
    )
    expect(() => testBoard({ watch: { Triage: { tail: '', run } } })).toThrow('watch: ids use lowercase')
  })
})
