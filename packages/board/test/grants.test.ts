import { describe, expect, it, vi } from 'vitest'
import { githubActions, oidc, vercelProject, type Known } from '../src/server/auth.ts'
import { createServer } from 'experimental-a2/server'
import { ACCESS_SESSION, accessContract } from '../src/contract/contract.ts'
import { caller, deploymentToken, localUserToken, oidcToken, OIDC_ISS, personToken, testBoard, testKeys, workflowToken } from './harness.ts'

/**
 * A board, its owner (its local user, as `vb serve` mints a token for it), a person on the team,
 * and callers with other tokens: the owner and the person set grants, the others try the board.
 */
async function setUp(options: Parameters<typeof testBoard>[0] = {}) {
  const board = testBoard(options)
  const owner = caller(board.fetch, await localUserToken())
  const person = caller(board.fetch, await personToken())
  return { board, owner, person, as: async (token: string | Promise<string>) => caller(board.fetch, await token) }
}

const ALL = ['read', 'post', 'react', 'label', 'sync', 'manage']
const everyone = { kind: 'everyone' } as const
const user = (userId: string) => ({ kind: 'user', userId }) as const

describe('grants', () => {
  it('starts with every person doing everything, and every project on the team reading, posting, reacting, and labeling', async () => {
    const { person, as } = await setUp()
    expect((await person('GET', '/grants')).body.grants).toEqual([
      { id: 'g1', principals: [{ kind: 'all-users' }], can: { '*': 'all' }, capped: false, by: null, at: null },
      { id: 'g2', principals: [{ kind: 'all-projects', environments: ['production', 'preview', 'development'] }], can: { '*': ['read', 'post', 'react', 'label'] }, capped: false, by: null, at: null },
    ])
    expect((await (await as(personToken('u_ada')))('GET', '/me')).body.can).toEqual({ '*': ALL })
    // Any project on the board's team, its previews included; none on another team.
    expect((await (await as(deploymentToken('web', 'prj_web', 'preview')))('GET', '/me')).body.can).toEqual({ '*': ['read', 'post', 'react', 'label'] })
    expect((await (await as(deploymentToken('web', 'prj_partner', 'production', { teamId: 'team_partner' })))('GET', '/me')).status).toBe(403)
  })

  it('lets in a workflow a grant names, as its can says, and keeps it out once revoked', async () => {
    const { person, as } = await setUp()
    const workflow = await as(workflowToken())
    expect((await workflow('GET', '/me')).status).toBe(403)
    const set = await person('POST', '/grants', { principals: [{ kind: 'github', repository: 'basehub-ai/www' }], can: { 'ci/': ['read', 'post'] } })
    expect(set.status).toBe(200)
    expect(set.body.grant).toMatchObject({ principals: [{ kind: 'github', repository: 'basehub-ai/www', repositoryId: null }], can: { 'ci/': ['read', 'post'] }, by: 'vercel:user:u_julian' })
    expect((await workflow('POST', '/messages', { channel: 'ci', text: 'green' })).status).toBe(201)
    expect((await workflow('POST', '/messages', { channel: 'dev', text: 'not here' })).status).toBe(403)
    expect((await person('POST', `/grants/${set.body.grant.id}/revoke`, {})).body).toEqual({ revoked: true })
    expect((await workflow('POST', '/messages', { channel: 'ci', text: 'again' })).status).toBe(403)
  })

  it('decides a channel by its most specific pattern first, then by the closest principal', async () => {
    const { owner, as } = await setUp()
    await owner('POST', '/grants', { principals: [everyone], can: { 'security/': [] } })
    await owner('POST', '/grants', { principals: [user('u_alice')], can: { 'security/': 'all' } })
    // A grant naming Bob on * doesn't reach security/: the more specific pattern decides first.
    await owner('POST', '/grants', { principals: [user('u_bob')], can: { '*': 'all' } })
    const alice = await as(personToken('u_alice'))
    const bob = await as(personToken('u_bob'))
    expect((await alice('POST', '/messages', { channel: 'security/incidents', text: 'paged' })).status).toBe(201)
    expect((await bob('GET', '/me')).body.can).toEqual({ '*': ALL, 'security/': [] })
    expect((await bob('POST', '/messages', { channel: 'security/incidents', text: 'paged' })).status).toBe(403)
    expect((await bob('POST', '/messages', { channel: 'dev', text: 'hi' })).status).toBe(201)
  })

  it('adds up grants tied at the closest principal, past what a group gives at the same pattern', async () => {
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [user('u_ada')], can: { 'dev/': ['read'] } })
    await person('POST', '/grants', { principals: [user('u_ada')], can: { 'dev/': ['post'] } })
    await person('POST', '/grants', { principals: [{ kind: 'all-users' }], can: { 'dev/': 'all' } })
    expect((await (await as(personToken('u_ada')))('GET', '/me')).body.can).toEqual({ '*': ALL, 'dev/': ['read', 'post'] })
    // Grace is named only by the group, which decides for her there.
    expect((await (await as(personToken('u_grace')))('GET', '/me')).body.can).toEqual({ '*': ALL })
  })

  it('lets no one in through everyone alone, and narrows whoever else is let in', async () => {
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [everyone], can: { '*': 'all', 'ci/': [] } })
    expect((await (await as(workflowToken()))('GET', '/me')).status).toBe(403)
    // A project on the team is let in by g2, and everyone's ci/ is more specific than g2's *.
    expect((await (await as(deploymentToken('web', 'prj_web', 'production')))('GET', '/me')).body.can).toEqual({ '*': ['read', 'post', 'react', 'label'], 'ci/': [] })
  })

  it("meets the code's rules as the principals they name", async () => {
    const { person, as } = await setUp({
      access: [githubActions({ repository: 'basehub-ai/www', can: { 'ci/': ['read', 'post'] } }), vercelProject({ project: 'prj_web', can: { '*': ['read'] } })],
    })
    await person('POST', '/grants', { principals: [everyone], can: { '*': ['read'], 'ci/': [], 'ci/deploys': [] } })
    // ci/ is the rule's, as a grant naming the repository would be; ci/deploys only everyone names.
    expect((await (await as(workflowToken()))('GET', '/me')).body.can).toEqual({ '*': ['read'], 'ci/': ['read', 'post'], 'ci/deploys': [] })
    // A rule naming a project is closer than g2's every project: at *, it alone decides.
    expect((await (await as(deploymentToken('web', 'prj_web', 'production')))('GET', '/me')).body.can).toEqual({ '*': ['read'], 'ci/': [] })
  })

  it('lets a member grant on * once a channel is closed to everyone, which the grant then leaves closed', async () => {
    const { owner, as } = await setUp()
    await owner('POST', '/grants', { principals: [everyone], can: { 'security/': [] } })
    await owner('POST', '/grants', { principals: [user('u_alice')], can: { 'security/': 'all' } })
    const bob = await as(personToken('u_bob'))
    const run = { kind: 'github', repository: 'acme/web' }
    const made = await bob('POST', '/grants', { principals: [run], can: { '*': 'all' } })
    expect(made.status).toBe(200)
    expect((await bob('PATCH', `/grants/${made.body.grant.id}`, { can: { '*': ['read', 'post'] } })).status).toBe(200)
    // The run it lets in gets nothing in security/: everyone's grant there is more specific than *.
    const me = (await (await as(workflowToken({ repository: 'acme/web', repository_id: '99' })))('GET', '/me')).body
    expect(me.can).toEqual({ '*': ['read', 'post'], 'security/': [] })
    // Nothing on security/ or under it, which Bob doesn't manage.
    for (const can of [{ 'security/': ['read'] }, { 'security/incidents': ['read'] }, { '*': 'all', 'security/': 'all' }])
      expect([JSON.stringify(can), (await bob('POST', '/grants', { principals: [run], can })).status]).toEqual([JSON.stringify(can), 403])
  })

  it("lets no one grant past a grant that narrows them, theirs or everyone's", async () => {
    const { owner, as } = await setUp()
    const run = { kind: 'github', repository: 'acme/web' }
    // Bob's own grant closes security/ to him: a grant on * for his run would open it.
    await owner('POST', '/grants', { principals: [user('u_bob')], can: { 'security/': [] } })
    const bob = await as(personToken('u_bob'))
    expect((await bob('POST', '/grants', { principals: [run], can: { '*': 'all' } })).status).toBe(403)
    // Carol's closes security/incidents to her, where everyone reads: anyone she lets in would read it.
    await owner('POST', '/grants', { principals: [everyone], can: { 'security/': ['read'] } })
    await owner('POST', '/grants', { principals: [user('u_carol')], can: { 'security/incidents': [] } })
    const carol = await as(personToken('u_carol'))
    expect((await carol('POST', '/grants', { principals: [run], can: { 'dev/': ['post'] } })).status).toBe(403)
  })

  it('revokes, or removes from, a grant with manage where it applies, however narrow the caller is elsewhere', async () => {
    const { owner, as } = await setUp()
    await owner('POST', '/grants', { principals: [everyone], can: { 'security/': ['read'] } })
    await owner('POST', '/grants', { principals: [user('u_carol')], can: { 'security/incidents': [] } })
    const wide = await owner('POST', '/grants', { principals: [{ kind: 'github', repository: 'acme/web' }, { kind: 'github', repository: 'acme/api' }], can: { '*': ['read'] } })
    const carol = await as(personToken('u_carol'))
    expect((await carol('PATCH', `/grants/${wide.body.grant.id}`, { add: [{ kind: 'github', repository: 'acme/cli' }] })).status).toBe(403)
    expect((await carol('PATCH', `/grants/${wide.body.grant.id}`, { remove: [{ kind: 'github', repository: 'acme/api' }] })).status).toBe(200)
    expect((await carol('POST', `/grants/${wide.body.grant.id}/revoke`, {})).body).toEqual({ revoked: true })
  })

  it('lets no token reach past its own can by granting someone else', async () => {
    const { person, as } = await setUp()
    // Manage at *, but nothing in security/, where no grant closes it to everyone: a grant on * for a run it controls would be all of security/ too.
    const minted = await person('POST', '/tokens', { name: 'scoped', can: { '*': 'all', 'security/': [] } })
    const scoped = await as(minted.body.secret)
    const run = { kind: 'github', repository: 'acme/web' }
    expect((await scoped('POST', '/grants', { principals: [run], can: { '*': 'all' } })).status).toBe(403)
    expect((await scoped('POST', '/grants', { principals: [run], can: { 'dev/': 'all' } })).status).toBe(200)
  })

  it("lets no token let in a principal it controls where everyone gets more than the token has", async () => {
    const { owner, person, as } = await setUp()
    await owner('POST', '/grants', { principals: [everyone], can: { 'secret/': ['read'] } })
    const minted = await person('POST', '/tokens', { name: 'scoped', can: { '*': 'all', 'secret/': [] } })
    const scoped = await as(minted.body.secret)
    // Nothing narrower is under dev/, but the run it lets in would read secret/ through everyone's grant.
    expect((await scoped('POST', '/grants', { principals: [{ kind: 'github', repository: 'acme/web' }], can: { 'dev/': ['post'] } })).status).toBe(403)
    expect((await (await as(workflowToken({ repository: 'acme/web', repository_id: '99' })))('GET', '/me')).status).toBe(403)
  })

  it("lets the board's local user, its owner, change any grant, though a closed channel still takes a grant to read", async () => {
    const { owner, person, as } = await setUp()
    const lock = await person('POST', '/grants', { principals: [everyone], can: { 'security/': [] } })
    // A person on the team is no owner: once security/ is closed to them, they open it to no one, and can't undo it.
    expect((await person('POST', '/grants', { principals: [user('u_julian')], can: { 'security/': 'all' } })).status).toBe(403)
    expect((await person('POST', `/grants/${lock.body.grant.id}/revoke`, {})).status).toBe(403)
    expect((await owner('POST', '/messages', { channel: 'security', text: 'locked out' })).status).toBe(403)
    // With g1 gone, the local user manages nothing, and is still the owner.
    expect((await owner('POST', '/grants/g1/revoke', {})).body).toEqual({ revoked: true })
    expect((await owner('GET', '/me')).body.can).toEqual({})
    expect((await owner('POST', '/grants', { principals: [user('julian')], can: { 'security/': 'all' } })).status).toBe(200)
    expect((await owner('POST', '/messages', { channel: 'security', text: 'let in' })).status).toBe(201)
    // A token the owner mints goes no further than its can, owner or not.
    const minted = await owner('POST', '/tokens', { name: 'reader', can: { 'security/': ['read'] } })
    const reader = await as(minted.body.secret)
    expect((await reader('POST', '/grants', { principals: [everyone], can: { 'security/': ['read'] } })).status).toBe(403)
    expect((await reader('GET', '/grants')).status).toBe(403)
  })

  it("names no stored grant's channels to a caller that can't list the grants", async () => {
    const { owner, as } = await setUp()
    const secret = await owner('POST', '/grants', { principals: [everyone], can: { 'security/incidents/': [] } })
    await owner('POST', '/grants', { principals: [{ kind: 'project', project: 'prj_ops', environments: ['production'] }], can: { 'ci/': 'all' } })
    const ops = await as(deploymentToken('ops', 'prj_ops', 'production'))
    for (const [method, path, body] of [
      ['PATCH', `/grants/${secret.body.grant.id}`, { can: { 'ci/': ['read'] } }],
      ['POST', `/grants/${secret.body.grant.id}/revoke`, {}],
    ] as const) {
      const refused = await ops(method, path, body)
      expect([refused.status, JSON.stringify(refused.body).includes('security')]).toEqual([403, false])
    }
  })

  it('keeps both of two adds to one grant that land at once', async () => {
    const { person } = await setUp()
    const { body } = await person('POST', '/grants', { principals: [user('u_ada')], can: { 'dev/': ['read'] } })
    const id = body.grant.id
    const answers = await Promise.all(['u_bob', 'u_carol', 'u_dan'].map((added) => person('PATCH', `/grants/${id}`, { add: [user(added)] })))
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200])
    const kept = (await person('GET', '/grants')).body.grants.find((grant: { id: string }) => grant.id === id)
    expect(kept.principals.map((principal: { userId: string }) => principal.userId).sort()).toEqual(['u_ada', 'u_bob', 'u_carol', 'u_dan'])
  })

  it('makes a new grant for the same principals, and keeps can as written', async () => {
    const { person } = await setUp()
    const grant = { principals: [{ kind: 'project', project: 'prj_front', environments: ['production', 'preview', 'production'] }], can: { '*': ['label', 'read'], 'feedback/': [] } }
    const first = await person('POST', '/grants', grant)
    const again = await person('POST', '/grants', grant)
    expect([first.body.grant.id, again.body.grant.id]).toEqual(['g3', 'g4'])
    expect(first.body.grant).toMatchObject({
      principals: [{ kind: 'project', projectId: 'prj_front', name: null, environments: ['production', 'preview'] }],
      can: { '*': ['read', 'label'], 'feedback/': [] },
    })
    expect((await person('GET', '/grants')).body.grants.map((listed: { id: string }) => listed.id)).toEqual(['g1', 'g2', 'g3', 'g4'])
  })

  it('updates a grant by its ID: adds principals, removes them by who they are, and replaces its can', async () => {
    const { person } = await setUp()
    const made = await person('POST', '/grants', { principals: [{ kind: 'project', project: 'prj_front', environments: ['preview'] }], can: { 'dev/': ['post'] } })
    const id = made.body.grant.id
    const added = await person('PATCH', `/grants/${id}`, {
      add: [user('u_ada'), { kind: 'github', repository: 'acme/web', workflow: 'ci.yml' }, { kind: 'all-projects', environments: ['preview'] }],
      can: { 'dev/': ['read', 'post'] },
    })
    expect(added.body.grant).toMatchObject({
      id,
      principals: [
        { kind: 'project', projectId: 'prj_front' },
        { kind: 'user', userId: 'u_ada' },
        { kind: 'github', repository: 'acme/web', workflow: '.github/workflows/ci.yml' },
        { kind: 'all-projects', environments: ['preview'] },
      ],
      can: { 'dev/': ['read', 'post'] },
    })
    // Adding a project it names already adds its environments to it.
    const joined = await person('PATCH', `/grants/${id}`, { add: [{ kind: 'project', project: 'prj_front', environments: ['production'] }, { kind: 'all-projects', environments: ['development'] }] })
    expect(joined.body.grant.principals).toMatchObject([
      { kind: 'project', projectId: 'prj_front', environments: ['production', 'preview'] },
      { kind: 'user' },
      { kind: 'github' },
      { kind: 'all-projects', environments: ['preview', 'development'] },
    ])
    // A project, and every project, is removed by who it is, whatever its environments.
    const removed = await person('PATCH', `/grants/${id}`, { remove: [{ kind: 'project', project: 'prj_front' }, { kind: 'github', repository: 'acme/web' }, { kind: 'all-projects' }] })
    expect(removed.body.grant.principals).toEqual([{ kind: 'user', userId: 'u_ada', email: null }])
    const refused = async (path: string, body: unknown) => {
      const { status, body: answer } = await person('PATCH', path, body)
      return [status, answer.error?.code]
    }
    expect(await refused(`/grants/${id}`, { remove: [{ kind: 'project', project: 'prj_front' }] })).toEqual([400, 'not_in_grant'])
    expect(await refused(`/grants/${id}`, { remove: [user('u_ada')] })).toEqual([400, 'grant_empty'])
    expect(await refused('/grants/g99', { can: { '*': ['read'] } })).toEqual([404, 'grant_not_found'])
    expect(await refused(`/grants/${id}`, {})).toEqual([400, 'invalid_request'])
    expect(await refused(`/grants/${id}`, { add: [{ kind: 'all-projects' }] })).toEqual([400, 'invalid_grant'])
  })

  it('matches a GitHub run by its workflow, branch, and event, as githubActions() does', async () => {
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [{ kind: 'github', repository: 'basehub-ai/www', workflow: 'deploy.yml', branch: 'main', event: 'push' }], can: { 'ci/': ['post'] } })
    const posts = async (claims: Record<string, unknown>) => (await (await as(workflowToken(claims)))('POST', '/messages', { channel: 'ci', text: 'run' })).status
    expect(await posts({})).toBe(201)
    expect(await posts({ workflow_ref: 'basehub-ai/www/.github/workflows/other.yml@refs/heads/main' })).toBe(403)
    expect(await posts({ ref: 'refs/heads/feature' })).toBe(403)
    expect(await posts({ event_name: 'pull_request' })).toBe(403)
  })

  it('trusts an issuer once a grant names it, and only for tokens with its claims', async () => {
    const { person, as } = await setUp()
    const gitlab = await as(oidcToken())
    expect((await gitlab('GET', '/me')).status).toBe(401)
    await person('POST', '/grants', { principals: [{ kind: 'oidc', issuer: OIDC_ISS, claims: { project_path: 'acme/api' } }], can: { 'ci/': ['post'] } })
    expect((await gitlab('POST', '/messages', { channel: 'ci', text: 'from gitlab' })).status).toBe(201)
    const another = await as(oidcToken({ project_path: 'acme/other', sub: 'project_path:acme/other' }))
    expect((await another('POST', '/messages', { channel: 'ci', text: 'not granted' })).status).toBe(403)
  })

  it("finds a grant's issuer's keys by OIDC discovery, never by a redirect or on the board's own network", async () => {
    const ISS = 'https://idp.acme.dev'
    const DISCOVERY = `${ISS}/.well-known/openid-configuration`
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [{ kind: 'oidc', issuer: ISS, claims: { project_path: 'acme/api' } }], can: { 'ci/': ['read'] } })
    const me = async () => (await (await as(oidcToken({}, ISS)))('GET', '/me')).status
    // The network as fetch sees it: a redirect is followed unless the request says otherwise.
    const asked: string[] = []
    let routes: Record<string, () => Response> = {}
    const network = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      asked.push(url)
      const response = routes[url]?.() ?? new Response('not found', { status: 404 })
      const location = response.headers.get('location')
      if (location && response.status >= 300 && response.status < 400) {
        const mode = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow')
        if (mode === 'error') throw new TypeError('redirected')
        if (mode === 'follow') return network(new URL(location, url).href, init)
      }
      return response
    }
    vi.stubGlobal('fetch', network)
    try {
      const refused = {
        'a redirect to the metadata service': [{ [DISCOVERY]: () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }) }, 'http://169.254.169.254/latest/meta-data/'],
        'keys on its own network': [{ [DISCOVERY]: () => Response.json({ issuer: ISS, jwks_uri: 'https://keys.internal/jwks' }) }, 'https://keys.internal/jwks'],
        'keys over plain http': [{ [DISCOVERY]: () => Response.json({ issuer: ISS, jwks_uri: 'http://idp.acme.dev/jwks' }) }, 'http://idp.acme.dev/jwks'],
        'a document for another issuer': [{ [DISCOVERY]: () => Response.json({ issuer: 'https://evil.example', jwks_uri: `${ISS}/jwks` }) }, `${ISS}/jwks`],
      } as const
      for (const [why, [served, never]] of Object.entries(refused)) {
        routes = served
        expect([why, await me()]).toEqual([why, 401])
        expect([why, asked.includes(never)]).toEqual([why, false])
      }
      // Its own document, naming it and its keys, is how it's let in.
      routes = { [DISCOVERY]: () => Response.json({ issuer: ISS, jwks_uri: `${ISS}/jwks` }), [`${ISS}/jwks`]: () => Response.json(testKeys) }
      expect(await me()).toBe(200)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("refuses names it can't look up, and principals that name more than they say", async () => {
    const { person } = await setUp()
    const refused = async (principal: unknown, can: unknown = { '*': ['read'] }) => {
      const { status, body } = await person('POST', '/grants', { principals: [principal], can })
      return [status, body.error?.code]
    }
    const invalid = [400, 'invalid_grant']
    // A board that verifies tokens itself has no directory to look names up in.
    expect(await refused({ kind: 'user', email: 'ada@acme.com' })).toEqual(invalid)
    expect(await refused({ kind: 'project', project: 'front', environments: ['production'] })).toEqual(invalid)
    // Every project is in production, preview, and development; a custom environment is one project's.
    expect(await refused({ kind: 'project', project: 'prj_front' })).toEqual(invalid)
    expect(await refused({ kind: 'all-projects', environments: ['env_staging'] })).toEqual(invalid)
    expect(await refused({ kind: 'github', repository: 'acme' })).toEqual(invalid)
    // A key it doesn't know is refused, never dropped: without workflow, this would let in every run.
    expect(await refused({ kind: 'github', repository: 'acme/web', workflows: 'deploy.yml' })).toEqual([400, 'invalid_request'])
    expect((await person('PATCH', '/grants/g2', { add: [everyone], cann: { '*': ['read'] } })).status).toBe(400)
    // An issuer signs tokens for everyone it serves, and its keys are fetched from it, so never from the board's own network.
    expect(await refused({ kind: 'oidc', issuer: OIDC_ISS, claims: {} })).toEqual(invalid)
    expect(await refused({ kind: 'oidc', issuer: 'https://169.254.169.254', claims: { sub: 'x' } })).toEqual(invalid)
    expect(await refused({ kind: 'oidc', issuer: 'https://ci.internal/oidc', claims: { sub: 'x' } })).toEqual(invalid)
    expect(await refused({ kind: 'oidc', issuer: 'http://gitlab.com', claims: { sub: 'x' } })).toEqual(invalid)
    expect(await refused({ kind: 'oidc', issuer: 'https://oidc.vercel.com/acme', claims: { project_id: 'prj_front' } })).toEqual(invalid)
    expect(await refused({ kind: 'oidc', issuer: 'https://token.actions.githubusercontent.com', claims: { repository: 'acme/web' } })).toEqual(invalid)
    expect(await refused(everyone, { 'ci/*': ['post'] })).toEqual(invalid)
    expect(await refused(everyone, {})).toEqual(invalid)
    expect((await person('POST', '/grants', { principals: [], can: { '*': ['read'] } })).status).toBe(400)
    expect((await person('GET', '/grants')).body.grants.map((grant: { id: string }) => grant.id)).toEqual(['g1', 'g2'])
  })

  it('refuses an issuer that names the same principals as one a grant trusts', async () => {
    const board = testBoard({ access: [] })
    const person = caller(board.fetch, await personToken())
    const gitlab = (issuer: string) => ({ principals: [{ kind: 'oidc', issuer, claims: { project_path: 'acme/api' } }], can: { 'ci/': ['post'] } })
    expect((await person('POST', '/grants', gitlab(OIDC_ISS))).status).toBe(200)
    const { status, body } = await person('POST', '/grants', gitlab(`${OIDC_ISS}/`))
    expect([status, body.error.code]).toEqual([400, 'invalid_grant'])
  })

  it('refuses two issuers that name the same principals within one grant, or added to it', async () => {
    const { person } = await setUp({ access: [] })
    const gitlab = (issuer: string) => ({ kind: 'oidc', issuer, claims: { project_path: 'acme/api' } })
    const both = await person('POST', '/grants', { principals: [gitlab(OIDC_ISS), gitlab(`${OIDC_ISS}/`)], can: { 'ci/': ['post'] } })
    expect([both.status, both.body.error.code]).toEqual([400, 'invalid_grant'])
    const one = await person('POST', '/grants', { principals: [gitlab(OIDC_ISS)], can: { 'ci/': ['post'] } })
    const added = await person('PATCH', `/grants/${one.body.grant.id}`, { add: [gitlab(`${OIDC_ISS}/`)] })
    expect([added.status, added.body.error.code]).toEqual([400, 'invalid_grant'])
  })

  it('takes manage everywhere to name an oidc issuer, whose keys the board then fetches', async () => {
    const { owner, as } = await setUp()
    await owner('POST', '/grants', { principals: [{ kind: 'project', project: 'prj_ops', environments: ['production'] }], can: { 'ci/': 'all' } })
    const ops = await as(deploymentToken('ops', 'prj_ops', 'production'))
    const gitlab = { kind: 'oidc', issuer: OIDC_ISS, claims: { project_path: 'acme/api' } }
    expect((await ops('POST', '/grants', { principals: [gitlab], can: { 'ci/': ['post'] } })).status).toBe(403)
    const run = await ops('POST', '/grants', { principals: [{ kind: 'github', repository: 'acme/web' }], can: { 'ci/': ['post'] } })
    expect(run.status).toBe(200)
    expect((await ops('PATCH', `/grants/${run.body.grant.id}`, { add: [gitlab] })).status).toBe(403)
  })

  it("trusts no stored grant's issuer that names another's principals or is on the board's own network, and nothing else breaks", async () => {
    const { board, person, as } = await setUp({ access: [] })
    // Grants a board refuses now, as one could hold from before it did.
    const log = createServer({ contract: accessContract, store: board.store.log }).session(ACCESS_SESSION)
    for (const issuer of [OIDC_ISS, `${OIDC_ISS}/`, 'https://169.254.169.254'])
      await log.append({ type: 'grant.created', payload: { principals: [{ kind: 'oidc', issuer, claims: { project_path: 'acme/api' } }], can: { 'ci/': ['post'] }, by: 'local:user:julian' } })
    const asked: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      asked.push(input instanceof Request ? input.url : String(input))
      return new Response('not found', { status: 404 })
    })
    try {
      // The first of the two issuers is trusted, and verifies as it would alone.
      expect((await (await as(oidcToken()))('POST', '/messages', { channel: 'ci', text: 'from gitlab' })).status).toBe(201)
      expect((await (await as(oidcToken({}, `${OIDC_ISS}/`)))('GET', '/me')).status).toBe(401)
      expect((await (await as(oidcToken({}, 'https://169.254.169.254')))('GET', '/me')).status).toBe(401)
      expect(asked).toEqual([])
      expect((await person('POST', '/messages', { channel: 'dev', text: 'still in' })).status).toBe(201)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("refuses an issuer that names the same principals as one the code's rules trust", async () => {
    const board = testBoard({ access: [oidc({ issuer: OIDC_ISS, claims: { project_path: 'acme/api' }, can: ['read'] })] })
    const person = caller(board.fetch, await personToken())
    const { status, body } = await person('POST', '/grants', { principals: [{ kind: 'oidc', issuer: `${OIDC_ISS}/`, claims: { project_path: 'acme/other' } }], can: { '*': ['read'] } })
    expect([status, body.error.code]).toEqual([400, 'invalid_grant'])
  })

  it('keeps none on a board whose access is one function, which decides alone', async () => {
    const board = testBoard({ access: async (principal: Known) => (principal.kind === 'person' ? 'all' : null) })
    const person = caller(board.fetch, await personToken())
    for (const [method, path, body] of [
      ['GET', '/grants', undefined],
      ['POST', '/grants', { principals: [everyone], can: { '*': ['read'] } }],
      ['PATCH', '/grants/g1', { can: { '*': ['read'] } }],
    ] as const) {
      const answer = await person(method, path, body)
      expect([method, answer.status, answer.body.error?.code]).toEqual([method, 501, 'no_grants'])
    }
  })
})
