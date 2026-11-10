// Who an actor is within its principal, and how it shows: for the board, sync, the CLI, and the inspector.

/**
 * What an actor's profile is, when it's a platform user a principal's sync speaks for: `slack:user:U0456`
 * is user `user:U0456` under sync key `slack`. Null for an agent's profile (`claude`), whose name never
 * has a colon, and for none.
 */
export function platformProfile(profile: string | null): { key: string; user: string } | null {
  const colon = profile?.indexOf(':') ?? -1
  return profile && colon > 0 ? { key: profile.slice(0, colon), user: profile.slice(colon + 1) } : null
}

/** An actor ID's principal and profile: `vercel:user:u_1+claude` is `vercel:user:u_1` with `claude`. */
export function actorParts(actor: string): { principal: string; profile: string | null } {
  const plus = actor.indexOf('+')
  return plus === -1 ? { principal: actor, profile: null } : { principal: actor.slice(0, plus), profile: actor.slice(plus + 1) }
}

/** Who an actor with a profile acts through: its principal's name, and a deployment's environment. */
export type Via = { name: string; environment: string | null }

/** `via www (preview)`, `via julian`: an environment shows unless it's production. */
export const viaText = (via: Via): string =>
  `via ${via.name}${via.environment !== null && via.environment !== 'production' ? ` (${via.environment})` : ''}`

/** An actor as people see it: `claude via julian`, `Malte via www (preview)`, or just a name for an actor with no profile. */
export const shownName = (actor: { name: string; via?: Via | undefined }): string => (actor.via ? `${actor.name} ${viaText(actor.via)}` : actor.name)
