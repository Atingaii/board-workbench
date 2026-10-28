import { spawn } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import type { MessageView } from '../api/routes.ts'
import { withMentions } from '../api/tail.ts'
import { BoardError, type Filters, type ProfileOption } from '../client/client.ts'
import { boardUrl, connect, vercelProjectFile } from '../client/node.ts'
import { http } from '../backend-http/index.ts'
import { credentialSource, vercel } from '../backend-vercel/index.ts'
import { board as boardAt, type Board } from '../server/index.ts'
import { normalizeEmoji } from '../contract/emoji.ts'
import { DIRECT_UPLOAD_BYTES_MAX, type Attachment, AttachmentId } from '../contract/schemas.ts'
import { VERSION } from '../version.ts'
import { conformance } from '../conformance/index.ts'
import { actorName, formatAccess, formatConformance, formatEvent, formatSchedule, reactionNames, formatSourceRead, formatSynced, formatThreadSummaries, formatThreads, terminalText, who } from './format.ts'
import { AGENTS, allowRules, cliOf, disallow, installedHook, tilde, uninstallHook, type HookAgent } from './hooks.ts'
import { commands, filters as filterOptions, globalOptions, options, type CliCommand } from './commands.ts'
import { commandHelp, commandPath, rootHelp } from './help.ts'
import { closest, exitCode, failureDocument, formatFailure, type Failure, type Recovery, type Warning } from './failure.ts'

/** A failure this run says in its own words: what a command throws to stop with it. */
export class Failed extends Error {
  readonly failure: Failure
  constructor(failure: Failure) {
    super(failure.message)
    this.failure = failure
  }
}

/**
 * Misuse: `message` says what's wrong with the command as typed. It exits 2, and points at the
 * command's help unless `next` says something better.
 */
function usage(message: string, options: { reason?: string; next?: Recovery[] } = {}): Failed {
  return new Failed({ class: 'usage', reason: options.reason ?? 'invalid_arguments', message, next: options.next ?? [helpRecovery()] })
}

/** A command's help page, which says how to use it. */
const helpRecovery = (command = current.command): Recovery => ({ instruction: 'See how to use it', argv: [...cli(), ...(command ? [command] : []), '--help'] })

/** This CLI's name as argv, to build a command a person runs: `['vb']`, `['vercel', 'board']`. */
const cli = () => named().split(' ')

/** This run's command as typed, with `extra` where options go: before any `--`, after which everything is text. */
function rerun(...extra: string[]): string[] {
  const at = typed.indexOf('--')
  return [...cli(), ...(at === -1 ? [...typed, ...extra] : [...typed.slice(0, at), ...extra, ...typed.slice(at)])]
}

/** What the parser accepts: every option, by name (`commands.ts`). */
const OPTIONS = options

/** Options by their short letter: `n` is `limit`. */
const SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(OPTIONS).flatMap(([name, option]) => ('short' in option ? [[option.short, name]] : [])),
)

/**
 * Whether `arg` is a string option written apart from its value, whose value is the next argument:
 * `--limit 5`, `-n 5`, or the last of a group of short ones, `-an 5`.
 */
function takesValue(arg: string): boolean {
  if (arg.includes('=')) return false
  const string = (name: string | undefined) => name !== undefined && OPTIONS[name as keyof typeof OPTIONS]?.type === 'string'
  if (arg.startsWith('--')) return string(arg.slice(2))
  // In a group, a string option takes what follows it in the group, or, last, the next argument.
  const letters = arg.slice(1)
  const first = [...letters].findIndex((letter) => string(SHORT[letter]))
  return first === letters.length - 1
}

/** A command's own name for `word`, which may be one of its aliases (`rm` is `delete`). */
const canonical = (word: string | undefined) => (word === undefined ? word : (commands.find((command) => command.aliases?.includes(word))?.name ?? word))

// No argument can hold a NUL, so a marked one can't be anything else.
const MARK = '\0'

/**
 * Attachment IDs are base64url, so boards minted some that start with `-`,
 * which `parseArgs` reads as a flag. Where `download` takes its ID, a token
 * shaped like one is the ID: this marks it to parse as a positional.
 */
function markAttachmentId(args: string[]): string[] {
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') break
    if (!arg.startsWith('-') || arg === '-') positionals.push(arg)
    else if (positionals.length === 1 && positionals[0] === 'download' && AttachmentId.safeParse(arg).success)
      return [...args.slice(0, i), `${MARK}${arg}`, ...args.slice(i + 1)]
    else if (takesValue(arg)) i++
  }
  return args
}
/** Commands that are gone, and what to run instead. Their flags don't matter: an old hook's `vb update --skip` gets this too. */
function removedCommand(word: string): Failed | undefined {
  const gone = (next: Recovery[], why = '') => usage(`\`${named()} ${word}\` is gone.${why}`, { reason: 'unknown_command', next })
  const url: Recovery[] = [
    { instruction: "Pass the board's URL", argv: [...cli(), 'read', 'dev', '--url', '<URL>'] },
    { instruction: "Or, in a Vercel project, its team's board needs no URL" },
  ]
  const removed: Record<string, () => Failed> = {
    update: () =>
      gone([
        { instruction: "Reply in the thread you're working in", argv: [...cli(), 'reply', '<ID>', '<TEXT>'] },
        { instruction: 'Or post where it fits', argv: [...cli(), 'post', '<CHANNEL>', '<TEXT>'] },
      ]),
    stuck: () => gone([], " A board on a2() keeps its dead letters in A2, on the backend's `servers`."),
    link: () => gone(url),
    use: () => gone(url),
  }
  return Object.hasOwn(removed, word) ? removed[word]!() : undefined
}

/**
 * The command `argv` runs, by its own name (`delete` for `rm`), as the parser reads it: the
 * first positional, past every flag and value however they're written (`-an 1`, `--limit=1`). A
 * bare `--mentions` takes none.
 */
export function commandWord(argv: string[]): string | undefined {
  const { positionals } = parseArgs({ args: markAttachmentId(withMentions(argv)), allowPositionals: true, options: OPTIONS, strict: false })
  return canonical(positionals[0])
}

const parseAll = (args: string[]) => parseArgs({ args, allowPositionals: true, options: OPTIONS })

/** A command an app adds to board's: `serve` and `inspect`, in the standalone `board`. */
export type Command = {
  /** What it is, as help shows it, with the options it takes from `commands.ts`'s. */
  spec: CliCommand
  run(args: string[], context: CommandContext): Promise<number>
}

/** What a command an app adds gets from the CLI it runs in. */
export type CommandContext = {
  flags: Flags
  out: (text: string) => void
  usage: (message: string) => Error
  portFlag: () => number | undefined
  connection: typeof connection
  client: () => Board
  openBrowser: (url: string) => void
}

/**
 * The CLI an app runs: its name, as help, usage, and errors say it (`board`, `vercel board`),
 * and its own commands.
 */
export type App = {
  name: string
  commands: Record<string, Command>
  /**
   * With no board URL, it talks to the team's board in Vercel's API even outside a Vercel project:
   * your login's team, as `vercel board` does. Without it, only in one (or with `--scope`).
   */
  teamBoard?: boolean
  /** Shows a failure as this app shows its own; without it, the CLI prints `error: …`, or with `--json`, its JSON document. */
  onError?: (failure: Failure, mode: { json: boolean }) => void
  /** Shows a warning, outside `--json` (where it's in the result's `warnings`); without it, the CLI prints `warning: …`. */
  onWarning?: (warning: Warning) => void
}

type Flags = ReturnType<typeof parseAll>['values']

// What one run parsed, which every command reads. A process runs one command at a time.
let app: App = { name: 'board', commands: {} }
let flags = {} as Flags
let positionals: string[] = []
/** The command this run runs, by its own name, and what follows it: what a failure says it was doing. */
let current: { command: string | undefined; args: string[] } = { command: undefined, args: [] }
/** What this run was given, as typed: what a recovery runs again, with what it lacked. */
let typed: string[] = []
/** What this run's writes had to say, for its JSON result. */
let warnings: Warning[] = []
/** The board this run reached by its URL, for a failure to name. */
let reached: string | null = null

/** The help `words` ask for: a command's page when they name one (`read`, `identity link`), or else every command. */
function help(words: readonly string[] = []): string {
  const own = Object.values(app.commands).map((command) => command.spec)
  const path = commandPath(words, [...commands, ...own])
  return path ? commandHelp(app.name, path) : rootHelp({ name: app.name, commands: own }, VERSION)
}

/** How messages name this CLI: `vb` for the standalone one, as they always have, or the app's own name. */
const named = () => (app.name === 'board' ? 'vb' : app.name)

/** The commands that take their text as an argument, where text that starts with `-` goes after `--`. */
const TEXT = new Set(['post', 'reply', 'edit', 'schedule'])

/** Parses `argv` for this run, or throws what's wrong with it. */
function parse(argv: string[]) {
  const args = withMentions(argv)
  const word = commandWord(args)
  current = { command: word, args: [] }
  const removed = removedCommand(word ?? '')
  if (removed) throw removed
  try {
    const parsed = parseAll(markAttachmentId(args))
    flags = parsed.values
    positionals = parsed.positionals.map((arg) => (arg.startsWith(MARK) ? arg.slice(MARK.length) : arg))
  } catch (error) {
    throw parseFailure(error as Error & { code?: string }, argv, word)
  }
}

/** What the parser rejected, as misuse: an unknown option (with the likeliest one meant), or an option without its value. */
function parseFailure(error: Error & { code?: string }, argv: string[], word: string | undefined): Failed {
  const option = error.message.match(/--[a-z][\w-]*/)?.[0] ?? /'(-[^' ,]+)/.exec(error.message)?.[1]
  if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && option) {
    const guess = option.startsWith('--') ? closest(option.slice(2), optionsOf(word)) : undefined
    const next: Recovery[] = [{ instruction: 'See all options', argv: [...cli(), ...(word ? [word] : []), '--help'] }]
    const at = argv.indexOf(option)
    if (word && TEXT.has(word) && at !== -1) {
      // The text goes first after the `--` there is, or a new one.
      const rest = [...argv.slice(0, at), ...argv.slice(at + 1)]
      const dash = rest.indexOf('--')
      const text = dash === -1 ? [...rest, '--', option] : [...rest.slice(0, dash + 1), option, ...rest.slice(dash + 1)]
      next.push({ instruction: 'Or, for text that starts with -, put it after --', argv: [...cli(), ...text] })
    }
    const where = `${named()}${word ? ` ${word}` : ''}`
    return usage(`Unknown option ${option} for ${where}.${guess ? ` Did you mean --${guess}?` : ''}`, { reason: 'unknown_option', next })
  }
  if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && option) return usage(`${option} needs a value.`, { reason: 'missing_value' })
  return usage(sentence(error.message))
}

/** The options `word`'s command takes, its subcommands' and the filters included, and the ones every command takes. */
function optionsOf(word: string | undefined): string[] {
  const command = [...commands, ...Object.values(app.commands).map((own) => own.spec)].find((known) => known.name === word)
  const own = command ? [command, ...(command.subcommands ?? [])].flatMap((c) => [...c.options, ...(c.filters ? filterOptions : [])]) : []
  return [...own, ...globalOptions].map((option) => option.name)
}

/** `text` as a sentence: a capital first, and a period last. */
const sentence = (text: string) => {
  const trimmed = text.trim()
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`
}

/**
 * Where a run's output goes and its files come from: the terminal and this machine's, or for
 * `vb()`, its caller's, with the board handle it runs on.
 */
export type Io = {
  write(chunk: string | Uint8Array): void
  error(chunk: string): void
  /** A file's bytes, for `--attach`; null when there's no such file. */
  readFile(path: string): Promise<Uint8Array | null>
  /** Saves a file, for `download`. */
  writeFile(path: string, data: Uint8Array): Promise<void>
  /** What `-` reads. */
  stdin(): Promise<string>
  /** Stops `tail` and `wait`; without one, Ctrl-C does. */
  signal?: AbortSignal
  /** The handle to run on, in place of the one the environment and `--url` find. */
  board?: Board
  /** Whether a person reads it at a terminal: JSON is indented there. */
  tty?: boolean
}

const TERMINAL: Io = {
  write: (chunk) => void process.stdout.write(chunk),
  error: (chunk) => void process.stderr.write(chunk),
  async readFile(path) {
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) return null
    if (info.size > DIRECT_UPLOAD_BYTES_MAX) throw tooLarge(path)
    return new Uint8Array(await readFile(path))
  },
  writeFile: (path, data) => writeFile(path, data),
  stdin: readStdin,
  tty: process.stdout.isTTY === true,
}
let io: Io = TERMINAL

// What a person reads can't drive their terminal; what a program reads is byte for byte what the board said.
const out = (text: string) => io.write(`${terminalText(text)}\n`)
/** `--json`'s result: one document, with what the run's writes warned about, indented at a terminal. */
const result = (value: object) => io.write(`${JSON.stringify(warnings.length ? { ...value, warnings } : value, null, io.tty ? 2 : undefined)}\n`)
/** One line of a JSON stream (`tail`, `identity link`): compact, wherever it goes. */
const line = (value: object) => io.write(`${JSON.stringify(value)}\n`)

/** A message's ID as you'd write it: `#812` or `812`. It's passed to the board as it is. */
function messageId(value: string | undefined, what = 'message ID'): string {
  const id = value?.replace(/^#/, '') ?? ''
  if (value === undefined) throw usage(`Missing the ${what}.`, { reason: 'missing_arguments' })
  if (!/^[^\s/]+$/.test(id)) throw usage(`${value} isn't a ${what}.`)
  return id
}

/** A file over what a direct upload takes. */
const tooLarge = (path: string) =>
  new Failed({ class: 'limit', reason: 'payload_too_large', message: `Can't attach ${path}. It's over ${DIRECT_UPLOAD_BYTES_MAX / 1024 / 1024} MB, the most an attachment can be.` })

/** Whether an argument names a message rather than a channel: `#<id>`, or a bare number. */
const isMessageRef = (value: string) => /^#[^\s/]+$/.test(value) || /^\d+$/.test(value)

/** A message's ID as it's passed back: bare when it's a number, `#<id>` when it could be a channel's name. */
const messageRef = (id: string) => (/^\d+$/.test(id) ? id : `#${id}`)

function labelPairs(values: string[] | undefined): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const value of values ?? []) {
    const at = value.indexOf('=')
    if (at <= 0) throw usage(`Labels look like key=value, and ${value} isn't one.`)
    pairs[value.slice(0, at)] = value.slice(at + 1)
  }
  return pairs
}

async function text(value: string | undefined): Promise<string> {
  if (value === undefined) throw usage("Missing the message's text: pass it, or - to read it from stdin.", { reason: 'missing_arguments' })
  if (value !== '-') return value
  return (await io.stdin()).replace(/\n$/, '')
}


/** Uploads each `--attach` file, reading them all before sending any. */
async function attachments(board: ReturnType<typeof client>): Promise<Attachment[]> {
  const files: { path: string; data: Uint8Array }[] = []
  for (const path of flags.attach ?? []) {
    const data = await io.readFile(path)
    if (!data) throw usage(`Can't attach ${path}. There's no such file.`, { reason: 'file_not_found', next: [] })
    if (data.byteLength > DIRECT_UPLOAD_BYTES_MAX) throw tooLarge(path)
    files.push({ path, data })
  }
  const uploaded: Attachment[] = []
  for (const { path, data } of files) uploaded.push(await board.upload({ data: new Uint8Array(data), name: basename(path) }))
  return uploaded
}

/** `s12` or `12`. */
function scheduleId(value: string | undefined): string {
  const id = value?.replace(/^s(?=\d)/i, '') ?? ''
  if (value === undefined) throw usage('Missing the schedule ID, like s12.', { reason: 'missing_arguments' })
  if (!/^[^\s/]+$/.test(id)) throw usage(`${value} isn't a schedule ID like s12.`)
  return id
}

/** A time flag: anything `Date` reads, as ISO. */
function instant(flag: string, value: string): string {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) throw usage(`--${flag} takes a time like 2026-10-08T09:00:00Z, and ${value} isn't one.`)
  return time.toISOString()
}

function filters(channel?: string): Filters & { after?: string } {
  return {
    ...(channel ? { channel } : {}),
    ...(flags.re ? { re: messageId(flags.re) } : {}),
    ...(flags.by ? { by: flags.by.replace(/^@/, '') } : {}),
    ...(flags.mentions ? { mentions: flags.mentions.replace(/^@/, '') } : {}),
    ...(flags.label?.length ? { label: flags.label } : {}),
    ...(flags.from ? { from: flags.from } : {}),
    ...(flags.text ? { text: flags.text } : {}),
    ...(flags.after !== undefined ? { after: flags.after.replace(/^#/, '') } : {}),
  }
}

/**
 * The board the environment points at. With none, the team's board for an app that has one
 * (null), or else how to point at one, with the commands this app has.
 */
function configuredUrl(): string | null {
  try {
    return boardUrl()
  } catch (error) {
    if (!(error instanceof BoardError) || error.code !== 'no_board') throw error
    // In a Vercel project, its team's board.
    if (app.teamBoard || process.env.VERCEL_ORG_ID || vercelProjectFile()) return null
    throw new Failed({
      class: 'missing_input',
      reason: 'missing_scope',
      actionRequired: true,
      message: "No board to use. Nothing sets one, and this directory isn't in a Vercel project.",
      next: [
        { instruction: "Use a team's board", argv: rerun('--scope', '<TEAM>') },
        { instruction: 'Or a board at a URL', argv: rerun('--url', '<URL>') },
      ],
    })
  }
}

/** A board that predates what this run asked of it. */
const outdated = (message: string) =>
  new Failed({
    class: 'platform',
    reason: 'board_outdated',
    message: `${message} It's older than this CLI.`,
    next: [{ instruction: 'Update @vercel/board where the board is deployed' }],
  })

/** A message ID as a failure names it: `#812`. */
const ref = (value: string | undefined) => (value === undefined ? 'a message' : `#${value.replace(/^#/, '')}`)

/** What this run was doing, as a failure's headline says it: `post to dev`, `reply to #812`. */
function doing(): string {
  const { command, args } = current
  const [a, b, c] = args
  const message = a !== undefined && isMessageRef(a)
  switch (command) {
    case 'read':
      return a === undefined ? 'read the board' : /^https?:\/\//i.test(a) ? 'read that link' : `read ${message ? ref(a) : a}`
    case 'post':
      return message ? `reply to ${ref(a)}` : `post to ${a ?? 'a channel'}`
    case 'reply':
      return `reply to ${ref(a)}`
    case 'edit':
    case 'delete':
    case 'label':
      return `${command} ${ref(a)}`
    case 'react':
      return `react to ${ref(a)}`
    case 'typing':
      return `show typing in ${ref(a)}`
    case 'sync':
      return b === undefined ? `list where ${ref(a)} is synced` : `sync ${ref(a)} with ${b}`
    case 'schedule':
      return a === 'cancel' ? `cancel schedule ${b}` : `schedule a message in ${message ? ref(a) : (a ?? 'a channel')}`
    case 'schedules':
    case 'channels':
    case 'actors':
      return `list ${command}`
    case 'sources':
      return b === undefined ? 'list sources' : `${b} ${c ?? 'it'} on ${a}`
    case 'identity':
      return a === 'link' ? `link your account on ${b}` : a === 'unlink' ? `unlink ${b}` : 'list your linked accounts'
    case 'download':
      return `download ${a ?? 'the attachment'}`
    case 'inbox':
      return `read ${a}'s inbox`
    case 'tail':
      return `follow ${a ?? 'the board'}`
    case 'wait':
      return `wait on ${a ?? 'the board'}`
    case 'whoami':
      return 'reach the board'
    case 'conformance':
      return 'check the board'
    default:
      return `run ${named()}${command ? ` ${command}` : ''}`
  }
}

/** The commands whose first argument is always a message. */
const ON_MESSAGE = new Set(['reply', 'edit', 'delete', 'react', 'label', 'typing', 'sync', 'schedules'])

/** What a 404 means this run couldn't find, when its arguments name it: `message #812`. */
function missing(): string | undefined {
  const { command = '', args } = current
  const [a, b] = args
  if (a === undefined) return undefined
  if (command === 'read' && /^https?:\/\//i.test(a)) return "that link's message on this board"
  if (ON_MESSAGE.has(command) || (['read', 'post', 'schedule'].includes(command) && isMessageRef(a))) return `message ${ref(a)}`
  if (command === 'schedule' && a === 'cancel' && b !== undefined) return `schedule ${b}`
  if (command === 'download') return `attachment ${a}`
  return undefined
}

/**
 * What `error` means for this run, in the Vercel CLI's terms. Its headline and its ways out are
 * this CLI's own words, chosen by the error's code and what this machine shows: a board can name
 * any code, so its message and hint stay under the headline and in `data`, never in what to run.
 */
function failureOf(error: unknown): Failure {
  if (error instanceof Failed) return error.failure
  const message = error instanceof Error ? error.message : String(error)
  const { code, status, hint } = error as { code?: unknown; status?: unknown; hint?: unknown }
  // Not the board's or the handle's: the system's (a file it couldn't write), or a bug.
  if (typeof code !== 'string' || typeof status !== 'number')
    return { class: 'unknown', reason: 'unexpected_error', message: `Failed to ${doing()}.`, details: [message] }
  const said = { error: { code, message, status, ...(typeof hint === 'string' ? { hint } : {}) } }
  const known = (kind: Failure['class'], reason: string, headline: string, next: Recovery[] = []): Failure => ({
    class: kind, reason, message: headline, details: [message], ...(next.length ? { next } : {}), data: said,
  })
  const bypass = `set VERCEL_AUTOMATION_BYPASS_SECRET (Project → Settings → Deployment Protection → Protection Bypass for Automation)`
  const login: Recovery = { instruction: "Log in as someone on its project's team", argv: ['vercel', 'login'] }
  // What the handle raises itself, and a board may answer too.
  switch (code) {
    case 'not_logged_in':
      return { class: 'auth', reason: 'login_required', message: "You're not logged in to Vercel.", next: [{ instruction: 'Log in', argv: ['vercel', 'login'] }], data: said }
    case 'no_access':
      return known('permission', 'permission_denied', "Your Vercel login can't access the board's project.", [login, { instruction: 'Or ask for access to it.' }])
    case 'wrong_project':
      return known('permission', 'wrong_project', "The board's host is another project's deployment, so no token is minted for it.")
    case 'protected':
      return known(
        'permission',
        'deployment_protected',
        "Can't reach the board. It's behind Vercel Deployment Protection.",
        // On Vercel, a deployment gets through by its project's trust, not a login or a secret.
        process.env.VERCEL === '1'
          ? [{ instruction: "Add this project and environment to the board project's Deployment Protection Trusted Sources." }]
          : process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? [{ instruction: `Check VERCEL_AUTOMATION_BYPASS_SECRET against Project → Settings → Deployment Protection → Protection Bypass for Automation.` }]
          : [login, { instruction: `Or ${bypass}.` }],
      )
    case 'no_project':
      return known('platform', 'no_project', "The board doesn't know its Vercel project, so there's no token to mint for it.", [{ instruction: 'Pass a token it accepts in BOARD_TOKEN.' }])
    case 'no_token':
      return known(
        'auth',
        'token_unavailable',
        "There's no token to reach the board with.",
        [
          {
            instruction: process.env.GITHUB_ACTIONS
              ? 'Give the job `permissions: id-token: write`.'
              : process.env.VERCEL === '1'
                ? 'Enable OIDC on this project, or pass a token the board accepts in BOARD_TOKEN.'
                : 'Pass a token it accepts in BOARD_TOKEN.',
          },
        ],
      )
    case 'no_board':
      return known('not_found', 'board_not_found', reached ? `Couldn't find a board at ${reached}.` : "Couldn't find the team's board.")
    case 'too_many_redirects':
      return known('network', 'network_error', "Couldn't reach the board. It redirected too many times.")
    case 'invalid_duration':
      return known('usage', 'invalid_arguments', '--timeout takes a duration like 30s, 10m, or 1h.', [helpRecovery()])
    case 'wrong_audience':
      return known('usage', 'wrong_url', 'The board says its URL is another one.', [{ instruction: 'Pass the URL it names with --url.' }])
    case 'ambiguous_agent':
      return known('usage', 'ambiguous_agent', "Several coding agents' environments are set, so it can't tell which one is writing.", [
        { instruction: 'Write as one of them', argv: rerun('--as', '<PROFILE>') },
        { instruction: 'Or as yourself', argv: rerun('--human') },
      ])
    case 'too_large':
      return known('limit', 'payload_too_large', `Can't ${doing()}. It's too large.`)
    case 'upload_failed':
      return known('platform', 'upload_failed', `Failed to ${doing()}.`)
    case 'port_taken':
      return known('conflict', 'port_taken', `Can't ${doing()}. Its port is taken.`, [{ instruction: 'Pick another port', argv: [...cli(), current.command ?? 'serve', '--port', '<PORT>'] }])
  }
  // The board's, said by what this run was doing, with its own words under it. Which board it was
  // matters when reaching it is what failed.
  const theirs = (kind: Failure['class'], reason: string, headline: string, next: Recovery[] = []): Failure => ({
    class: kind,
    reason,
    message: headline,
    details: [message],
    ...(reached && ['auth', 'permission', 'network', 'platform'].includes(kind) ? { context: [['Board', reached]] as [string, string][] } : {}),
    ...(next.length ? { next } : {}),
    data: said,
  })
  const specific = (fallback: string) => (/^[a-z]+(_[a-z]+)+$/.test(code) && code !== 'invalid_request' && code !== 'remote_error' ? code : fallback)
  // What the board said is what to fix: an ambiguous mention names whom it could be.
  if (status === 400) return theirs('usage', specific('invalid_arguments'), `Can't ${doing()}.`)
  if (status === 401)
    return theirs('auth', 'login_required', "The board didn't accept your credentials.", [{ instruction: 'Log in again', argv: ['vercel', 'login'] }])
  if (status === 403) return theirs('permission', 'permission_denied', `You can't ${doing()}.`)
  if (status === 404) {
    const thing = missing()
    // What it names says it, and the board's "message not found: 812" says no more.
    return thing ? { ...theirs('not_found', specific('not_found'), `Couldn't find ${thing}.`), details: [] } : theirs('not_found', specific('not_found'), `Can't ${doing()}.`)
  }
  if (status === 409) return theirs('conflict', specific('conflict'), `Can't ${doing()}.`)
  if (status === 413) return theirs('limit', 'payload_too_large', `Can't ${doing()}. It's too large for the board.`)
  if (status === 429) return theirs('rate_limit', 'rate_limited', 'Too many requests to the board. Try again in a minute.')
  if (status === 501) return theirs('platform', specific('not_supported'), `Can't ${doing()}. This board doesn't support it.`)
  if (code === 'unreachable') return theirs('network', 'network_error', "Couldn't reach the board.")
  return theirs('platform', 'api_error', `Failed to ${doing()}.`)
}

/** How this run ends with `failure`: shown on stderr, or by the app, and its exit code. */
function report(failure: Failure, json: boolean): number {
  if (app.onError) app.onError(failure, { json })
  else if (json) io.error(`${JSON.stringify(failureDocument(failure))}\n`)
  else io.error(`${terminalText(formatFailure(failure))}\n`)
  return exitCode(failure)
}

/**
 * A team's board in Vercel's API, by the URL its discovery names it with
 * (`https://api.vercel.com/v1/messageboard/boards/<board>?teamId=<team>`): its board and team.
 */
function vercelBoard(url: string): { board: string; team?: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const found = /^\/v1\/messageboard\/boards\/([^/]+)\/?$/.exec(parsed.pathname)
  if (parsed.origin !== 'https://api.vercel.com' || !found) return null
  const team = parsed.searchParams.get('teamId')
  return { board: decodeURIComponent(found[1]!), ...(team ? { team } : {}) }
}

/** Who the handle writes as: `--as`'s profile (with `--avatar`), yourself with `--human`, or what the environment says. */
function profileFlag(): ProfileOption | undefined {
  if (flags.human) return null
  if (!flags.as) return undefined
  return flags.avatar ? { name: flags.as, avatar: flags.avatar } : flags.as
}

/**
 * The board this command talks to, as `--as` says: a handle on it, where it is (null until its
 * discovery says, for a team's board), and how it reaches it. It's `--url`'s; a team's board in
 * Vercel's API for `--scope` or `--team`; the one the environment points at; or the team's board
 * of the Vercel project it runs in, or, for an app with a team board, your login's.
 */
function connection(url: string | undefined = flags.url, options: { token?: string; handle?: string | undefined } = {}) {
  const profile = profileFlag()
  const team = flags.scope ?? flags.team
  const configured = url ?? (team === undefined ? configuredUrl() : null)
  if (configured === null) {
    const board = boardAt({ backend: vercel(team !== undefined ? { team } : {}) })
    return { url: null, transport: { source: credentialSource }, board: profile !== undefined ? board.as(profile) : board }
  }
  const at = configured.replace(/\/+$/, '')
  reached = at
  // A team's board in Vercel's API (what `whoami` prints for one) is reached through the API, as `--scope` is.
  const onVercel = vercelBoard(at)
  if (onVercel) {
    const board = boardAt({ backend: vercel(onVercel) })
    return { url: at as string | null, transport: { source: credentialSource }, board: profile !== undefined ? board.as(profile) : board }
  }
  const handle = options.handle ?? flags.handle
  const transport = connect(at, { ...(options.token !== undefined ? { token: options.token } : {}), ...(handle ? { handle } : {}) })
  const board = boardAt({ backend: http(at, { fetch: transport.fetch }) })
  return { url: at as string | null, transport: transport as { source(): string | null }, board: profile !== undefined ? board.as(profile) : board }
}

/** A handle on the board this command talks to: `vb()`'s, as `--as` says, or the one `connection()` finds. */
function client(): Board {
  if (!io.board) return connection().board
  if (flags.human) return io.board.as(null)
  if (flags.as) return io.board.as(flags.avatar ? { name: flags.as, avatar: flags.avatar } : flags.as)
  return io.board
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function hookAgents(names: string[]): HookAgent[] {
  const known = Object.keys(AGENTS) as HookAgent[]
  for (const name of names)
    if (!known.includes(name as HookAgent)) throw usage(`Unknown agent ${name}. The agents are ${known.join(', ')}.`)
  return names.length ? (names as HookAgent[]) : known
}

/** Says what a write that went through had to say: in its JSON result with `--json`, on stderr otherwise. */
function warn(warning: Warning) {
  if (flags.json) warnings.push(warning)
  else if (app.onWarning) app.onWarning(warning)
  else io.error(`${terminalText(`warning: ${warning.message}`)}\n`)
}

/** A write went through, but some handles in it matched no one: they stayed plain text. */
function warnUnknownMentions(handles: string[] | undefined) {
  if (!handles?.length) return
  const names = handles.map((handle) => `@${handle}`)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  const one = names.length === 1
  warn({
    reason: 'unknown_mention',
    message: `${list} ${one ? 'matches' : 'match'} no one on the board, so ${one ? 'it stays' : 'they stay'} plain text and ${one ? 'notifies' : 'notify'} no one.`,
  })
}

/** A post or reply: its ID, or with `--json`, the message. */
function printMessage(message: MessageView) {
  if (flags.json) result({ message, outcome: 'posted' })
  else out(messageRef(message.id))
}

/** A write that answers nothing but that it went through: with `--json`, which message, and what happened to it. */
function printDone(id: string, outcome: string) {
  if (flags.json) result({ message: { id }, outcome })
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

function portFlag(): number | undefined {
  const port = flags.port === undefined ? undefined : Number(flags.port)
  if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535))
    throw usage(`${flags.port} isn't a port.`, { reason: 'invalid_port' })
  return port
}

/** How long `identity link` waits for the sign-in or the code. */
const LINK_WAIT_MS = 10 * 60_000

async function identity(args: string[]): Promise<number> {
  const board = client()
  const [sub, target] = args
  if (sub === undefined) {
    const view = await board.identity()
    if (flags.json) return result(view), 0
    if (view.links.length === 0) out('no linked accounts')
    for (const link of view.links) out(`${link.handle ? `@${link.handle}  ` : ''}${link.actor}  by ${link.method === 'code' ? 'code' : 'sign-in'} · ${link.at}`)
    if (view.unlinked?.length) out(`not linked  ${view.unlinked.join(', ')}  (${named()} identity link <key>)`)
    return 0
  }
  if (sub === 'unlink') {
    if (!target) throw usage(`Missing the account to unlink: a handle or actor ID from \`${named()} identity\`.`, { reason: 'missing_arguments' })
    if (args.length !== 2) throw usage('identity unlink takes one account.')
    const unlinked = await board.unlinkAccount(target)
    if (flags.json) result({ ...unlinked, outcome: 'unlinked' })
    else out(`unlinked ${unlinked.actor}`)
    return 0
  }
  if (sub !== 'link') throw usage(`Unknown command ${sub} for ${named()} identity.`, { reason: 'unknown_command' })
  if (!target) throw usage('Missing the sync entry to link your account on, such as slack.', { reason: 'missing_arguments' })
  if (args.length !== 2) throw usage('identity link takes one sync entry.')
  const before = new Set((await board.identity()).links.map((link) => `${link.actor}|${link.at}`))
  // The entry's platform, as the board lists it: what the code is posted from, or the sign-in is for.
  const platform = (await board.discovery().catch(() => null))?.sync.find((entry) => entry.key === target)?.platform ?? target
  const { code, expiresAt, signIn } = await board.syncCode(target)
  const consent = signIn !== undefined && !flags.code
  // The board says where its sign-in is, and the CLI opens it: only a web page.
  if (consent && browsable(signIn) === null)
    throw new Failed({ class: 'platform', reason: 'invalid_sign_in', message: "The board's sign-in isn't an http or https URL.", details: [JSON.stringify(signIn)], data: { signIn } })
  // A stream: the code comes first, to use while this waits, and the account it linked last.
  if (flags.json) line({ type: 'code', sync: target, platform, code, expiresAt, ...(signIn !== undefined ? { signIn } : {}) })
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
      if (flags.json) line({ type: 'linked', account: linked })
      else out(`linked ${linked.handle ? `@${linked.handle} ` : ''}(${linked.actor})`)
      return 0
    }
  }
  throw new Failed({
    class: 'timeout',
    reason: 'timeout',
    message: consent ? 'Nothing linked an account within 10 minutes.' : 'The code expired before a message carried it.',
    next: [{ instruction: 'Try again', argv: [...cli(), 'identity', 'link', target] }],
  })
}

async function run(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case undefined:
    case 'help':
      out(help(args))
      return 0

    case 'whoami': {
      const { board, url: given, transport } = connection()
      // Its discovery too, so a URL to a board that isn't there, or you can't reach, says so.
      const [me, discovered] = await Promise.all([board.me(), board.discovery()])
      const url = given ?? discovered.url
      const source = transport.source()
      if (flags.json) {
        result({ ...me, board: url, source })
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

    case 'conformance': {
      if (args.length > 0) throw usage('conformance takes no arguments: pass its channel with --channel.')
      const report = await conformance(client(), flags.channel ? { channel: flags.channel } : {})
      if (flags.json) result(report)
      else out(formatConformance(report))
      return report.ok ? 0 : 1
    }

    case 'channels': {
      const channels = await client().channels()
      if (flags.json) return result({ channels }), 0
      if (channels.length === 0) return out('no channels yet'), 0
      let group = ''
      for (const channel of channels) {
        const prefix = channel.path.includes('/') ? channel.path.slice(0, channel.path.lastIndexOf('/') + 1) : ''
        if (prefix !== group) {
          if (prefix) out(prefix)
          group = prefix
        }
        const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
        out(`${prefix ? '  ' : ''}${channel.path}  ${count(channel.threads, 'thread', 'threads')} · ${count(channel.messages, 'message', 'messages')} · last #${channel.lastIndex}`)
      }
      return 0
    }

    case 'actors': {
      const actors = await client().actors()
      if (flags.json) return result({ actors }), 0
      for (const actor of actors) out(`@${actor.handle}  ${actor.name}  ${actor.id}${actor.person ? `  → @${actor.person.handle}` : ''}`)
      return 0
    }

    case 'identity':
      return identity(args)

    case 'read': {
      const target = args[0]
      const board = client()
      // A platform's link to a message (a Slack permalink, a GitHub comment) reads the board's thread it synced.
      const link = target !== undefined && /^https?:\/\//i.test(target)
      if (target && (link || isMessageRef(target))) {
        const thread = link ? await board.linked(target) : await board.thread(messageId(target))
        // A board older than this CLI answers /links with its discovery document. Its 404 stays: a
        // current board's means the link isn't one it synced.
        if (link && !Array.isArray((thread as { replies?: unknown }).replies)) throw outdated("This board can't read links.")
        // With filters, the root and only the replies that match them.
        const narrowed = Object.keys(filters()).length > 0
        const replies = narrowed
          ? (await board.messages({ ...filters(), re: thread.message.id, limit: 500 })).messages.filter((m) => m.re !== null)
          : thread.replies
        if (flags.json) return result({ ...thread, replies }), 0
        // Reactions name people who may not have written here: look up the ones that show.
        const authors = new Set([thread.message, ...replies].map((m) => m.by.actor))
        const unnamed = reactionNames([thread.message, ...replies]).filter((id) => !authors.has(id))
        const known = unnamed.length
          ? new Map((await board.actors().catch(() => [])).filter((a) => unnamed.includes(a.id)).map((a) => [a.id, actorName(a)]))
          : new Map<string, string>()
        out(formatThreads([thread.message, ...replies], known))
        if (!narrowed) for (const schedule of thread.schedules ?? []) out(formatSchedule(schedule, { pad: '  ' }))
        return 0
      }
      const query = { ...filters(target), ...(flags.limit ? { limit: Number(flags.limit) } : {}) }
      // A board older than this CLI answers /threads with its discovery document, or a 404 under a basePath.
      const old = outdated("This board can't list threads.")
      // Only a board's own "no route" is one without the route: any other 404 says what it is.
      const page = await board.threads(query).catch((error: unknown) => {
        throw error instanceof BoardError && error.status === 404 && /^no route: /.test(error.message) ? old : error
      })
      if (!Array.isArray((page as { threads?: unknown }).threads)) throw old
      // Nothing in a channel that doesn't exist is a typo, not an empty channel.
      if (!page.threads.length && target) {
        const channels = (await board.channels()).map((c) => c.path)
        if (!channels.some((path) => path === target || path.startsWith(target.replace(/\/?$/, '/')))) {
          const guess = closest(target, channels)
          throw new Failed({
            class: 'not_found',
            reason: 'channel_not_found',
            message: `Couldn't find channel ${target}.${guess ? ` Did you mean ${guess}?` : ''}`,
            next: [{ instruction: 'See its channels', argv: [...cli(), 'channels'] }],
          })
        }
      }
      if (flags.json) return result(page), 0
      const count = `${page.threads.length} ${page.threads.length === 1 ? 'thread' : 'threads'}`
      out(`${target ?? 'all channels'} · ${count} · cursor ${page.cursor}${page.threads.length ? '\n' : ''}`)
      if (page.threads.length) out(formatThreadSummaries(page.threads, { channel: !target || target.endsWith('/') }))
      return 0
    }

    case 'post': {
      const [target, body] = args
      if (!target) throw usage('Missing the channel or message to post to.', { reason: 'missing_arguments' })
      const re = isMessageRef(target) ? messageId(target) : undefined
      if (re !== undefined && flags.sync?.length)
        throw usage("Can't use --sync on a reply. It syncs whole threads.", {
          next: [{ instruction: 'Sync the thread instead', argv: [...cli(), 'sync', re, '<TARGET>'] }],
        })
      if (flags.sync?.length && flags['no-sync']) throw usage("Can't use --sync with --no-sync.")
      const board = client()
      const content = body === undefined && flags.attach?.length ? '' : await text(body)
      const files = await attachments(board)
      const options = {
        text: content,
        ...(files.length ? { attachments: files } : {}),
        ...(flags.label?.length ? { labels: labelPairs(flags.label) } : {}),
        ...(flags.id ? { id: flags.id } : {}),
        ...(flags['no-sync'] ? { noSync: true } : {}),
      }
      const message = re === undefined
        ? await board.post(target, { ...options, ...(flags.sync?.length ? { sync: flags.sync } : {}) })
        : await board.reply(re, options)
      warnUnknownMentions(message.unknownMentions)
      printMessage(message)
      return 0
    }

    case 'reply': {
      const id = messageId(args[0])
      const board = client()
      const content = args[1] === undefined && flags.attach?.length ? '' : await text(args[1])
      const files = await attachments(board)
      const message = await board.reply(id, {
        text: content,
        ...(files.length ? { attachments: files } : {}),
        ...(flags.id ? { id: flags.id } : {}),
        ...(flags['no-sync'] ? { noSync: true } : {}),
      })
      warnUnknownMentions(message.unknownMentions)
      printMessage(message)
      return 0
    }

    case 'schedule': {
      if (args[0] === 'cancel' && args.length === 2) {
        const { schedule, canceled } = await client().cancelSchedule(scheduleId(args[1]))
        if (flags.json) result({ schedule, outcome: canceled ? 'canceled' : 'unchanged' })
        else out(canceled ? `canceled s${schedule.id}` : `s${schedule.id} is already ${schedule.state}`)
        return 0
      }
      const [target, body] = args
      if (!target) throw usage('Missing the channel or message to schedule a message in.', { reason: 'missing_arguments' })
      if (!flags.in && !flags.at && !flags.every) throw usage("Can't schedule a message without a time: pass --in 1d, --at <time>, or --every 30m.", { reason: 'missing_arguments' })
      if (flags.sync?.length) throw usage("Can't use --sync with schedule. A schedule posts where you point it.")
      const times = flags.times === undefined ? undefined : Number(flags.times)
      if (times !== undefined && !(Number.isInteger(times) && times > 0)) throw usage(`--times takes a count, and ${flags.times} isn't one.`)
      const board = client()
      const content = body === undefined && flags.attach?.length ? '' : await text(body)
      const files = await attachments(board)
      const where = isMessageRef(target) ? { re: messageId(target) } : target
      const schedule = await board.schedule(where, {
        text: content,
        ...(files.length ? { attachments: files } : {}),
        ...(flags.label?.length ? { labels: labelPairs(flags.label) } : {}),
        ...(flags['no-sync'] ? { noSync: true } : {}),
        ...(flags.in ? { in: flags.in } : {}),
        ...(flags.at ? { at: instant('at', flags.at) } : {}),
        ...(flags.every ? { every: flags.every } : {}),
        ...(flags.until ? { until: instant('until', flags.until) } : {}),
        ...(flags.for ? { for: flags.for } : {}),
        ...(times !== undefined ? { times } : {}),
      })
      warnUnknownMentions(schedule.unknownMentions)
      if (flags.json) result({ schedule, outcome: 'scheduled' })
      else out(formatSchedule(schedule))
      return 0
    }

    case 'schedules': {
      const list = await client().schedules({
        ...(args[0] ? { re: messageId(args[0]) } : {}),
        ...(flags.by ? { by: flags.by.replace(/^@/, '') } : {}),
        ...(flags.channel ? { channel: flags.channel } : {}),
        ...(flags.all ? { all: true } : {}),
      })
      if (flags.json) return result({ schedules: list }), 0
      if (list.length === 0) return out(flags.all ? 'no schedules' : 'no pending schedules'), 0
      out(list.map((schedule) => formatSchedule(schedule)).join('\n'))
      return 0
    }

    case 'hooks': {
      const [action, ...names] = args
      if (action !== 'uninstall')
        throw usage(`\`${`${named()} hooks ${action ?? ''}`.trimEnd()}\` is gone. Turn-end hooks were removed.`, {
          reason: 'unknown_command',
          next: [{ instruction: 'Clear an earlier install', argv: [...cli(), 'hooks', 'uninstall'] }],
        })
      const agents = hookAgents(names)
      const width = Math.max(...agents.map((agent) => AGENTS[agent].name.length))
      const hooks: { agent: string; outcome: string; file: string | null }[] = []
      for (const agent of agents) {
        const installed = installedHook(agent)
        const by = installed ? cliOf(installed) : null
        const rules = by ? allowRules(agent, by) : null
        if (rules) disallow(rules.file, rules.rules)
        const removed = uninstallHook(agent)
        hooks.push({ agent, outcome: removed ? 'removed' : 'unchanged', file: installed ? AGENTS[agent].file() : null })
        if (!flags.json) out([AGENTS[agent].name.padEnd(width), removed ? 'removed' : 'not installed', installed ? tilde(AGENTS[agent].file()) : ''].join('  ').trimEnd())
      }
      if (flags.json) result({ hooks })
      return 0
    }

    // What an earlier board's turn-end hook still runs: it does nothing, so those turns end as they would without it.
    // `hooks uninstall` clears it.
    case 'hook':
      return 0

    case 'edit': {
      const id = messageId(args[0])
      const { unknownMentions } = await client().edit(id, await text(args[1]))
      warnUnknownMentions(unknownMentions)
      printDone(id, 'edited')
      return 0
    }

    case 'delete': {
      const id = messageId(args[0])
      await client().delete(id)
      printDone(id, 'deleted')
      return 0
    }

    case 'react': {
      const id = messageId(args[0])
      if (!args[1]) throw usage('Missing the emoji to react with, like eyes or thumbs_up.', { reason: 'missing_arguments' })
      let emoji: string
      try {
        emoji = normalizeEmoji(args[1])
      } catch {
        throw usage(`Unknown emoji ${args[1]}. Use a short name, like eyes or thumbs_up.`)
      }
      await client().react(id, emoji, flags.remove ? { remove: true } : {})
      printDone(id, flags.remove ? 'unreacted' : 'reacted')
      return 0
    }

    case 'label': {
      const id = messageId(args[0])
      const set = labelPairs(args.slice(1))
      const unset = flags.unset ?? []
      if (Object.keys(set).length === 0 && unset.length === 0)
        throw usage('Missing the labels: k=v to set one, --unset k to remove one.', { reason: 'missing_arguments' })
      await client().label(id, { set, unset })
      printDone(id, 'labeled')
      return 0
    }

    case 'typing': {
      const id = messageId(args[0])
      const status = args.slice(1).join(' ').trim()
      const targets = await client().typing(id, status || undefined)
      if (flags.json) result({ targets })
      return 0
    }

    case 'sync': {
      const id = messageId(args[0])
      if (!args[1]) {
        const { targets } = await client().sync(id)
        if (flags.json) return result({ targets }), 0
        out(targets.length ? formatSynced(targets) : 'not synced anywhere')
        return 0
      }
      const synced = await client().sync(id, args[1])
      if (flags.json) result({ ...synced, outcome: synced.attached ? 'synced' : 'unchanged' })
      else out(synced.attached ? `synced with ${synced.target}` : `already synced with ${synced.target}`)
      return 0
    }

    case 'download': {
      const id = args[0]
      if (!id) throw usage(`Missing the attachment to download: the ID \`${named()} read\` shows on a file line.`, { reason: 'missing_arguments' })
      const response = await client().download(id)
      const data = new Uint8Array(await response.arrayBuffer())
      if (args[1] === '-') return io.write(data), 0
      const disposition = response.headers.get('content-disposition') ?? ''
      const filename = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1]
      const path = args[1] ?? basename(filename ? decodeURIComponent(filename) : id)
      await io.writeFile(path, data)
      if (flags.json) result({ attachment: { id }, path, outcome: 'downloaded' })
      else out(path)
      return 0
    }

    case 'inbox': {
      const key = args[0]
      if (!key) throw usage('Missing the sync entry whose inbox to read, such as slack.', { reason: 'missing_arguments' })
      const events = await client().inbox(key, {
        ...(args[1] ? { channel: args[1] } : {}),
        ...(flags.limit ? { limit: Number(flags.limit) } : {}),
      })
      if (flags.json) return result({ events }), 0
      if (events.length === 0) return out('no events'), 0
      for (const entry of events) {
        const event = entry.event as { kind: string; thread: string; text?: string; type?: string; emoji?: string; author?: { handle: string } }
        const detail = event.text ?? event.type ?? event.emoji ?? ''
        out(`${entry.createdAt}  ${entry.channel}  ${event.kind}  ${event.author?.handle ?? ''}  ${detail.split('\n')[0]}`)
      }
      return 0
    }

    case 'sources': {
      const [key, sub, target] = args
      if (!key) {
        const { sync } = await client().discovery()
        if (flags.json) return result({ sources: sync }), 0
        if (sync.length === 0) return out('no sources: this board has no sync configured'), 0
        for (const entry of sync) out(`${entry.key}  ${entry.platform}`)
        return 0
      }
      if (sub === 'join' && target) {
        const joined = await client().joinSource(key, target)
        if (flags.json) return result({ ...joined, outcome: joined.joined ? 'joined' : 'unchanged' }), 0
        const label = joined.name ? `#${joined.name}` : joined.channel
        return out(joined.joined ? `joined ${label}` : `already in ${label}`), 0
      }
      if (sub !== 'read' && sub !== 'join') throw usage(sub === undefined ? `Missing what to do with ${key}: read or join.` : `Unknown command ${sub} for ${named()} sources.`, { reason: sub === undefined ? 'missing_arguments' : 'unknown_command' })
      if (!target) throw usage(`Missing the channel, thread, or link to ${sub}.`, { reason: 'missing_arguments' })
      const read = await client().readSource(key, target, flags.limit ? { limit: Number(flags.limit) } : {})
      if (flags.json) return result(read), 0
      return out(formatSourceRead(key, read, Date.now(), named())), 0
    }

    case 'tail': {
      const controller = new AbortController()
      // Its handler goes when it's done: inside another CLI, the process goes on, and Ctrl-C should stop it.
      const stop = stopOn(controller)
      try {
        for await (const event of client().events(
          { ...filters(args[0]), ...(flags.all ? { all: true } : {}) },
          { signal: controller.signal },
        ))
          if (flags.json) line(event)
          else out(formatEvent(event))
      } finally {
        stop.release()
      }
      // Ctrl-C is a cancel; the caller's signal is how `vb()` ends a tail.
      return stop.interrupted() ? 130 : 0
    }

    case 'wait': {
      const controller = new AbortController()
      const stop = stopOn(controller)
      const timeout = flags.timeout ?? '30m'
      const event = await client()
        .wait(filters(args[0]), { timeout, signal: controller.signal })
        .finally(stop.release)
      if (!event) {
        // Stopped, it says nothing, and answers as `tail` does: whoever stopped it knows.
        if (controller.signal.aborted) return stop.interrupted() ? 130 : 0
        throw new Failed({ class: 'timeout', reason: 'timeout', message: `Nothing matched within ${timeout}.` })
      }
      if (flags.json) result({ event })
      else out(formatEvent(event))
      return 0
    }

    default: {
      const own = app.commands[command]
      if (own) return own.run(args, context())
      const names = [...commands.flatMap((known) => [known.name, ...(known.aliases ?? [])]), ...Object.keys(app.commands)]
      const guess = closest(command, names)
      throw usage(`Unknown command ${command} for ${named()}.${guess ? ` Did you mean ${guess}?` : ''}`, {
        reason: 'unknown_command',
        next: [{ instruction: 'See all commands', argv: [...cli(), '--help'] }],
      })
    }
  }
}


/**
 * Aborts `controller` on the run's signal, or Ctrl-C without one. `release` stops listening, and
 * `interrupted` says whether Ctrl-C stopped it.
 */
function stopOn(controller: AbortController): { release: () => void; interrupted: () => boolean } {
  const stop = () => controller.abort()
  if (io.signal) {
    if (io.signal.aborted) stop()
    io.signal.addEventListener('abort', stop, { once: true })
    const signal = io.signal
    return { release: () => signal.removeEventListener('abort', stop), interrupted: () => false }
  }
  process.once('SIGINT', stop)
  return { release: () => process.off('SIGINT', stop), interrupted: () => controller.signal.aborted }
}

/** What a command an app adds gets: this run's flags, and the helpers board's own commands use. */
const context = (): CommandContext => ({
  flags,
  out,
  usage: (message) => usage(message),
  portFlag,
  connection,
  client,
  openBrowser,
})

/**
 * Runs board's CLI on `argv` (what follows the command name) as `app`, and answers its exit
 * code: 0 success, 1 error, 2 misuse, 124 when `wait` times out, 130 when Ctrl-C stops it. A
 * failure goes to `app.onError`, or to stderr: `error: ` and what failed, then how to fix it, or
 * with `--json`, one JSON document. A long-running command (`tail`, `serve`) answers once it's
 * stopped.
 */
export async function main(argv: string[], options: App): Promise<number> {
  app = options
  typed = argv
  flags = {} as Flags
  positionals = []
  warnings = []
  reached = null
  try {
    parse(argv)
    if (flags.version) {
      if (flags.json) result({ version: VERSION })
      else out(VERSION)
      return 0
    }
    // --help is help, never the command it's on: that command's page.
    if (flags.help) {
      out(help(positionals))
      return 0
    }
    const [word, ...args] = positionals
    const command = canonical(word)
    current = { command, args }
    if (io.board) {
      if (flags.url || flags.handle)
        throw usage(`--${flags.url ? 'url' : 'handle'} doesn't apply in-process: the board handle you pass says which board and who.`, { next: [] })
      if (command !== undefined && MACHINE.has(command))
        throw usage(`${command} isn't available in-process: it's about the machine ${named()} runs on.`, { reason: 'not_available', next: [] })
    }
    return await run(command, args)
  } catch (error) {
    // Before the parser says, `--json` is whether it was typed before any `--`.
    const json = flags.json ?? argv.slice(0, argv.includes('--') ? argv.indexOf('--') : undefined).includes('--json')
    return report(failureOf(error), json)
  }
}

/** The commands about the machine the CLI runs on, not the board: none of them run in-process. */
const MACHINE = new Set(['whoami', 'identity', 'hooks', 'hook', 'serve', 'inspect'])

/** `main()` with `io` in place of the terminal, for `vb()`. One run at a time, as `main()`'s. */
export async function mainWith(argv: string[], options: App, with_: Io): Promise<number> {
  io = with_
  try {
    return await main(argv, options)
  } finally {
    io = TERMINAL
  }
}
