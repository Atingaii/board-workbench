// The CLI's arguments: its help, its flags, and how a command's words parse. `vb` (main.ts) and
// `vb()` (vb.ts, in-process) share them.
import { parseArgs } from 'node:util'
import { FILTER_FLAGS, withMentions } from '../api/tail.ts'
import { AttachmentId } from '../contract/schemas.ts'
import { VERSION } from '../version.ts'

export class UsageError extends Error {}

export const HELP = `board ${VERSION}: a message board you mount in one route

usage: board <command> [options]      (also installed as \`vb\`)

  whoami                                   who am I, on which board, with which token, and what I can do
  link <url>                               link this project to a board (.board/config.json)
  use <url>                                save the default board

  channels                                 channels, grouped by path prefix
  actors                                   actors and their handles
  identity                                 your linked Slack and GitHub accounts
  identity link <key> [--code] [--no-wait] link your account on sync entry <key> (e.g. slack): sign in, or post a code from it
  identity unlink <account>                unlink one, by handle or actor ID

  read [channel] [filters] [--limit N]     the latest threads, one each: root, replies, latest reply
                                           (no channel: every channel)
  read <id>                                one thread, every message (filters: the root and the replies that match)
  read <link>                              the thread a Slack or GitHub link names, if the board synced it

  post <channel|id> ["<text>"] [--label k=v]... [--attach <file>]... [--sync <target>]... [--no-sync] [--id <key>]
                                           a new thread in a channel, or with an id, a reply in its thread
  reply <id> ["<text>"] [--attach <file>]... [--id <key>] [--no-sync]
  schedule <channel|id> ["<text>"] (--in 1d | --at <time> | --every 30m) [--until <time> | --for 24h | --times N]
           [--label k=v]... [--attach <file>]... [--no-sync]
                                           post later, as you: once, or repeating until a stop or until canceled
  schedules [id] [--by <handle>] [--channel <c>] [--all]
                                           pending schedules (a thread's, with an id); --all adds done and canceled
  schedule cancel <schedule>               stop one, e.g. schedule cancel s12 (yours, or with manage)
  edit <id> "<text>"
  delete <id>
  react <id> <emoji> [--remove]
  label <id> k=v... [--unset k]...
  typing <id> [status]                     show typing in the thread's synced platform threads (marks WhatsApp read);
                                           Slack shows the status, if given, instead of "Typing…"
  sync <id>                                where the thread is synced, with this message's link on each
  sync <id> <target>                       attach the thread to e.g. slack:#incidents, backfilling it
  inbox <key> [channel] [--limit N]        raw platform events, for debugging sync
  sources                                  the board's sources (its sync entries: slack, github, …)
  sources <key> read <channel|thread|link> [--limit N]
                                           read a source's channel, thread, or message link without syncing it,
                                           e.g. sources slack read '#general', or a Slack permalink (full access only)
  sources <key> join <channel|link>        add the app to a public channel so it can be read, where the board
                                           opted in (slack({ join: true })); full access only
  download <attachment> [path]             save an attachment (its name, here, by default; - for stdout)
  conformance [--channel <c>]              check that the board speaks the protocol: posts to conformance,
                                           kept on the board, and deletes what it posted (1 if a check fails)

  hooks [install|uninstall|status] [claude|codex|cursor|pi]...
                                           after a turn that didn't update the board, remind the agent to (linked projects only)

  tail [channel] [filters] [--all]         live, until Ctrl-C
  wait [channel] [filters] [--timeout 30m] block for the next match, print it, then exit (124 on timeout)

  inspect [--port N] [--no-open]           the board in your browser, as you: read, post, react (local only)
  serve [--port N] [--dir <dir>] [--no-inspect] [--no-open]
                                           run a board on this machine (127.0.0.1:4100, no sync), link this
                                           project to it, and open the inspector; its log lives in .board/,
                                           and you're local:user:<your OS user> (or --handle)

filters:  --re <id>  --by <handle>  --from <source>  --label k[=v|w]  --text <words>  --mentions [@handle]  --after <id>
          labels match a message or its thread's root; repeated flags all must match
global:   --url <url>  --as <profile>  --avatar <url>  --human  --handle <h>  --json
json:     one object per line (JSONL): { message, replies, last } for read <channel>, a message for read <id>
text:     pass "-" to read it from stdin; it may be left out when you --attach
env:      BOARD_URL  BOARD_TOKEN  BOARD_AS  BOARD_AVATAR  BOARD_HANDLE`


export const OPTIONS = {
  ...FILTER_FLAGS,
  url: { type: 'string' },
  as: { type: 'string' },
  avatar: { type: 'string' },
  human: { type: 'boolean' },
  handle: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  unset: { type: 'string', multiple: true },
  id: { type: 'string' },
  'no-sync': { type: 'boolean' },
  sync: { type: 'string', multiple: true },
  attach: { type: 'string', multiple: true },
  channel: { type: 'string' },
  agent: { type: 'string' },
  remove: { type: 'boolean' },
  after: { type: 'string' },
  limit: { type: 'string' },
  all: { type: 'boolean' },
  timeout: { type: 'string' },
  port: { type: 'string' },
  'no-open': { type: 'boolean' },
  'no-inspect': { type: 'boolean' },
  dir: { type: 'string' },
  code: { type: 'boolean' },
  'no-wait': { type: 'boolean' },
  in: { type: 'string' },
  at: { type: 'string' },
  every: { type: 'string' },
  until: { type: 'string' },
  for: { type: 'string' },
  times: { type: 'string' },
} as const

// No argument can hold a NUL, so a marked one can't be anything else.
export const MARK = '\0'

/**
 * Attachment IDs are base64url, so boards minted some that start with `-`,
 * which `parseArgs` reads as a flag. Where `download` takes its ID, a token
 * shaped like one is the ID: this marks it to parse as a positional.
 */
export function markAttachmentId(args: string[]): string[] {
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') break
    if (!arg.startsWith('-') || arg === '-') positionals.push(arg)
    else if (positionals.length === 1 && positionals[0] === 'download' && AttachmentId.safeParse(arg).success)
      return [...args.slice(0, i), `${MARK}${arg}`, ...args.slice(i + 1)]
    else if (!arg.includes('=') && OPTIONS[arg.slice(2) as keyof typeof OPTIONS]?.type === 'string') i++
  }
  return args
}
/** Commands that are gone, and what to run instead. Their flags don't matter: an old hook's `vb update --skip` gets this too. */
export const REMOVED: Record<string, string> = {
  update: "`vb update` is gone: reply in the thread you're working in (vb reply <id>), or post where it fits (vb post <channel>)",
  stuck: '`vb stuck` is gone: a board on a2() keeps its dead letters in A2, on the backend\'s `servers`',
}

/** The command word: the first argument that isn't a flag or a string flag's value. */
export function commandWord(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') return args[i + 1]
    if (!arg.startsWith('-') || arg === '-') return arg
    if (!arg.includes('=') && OPTIONS[arg.slice(2) as keyof typeof OPTIONS]?.type === 'string') i++
  }
  return undefined
}

/** The flags and positionals in `argv`, as `vb` reads them. Throws a UsageError for a removed command or a misused flag. */
export function parse(argv: readonly string[]) {
  const args = withMentions(argv)
  const removed = REMOVED[commandWord(args) ?? '']
  if (removed) throw new UsageError(removed)
  let parsed
  try {
    parsed = parseArgs({ args: markAttachmentId(args), allowPositionals: true, options: OPTIONS })
  } catch (error) {
    const unknown = (error as { code?: string }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && /'([^']+)'/.exec((error as Error).message)?.[1]
    throw new UsageError(unknown ? `unknown option: ${unknown} (run \`board help\`; text starting with - goes after --, as in -- "${unknown}")` : (error as Error).message)
  }
  return { flags: parsed.values, positionals: parsed.positionals.map((arg) => (arg.startsWith(MARK) ? arg.slice(MARK.length) : arg)) }
}

export type Flags = ReturnType<typeof parse>['flags']

/** A message's ID as you'd write it: `#812` or `812`. It's passed to the board as it is. */
export function messageId(value: string | undefined, what = 'message id'): string {
  const id = value?.replace(/^#/, '') ?? ''
  if (!/^[^\s/]+$/.test(id)) throw new UsageError(`expected a ${what}, got: ${value ?? '(nothing)'}`)
  return id
}

/** Whether an argument names a message rather than a channel: `#<id>`, or a bare number. */
export const isMessageRef = (value: string) => /^#[^\s/]+$/.test(value) || /^\d+$/.test(value)

export function labelPairs(values: string[] | undefined): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const value of values ?? []) {
    const at = value.indexOf('=')
    if (at <= 0) throw new UsageError(`labels look like key=value, got: ${value}`)
    pairs[value.slice(0, at)] = value.slice(at + 1)
  }
  return pairs
}

/** `s12` or `12`. */
export function scheduleId(value: string | undefined): string {
  const id = value?.replace(/^s(?=\d)/i, '') ?? ''
  if (!/^[^\s/]+$/.test(id)) throw new UsageError(`expected a schedule id like s12, got: ${value ?? '(nothing)'}`)
  return id
}

/** A time flag: anything `Date` reads, as ISO. */
export function instant(flag: string, value: string): string {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) throw new UsageError(`--${flag} takes a time like 2026-10-08T09:00:00Z, got: ${value}`)
  return time.toISOString()
}
