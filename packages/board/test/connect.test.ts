import { describe, expect, it, vi } from 'vitest'

const connect = vi.hoisted(() => {
  class UserAuthorizationRequiredError extends Error {}
  class NoValidTokenError extends Error {}
  return {
    UserAuthorizationRequiredError,
    NoValidTokenError,
    startAuthorization: vi.fn(async (connector: string, params: { subject: { id: string } }) => ({ url: `https://connect.test/${connector}?subject=${params.subject.id}`, request: 'r', verifier: 'v' })),
    getToken: vi.fn(async (_connector: string, _params: unknown): Promise<string> => {
      throw new UserAuthorizationRequiredError('user_authorization_required')
    }),
  }
})
vi.mock('@vercel/connect', () => connect)

const { slack } = await import('../src/sync/slack.ts')
const { github } = await import('../src/sync/github.ts')

describe('a Vercel Connect connector as the adapter', () => {
  it("builds Slack's adapter and client, and signs people in through Connect as their board principal", async () => {
    const provider = slack({ adapter: 'slack/acme', channels: { C1: 'firehose' } })
    const adapter = (provider as unknown as { transport: { adapter: { name: string; withBotToken?: unknown } } }).transport.adapter
    expect(adapter.name).toBe('slack')
    expect(typeof adapter.withBotToken).toBe('function')
    expect(provider.users).not.toBeNull()

    expect(await provider.users!.authorize('vercel:user:u_julian')).toBe('https://connect.test/slack/acme?subject=vercel:user:u_julian')
    expect(connect.startAuthorization).toHaveBeenCalledWith('slack/acme', { subject: { type: 'user', id: 'vercel:user:u_julian' } })
    // Not signed in yet: no token, so the app posts.
    expect(await provider.users!.token('vercel:user:u_julian')).toBeNull()
    connect.getToken.mockResolvedValueOnce('xoxp-julian')
    expect(await provider.users!.token('vercel:user:u_julian')).toBe('xoxp-julian')
    expect(connect.getToken).toHaveBeenLastCalledWith('slack/acme', { subject: { type: 'user', id: 'vercel:user:u_julian' } })
    // Anything else Connect says is an error, which delivery treats as "post as the app".
    connect.getToken.mockRejectedValueOnce(new Error('connect is down'))
    await expect(provider.users!.token('vercel:user:u_julian')).rejects.toThrow('connect is down')
  })

  it("builds GitHub's adapter with the bot's user ID, and the same sign-in", async () => {
    const provider = github({ adapter: 'github/acme', botUserId: 338721338, repos: { 'vercel-labs/board': 'prs' } })
    const adapter = (provider as unknown as { transport: { adapter: { name: string; botUserId?: string | number } } }).transport.adapter
    expect(adapter.name).toBe('github')
    expect(String(adapter.botUserId)).toBe('338721338')
    expect(await provider.users!.authorize('vercel:user:u_monto')).toBe('https://connect.test/github/acme?subject=vercel:user:u_monto')
  })

  it("finds the app's bot user ID itself, from GraphQL's viewer, when botUserId isn't set", async () => {
    type Detecting = { botUserId?: string; logger: unknown; initialize(chat: unknown): Promise<void>; defaultOctokit: unknown }
    const provider = github({ adapter: 'github/acme', repos: { 'vercel-labs/board': 'prs' } })
    const adapter = (provider as unknown as { transport: { adapter: Detecting } }).transport.adapter
    expect(adapter.botUserId).toBeUndefined()
    // An installation token can't call REST's /user, but GraphQL's viewer answers with the bot.
    const graphql = vi.fn(async () => ({ viewer: { databaseId: 338721338, login: 'acme[bot]' } }))
    adapter.defaultOctokit = { graphql }
    await adapter.initialize({ getLogger: () => adapter.logger })
    expect(graphql).toHaveBeenCalledWith('query { viewer { databaseId login } }')
    expect(adapter.botUserId).toBe('338721338')
    // Once known, it isn't asked again.
    await adapter.initialize({ getLogger: () => adapter.logger })
    expect(graphql).toHaveBeenCalledTimes(1)
  })

  it('keeps a given botUserId without asking GitHub', async () => {
    type Detecting = { botUserId?: string; initialize(chat: unknown): Promise<void>; defaultOctokit: unknown }
    const provider = github({ adapter: 'github/acme', botUserId: 42, repos: {} })
    const adapter = (provider as unknown as { transport: { adapter: Detecting } }).transport.adapter
    const graphql = vi.fn()
    adapter.defaultOctokit = { graphql }
    await adapter.initialize({})
    expect(graphql).not.toHaveBeenCalled()
    expect(adapter.botUserId).toBe('42')
  })

  it('keeps a plain adapter posting as the app', async () => {
    const { fakePlatform } = await import('./sync-fixtures.ts')
    expect(slack({ adapter: fakePlatform('slack').adapter, channels: {} }).users).toBeNull()
  })
})
