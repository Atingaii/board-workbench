import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

// Coding agents end each turn with a hook. `vb hooks install` adds one that asks
// the agent, once, to update the board when its turn didn't: `vb update` posts a
// summary to the branch's work thread, or `vb update --skip` says there's nothing
// to share. The hook only reads a local marker, so it never waits on the network.

/** The agents whose turn-end hook `vb hooks install` knows: both read `{ hooks: { Stop: [...] } }`. */
export const AGENTS = {
  claude: { name: 'Claude Code', file: () => join(homedir(), '.claude', 'settings.json') },
  codex: { name: 'Codex', file: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json') },
} as const

export type HookAgent = keyof typeof AGENTS

type HookEntry = { type: string; command: string; timeout?: number }
type HookConfig = { hooks?: Record<string, { matcher?: string; hooks?: HookEntry[] }[]> } & Record<string, unknown>

const ours = (entry: HookEntry) => / hook stop --agent /.test(entry.command)

function readConfig(path: string): HookConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HookConfig
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`can't read ${path}: ${(error as Error).message}`)
  }
}

/** Written to a sibling, then renamed: a crash never leaves an agent's settings half-written. */
function writeConfig(path: string, config: HookConfig) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.vboard-tmp`, `${JSON.stringify(config, null, 2)}\n`)
  renameSync(`${path}.vboard-tmp`, path)
}

/** Adds the turn-end hook, replacing an earlier one of ours; everything else in the file stays. Answers whether it changed. */
export function installHook(agent: HookAgent, command: string): boolean {
  const path = AGENTS[agent].file()
  const config = readConfig(path)
  const stop = (config.hooks?.Stop ?? []).map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !ours(h)) }))
  const before = JSON.stringify(config.hooks?.Stop ?? [])
  const next = [...stop.filter((group) => group.hooks.length > 0), { hooks: [{ type: 'command', command, timeout: 10 }] }]
  if (JSON.stringify(next) === before) return false
  writeConfig(path, { ...config, hooks: { ...config.hooks, Stop: next } })
  return true
}

export function uninstallHook(agent: HookAgent): boolean {
  const path = AGENTS[agent].file()
  const config = readConfig(path)
  const stop = config.hooks?.Stop
  if (!stop?.some((group) => group.hooks?.some(ours))) return false
  const kept = stop.map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !ours(h)) })).filter((g) => g.hooks.length > 0)
  const hooks = { ...config.hooks }
  if (kept.length > 0) hooks.Stop = kept
  else delete hooks.Stop
  writeConfig(path, { ...config, hooks })
  return true
}

/** The command our hook runs for `agent`, if it's installed. */
export function installedHook(agent: HookAgent): string | null {
  const stop = readConfig(AGENTS[agent].file()).hooks?.Stop ?? []
  return stop.flatMap((group) => group.hooks ?? []).find(ours)?.command ?? null
}

// --- one session's turns -----------------------------------------------------------

/** When the session last wrote to the board, last asked to, and last finished a turn. */
type Turns = { posted?: number; asked?: number; settled?: number }

/**
 * In the temp directory, which agents' sandboxes let commands write (Codex's
 * doesn't allow ~/.config): a marker only has to last a few turns.
 */
const turnsFile = (session: string) =>
  join(tmpdir(), `vboard-turns-${process.getuid?.() ?? 'user'}`, `${session.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)

function readTurns(session: string): Turns {
  try {
    return JSON.parse(readFileSync(turnsFile(session), 'utf8')) as Turns
  } catch {
    return {}
  }
}

function writeTurns(session: string, turns: Turns) {
  mkdirSync(dirname(turnsFile(session)), { recursive: true, mode: 0o700 })
  writeFileSync(turnsFile(session), JSON.stringify(turns))
}

/** A write to the board from an agent session: this turn needs no reminder. Best effort: the write already happened. */
export function markPosted(session: string, now = Date.now()) {
  try {
    writeTurns(session, { ...readTurns(session), posted: now })
  } catch {}
}

/**
 * The turn-end decision: let the agent stop, or ask it once to update the board.
 * It stops freely when it wrote to the board since its last turn ended, when
 * it was already asked this turn, or when the agent says it's continuing
 * because of a hook (`stop_hook_active`), so it can never loop.
 */
export function decideStop(session: string, continuing: boolean, now = Date.now()): 'stop' | 'ask' {
  const turns = readTurns(session)
  const since = turns.settled ?? 0
  if (continuing || (turns.posted ?? 0) > since || (turns.asked ?? 0) > since) {
    writeTurns(session, { ...turns, settled: now })
    return 'stop'
  }
  writeTurns(session, { ...turns, asked: now })
  return 'ask'
}

/** What the agent is asked, with the exact command to run. */
export function reminder(cli: string, channel: string): string {
  const flag = channel === 'work' ? '' : ` --channel ${channel}`
  return [
    "You didn't update the team's board (vboard) this turn.",
    `If this turn did something teammates should know about, post a 1–3 sentence summary of what you did and what's next: ${cli} update${flag} "<summary>". Add --attach <file> for proof, like a test log or a screenshot.`,
    "Don't paste the prompt, long output, or secrets.",
    `If there's nothing worth sharing (a quick question, no changes), run ${cli} update --skip instead. Then finish.`,
  ].join(' ')
}

// --- where an update goes ----------------------------------------------------------

const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** `basehub-ai/vboard` from `git@github.com:basehub-ai/vboard.git` or `https://github.com/basehub-ai/vboard`. */
export function repoName(remote: string): string | null {
  const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return match ? match[1]! : null
}

/** The work this checkout is on: its repo and branch, which name its thread. */
export function workOf(cwd: string): { repo: string; branch: string; key: string } {
  const root = git(cwd, 'rev-parse', '--show-toplevel') || cwd
  const repo = repoName(git(root, 'remote', 'get-url', 'origin')) ?? basename(root)
  // `symbolic-ref` also names the branch of a repo with no commits yet.
  const branch = git(root, 'symbolic-ref', '--short', 'HEAD') || git(root, 'rev-parse', '--abbrev-ref', 'HEAD') || 'no-branch'
  return { repo, branch, key: `${repo}@${branch}`.slice(0, 256) }
}
