#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { withMentions } from '../api/tail.ts'
import { type ProfileOption } from '../client/client.ts'
import { boardUrl, configDir, connect, detectAgent, projectDir, projectUrl } from '../client/node.ts'
import { http } from '../backend-http/index.ts'
import { board as boardAt, type Board } from '../server/index.ts'
import { DIRECT_UPLOAD_BYTES_MAX } from '../contract/schemas.ts'
import { startInspector } from '../inspect/server.ts'
import { VERSION } from '../version.ts'
import { formatAccess, terminalText, who } from './format.ts'
import { commandWord, HELP, parse, UsageError, type Flags } from './args.ts'
import { run as runOnBoard, type Io } from './vb.ts'
import {
  AGENTS,
  allow,
  allowRules,
  claimLinkOffer,
  cliOf,
  codexNetwork,
  decideStop,
  disallow,
  installedHook,
  installHook,
  legacyRules,
  linkOffer,
  markPosted,
  outdated,
  reminder,
  stopOutput,
  tilde,
  uninstallHook,
  type HookAgent,
} from './hooks.ts'


// What a person reads can't drive their terminal; what a program reads is byte for byte what the board said.
const out = (text: string) => process.stdout.write(`${terminalText(text)}\n`)
const printJson = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)

const argv = process.argv.slice(2)
/** The commands about this machine: the rest act on the board, through `vb()`'s code (vb.ts). */
const LOCAL = new Set(['link', 'use', 'whoami', 'identity', 'hooks', 'hook', 'serve', 'inspect'])
const parsed = (() => {
  try {
    return parse(argv)
  } catch (error) {
    return error as Error
  }
})()
// A misused flag runs nothing: the end of this file says why and exits 2.
const { flags, positionals } = parsed instanceof Error ? { flags: {} as Flags, positionals: [] as string[] } : parsed










/**
 * The board this command talks to, `--url`'s or the one the environment points at, as `--as`
 * says: a handle on it, and how it reaches it (the credentials `vb` finds, `--handle`'s handle).
 */
function connection(url: string | undefined = flags.url, options: { token?: string; handle?: string | undefined } = {}) {
  const at = (url ?? boardUrl()).replace(/\/+$/, '')
  const handle = options.handle ?? flags.handle
  const transport = connect(at, { ...(options.token !== undefined ? { token: options.token } : {}), ...(handle ? { handle } : {}) })
  const board = boardAt({ backend: http(at, { fetch: transport.fetch }) })
  const profile: ProfileOption | undefined = flags.human
    ? null
    : flags.as
      ? flags.avatar
        ? { name: flags.as, avatar: flags.avatar }
        : flags.as
      : undefined
  return { url: at, transport, board: profile !== undefined ? board.as(profile) : board }
}

/** A handle on the board this command talks to. */
const client = (): Board => connection().board

/**
 * What names an agent's turns, for the turn-end hook: its session, or for
 * Cursor, whose shell has no session ID, the project it works in.
 */
const turnKey = (agent: string, session: string | null) => session ?? (agent === 'cursor' ? `cursor@${projectDir()}` : null)

/** A write from an agent session counts as this turn's board update. */
function wrote() {
  const detected = flags.human ? null : detectAgent()
  const key = detected ? turnKey(detected.profile, detected.session) : null
  if (key) markPosted(key)
}

const fromNpx = (path: string) => /[\\/]_npx[\\/]/.test(path)

/** The first `vb` on PATH outside npx's cache, which is gone once npx exits. */
function globalVb(): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, 'vb')
    if (existsSync(candidate) && !fromNpx(realpathSync(candidate))) return candidate
  }
  return null
}

/**
 * Whether `bin` runs the CLI at `self`: a symlink to it (npm), or a shell
 * shim that execs node on it (pnpm, through `$basedir`- or `$basedir_abs`-relative paths).
 */
function runsCli(bin: string, self: string): boolean {
  try {
    const real = realpathSync(bin)
    if (real === self) return true
    if (statSync(real).size > 64 * 1024) return false
    const script = readFileSync(real, 'utf8')
    if (!script.startsWith('#!')) return false
    const basedir = dirname(bin)
    // pnpm 10 quotes "$basedir/…"; pnpm 11 quotes "$basedir_abs/…" and notes `# cmd-shim-target=<path>`.
    const paths = [
      ...[...script.matchAll(/"([^"\n]+)"/g)].map(([, quoted]) => quoted!.replace(/^\$(?:\{basedir(?:_abs)?\}|basedir(?:_abs)?)(?=\/)/, basedir)),
      ...[...script.matchAll(/^# cmd-shim-target=(.+)$/gm)].map(([, target]) => target!.trim()),
    ]
    for (const path of paths) if (isAbsolute(path) && existsSync(path) && realpathSync(path) === self) return true
  } catch {}
  return false
}

/**
 * How an agent's hook should run this CLI, long after this command exits:
 * `vb` when that's this CLI; under npx, a global `vb` of this version, else
 * this version through npx; otherwise this CLI's full path.
 */
function cliCommand(): { command: string; note?: string } {
  const self = realpathSync(process.argv[1]!)
  const installed = globalVb()
  if (!fromNpx(self)) {
    if (installed && runsCli(installed, self)) return { command: 'vb' }
    const quote = (part: string) => (/^[\w./-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`)
    return { command: [process.execPath, self].map(quote).join(' ') }
  }
  let version = ''
  try {
    version = installed ? execFileSync(installed, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() : ''
  } catch {}
  if (version === VERSION) return { command: 'vb' }
  return {
    command: `npx -y @vercel/board@${VERSION}`,
    note: `the hook runs board ${VERSION} through npx${installed ? ` (your vb is ${version || 'older'})` : ''}; \`npm i -g @vercel/board\` makes it start faster`,
  }
}

/**
 * The board version a hook's CLI runs: pinned in an npx command, else what it
 * answers to `--version` (the first `vb` on PATH, for plain `vb`). Null when
 * it doesn't answer with one.
 */
function hookVersion(cli: string): string | null {
  const pinned = /^npx -y @vercel\/board@(\S+)$/.exec(cli)
  if (pinned) return pinned[1]!
  try {
    const answer = execFileSync('/bin/sh', ['-c', `${cli} --version`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return /^\d+\.\d+\.\d+\S*$/.test(answer) ? answer : null
  } catch {
    return null
  }
}

/** Whether version `a` comes before `b`, by major, minor, and patch. */
function olderVersion(a: string, b: string): boolean {
  const parts = (version: string) => version.split(/[.-]/).slice(0, 3).map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function hookAgents(names: string[]): HookAgent[] {
  const known = Object.keys(AGENTS) as HookAgent[]
  for (const name of names)
    if (!known.includes(name as HookAgent)) throw new UsageError(`unknown agent: ${name} (known: ${known.join(', ')})`)
  return names.length ? (names as HookAgent[]) : known
}




/** Best-effort: the URL is printed either way. */
/** `url`, when it's an http or https URL as `new URL` reads it: the only kind the CLI opens, so a board can't hand the opener a flag or another scheme. */
function browsable(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Opens an http(s) URL in the browser, as one argument to the opener: no shell reads it, Windows' included. */
function openBrowser(url: string) {
  const at = browsable(url)
  if (at === null) return
  const [command, ...args] =
    process.platform === 'darwin' ? ['open', at] : process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', at] : ['xdg-open', at]
  const child = spawn(command!, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

/** Writes the board link: the project's `.board/` (kept out of Git), or the saved default when `root` is null. */
async function saveLink(root: string | null, url: string, extra: Record<string, unknown> = {}) {
  const directory = root === null ? configDir() : join(root, '.board')
  if (root !== null) {
    const path = join(root, '.gitignore')
    const ignore = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    if (!ignore.split(/\r?\n/).some((line) => /^\/?\.board\/?$/.test(line)))
      await appendFile(path, `${ignore && !ignore.endsWith('\n') ? '\n' : ''}.board/\n`)
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(join(directory, 'config.json'), `${JSON.stringify({ url, ...extra }, null, 2)}\n`, { mode: 0o600 })
}

/** Whether the project's link was written by `vb serve` (`"serve": true`), so a new run may move it. */
function linkedByServe(root: string): boolean {
  try {
    return JSON.parse(readFileSync(join(root, '.board', 'config.json'), 'utf8')).serve === true
  } catch {
    return false
  }
}

function portFlag(): number | undefined {
  const port = flags.port === undefined ? undefined : Number(flags.port)
  if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535))
    throw new UsageError(`expected a port, got: ${flags.port}`)
  return port
}

/** How long `identity link` waits for the sign-in or the code. */
const LINK_WAIT_MS = 10 * 60_000

async function identity(args: string[]): Promise<number> {
  const board = client()
  const [sub, target] = args
  if (sub === undefined) {
    const view = await board.identity()
    if (flags.json) return printJson(view), 0
    if (view.links.length === 0) out('no linked accounts')
    for (const link of view.links) out(`${link.handle ? `@${link.handle}  ` : ''}${link.actor}  by ${link.method === 'code' ? 'code' : 'sign-in'} · ${link.at}`)
    if (view.unlinked?.length) out(`not linked  ${view.unlinked.join(', ')}  (vb identity link <key>)`)
    return 0
  }
  if (sub === 'unlink') {
    if (!target || args.length !== 2) throw new UsageError('usage: board identity unlink <account>   (a handle or actor ID from `vb identity`)')
    const result = await board.unlinkAccount(target)
    if (flags.json) printJson(result)
    else out(`unlinked ${result.actor}`)
    return 0
  }
  if (sub !== 'link' || !target || args.length !== 2) throw new UsageError('usage: board identity [link <key> [--code] [--no-wait] | unlink <account>]')
  const before = new Set((await board.identity()).links.map((link) => `${link.actor}|${link.at}`))
  // The entry's platform, as the board lists it: what the code is posted from, or the sign-in is for.
  const platform = (await board.discovery().catch(() => null))?.sync.find((entry) => entry.key === target)?.platform ?? target
  const { code, expiresAt, signIn } = await board.syncCode(target)
  const consent = signIn !== undefined && !flags.code
  // The board says where its sign-in is, and the CLI opens it: only a web page.
  if (consent && browsable(signIn) === null) throw new Error(`the board's sign-in isn't an http or https URL: ${JSON.stringify(signIn)}`)
  if (flags.json) printJson({ sync: target, platform, code, expiresAt, ...(signIn !== undefined ? { signIn } : {}) })
  const until = Date.now() + LINK_WAIT_MS
  const sleep = () => new Promise((resolve) => setTimeout(resolve, 2000))
  /** An account linked on that platform since this run began: where the code or the sign-in landed. */
  const linkedSince = async () =>
    (await board.identity()).links.find((link) => link.actor.startsWith(`${platform}:user:`) && !before.has(`${link.actor}|${link.at}`))
  if (consent) {
    if (!flags.json) {
      out(`Sign in to ${platform} as yourself to link it (and to post as you there):\n\n  ${signIn}\n`)
      out(`Only open it yourself: whoever completes it links their account to you.`)
    }
    if (!flags['no-open'] && !flags.json) openBrowser(signIn!)
  } else if (!flags.json) {
    const minutes = Math.round((Date.parse(expiresAt) - Date.now()) / 60_000)
    out(`From your ${platform} account, post this as a message anywhere the board syncs, within ${minutes} minutes:\n\n  ${code}\n`)
  }
  if (flags['no-wait']) return 0
  // The sign-in, or the code's post, links the account where the entry's sync runs: it shows up in your links.
  while (Date.now() < Math.min(until, consent ? Infinity : Date.parse(expiresAt))) {
    await sleep()
    const linked = await linkedSince()
    if (linked) {
      if (flags.json) printJson(linked)
      else out(`linked ${linked.handle ? `@${linked.handle} ` : ''}(${linked.actor})`)
      return 0
    }
  }
  process.stderr.write('timed out\n')
  return 124
}

async function run(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'link':
    case 'use': {
      const url = args[0]
      if (!url || args.length !== 1) throw new UsageError(`usage: board ${command} <url>`)
      const discovery = await connection(url).board.discovery()
      const root = command === 'link' ? projectDir() : null
      await saveLink(root, discovery.url)
      out(root === null ? `using ${discovery.url}` : `linked ${root} to ${discovery.url}`)
      return 0
    }

    case 'whoami': {
      const { board, url, transport } = connection()
      const me = await board.me()
      const source = transport.source()
      if (flags.json) {
        printJson({ ...me, board: url, source })
        return 0
      }
      const name = me.profile !== null ? `${me.name} via ${me.handle.split('/')[0]}` : me.name
      out(`${name} (${me.actor})`)
      const rows: [string, string][] = [['board', url]]
      if (source) rows.push(['source', source])
      if (me.expiresAt) {
        const minutes = Math.max(0, Math.round((Date.parse(me.expiresAt) - Date.now()) / 60_000))
        rows.push(['token', `expires in ${Math.floor(minutes / 60)}h ${minutes % 60}m`])
      }
      if (me.session) rows.push(['session', me.session])
      // Full access says nothing; anything less says what it is, one pattern a row.
      ;(me.can === undefined ? [] : formatAccess(me.can)).forEach((line, index) => rows.push([index === 0 ? 'can' : '', line]))
      const width = Math.max(...rows.map(([subject]) => subject.length))
      for (const [subject, value] of rows) out(`${subject.padEnd(width)}  ${value}`)
      return 0
    }

    case 'identity':
      return identity(args)

    case 'hooks': {
      const [action = 'status', ...names] = args
      const agents = hookAgents(names)
      const width = Math.max(...agents.map((agent) => AGENTS[agent].name.length))
      const row = (agent: HookAgent, ...cells: string[]) => out([AGENTS[agent].name.padEnd(width), ...cells].join('  ').trimEnd())
      if (action === 'status') {
        const versions = new Map<string, string | null>()
        for (const agent of agents) {
          const installed = installedHook(agent)
          if (installed === null) {
            row(agent, 'not installed')
            continue
          }
          // What installing again would change, and whether the board the hook runs is older than this one.
          const cli = cliOf(installed)
          const problems = outdated(agent, installed)
          if (!versions.has(cli)) versions.set(cli, hookVersion(cli))
          const version = versions.get(cli)
          const behind = version != null && olderVersion(version, VERSION)
          if (behind) problems.push(`runs board ${version}, not ${VERSION}`)
          row(agent, (problems.length ? 'outdated' : 'installed').padEnd(9), tilde(AGENTS[agent].file()))
          if (problems.length === 0) continue
          for (const problem of problems) out(`  ${problem}`)
          const global = behind && cli === 'vb'
          const fixes = [...(global ? ['npm i -g @vercel/board'] : []), ...(problems.length > (global ? 1 : 0) ? [`vb hooks install ${agent}`] : [])]
          out(`  fix with ${fixes.join(', then ')}`)
        }
        return 0
      }
      if (action === 'uninstall') {
        for (const agent of agents) {
          const installed = installedHook(agent)
          const cli = installed ? cliOf(installed) : null
          const rules = cli ? allowRules(agent, cli) : null
          if (rules) disallow(rules.file, [...rules.rules, ...legacyRules(agent, cli!)])
          row(agent, uninstallHook(agent) ? 'removed' : 'not installed', installed ? tilde(AGENTS[agent].file()) : '')
        }
        return 0
      }
      if (action !== 'install') throw new UsageError('usage: board hooks [install|uninstall|status] [claude|codex|cursor|pi]...')
      const { command: cli, note } = cliCommand()
      // One block per agent: its name and file, then what happened and what's left to do, indented.
      for (const agent of agents) {
        const had = installedHook(agent) !== null
        const changed = installHook(agent, cli)
        // The reminder asks for `vb reply`, `vb post`, `vb read`, and `vb channels`: no permission prompt for each.
        const rules = allowRules(agent, cli)
        const added = rules ? allow(rules.file, rules.rules) : []
        const dropped = rules ? disallow(rules.file, legacyRules(agent, cli)) : false
        // "already installed" only when nothing was written: a new hook command, rule, or dropped rule is an update.
        out(`${AGENTS[agent].name}  ${tilde(AGENTS[agent].file())}`)
        out(`  ${!had ? 'added the turn-end hook' : changed || added.length > 0 || dropped ? 'updated' : 'already installed'}`)
        if (added.length > 0) out(`  ${agent === 'claude' ? 'reply, post, read, and channels run without asking' : 'vb runs without asking'}`)
        if (agent === 'cursor' && !rules) out('  npm i -g @vercel/board lets Cursor run vb without asking')
        if (agent === 'codex') {
          if (changed) out('  approve it once in Codex with /hooks')
          let host: string | null = null
          try {
            const url = process.env.BOARD_URL || projectUrl()
            host = url ? new URL(url).hostname : null
          } catch {}
          const config = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
          const profile = codexNetwork(host)
          out(`  to let vb reach the board from Codex's sandbox, add to ${tilde(config)}:`)
          out('')
          out(['# a permission profile (beta) that opens the network to just the board', '', '# at the top, before any [table]', profile.top, '', '# anywhere (merge [features] into yours)', profile.tables].join('\n').replace(/^(?=.)/gm, '    '))
        }
        out('')
      }
      if (note) out(`${note[0]!.toUpperCase()}${note.slice(1)}.`)
      out('The hooks remind once per turn without a board update.')
      out('They stay quiet outside projects linked with `vb link <url>`.')
      return 0
    }

    // What an agent's turn-end hook runs. It must never break the agent's turn: any failure lets it stop.
    case 'hook': {
      if (args[0] !== 'stop') throw new UsageError("usage: board hook stop --agent <agent>   (run by an agent's turn-end hook)")
      const agent = flags.agent ?? 'agent'
      try {
        // Claude Code and Codex send `session_id`, `cwd`, and `stop_hook_active`; Cursor sends
        // `conversation_id`, `workspace_roots`, `status`, and `loop_count`.
        const payload = JSON.parse(await readStdin()) as {
          session_id?: string
          conversation_id?: string
          cwd?: string
          workspace_roots?: string[]
          stop_hook_active?: boolean
          loop_count?: number
          status?: string
        }
        const cwd = payload.cwd ?? payload.workspace_roots?.[0]
        if (cwd && existsSync(cwd)) process.chdir(cwd)
        const session = turnKey(agent, agent === 'cursor' ? null : (payload.session_id ?? null))
        const boardUrl = process.env.BOARD_URL || projectUrl()
        if (!session || !boardUrl) return 0
        if (payload.status && payload.status !== 'completed') return 0
        const continuing = payload.stop_hook_active === true || (payload.loop_count ?? 0) > 0
        if (decideStop(session, continuing) === 'ask') {
          const cli = cliCommand().command
          // The first reminder on this board also offers, once, to link the person's accounts.
          const text = claimLinkOffer(boardUrl) ? `${reminder(cli)}\n\n${linkOffer(cli)}` : reminder(cli)
          printJson(stopOutput(agent, text))
        }
      } catch {}
      return 0
    }

    case 'serve': {
      if (args.length > 0) throw new UsageError('usage: board serve [--port N] [--dir <dir>] [--no-inspect] [--no-open]')
      const port = portFlag()
      const root = projectDir()
      const { localHandle, serveLocal } = await import('./serve.ts')
      const handle = flags.handle ?? process.env.BOARD_HANDLE
      const local = await serveLocal({
        dir: flags.dir ?? join(root, '.board'),
        ...(port !== undefined ? { port } : {}),
        ...(handle ? { handle: localHandle(handle) } : {}),
      })
      let inspector: Awaited<ReturnType<typeof startInspector>> | null = null
      try {
        // Link this project, unless it's linked to another board (a remote one, or a \`board()\` dev
        // server on localhost): then say how to reach this one. A link an earlier \`vb serve\` wrote moves.
        const linked = projectUrl()
        if (linked === undefined || linked === local.url || linkedByServe(root)) {
          await saveLink(root, local.url, { serve: true })
          if (linked !== local.url) out(`linked ${root} to ${local.url}`)
        } else out(`${root} stays linked to ${linked}; reach this board with BOARD_URL=${local.url}`)
        out(`serving a local board at ${local.url} as ${local.principal}, its log in ${local.dir}  (Ctrl-C to stop)`)
        if (!flags['no-inspect']) {
          // With this board's token, whatever BOARD_TOKEN says.
          const { board } = connection(local.url, { token: local.token, handle: local.handle })
          inspector = await startInspector({ client: board.as(null) })
          out(`inspector at ${inspector.url}`)
          if (!flags['no-open']) openBrowser(inspector.url)
        }
        await new Promise<void>((resolve) => {
          process.once('SIGINT', resolve)
          process.once('SIGTERM', resolve)
        })
      } finally {
        await inspector?.close()
        await local.close()
      }
      return 0
    }

    case 'inspect': {
      const port = portFlag()
      const inspector = await startInspector({ client: client(), ...(port !== undefined ? { port } : {}) })
      out(`inspecting ${inspector.board} as ${who(inspector.me)} at ${inspector.url}  (Ctrl-C to stop)`)
      if (!flags['no-open']) openBrowser(inspector.url)
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve)
        process.once('SIGTERM', resolve)
      })
      await inspector.close()
      return 0
    }

    default:
      throw new UsageError(`unknown command: ${command} (run \`board help\`)`)
  }
}

/** The terminal, this machine's files, stdin, and Ctrl-C: what the board's commands run with here. */
const terminal: Io = {
  write: (chunk) => process.stdout.write(chunk),
  error: (chunk) => process.stderr.write(chunk),
  async readFile(path) {
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) return null
    if (info.size > DIRECT_UPLOAD_BYTES_MAX) throw new UsageError(`${path} is over ${DIRECT_UPLOAD_BYTES_MAX / 1024 / 1024} MB, the most an attachment can be`)
    return new Uint8Array(await readFile(path))
  },
  writeFile: (path, data) => writeFile(path, data),
  stdin: readStdin,
  // Only a command that reads it (tail, wait) takes over Ctrl-C: the rest stop as any process does.
  get signal() {
    const controller = new AbortController()
    process.once('SIGINT', () => controller.abort())
    return controller.signal
  },
  wrote,
}

const command = commandWord(withMentions(argv))
if (command === undefined || !LOCAL.has(command)) {
  // `help` and `--version` too: they need no board.
  if (!(parsed instanceof Error) && flags.version) out(VERSION), exit(0)
  else if (!(parsed instanceof Error) && flags.help) out(HELP), exit(0)
  else runOnBoard(client, argv, terminal).then(exit)
} else if (parsed instanceof Error) {
  process.stderr.write(terminalText(`error: ${parsed.message}`) + '\n')
  exit(2)
} else if (flags.version) {
  out(VERSION)
} else if (flags.help) {
  out(HELP)
} else {
  const [, ...args] = positionals
  run(positionals[0], args).then(
    (code) => exit(code),
    (error: unknown) => {
      // A board's error says what the board said: it can't drive the terminal either.
      process.stderr.write(`${terminalText(`error: ${(error as Error).message}`)}\n`)
      exit(error instanceof UsageError ? 2 : 1)
    },
  )
}

/**
 * Exits once stdout and stderr have flushed. On a pipe, writes can still be
 * queued when a command returns, and `process.exit` would drop them: a long
 * `read <id> --json` would reach a slow reader cut off.
 */
function exit(code: number) {
  let pending = 2
  const done = () => --pending === 0 && process.exit(code)
  process.stdout.write('', done)
  process.stderr.write('', done)
}
