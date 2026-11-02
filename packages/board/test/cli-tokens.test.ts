import { describe, expect, it } from 'vitest'
import { useBoard, vb } from './cli-harness.ts'

useBoard()

describe('cli tokens and grants', () => {
  it('mints a token that posts as you only where it may, lists it, and revokes it', async () => {
    const minted = await vb(['token', 'create', 'feedback-widget', '--can', 'feedback/=post'])
    expect(minted).toMatchObject({ code: 0, stderr: '' })
    const secret = minted.stdout.trim()
    expect(secret).toMatch(/^board_[A-Za-z0-9_-]{43}$/)

    // Whoever holds it is you, narrowed: a coding agent with it writes as itself under you.
    const widget = { BOARD_TOKEN: secret, CLAUDECODE: '1' }
    const whoami = await vb(['whoami'], widget)
    expect(whoami.stdout).toMatch(/^claude via julian \(vercel:user:u_julian\+claude\)\n/)
    expect(whoami.stdout).toMatch(/\ncan +feedback\/ +post\n/)
    expect((await vb(['post', 'feedback/web', 'love the new board'], widget)).code).toBe(0)
    const refused = await vb(['post', 'dev', 'not here'], widget)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toMatch(/can't post in dev/)

    const listed = await vb(['token', 'list'])
    expect(listed.stdout).toMatch(/^t\d+ +feedback-widget +feedback\/=post +expires in 30d\n$/)
    const id = listed.stdout.split(' ')[0]!
    expect((await vb(['token', 'revoke', id])).stdout).toBe(`revoked ${id}\n`)
    expect((await vb(['token', 'revoke', id])).stdout).toBe(`${id} is already revoked\n`)
    const revoked = await vb(['post', 'feedback/web', 'again'], widget)
    expect(revoked).toMatchObject({ code: 1, stderr: expect.stringMatching(/^error: The board didn't accept your credentials\.\n {2}invalid token: revoked, expired, or not this board's\n[\s\S]*Pass a token it accepts in BOARD_TOKEN, or unset it/) })
    expect(revoked.stderr).not.toContain('vercel login')
    expect((await vb(['token', 'list'])).stdout).toBe('no tokens\n')
  }, 30_000)

  it('grants a workflow, lists it with its claims, sets its can again, and revokes it', async () => {
    const granted = await vb(['grant', 'create', 'github', '--claim', 'repository=acme/web', '--claim', 'event_name=push', '--claim', 'event_name=schedule', '--can', 'ci/=read,post'])
    expect(granted).toMatchObject({ code: 0, stdout: expect.stringMatching(/^granted g\d+\n$/) })
    const id = granted.stdout.trim().split(' ')[1]!
    expect((await vb(['grant', 'list'])).stdout).toBe(`${id}  github  event_name=push|schedule repository=acme/web  ci/=read,post\n`)
    const again = await vb(['grant', 'create', 'github', '--claim', 'repository=acme/web', '--claim', 'event_name=schedule', '--claim', 'event_name=push', '--can', 'ci/=read'])
    expect(again.stdout).toBe(`updated ${id}\n`)
    expect((await vb(['grant', 'revoke', id])).stdout).toBe(`revoked ${id}\n`)
    expect((await vb(['grant', 'list'])).stdout).toBe('no grants\n')
  }, 30_000)

  it('says what grant and token take, alone or with a verb they lack', async () => {
    expect(await vb(['grant'])).toMatchObject({ code: 2, stderr: expect.stringMatching(/^error: grant takes create, list, or revoke\.\n/) })
    expect(await vb(['token', 'mint', 'x'])).toMatchObject({ code: 2, stderr: expect.stringMatching(/^error: token takes create, list, or revoke, and mint isn't one\.\n/) })
  })

  it('says what a grant needs before it asks the board', async () => {
    const bare = await vb(['grant', 'create', 'github'])
    expect(bare).toMatchObject({ code: 2, stderr: expect.stringMatching(/^error: Missing the claims github's tokens must carry: pass --claim name=value\.\n/) })
    const pattern = await vb(['grant', 'create', 'github', '--claim', 'repository=acme/web', '--can', 'ci/*=post'])
    expect(pattern).toMatchObject({ code: 2, stderr: expect.stringMatching(/^error: invalid channel pattern ci\/\*: write ci\/ for ci and its subtree\.\n/) })
  })
})
