import { describe, expect, it, vi } from 'vitest'
import { githubActions, oidc, vercelProject, type Known } from '../src/server/auth.ts'
import { caller, deploymentToken, oidcToken, OIDC_ISS, personToken, testBoard, testKeys, workflowToken } from './harness.ts'

/** A person, and callers with other tokens, on one board: the person sets grants, the others try the board. */
async function setUp(options: Parameters<typeof testBoard>[0] = {}) {
  const board = testBoard(options)
  const person = caller(board.fetch, await personToken())
  return { board, person, as: async (token: string | Promise<string>) => caller(board.fetch, await token) }
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
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [everyone], can: { 'security/': [] } })
    await person('POST', '/grants', { principals: [user('u_alice')], can: { 'security/': 'all' } })
    // A grant naming Bob on * doesn't reach security/: the more specific pattern decides first.
    await person('POST', '/grants', { principals: [user('u_bob')], can: { '*': 'all' } })
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

  it('changes a grant only with manage at each pattern it names, before and after', async () => {
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [{ kind: 'project', project: 'prj_ops', environments: ['production'] }], can: { '*': 'all' } })
    const ops = await as(deploymentToken('ops', 'prj_ops', 'production'))
    const readers = await ops('POST', '/grants', { principals: [everyone], can: { '*': ['read'] } })
    expect(readers.status).toBe(200)
    const lock = await person('POST', '/grants', { principals: [everyone], can: { 'security/': [], 'ci/': ['read'] } })
    // A grant on * is still ops's to change, where manage at * is what * gives, whatever security/ says.
    expect((await ops('PATCH', `/grants/${readers.body.grant.id}`, { can: { '*': ['read', 'react'] } })).status).toBe(200)
    // Not one on security/, before or after: taking security/ out of the lock is changing it there.
    expect((await ops('POST', '/grants', { principals: [everyone], can: { 'security/': ['read'] } })).status).toBe(403)
    expect((await ops('PATCH', `/grants/${lock.body.grant.id}`, { can: { '*': ['read'] } })).status).toBe(403)
    expect((await ops('PATCH', `/grants/${readers.body.grant.id}`, { can: { '*': ['read'], 'security/incidents': ['read'] } })).status).toBe(403)
    expect((await ops('POST', `/grants/${lock.body.grant.id}/revoke`, {})).status).toBe(403)
    expect((await person('GET', '/grants')).body.grants.find((grant: { id: string }) => grant.id === lock.body.grant.id).can).toEqual({ 'ci/': ['read'], 'security/': [] })
  })

  it("lets the board's owner change any grant, though a closed channel still takes a grant to read", async () => {
    const { person, as } = await setUp()
    await person('POST', '/grants', { principals: [everyone], can: { 'security/': [] } })
    expect((await person('POST', '/messages', { channel: 'security', text: 'locked out' })).status).toBe(403)
    // With g1 gone, the local user manages nothing, and is still the owner.
    expect((await person('POST', '/grants/g1/revoke', {})).body).toEqual({ revoked: true })
    expect((await person('GET', '/me')).body.can).toEqual({})
    expect((await person('POST', '/grants', { principals: [user('u_julian')], can: { 'security/': 'all' } })).status).toBe(200)
    expect((await person('POST', '/messages', { channel: 'security', text: 'let in' })).status).toBe(201)
    // A token the owner mints goes no further than its can, owner or not.
    const minted = await person('POST', '/tokens', { name: 'reader', can: { 'security/': ['read'] } })
    const reader = await as(minted.body.secret)
    expect((await reader('POST', '/grants', { principals: [everyone], can: { 'security/': ['read'] } })).status).toBe(403)
    expect((await reader('GET', '/grants')).status).toBe(403)
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

describe('explain', () => {
  it('says which pattern, level, and grants decide a channel for a principal, and what they give', async () => {
    const { person } = await setUp()
    const lock = (await person('POST', '/grants', { principals: [everyone], can: { 'security/': [] } })).body.grant
    const team = (await person('POST', '/grants', { principals: [user('u_alice'), user('u_bob')], can: { 'security/': 'all' } })).body.grant
    const explain = async (query: string) => (await person('GET', `/grants/explain?${query}`)).body
    expect(await explain('channel=security/incidents&user=u_bob')).toEqual({ channel: 'security/incidents', pattern: 'security/', over: ['*'], level: 'principal', grants: [team], rule: null, capped: null, can: ALL })
    expect(await explain('channel=security/incidents&user=u_carol')).toEqual({ channel: 'security/incidents', pattern: 'security/', over: ['*'], level: 'everyone', grants: [lock], rule: null, capped: null, can: [] })
    expect(await explain('channel=dev&user=u_carol')).toMatchObject({ pattern: '*', over: [], level: 'group', grants: [{ id: 'g1' }], can: ALL })
    // A project on the board's team, in the environment it names.
    expect(await explain('channel=dev&project=prj_web&environment=preview')).toMatchObject({ pattern: '*', level: 'group', grants: [{ id: 'g2' }], can: ['read', 'post', 'react', 'label'] })
  })

  it('explains the caller when it names no one, a rule by its name, and nothing for whom nothing lets in', async () => {
    const { person, as } = await setUp({ access: [githubActions({ repository: 'basehub-ai/www', can: { 'ci/': ['read', 'post'] } })] })
    await person('POST', '/grants', { principals: [{ kind: 'github', repository: 'acme/web' }], can: { 'ci/': ['post'] } })
    const explain = async (query: string) => (await person('GET', `/grants/explain?${query}`)).body
    expect(await explain('channel=ci&github=basehub-ai/www')).toEqual({
      channel: 'ci',
      pattern: 'ci/',
      over: [],
      level: 'principal',
      grants: [],
      rule: "githubActions({ repository: 'basehub-ai/www' })",
      capped: null,
      can: ['read', 'post'],
    })
    expect(await explain('channel=ci&github=acme/other')).toEqual({ channel: 'ci', pattern: null, over: [], level: null, grants: [], rule: null, capped: null, can: [] })
    // A run asks about itself: what decides, without the grants, which it may not list.
    const run = await as(workflowToken({ repository: 'acme/web', repository_id: '99' }))
    expect((await run('GET', '/grants/explain?channel=ci')).body).toEqual({ channel: 'ci', pattern: 'ci/', over: [], level: 'principal', grants: [], rule: null, capped: null, can: ['post'] })
    expect((await explain('channel=ci&github=acme/web')).grants).toHaveLength(1)
    expect((await run('GET', '/grants/explain?channel=ci&user=u_julian')).status).toBe(403)
    // A token says what it may do, narrowed.
    const reader = await as((await person('POST', '/tokens', { name: 'reader', can: { 'ci/': ['read'] } })).body.secret)
    expect((await reader('GET', '/grants/explain?channel=ci')).body).toMatchObject({ pattern: '*', level: 'group', can: ['read'] })
  })

  it("refuses a name it can't look up, and a query that names two principals", async () => {
    const { person } = await setUp()
    const status = async (query: string) => (await person('GET', `/grants/explain?${query}`)).status
    expect(await status('channel=dev&user=ada@acme.com')).toBe(400)
    expect(await status('channel=dev&project=web')).toBe(400)
    expect(await status('channel=dev&user=u_ada&project=prj_web')).toBe(400)
    expect(await status('channel=dev&environment=preview')).toBe(400)
    expect(await status('channel=Not%20A%20Channel')).toBe(400)
  })
})

