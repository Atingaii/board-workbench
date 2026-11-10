import { describe, expect, it } from 'vitest'
import { extractMentions } from '../src/contract/mentions.ts'
import type { ActorsState, Message } from '../src/contract/folds.ts'
import { compileFilter } from '../src/server/feed.ts'
import { FULL_ACCESS } from '../src/server/access.ts'

describe('extractMentions', () => {
  it('finds handles and profile handles in prose, in order', () => {
    expect(extractMentions('hey @Ada and @julian/claude, see @ada')).toEqual([
      { kind: 'handle', handle: 'ada' },
      { kind: 'handle', handle: 'julian/claude' },
    ])
  })

  it('ignores mentions inside code', () => {
    expect(extractMentions('run `@ada` and\n```\n@bob\n```\nthen @carol')).toEqual([
      { kind: 'handle', handle: 'carol' },
    ])
  })

  it('ignores emails and trailing punctuation', () => {
    expect(extractMentions('mail ada@example.com, ping @bob.')).toEqual([
      { kind: 'handle', handle: 'bob' },
    ])
  })

  it('reads exact actor mentions', () => {
    expect(extractMentions('cc @[slack:T0123:U0456] and @ada')).toEqual([
      { kind: 'actor', actor: 'slack:T0123:U0456' },
      { kind: 'handle', handle: 'ada' },
    ])
  })
})

describe('a mentions filter', () => {
  const nobody: ActorsState = { byId: {}, byHandle: {} }
  const message = (text: string) => ({ id: 1, channel: 'dev', text, re: null }) as Message

  it('takes names every object has as names nobody has', () => {
    const matcher = (name: string) => compileFilter({ mentions: name }, { me: null, actors: nobody, access: FULL_ACCESS })
    for (const name of ['constructor', 'toString', 'valueOf']) {
      const matches = matcher(name)
      expect([matches(message(`thanks @${name}`)), matches(message(`cc @[${name}]`)), matches(message('thanks @someone'))], name).toEqual([true, true, false])
    }
    expect([matcher('__proto__')(message('cc @[__proto__]')), matcher('__proto__')(message('cc @[someone]'))]).toEqual([true, false])
  })
})
