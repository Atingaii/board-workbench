import 'server-only'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { createClient } from 'just-board'

/** The observer is a local tool: on a deployment its pages don't exist. */
export function localOnly() {
  if (process.env.VERCEL) notFound()
}

/**
 * The board the observer reads: `SOFTWARE_FACTORY_BOARD_URL` (e.g. the deployed
 * board), or the board this dev server mounts. Your Vercel login authenticates.
 * Pages render in parallel with their layout, so the local-only check lives here,
 * in front of every read.
 */
export async function observerBoard() {
  localOnly()
  const host = (await headers()).get('host') ?? 'localhost:3000'
  const url = process.env.SOFTWARE_FACTORY_BOARD_URL ?? `http://${host}/api/board`
  return createClient({ url, profile: null, session: null })
}

export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}
