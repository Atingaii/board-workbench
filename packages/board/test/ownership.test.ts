import { describe, expect, it } from 'vitest'
import { caller, personToken, testBoard } from './harness.ts'
import { fakeQueue } from './queue.ts'

/** A board, and Julian on it as himself or as any profile, with headers a proxy might add. */
async function setUp(options: Parameters<typeof testBoard>[0] = {}) {
  const board = testBoard(options)
  const token = await personToken()
  const julian = caller(board.fetch, token)
  const as = (profile: string, headers: Record<string, string> = {}) => caller(board.fetch, token, { 'x-board-profile': profile, ...headers })
  const post = async (by: typeof julian, text: string) => (await by('POST', '/messages', { channel: 'dev', text })).body.message as { id: string; by: { actor: string } }
  return { board, token, julian, as, post }
}

/** What a sandbox's policy narrows it to by default: no `manage`, so nothing but owning a write lets it change one. */
const NARROWED = { 'x-board-can': '*=read,post,react,label' }

describe('who changes what a principal wrote', () => {
  it("lets a profile edit and delete only what it wrote, not another profile's or its principal's", async () => {
    const { julian, as, post } = await setUp()
    const claude = as('claude')
    const codex = as('codex')
    const julians = await post(julian, 'mine')
    const codexes = await post(codex, 'on it')
    const claudes = await post(claude, 'me too')
    for (const message of [julians, codexes]) {
      expect((await claude('POST', `/messages/${message.id}/edit`, { text: 'not yours' })).status).toBe(403)
      expect((await claude('POST', `/messages/${message.id}/delete`, {})).status).toBe(403)
    }
    expect((await julian('GET', `/messages/${codexes.id}`)).body.message).toMatchObject({ text: 'on it', deleted: false })
    // A profile's name in another case is the same profile.
    expect((await as('Claude')('POST', `/messages/${claudes.id}/edit`, { text: 'me too, edited' })).status).toBe(200)
    expect((await claude('POST', `/messages/${claudes.id}/delete`, {})).status).toBe(200)
  })

  it('lets the principal itself edit and delete what any of its profiles wrote, keeping who wrote it', async () => {
    const { julian, as, post } = await setUp()
    const codexes = await post(as('codex'), 'on it')
    expect((await julian('POST', `/messages/${codexes.id}/edit`, { text: 'on it, edited' })).status).toBe(200)
    expect((await julian('GET', `/messages/${codexes.id}`)).body.message).toMatchObject({ text: 'on it, edited', by: { actor: codexes.by.actor } })
    expect((await julian('POST', `/messages/${codexes.id}/delete`, {})).status).toBe(200)
    expect((await julian('GET', `/messages/${codexes.id}`)).body.message.deleted).toBe(true)
  })

  it('holds a sandbox its policy narrows to its own profile, whatever its principal wrote as another', async () => {
    const { board, token, as, post } = await setUp()
    const fixer = as('fixer', NARROWED)
    const triage = await post(as('triage'), 'triaged')
    const fixers = await post(fixer, 'fixing')
    expect((await fixer('POST', `/messages/${triage.id}/edit`, { text: 'not yours' })).status).toBe(403)
    expect((await fixer('POST', `/messages/${triage.id}/delete`, {})).status).toBe(403)
    expect((await fixer('POST', `/messages/${fixers.id}/edit`, { text: 'fixed' })).status).toBe(200)
    expect((await fixer('POST', `/messages/${fixers.id}/delete`, {})).status).toBe(200)
    // Narrowing alone takes nothing from the principal itself.
    const julian = caller(board.fetch, token, NARROWED)
    expect((await julian('POST', `/messages/${triage.id}/edit`, { text: 'triaged, edited' })).status).toBe(200)
  })

  it('lets a profile cancel only schedules made as it, and its principal any of them', async () => {
    const queue = fakeQueue()
    const { board, token, as } = await setUp({ scheduler: queue.scheduler })
    // Without manage, which cancels anyone's.
    const julian = caller(board.fetch, token, NARROWED)
    const claude = as('claude', NARROWED)
    const schedule = async (by: typeof julian, text: string) => (await by('POST', '/schedules', { channel: 'dev', text, every: '1d' })).body.schedule as { id: string }
    const standup = await schedule(julian, 'standup')
    const codexes = await schedule(as('codex'), 'check CI')
    const claudes = await schedule(claude, 'check deploys')
    for (const other of [standup, codexes]) expect((await claude('POST', `/schedules/${other.id}/cancel`, {})).status).toBe(403)
    expect((await claude('POST', `/schedules/${claudes.id}/cancel`, {})).body).toMatchObject({ canceled: true })
    expect((await julian('POST', `/schedules/${codexes.id}/cancel`, {})).body).toMatchObject({ canceled: true })
  })
})
