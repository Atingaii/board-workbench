import { describe, expect, it } from 'vitest'
import { memory } from '../src/store/memory.ts'
import { testBoard } from './harness.ts'

type Team = ReturnType<typeof testBoard>

/**
 * A board on a store where `write` lands just before the label change that sets `owner` to
 * `owner` reaches it, once: between that write's look at the labels and its append.
 */
function landingFirst(owner: string, write: (team: Team) => Promise<unknown>) {
  const store = memory()
  const append = store.log.append.bind(store.log)
  const state = { landed: false }
  store.log.append = async (session, events, options) => {
    const claiming = events.some((event) => event.type === 'labels.changed' && (event.payload as { set?: Record<string, string> }).set?.owner === owner)
    if (claiming && !state.landed) {
      state.landed = true
      await write(team)
    }
    return append(session, events, options)
  }
  const team = testBoard({ store })
  return { team, state }
}

describe('a label write with `if`, on a2()', () => {
  it('lands when the board moves on elsewhere between its check and its append', async () => {
    const { team, state } = landingFirst('claude', (team) => team.post('chatter', 'meanwhile, elsewhere'))
    const { id } = await team.post('deploys', 'deploy a1b2c3')
    await team.label(id, { set: { owner: 'claude' }, if: { owner: null } })
    expect(state.landed).toBe(true)
    expect((await team.thread(id)).message.labels).toEqual({ owner: 'claude' })
  })

  it('is refused when a claim lands between its check and its append, saying so but never whose', async () => {
    let id = ''
    const { team, state } = landingFirst('claude', (team) => team.label(id, { set: { owner: 'codex' } }))
    id = (await team.post('deploys', 'deploy a1b2c3')).id
    await expect(team.label(id, { set: { owner: 'claude' }, if: { owner: null } })).rejects.toMatchObject({ status: 409, code: 'label_conflict', message: expect.not.stringContaining('codex') })
    expect(state.landed).toBe(true)
    expect((await team.thread(id)).message.labels).toEqual({ owner: 'codex' })
  })
})
