import { describe, expect, it } from 'vitest'
import { checkGrantChange, compileAccess, type GrantShape } from '../src/access/index.ts'

// What a board and Vercel's API both run on a grant write. `caller` is what `GET /me` says.
const g1: GrantShape = { principals: [{ kind: 'all-users' }], can: { '*': 'all' } }
const run = [{ kind: 'github' }]
const everyone = (can: GrantShape['can']): GrantShape => ({ principals: [{ kind: 'everyone' }], can })

describe('checkGrantChange', () => {
  it("refuses a grant that reaches where the caller can't manage, by its token or its own grants", () => {
    const changed = { principals: run, can: { '*': 'all' } } as const
    // A token with nothing in secret/, where no grant closes it to everyone.
    expect(checkGrantChange({ caller: compileAccess({ '*': 'all', 'secret/': [] }), after: [g1, changed], changed })).toEqual({ reason: 'reach', pattern: 'secret/', permission: 'manage' })
    // A person a grant on them keeps out of security/.
    expect(checkGrantChange({ caller: compileAccess({ '*': 'all', 'security/': [] }), after: [g1, changed], changed })).toEqual({ reason: 'reach', pattern: 'security/', permission: 'manage' })
  })

  it('lets a grant on * be made past a channel closed to everyone, and nothing in it', () => {
    const lock = everyone({ 'security/': [] })
    const alice = { principals: [{ kind: 'user' }], can: { 'security/': 'all' } } as const
    const bob = compileAccess({ '*': 'all', 'security/': [] })
    const wide = { principals: run, can: { '*': 'all' } } as const
    expect(checkGrantChange({ caller: bob, after: [g1, lock, alice, wide], changed: wide })).toBeNull()
    for (const pattern of ['security/', 'security/incidents']) {
      const changed: GrantShape = { principals: run, can: { [pattern]: ['read'] } }
      expect(checkGrantChange({ caller: bob, after: [g1, lock, alice, changed], changed })).toEqual({ reason: 'reach', pattern, permission: 'manage' })
    }
  })

  it("counts a grant's own pattern under a lock: the lock spares only what's narrower than it", () => {
    const lock = everyone({ 'secret/': [] })
    const changed = { principals: run, can: { 'secret/sub/': 'all' } } as const
    expect(checkGrantChange({ caller: compileAccess({ '*': 'all', 'secret/': [] }), after: [g1, lock, changed], changed })).toEqual({ reason: 'reach', pattern: 'secret/sub/', permission: 'manage' })
  })

  it('lets no one in, however narrow the grant, where everyone gets more than the caller has', () => {
    const changed = { principals: run, can: { 'dev/': ['post'] } } as const
    // A token kept out of secret/, which everyone reads: the run it lets in would read it.
    const reads = everyone({ 'secret/': ['read'] })
    expect(checkGrantChange({ caller: compileAccess({ '*': 'all', 'secret/': [] }), after: [g1, reads, changed], changed })).toEqual({ reason: 'admission', pattern: 'secret/', permission: 'read' })
    // A person kept out of security/incidents, under security/, which everyone reads.
    const below = everyone({ 'security/': ['read'] })
    const carol = compileAccess({ '*': 'all', 'security/': ['read'], 'security/incidents': [] })
    expect(checkGrantChange({ caller: carol, after: [g1, below, changed], changed })).toEqual({ reason: 'admission', pattern: 'security/incidents', permission: 'read' })
    // Where everyone gets nothing, there's nothing to let anyone in to.
    expect(checkGrantChange({ caller: compileAccess({ '*': 'all', 'secret/': [] }), after: [g1, everyone({ 'secret/': [] }), changed], changed })).toBeNull()
  })

  it('lets an owner no token narrows make any grant', () => {
    const changed = { principals: run, can: { '*': 'all' } } as const
    expect(checkGrantChange({ caller: compileAccess({}), owner: true, after: [g1, everyone({ 'secret/': ['read'] }), changed], changed })).toBeNull()
  })
})
