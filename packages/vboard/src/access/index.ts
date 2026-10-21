// `vboard/access`: who may use a board, and what each may do in which channels. Backend-agnostic:
// the rules a2() takes, and the pieces a backend of your own verifies and decides with.
export {
  vercelProject,
  githubActions,
  oidc,
  verifyTokens,
  type AccessRule,
  type AccessFunction,
  type Authenticate,
  type AuthenticateContext,
  type HostPrincipal,
  type Known,
  type Principal,
  type PrincipalKind,
  type VerifyTokensOptions,
  type IssuerConfig,
} from '../server/auth.ts'
export { resolveActor } from '../server/actors.ts'
export { compileRules } from '../server/auth.ts'
export { type Access, type Permission, type ChannelPattern, type Grant, type Can, type AccessSummary } from '../server/access.ts'
export type { CallerRequest, Claims } from '../server/backend.ts'
