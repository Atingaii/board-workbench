import { describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { http } from '../src/backend-http/index.ts'
import { bearer, BOARD_URL, caller, deploymentToken, personToken, testBoard, workflowToken } from './harness.ts'

type Fetch = (request: Request) => Promise<Response>

// What a handle does on top of the protocol for grants: a private channel from createChannel and
// createGrant, and `can` and principals as people write them. Each handle here is a caller's, over
// HTTP, to a board in this process.

/** A handle on the board behind `fetch`, as whoever `token` names. */
const handleAs = (fetch: Fetch, token: () => Promise<string>) => board({ backend: http(BOARD_URL, { fetch: bearer((input, init) => fetch(new Request(input, init)), token) }) }).as(null)

const ids = async (team: ReturnType<typeof testBoard>) => (await team.grants()).map((grant) => grant.id)

describe('a private channel, from the handle', () => {
  it('is the channel, then a grant letting its creator in, then one closing it to everyone else', async () => {
    const team = testBoard()
    const julian = handleAs(team.fetch, () => personToken())
    const made = await julian.createChannel('vault', { private: true })
    expect(made).toMatchObject({
      channel: { path: 'vault' },
      created: true,
      grants: [
        { principals: [{ kind: 'user', userId: 'u_julian' }], can: { 'vault/': 'all' } },
        { principals: [{ kind: 'everyone' }], can: { 'vault/': [] } },
      ],
    })
    expect((await julian.post('vault/keys', { text: 'rotated' })).channel).toBe('vault/keys')
    expect((await caller(team.fetch, await personToken('u_ada'))('POST', '/messages', { channel: 'vault', text: 'let me in' })).status).toBe(403)
    // A deployment lets in its own project, in the environment it runs in.
    await team.createGrant({ principals: [{ kind: 'project', project: 'prj_ops', environments: ['production'] }], can: { '*': 'all' } })
    const ops = handleAs(team.fetch, () => deploymentToken('ops', 'prj_ops', 'production'))
    expect((await ops.createChannel('ops/keys', { private: true })).grants?.[0]?.principals).toEqual([{ kind: 'project', projectId: 'prj_ops', name: null, environments: ['production'] }])
  })

  it("refuses a channel that's there and a caller no grant could name, before it writes anything", async () => {
    const team = testBoard()
    const julian = handleAs(team.fetch, () => personToken())
    await julian.post('dev', { text: 'already here' })
    const before = await ids(team)
    await expect(julian.createChannel('dev', { private: true })).rejects.toMatchObject({ status: 409, code: 'channel_exists', origin: 'handle' })
    // The board's own code, and a GitHub run, are no principal a grant could let in.
    await expect(team.createChannel('mine', { private: true })).rejects.toMatchObject({ status: 400, code: 'no_own_principal', origin: 'handle' })
    await team.createGrant({ principals: [{ kind: 'github', repository: 'basehub-ai/www' }], can: { '*': 'all' } })
    await expect(handleAs(team.fetch, () => workflowToken()).createChannel('ci-secrets', { private: true })).rejects.toMatchObject({ status: 400, code: 'no_own_principal' })
    expect((await team.channels()).map((channel) => channel.path)).toEqual(['dev'])
    expect((await ids(team)).length).toBe(before.length + 1)
  })

  it('leaves the channel open when a step after it fails, never closed to its creator', async () => {
    const team = testBoard()
    let grantsPosted = 0
    // The second grant, the one that closes the channel, never reaches the board.
    const flaky: Fetch = async (request) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/grants') && ++grantsPosted === 2) throw new TypeError('fetch failed')
      return team.fetch(request)
    }
    const julian = handleAs(flaky, () => personToken())
    await expect(julian.createChannel('vault', { private: true })).rejects.toThrow()
    expect((await team.grants()).slice(2).map((grant) => [grant.principals, grant.can])).toEqual([[[{ kind: 'user', userId: 'u_julian', email: null }], { 'vault/': 'all' }]])
    expect((await caller(team.fetch, await personToken('u_ada'))('POST', '/messages', { channel: 'vault', text: 'still open' })).status).toBe(201)
  })
})

describe('grants, from the handle', () => {
  it("takes 'none' at a pattern and leaves out a project's environments, as people write them", async () => {
    const team = testBoard()
    const julian = handleAs(team.fetch, () => personToken())
    const { grant } = await julian.createGrant({
      principals: [{ kind: 'project', project: 'prj_web' }, { kind: 'all-projects' }],
      can: { '*': 'all', 'security/': 'none' },
    })
    expect(grant).toMatchObject({
      principals: [
        { kind: 'project', projectId: 'prj_web', environments: ['production'] },
        { kind: 'all-projects', environments: ['production'] },
      ],
      can: { '*': 'all', 'security/': [] },
    })
    const updated = await julian.updateGrant(grant.id, { add: [{ kind: 'project', project: 'prj_api' }], remove: [{ kind: 'all-projects' }], can: { 'ci/': 'none' } })
    expect(updated.grant).toMatchObject({ principals: [{ projectId: 'prj_web' }, { projectId: 'prj_api', environments: ['production'] }], can: { 'ci/': [] } })
    const { token } = await julian.createToken({ name: 'no-security', can: { '*': ['read'], 'security/': 'none' } })
    expect(token.can).toEqual({ '*': ['read'], 'security/': [] })
  })
})
