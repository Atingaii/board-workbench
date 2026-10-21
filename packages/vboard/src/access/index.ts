// `vboard/access`: who may use a board, and what each may do in which channels.
export {
  vercelProject,
  githubActions,
  oidc,
  type AccessRule,
  type AccessFunction,
  type Authenticate,
  type HostPrincipal,
  type Known,
  type Principal,
  type PrincipalKind,
  type AuthOptions,
  type IssuerConfig,
} from '../server/auth.ts'
export { type Permission, type ChannelPattern, type Grant, type Can, type AccessSummary } from '../server/access.ts'
