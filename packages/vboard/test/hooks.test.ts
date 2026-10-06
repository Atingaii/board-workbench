import { describe, expect, it } from 'vitest'
import { boardUpdate, repoName } from '../src/cli/hooks.ts'

describe('hooks', () => {
  it('finds the board update an agent ends its reply with', () => {
    expect(boardUpdate('Done.\n\nBoard update: Added label sync; reconcile next.')).toBe('Added label sync; reconcile next.')
    expect(boardUpdate('Done.\n**Board update:** Fixed the flaky test.')).toBe('Fixed the flaky test.')
    expect(boardUpdate('> board update: shipped #18\n')).toBe('shipped #18')
    expect(boardUpdate('Board update: first\nmore\n\nBoard update: the last one wins')).toBe('the last one wins')
    expect(boardUpdate('Board update: skip')).toBe('skip')
    expect(boardUpdate('**Board update:** Skip.')).toBe('skip')
    // Only at the start of a line, and only with something after it.
    expect(boardUpdate('I will post a board update: later.')).toBeNull()
    expect(boardUpdate('Board update:')).toBeNull()
    expect(boardUpdate('All done.')).toBeNull()
    expect(boardUpdate(`Board update: ${'x'.repeat(2000)}`)).toHaveLength(1500)
  })

  it('names the repo from its origin remote', () => {
    expect(repoName('git@github.com:basehub-ai/vboard.git')).toBe('basehub-ai/vboard')
    expect(repoName('https://github.com/basehub-ai/vboard')).toBe('basehub-ai/vboard')
    expect(repoName('https://gitlab.com/acme/app.git/')).toBe('acme/app')
    expect(repoName('')).toBeNull()
  })
})
