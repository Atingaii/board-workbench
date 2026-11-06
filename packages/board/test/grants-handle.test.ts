import { describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { http } from '../src/backend-http/index.ts'
import { oidcTokens, vercelProject } from '../src/access/index.ts'
import { board as mount, bearer, BOARD_URL, caller, deploymentToken, personToken, testAuth, testBoard, workflowToken } from './harness.ts'

/** Where a gateway on the team's board is mounted. */
const V0_URL = 'https://v0.test/api/board'

type Fetch = (request: Request) => Promise<Response>

// What a handle does on top of the protocol for grants: a private channel from createChannel and
// createGrant, and `can` and principals as people write them. Each handle here is a caller's, over
// HTTP, to a board in this process.

/** A handle on the board behind `fetch`, as whoever `token` names. */
const handleAs = (fetch: Fetch, token: () => Promise<string>) => board({ backend: http(BOARD_URL, { fetch: bearer((input, init) => fetch(new Request(input, init)), token) }) }).as(null)

const ids = async (team: ReturnType<typeof testBoard>) => (await team.grants()).map((grant) => grant.id)

describe('a private channel, from the handle', () => {
  it("is a grant letting its creator in, then one closing it to everyone else, then the channel", async () => {
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

  it("refuses a path where it or a channel under it is there, and a caller no grant could name, before it writes anything", async () => {
    const team = testBoard()
    const julian = handleAs(team.fetch, () => personToken())
    await julian.post('dev', { text: 'already here' })
    await julian.post('security/incidents', { text: 'under it' })
    const before = await ids(team)
    await expect(julian.createChannel('dev', { private: true })).rejects.toMatchObject({ status: 409, code: 'channel_exists', origin: 'handle' })
    // Closing security/ would close security/incidents too.
    await expect(julian.createChannel('security', { private: true })).rejects.toMatchObject({ status: 409, code: 'channel_exists', message: expect.stringContaining('security/incidents') })
    // The board's own code, and a GitHub run, are no principal a grant could let in.
    await expect(team.createChannel('mine', { private: true })).rejects.toMatchObject({ status: 400, code: 'no_own_principal', origin: 'handle' })
    await team.createGrant({ principals: [{ kind: 'github', repository: 'basehub-ai/www' }], can: { '*': 'all' } })
    await expect(handleAs(team.fetch, () => workflowToken()).createChannel('ci-secrets', { private: true })).rejects.toMatchObject({ status: 400, code: 'no_own_principal' })
    expect((await team.channels()).map((channel) => channel.path)).toEqual(['dev', 'security/incidents'])
    expect((await ids(team)).length).toBe(before.length + 1)
  })

  it('never shuts its creator out when a step fails part way', async () => {
    const team = testBoard()
    let grantsPosted = 0
    let channels = true
    // The second grant, the one that closes it, never reaches the board; then, the channel doesn't.
    const flaky: Fetch = async (request) => {
      const path = new URL(request.url).pathname
      if (request.method === 'POST' && path.endsWith('/grants') && ++grantsPosted === 2) throw new TypeError('fetch failed')
      if (request.method === 'POST' && path.endsWith('/channels') && !channels) throw new TypeError('fetch failed')
      return team.fetch(request)
    }
    const julian = handleAs(flaky, () => personToken())
    const ada = caller(team.fetch, await personToken('u_ada'))
    await expect(julian.createChannel('vault', { private: true })).rejects.toThrow()
    // Open, with a grant too many.
    expect((await team.grants()).slice(2).map((grant) => [grant.principals, grant.can])).toEqual([[[{ kind: 'user', userId: 'u_julian', email: null }], { 'vault/': 'all' }]])
    expect((await team.channels()).map((channel) => channel.path)).toEqual([])
    expect((await ada('POST', '/messages', { channel: 'vault', text: 'still open' })).status).toBe(201)
    // Closed, and not made yet: its creator still gets in.
    channels = false
    await expect(julian.createChannel('lockbox', { private: true })).rejects.toThrow()
    expect((await team.channels()).map((channel) => channel.path)).toEqual(['vault'])
    expect((await ada('POST', '/messages', { channel: 'lockbox', text: 'let me in' })).status).toBe(403)
    expect((await caller(team.fetch, await personToken())('POST', '/messages', { channel: 'lockbox', text: 'mine' })).status).toBe(201)
  })

  it('makes nothing on a board that keeps no grants, or through a gateway, which would grant its whole project', async () => {
    const none = testBoard({ access: async () => 'all' as const })
    await expect(handleAs(none.fetch, () => personToken()).createChannel('vault', { private: true })).rejects.toMatchObject({ status: 501, code: 'no_grants' })
    expect(await none.channels()).toEqual([])
    // A gateway on the team's board: its callers act there as its project.
    const team = testBoard({ access: [vercelProject({ project: 'prj_v0', can: 'all' })] })
    const remote = (input: RequestInfo | URL, init?: RequestInit) => team.fetch(new Request(input, init))
    const gateway = mount({ backend: http(BOARD_URL, { fetch: bearer(remote, () => deploymentToken('v0', 'prj_v0', 'production')) }), url: V0_URL, authenticate: oidcTokens(testAuth), access: [vercelProject({ project: 'prj_web', can: 'all' })] })
    const served = board({ backend: http(V0_URL, { fetch: bearer((input, init) => gateway.fetch(new Request(input, init)), () => personToken('u_julian', V0_URL)) }) }).as(null)
    await expect(served.createChannel('vault', { private: true })).rejects.toMatchObject({ status: 403 })
    expect((await ids(team)).length).toBe(2)
    expect(await team.channels()).toEqual([])
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
