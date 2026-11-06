import { describe, expect, it } from 'vitest'
import { checkGrantChange, grantAccess, type DecidingGrant, type GrantFacts, type GrantShape } from '../src/access/index.ts'

// The grant decision as Vercel's API makes it with board's code: plain data in, accesses out.

const ALL = ['read', 'post', 'react', 'label', 'sync', 'manage']
const g1: DecidingGrant = { principals: [{ kind: 'all-users' }], can: { '*': 'all' } }
const g2: DecidingGrant = { principals: [{ kind: 'all-projects', environments: ['production', 'preview', 'development'] }], can: { '*': ['read', 'post', 'react', 'label'] } }
const g3: DecidingGrant = { principals: [{ kind: 'all-apps' }], can: { '*': ['read', 'post', 'react', 'label'] } }
const lock: DecidingGrant = { principals: [{ kind: 'everyone' }], can: { 'security/': [] } }
const bob = { caller: { kind: 'user', userId: 'u_bob' }, member: (userId: string) => userId === 'u_bob' } as const
const summaries = (facts: GrantFacts) => {
  const decided = grantAccess(facts)
  return decided && { caller: decided.caller.summary(), own: decided.own.summary() }
}

describe('grantAccess', () => {
  it("lets in a person on the team, by every grant that names them, and gives what's closest where it's most specific", () => {
    const alice: DecidingGrant = { principals: [{ kind: 'user', userId: 'u_alice' }, { kind: 'user', userId: 'u_bob' }], can: { 'security/': 'all' } }
    expect(summaries({ ...bob, grants: [g1, lock] })).toEqual({ caller: { '*': ALL, 'security/': [] }, own: { '*': ALL } })
    expect(summaries({ ...bob, grants: [g1, lock, alice] })).toEqual({ caller: { '*': ALL }, own: { '*': ALL } })
    // Ties at the closest level add up; a farther one there doesn't.
    const reads: DecidingGrant = { principals: [{ kind: 'user', userId: 'u_bob' }], can: { 'dev/': ['read'] } }
    const posts: DecidingGrant = { principals: [{ kind: 'user', userId: 'u_bob' }], can: { 'dev/': ['post'] } }
    expect(summaries({ ...bob, grants: [g1, reads, posts, { principals: [{ kind: 'everyone' }], can: { 'dev/': ['label'] } }] })?.caller).toEqual({ '*': ALL, 'dev/': ['read', 'post'] })
    // Off the team, nothing lets a user in, and everyone's grant lets in no one.
    expect(grantAccess({ caller: { kind: 'user', userId: 'u_mallory' }, member: () => false, grants: [g1, { principals: [{ kind: 'everyone' }], can: { '*': ['read'] } }] })).toBeNull()
  })

  it('caps what it gives, then narrows it by a token', () => {
    expect(summaries({ ...bob, grants: [g1], cap: ['read'] })).toEqual({ caller: { '*': ['read'] }, own: { '*': ['read'] } })
    expect(summaries({ ...bob, grants: [g1], can: { 'dev/': ['read', 'post'] } })?.caller).toEqual({ 'dev/': ['read', 'post'] })
  })

  it("lets in a project, a run, an issuer's token, and an app, each as its principal or its group names it", () => {
    const web = { caller: { kind: 'project', projectId: 'prj_web', environment: 'preview' }, teamProject: (id: string) => id === 'prj_web' } as const
    expect(summaries({ ...web, grants: [g1, g2] })?.caller).toEqual({ '*': ['read', 'post', 'react', 'label'] })
    expect(grantAccess({ ...web, teamProject: () => false, grants: [g1, g2] })).toBeNull()
    const run = { caller: { kind: 'github', repository: 'acme/web', repositoryId: '7', workflowRef: 'acme/web/.github/workflows/ci.yml@refs/heads/main', ref: 'refs/heads/main', event: 'push' } } as const
    const ci: DecidingGrant = { principals: [{ kind: 'github', repository: 'acme/web', repositoryId: '7', workflow: '.github/workflows/ci.yml', branch: 'main' }], can: { 'ci/': ['post'] } }
    expect(summaries({ ...run, grants: [ci] })?.caller).toEqual({ 'ci/': ['post'] })
    expect(grantAccess({ caller: { ...run.caller, ref: 'refs/heads/dev' }, grants: [ci] })).toBeNull()
    const gitlab: DecidingGrant = { principals: [{ kind: 'oidc', issuer: 'https://gitlab.com', claims: { project_id: ['42', '43'] } }], can: { 'ci/': ['post'] } }
    expect(grantAccess({ caller: { kind: 'oidc', issuer: 'https://gitlab.com', claims: { project_id: 43 } }, grants: [gitlab] })).not.toBeNull()
    const app = { caller: { kind: 'app', clientId: 'cl_ship' }, teamApp: (id: string) => id === 'cl_ship' } as const
    expect(summaries({ ...app, grants: [g3] })?.caller).toEqual({ '*': ['read', 'post', 'react', 'label'] })
    expect(summaries({ ...app, grants: [g3, { principals: [{ kind: 'app', clientId: 'cl_ship' }], can: { 'ship/': 'all' } }] })?.caller).toEqual({ '*': ['read', 'post', 'react', 'label'], 'ship/': ALL })
    expect(grantAccess({ ...app, teamApp: () => false, grants: [g3] })).toBeNull()
  })

  it('lets an app capped by its scope, or narrowed where everyone reads, let no one in', () => {
    const app = { caller: { kind: 'app', clientId: 'cl_ship' }, teamApp: () => true } as const
    const manages: DecidingGrant = { principals: [{ kind: 'app', clientId: 'cl_ship' }], can: { '*': 'all' } }
    const reads: DecidingGrant = { principals: [{ kind: 'everyone' }], can: { 'open/': ['read'] } }
    const changed: GrantShape = { principals: [{ kind: 'github' }], can: { 'dev/': ['post'] } }
    const after: GrantShape[] = [g3, manages, reads, changed]
    // Its scope lets it read and post, never manage.
    const capped = grantAccess({ ...app, grants: [g3, manages, reads], cap: ['read', 'post', 'react', 'label', 'sync'] })!
    expect(checkGrantChange({ ...capped, after, changed })).toEqual({ reason: 'reach', pattern: 'dev/', permission: 'manage' })
    // Narrowed out of open/, which everyone reads: anyone it lets in would read it.
    const narrowed = grantAccess({ ...app, grants: [g3, manages, reads], can: { '*': 'all', 'open/': [] } })!
    expect(checkGrantChange({ ...narrowed, after, changed })).toEqual({ reason: 'admission', pattern: 'open/', permission: 'read' })
    expect(checkGrantChange({ ...grantAccess({ ...app, grants: [g3, manages, reads] })!, after, changed })).toBeNull()
  })

  it('counts a rule in code as one principal of its kind', () => {
    const lockCi: DecidingGrant = { principals: [{ kind: 'everyone' }], can: { 'ci/': [] } }
    const run = { caller: { kind: 'github', repository: 'acme/web' }, rules: [{ rule: "githubActions({ repository: 'acme/web' })", can: { 'ci/': ['post'] } }] } as const
    expect(summaries({ ...run, grants: [lockCi] })?.caller).toEqual({ 'ci/': ['post'] })
  })
})
