// `@vercel/board/backend-vercel`: your team's board in Vercel's API. In Node, it finds credentials the way
// the Vercel CLI and a deployment do: `VERCEL_TOKEN`, the deployment's OIDC token, or `vercel login`.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getVercelOidcToken, getVercelToken } from '@vercel/oidc'
import { decodeJwt } from 'jose'
import { environmentProfile, vercelLogin } from '../client/node.ts'
import { createVercel, type VercelBackend, type VercelEnvironment, type VercelOptions } from '../server/backend-vercel.ts'

/** On Vercel, or with its OIDC token pulled (`vercel env pull`): a deployment acts as its project. */
const deployed = () => process.env.VERCEL === '1' || !!process.env.VERCEL_OIDC_TOKEN

/**
 * A token Vercel's API takes: `VERCEL_TOKEN`, this deployment's OIDC token, or your Vercel login,
 * the one the Vercel CLI hands a CLI it runs (`VERCEL_AUTH_TOKEN`) or your `vercel login`.
 */
async function token(): Promise<string> {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN
  if (deployed()) return getVercelOidcToken()
  return vercelLogin()
}

/** Where `token` comes from, in words: what `vb whoami` says. */
export function credentialSource(): string {
  if (process.env.VERCEL_TOKEN) return 'VERCEL_TOKEN'
  if (deployed()) return 'Vercel OIDC'
  return process.env.VERCEL_AUTH_TOKEN ? 'the Vercel CLI' : 'vercel login'
}

/** The team: `VERCEL_ORG_ID`, the one the deployment's OIDC token names, or the linked project's (`.vercel/project.json`). */
async function team(): Promise<string | null> {
  if (process.env.VERCEL_ORG_ID) return process.env.VERCEL_ORG_ID
  if (!process.env.VERCEL_TOKEN && deployed()) {
    try {
      const owner = decodeJwt(await getVercelOidcToken()).owner_id
      if (typeof owner === 'string') return owner
    } catch {}
  }
  try {
    const linked = JSON.parse(await readFile(join(process.cwd(), '.vercel', 'project.json'), 'utf8')) as { orgId?: unknown }
    if (typeof linked.orgId === 'string') return linked.orgId
  } catch {}
  return null
}

const environment: VercelEnvironment = {
  fetch: () => async (input, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${await token()}`)
    return globalThis.fetch(input, { ...init, headers })
  },
  team,
  profile: environmentProfile,
}

/**
 * Your team's board, in Vercel's API: this board keeps nothing, and reads and writes that one as
 * this deployment's project, or as you. Without `board`, the team's board; without `fetch`, it
 * sends the credentials the Vercel CLI or the deployment has.
 */
export function vercel(options: VercelOptions = {}): VercelBackend {
  return createVercel(options, environment)
}

export type { VercelBackend, VercelOptions }
