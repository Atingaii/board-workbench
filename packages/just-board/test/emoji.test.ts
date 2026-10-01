import { describe, expect, it } from 'vitest'
import { displayEmoji, normalizeEmoji } from '../src/contract/emoji.ts'
import { caller, personToken, testBoard } from './harness.ts'

describe('emoji', () => {
  it("uses Chat SDK's names, with Slack's as aliases", () => {
    expect(['+1', ':thumbsup:', '👍', 'thumbs_up'].map(normalizeEmoji)).toEqual(Array(4).fill('thumbs_up'))
    expect(normalizeEmoji('white_check_mark')).toBe('check')
    expect(normalizeEmoji('❤️')).toBe('heart')
    expect(normalizeEmoji('rotating_light')).toBe('rotating_light')
    expect(displayEmoji('+1')).toBe('👍')
    expect(displayEmoji('tada')).toBe('🎉')
    expect(displayEmoji('made_up')).toBe(':made_up:')
    expect(() => normalizeEmoji('not an emoji')).toThrow('unknown emoji')
  })

  it('groups a reaction stored under an old name with its canonical one', async () => {
    const board = testBoard()
    const julian = caller(board.fetch, await personToken())
    const ada = caller(board.fetch, await personToken('u_ada'))
    const { body } = await julian('POST', '/messages', { channel: 'ops', text: 'shipped' })
    await julian('POST', `/messages/${body.message.id}/reactions`, { emoji: '+1' }) // as written before Chat SDK's names
    await ada('POST', `/messages/${body.message.id}/reactions`, { emoji: 'thumbs_up' })
    const { body: thread } = await julian('GET', `/messages/${body.message.id}`)
    expect(thread.message.reactions).toEqual({ thumbs_up: ['vercel:user:u_julian', 'vercel:user:u_ada'] })
  })
})
