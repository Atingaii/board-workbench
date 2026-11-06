import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { BOARD_URL, caller, TEAM_ID, testBoard } from './harness.ts'

// Vercel signs every team's tokens, each under its own issuer
// (`https://oidc.vercel.com/<team>`), and production accepts any of them.
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'vercel', alg: 'RS256' }] })
const auth = { vercel: { issuer: /^https:\/\/oidc\.vercel\.com\/[a-z0-9-]+$/, jwks } }

/** A production deployment of `project` on some team. */
const deployment = (team: string, teamId: string, project: string, projectId: string, audience = BOARD_URL) =>
  new SignJWT({
    sub: `owner:${team}:project:${project}:environment:production`,
    owner: team,
    owner_id: teamId,
    project,
    project_id: projectId,
    environment: 'production',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'vercel' })
    .setIssuer(`https://oidc.vercel.com/${team}`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)

const ours = () => deployment('test', TEAM_ID, 'marketing', 'prj_marketing')
const theirs = () => deployment('attacker', 'team_attacker', 'marketing', 'prj_attacker')

describe("a Vercel grant, across teams' issuers", () => {
  it("lets in another team's project it names by ID, and no project of the same name", async () => {
    const board = testBoard({ auth })
    const call = async (token: string) => caller(board.fetch, token)('GET', '/me')
    expect((await call(await theirs())).body.error).toEqual({
      code: 'forbidden',
      message: "this token can't use this board: no grant lets in project prj_attacker in production",
      hint: 'Grant it: vb grants create vercel --claim project_id=prj_attacker --claim environment=production',
    })
    await board.createGrant({ issuer: 'vercel', claims: { project_id: 'prj_attacker', environment: 'production' }, can: 'all' })
    const me = await call(await theirs())
    expect({ status: me.status, actor: me.body?.actor }).toEqual({ status: 200, actor: 'vercel:project:prj_attacker:production' })
    // The board's own team's project that took the same name isn't the grant's.
    expect((await call(await ours())).status).toBe(403)
  })

  it('keeps one that names owner_id to that team, whichever projects it lists', async () => {
    const board = testBoard({ auth })
    await board.createGrant({ issuer: 'vercel', claims: { project_id: ['prj_marketing', 'prj_attacker'], environment: 'production', owner_id: TEAM_ID }, can: 'all' })
    expect((await caller(board.fetch, await ours())('POST', '/messages', { channel: 'general', text: 'deploy approved' })).status).toBe(201)
    const call = caller(board.fetch, await theirs())
    expect((await call('GET', '/me')).status).toBe(403)
    expect((await call('POST', '/messages', { channel: 'general', text: 'deploy approved' })).status).toBe(403)
  })
})
