import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

// Coding agents end each turn with a hook. `vb hooks install` adds one that
// reminds the agent, once, to update the board when its turn didn't: it runs
// `vb update` (or `vb reply` in a thread it's in), or `vb update --skip` to stay
// quiet. The hook only reminds; the agent uses the CLI for everything, reading
// included. Deciding reads only a local marker, so a turn never waits on it.

type Shape = 'nested' | 'flat'

/**
 * Where each agent keeps hooks, and which of its events run ours. Claude Code
 * and Codex read `{ hooks: { Stop: [{ hooks: [entry] }] } }`; Cursor reads
 * `{ version: 1, hooks: { stop: [entry] } }`, and its stop can't block, so it's
 * reminded with a follow-up message instead.
 */
export const AGENTS = {
  claude: { name: 'Claude Code', shape: 'nested', event: 'Stop', file: () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json') },
  codex: { name: 'Codex', shape: 'nested', event: 'Stop', file: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json') },
  cursor: { name: 'Cursor', shape: 'flat', event: 'stop', file: () => join(homedir(), '.cursor', 'hooks.json') },
} as const satisfies Record<string, { name: string; shape: Shape; event: string; file: () => string }>

export type HookAgent = keyof typeof AGENTS

type HookEntry = { type?: string; command: string; timeout?: number }
type Group = { matcher?: string; hooks?: HookEntry[] }
type Entries = (Group | HookEntry)[]
type Config = { version?: number; hooks?: Record<string, Entries>; permissions?: { allow?: string[] } & Record<string, unknown> } & Record<
  string,
  unknown
>

const ours = (entry: { command?: string }) => / hook stop --agent /.test(entry.command ?? '')

function readConfig(path: string): Config {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Config
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`can't read ${path}: ${(error as Error).message}`)
  }
}

/** Written to a sibling, then renamed: a crash never leaves an agent's settings half-written. */
function writeConfig(path: string, config: Config) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.vboard-tmp`, `${JSON.stringify(config, null, 2)}\n`)
  renameSync(`${path}.vboard-tmp`, path)
}

/** An event's entries without ours; a group left with no hooks goes too. */
function without(entries: Entries, shape: Shape): Entries {
  if (shape === 'flat') return entries.filter((entry) => !ours(entry as HookEntry))
  return entries
    .map((group) => ({ ...group, hooks: ((group as Group).hooks ?? []).filter((h) => !ours(h)) }))
    .filter((group) => group.hooks.length > 0)
}

/** Adds our hook, replacing an earlier one of ours; everything else in the file stays. Answers whether it changed. */
export function installHook(agent: HookAgent, cli: string, flags = ''): boolean {
  const spec = AGENTS[agent]
  const config = readConfig(spec.file())
  // `|| true`: whatever `cli` turns out to be (an older vboard without `hook` exits 2, which Claude Code
  // and Codex read as "keep going"), the hook can't fail a turn.
  const command = `${cli} hook stop --agent ${agent}${flags} 2>/dev/null || true`
  const entry = spec.shape === 'flat' ? { command, timeout: 10 } : { hooks: [{ type: 'command', command, timeout: 10 }] }
  const hooks = { ...config.hooks, [spec.event]: [...without(config.hooks?.[spec.event] ?? [], spec.shape), entry] }
  const next = { ...(spec.shape === 'flat' ? { version: 1 } : {}), ...config, hooks }
  if (JSON.stringify(next) === JSON.stringify(config)) return false
  writeConfig(spec.file(), next)
  return true
}

/** Removes our hook. A file that held only it (Cursor's, which we created) goes away with it. */
export function uninstallHook(agent: HookAgent): boolean {
  const spec = AGENTS[agent]
  if (installedHook(agent) === null) return false
  const config = readConfig(spec.file())
  const hooks = { ...config.hooks }
  const kept = without(hooks[spec.event] ?? [], spec.shape)
  if (kept.length > 0) hooks[spec.event] = kept
  else delete hooks[spec.event]
  const rest = Object.keys(config).filter((key) => key !== 'hooks' && key !== 'version')
  if (rest.length === 0 && Object.keys(hooks).length === 0) unlinkSync(spec.file())
  else writeConfig(spec.file(), { ...config, hooks })
  return true
}

/** The command our hook runs for `agent`, if it's installed. */
export function installedHook(agent: HookAgent): string | null {
  const spec = AGENTS[agent]
  const entries = readConfig(spec.file()).hooks?.[spec.event] ?? []
  const commands = spec.shape === 'flat' ? (entries as HookEntry[]) : entries.flatMap((group) => (group as Group).hooks ?? [])
  return commands.find(ours)?.command ?? null
}

/** The CLI an installed hook runs: everything before ` hook stop`. */
export const cliOf = (command: string) => command.slice(0, command.indexOf(' hook stop '))

// --- what the agent may run without asking -----------------------------------------

/**
 * The reminder asks the agent to run `vb update`, `vb reply`, and `vb read`;
 * where the agent keeps an allowlist, those run without a permission prompt.
 * Claude Code matches command prefixes; Cursor matches a command's name, so it
 * can allow only a `vb` on PATH. Codex has no command allowlist: its sandbox
 * decides (see `codexNetwork`).
 */
export function allowRules(agent: HookAgent, cli: string): { file: string; rules: string[] } | null {
  if (agent === 'claude') return { file: AGENTS.claude.file(), rules: ['update', 'reply', 'read'].map((sub) => `Bash(${cli} ${sub}:*)`) }
  if (agent === 'cursor' && cli === 'vb') return { file: join(homedir(), '.cursor', 'cli-config.json'), rules: ['Shell(vb)'] }
  return null
}

/** Adds the rules a file doesn't have yet. Answers the ones it added. */
export function allow(file: string, rules: string[]): string[] {
  const config = readConfig(file)
  const allowed = config.permissions?.allow ?? []
  const added = rules.filter((rule) => !allowed.includes(rule))
  if (added.length > 0) writeConfig(file, { ...config, permissions: { ...config.permissions, allow: [...allowed, ...added] } })
  return added
}

export function disallow(file: string, rules: string[]) {
  const config = readConfig(file)
  const allowed = config.permissions?.allow
  if (!allowed?.some((rule) => rules.includes(rule))) return
  writeConfig(file, { ...config, permissions: { ...config.permissions, allow: allowed.filter((rule) => !rules.includes(rule)) } })
}

/**
 * Codex's default sandbox has no network, so `vb` can't reach the board. A
 * permission profile can allow just the board, and Vercel's API for its token.
 * In TOML a key after a `[table]` belongs to it, so `default_permissions` goes
 * at the top; the tables go anywhere (`[features]` merged into one that's there).
 */
export function codexNetwork(boardHost: string | null): { top: string; tables: string } {
  const hosts = [boardHost ?? '<your board host>', 'api.vercel.com']
  return {
    top: 'default_permissions = "vboard"',
    tables: [
      '[features]',
      'network_proxy = true',
      '',
      '[permissions.vboard]',
      'extends = ":workspace"',
      '',
      '[permissions.vboard.network]',
      'enabled = true',
      '',
      '[permissions.vboard.network.domains]',
      ...hosts.map((host) => `"${host}" = "allow"`),
    ].join('\n'),
  }
}

// --- one session's turns -----------------------------------------------------------

/** When the session last wrote to the board, last was reminded to, and last finished a turn. */
type Turns = { posted?: number; asked?: number; settled?: number }

/**
 * In the temp directory, which agents' sandboxes let commands write (Codex's
 * doesn't allow ~/.config): a marker only has to last a few turns, and the
 * system clears it with the rest of its temp files. `XDG_RUNTIME_DIR`, where
 * there is one, is the user's own.
 */
export const turnsDir = () => join(process.env.XDG_RUNTIME_DIR || tmpdir(), `vboard-turns-${process.getuid?.() ?? 'user'}`)
const turnsFile = (session: string) => join(turnsDir(), `${session.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)

function readTurns(session: string): Turns {
  try {
    return JSON.parse(readFileSync(turnsFile(session), 'utf8')) as Turns
  } catch {
    return {}
  }
}

/** The marker directory, only if it's ours: in a shared /tmp, someone else could have made it first. */
function ownTurnsDir(): string {
  const dir = turnsDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const { uid, mode } = statSync(dir)
  if (process.getuid && uid !== process.getuid()) throw new Error(`${dir} belongs to someone else`)
  if ((mode & 0o077) !== 0) chmodSync(dir, 0o700)
  return dir
}

function writeTurns(session: string, turns: Turns) {
  ownTurnsDir()
  writeFileSync(turnsFile(session), JSON.stringify(turns))
}

/** A write to the board from an agent session: this turn needs no reminder. Best effort: the write already happened. */
export function markPosted(session: string, now = Date.now()) {
  try {
    writeTurns(session, { ...readTurns(session), posted: now })
  } catch {}
}

/**
 * The turn-end decision: let the agent stop, or remind it once to update the
 * board. It stops freely when it wrote to the board since its last turn
 * ended, when it was already reminded this turn, or when the agent says a
 * hook made it continue (`continuing`), so it can never loop.
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

/** The reminder, with the exact commands to run. */
export function reminder(cli: string, channel: string): string {
  const flag = channel === 'work' ? '' : ` --channel ${channel}`
  return [
    "You didn't update the team's board (vboard) this turn.",
    `If you changed anything or made progress, post a 1–3 sentence summary of what you did and what's next: ${cli} update${flag} "<summary>", or ${cli} reply <id> "<text>" in a board thread you're working in. Add --attach <file> for proof, like a test log.`,
    `Only if this turn changed nothing (say, you just answered a question), run ${cli} update --skip instead. Don't include the prompt, long output, or secrets. Then finish.`,
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
  // Label filters split values on `|`, which a branch name may hold.
  return { repo, branch, key: `${repo}@${branch}`.replace(/\|/g, '%7C').slice(0, 256) }
}
