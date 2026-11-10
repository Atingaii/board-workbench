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

/**
 * A platform user's handle as board's mention syntax takes it (`NAME` in `mentions.ts`), so anyone
 * can type it: diacritics taken off (`ü` is `u`), lowercased, each run of anything but `a-z`, `0-9`,
 * `.`, `_`, and `-` as one `-`, and `-`, `.`, and `_` trimmed from the ends. "Jürgen Ubl" is
 * `jurgen-ubl`. One with nothing left is their ID on the platform, without the sync key, the same
 * way: `T_EU:U0MALTE` is `t_eu-u0malte`. Vercel's API names them by the same rule.
 */
export function typableHandle(handle: string, userId: string): string {
  return typable(handle) || typable(userId)
}

/** `typableHandle`'s rule on one value, in a single pass: a trim by regex backtracks on long runs. */
function typable(value: string): string {
  const dashed = value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  let start = 0
  let end = dashed.length
  while (start < end && '-._'.includes(dashed[start]!)) start++
  while (end > start && '-._'.includes(dashed[end - 1]!)) end--
  return dashed.slice(start, end)
}

/** A platform user's ID there, without the sync key they came through: `T_EU:U0MALTE` of `slack-eu:T_EU:U0MALTE`. */
export const userIdOf = (id: string): string => id.slice(id.indexOf(':') + 1)

/**
 * A platform user's handle as a principal's sync imported them: the principal's name (a project's,
 * in every environment), then theirs, typable: `support/malte-ubl`. `userId` is theirs on the
 * platform, without the sync key.
 */
export const importedHandle = (principal: string, handle: string, userId: string): string => `${principal}/${typableHandle(handle, userId)}`

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
