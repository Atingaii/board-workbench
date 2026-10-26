/**
 * People's own platform tokens, so a board message they wrote reaches Slack or
 * GitHub as them, and signing in proves an account is theirs. The board never
 * stores a token: it asks for one at each delivery, and a person without one
 * (never signed in, revoked, expired) is delivered as the bot, as before.
 */
export type UserTokens = {
  /**
   * A sign-in URL that binds whoever completes it to `principal`. Show it only to them. With
   * `callback`, the platform sends them there once they've approved.
   */
  authorize(principal: string, options?: { callback?: string }): Promise<string>
  /** `principal`'s token on the platform, or null when they haven't signed in. */
  token(principal: string): Promise<string | null>
}

const USER_TOKENS = Symbol.for('board.userTokens')

/**
 * Gives an adapter people's tokens, for your own OAuth: `slack({ adapter:
 * withUserTokens(createSlackAdapter(...), { authorize, token }) })`. A Connect
 * connector name (`adapter: 'slack/acme'`) does this for you.
 */
export function withUserTokens<A extends object>(adapter: A, tokens: UserTokens): A {
  Object.defineProperty(adapter, USER_TOKENS, { value: tokens, enumerable: false, configurable: true })
  return adapter
}

export const userTokensOf = (adapter: object): UserTokens | null =>
  ((adapter as Record<symbol, UserTokens | undefined>)[USER_TOKENS]) ?? null

/** Vercel Connect's user tokens for `connector`: the subject is the board's principal, so Connect binds the account to it. */
export function connectUserTokens(connector: string): UserTokens {
  const subject = (principal: string) => ({ subject: { type: 'user' as const, id: principal } })
  return {
    async authorize(principal, options = {}) {
      const { startAuthorization } = await import('@vercel/connect')
      return (options.callback ? await startAuthorization(connector, subject(principal), { callbackUrl: options.callback }) : await startAuthorization(connector, subject(principal))).url
    },
    async token(principal) {
      const { getToken, NoValidTokenError, UserAuthorizationRequiredError } = await import('@vercel/connect')
      try {
        return await getToken(connector, subject(principal))
      } catch (error) {
        if (error instanceof UserAuthorizationRequiredError || error instanceof NoValidTokenError) return null
        const code = (error as { code?: unknown }).code
        if (code === 'user_authorization_required' || code === 'no_token') return null
        throw error
      }
    },
  }
}
