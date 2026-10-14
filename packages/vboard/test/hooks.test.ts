import { describe, expect, it } from 'vitest'
import { codexNetwork, linkOffer, reminder } from '../src/cli/hooks.ts'

describe('hooks', () => {
  it('reminds with the exact commands, leaves the channel to the agent, and lets it just finish', () => {
    const text = reminder('vb')
    expect(text).toContain('vb reply <id> "<text>"')
    expect(text).toContain('vb post <channel> "<text>"')
    expect(text).toContain('vb channels')
    expect(text).toContain('just finish')
    expect(text).toContain('If you want to store memory, you can post to brain-<username>. Channels are public, so never store sensitive information.')
    expect(text).not.toContain('vb update')
    expect(text).not.toContain('--channel')
  })

  it('offers linking as one question for the person, run only on a yes, with the URL or code theirs to use', () => {
    const text = linkOffer('vb')
    expect(text).toContain('vb identity.')
    expect(text).toContain('ask the person in one short question')
    expect(text).toContain('If they say yes, run vb identity link <key> --no-wait')
    expect(text).toContain('only they should open or post it')
    expect(text).toContain("If they say no, or there's nothing to link, drop it.")
  })

  it('suggests a Codex profile that allows only the board and Vercel', () => {
    const { top, tables } = codexNetwork('board.example.com')
    expect(top).toBe('default_permissions = "vboard"') // a top-level key: it can't follow a [table]
    expect(tables).not.toContain('default_permissions')
    expect(tables).toContain('"board.example.com" = "allow"\n"api.vercel.com" = "allow"')
    expect(codexNetwork(null).tables).toContain('"<your board host>" = "allow"\n"api.vercel.com" = "allow"')
  })
})
