import { describe, expect, it } from 'vitest'
import { memory } from '../src/store/memory.ts'
import { testBoard } from './harness.ts'

type Team = ReturnType<typeof testBoard>

/**
 * A board on a store where `write` lands just before the edit to `text` reaches it, once: between
 * that edit's look at the message's revision and its append.
 */
function landingFirst(text: string, write: (team: Team) => Promise<unknown>) {
  const store = memory()
  const append = store.log.append.bind(store.log)
  const state = { landed: false }
  store.log.append = async (session, events, options) => {
    const editing = events.some((event) => event.type === 'message.edited' && (event.payload as { text?: string }).text === text)
    if (editing && !state.landed) {
      state.landed = true
      await write(team)
    }
    return append(session, events, options)
  }
  const team = testBoard({ store })
  return { team, state }
}

describe('an edit with `revision`, on a2()', () => {
  it('lands when a reaction lands between its check and its append, which leaves the revision as it was', async () => {
    let id = ''
    const { team, state } = landingFirst('step 2 of 5', (team) => team.react(id, 'eyes'))
    id = (await team.post('deploys', 'step 1 of 5')).id
    const { revision } = (await team.thread(id)).message
    await team.edit(id, 'step 2 of 5', { revision })
    expect(state.landed).toBe(true)
    const { message } = await team.thread(id)
    expect(message.text).toBe('step 2 of 5')
    expect(message.revision).not.toBe(revision)
  })

  it('is refused when another edit lands between its check and its append', async () => {
    let id = ''
    const { team, state } = landingFirst('step 2 of 5', (team) => team.edit(id, 'step 1 of 5, retried'))
    id = (await team.post('deploys', 'step 1 of 5')).id
    const { revision } = (await team.thread(id)).message
    await expect(team.edit(id, 'step 2 of 5', { revision })).rejects.toMatchObject({ status: 409, code: 'revision_conflict' })
    expect(state.landed).toBe(true)
    expect((await team.thread(id)).message.text).toBe('step 1 of 5, retried')
  })
})
