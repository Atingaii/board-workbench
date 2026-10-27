// `vb()`: a vb command, run in-process against a board handle, saying what the CLI would print.
// The CLI (main.ts) runs the board's commands through it too, so there's one of each.
import type { BoardEventView, MessageView } from '../api/routes.ts'
import { BoardError, type Filters } from '../client/client.ts'
import { conformance } from '../conformance/index.ts'
import { normalizeEmoji } from '../contract/emoji.ts'
import { DIRECT_UPLOAD_BYTES_MAX, type Attachment } from '../contract/schemas.ts'
import type { Board } from '../server/index.ts'
import { HELP, instant, isMessageRef, labelPairs, messageId, parse, scheduleId, UsageError, type Flags } from './args.ts'
import {
  actorName,
  formatConformance,
  formatEvent,
  formatSchedule,
  formatSourceRead,
  formatSynced,
  formatThreadSummaries,
  formatThreads,
  reactionNames,
  terminalText,
} from './format.ts'

/** Where a command's files come from and go, and what stops it. Each is optional: a command that needs one it lacks says so. */
export type VbOptions = {
  /** A file's bytes, for `--attach`; null when there's no such file. */
  readFile?: (path: string) => Promise<Uint8Array | null> | PromiseLike<Uint8Array | null>
  /** Saves a file, for `download`. */
  writeFile?: (path: string, data: Uint8Array) => Promise<void> | PromiseLike<void>
  /** The text `-` reads, as stdin would hold it. */
  stdin?: string | (() => Promise<string>)
  /** Stops `tail` and `wait`, as Ctrl-C does. */
  signal?: AbortSignal
}

/** What the command printed, and its exit code: 0, 1 for an error, 2 for a usage error, 124 when `wait` timed out. */
export type VbResult = { code: number; stdout: string; stderr: string }

/** Commands about the machine vb runs on, not the board: the CLI's alone. */
const LOCAL = new Set(['link', 'use', 'whoami', 'identity', 'hooks', 'hook', 'serve', 'inspect'])

/** How a run's output leaves it: collected for `vb()`, the terminal's for the CLI. */
export type Io = VbOptions & {
  write(chunk: string | Uint8Array): void
  error(chunk: string): void
  /** A write went through (the CLI's hooks count it as this turn's board update). */
  wrote?: () => void
}

/**
 * Runs the vb command `argv` (`['read', '42']`, `['reply', '42', 'on it']`) on `board`, as the CLI
 * would, and returns what it printed. `board` already says which board and who: `--url` and
 * `--handle` don't apply, and the commands about your machine (`link`, `whoami`, `serve`, …) aren't here.
 */
export async function vb(board: Board, argv: readonly string[], options: VbOptions = {}): Promise<VbResult> {
  let stdout = ''
  let stderr = ''
  const decoder = new TextDecoder()
  const code = await run(() => board, argv, {
    ...options,
    write: (chunk) => (stdout += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })),
    error: (chunk) => (stderr += chunk),
  }, { inProcess: true })
  return { code, stdout, stderr }
}

/**
 * A command on the handle `handle` gives, writing to `io`: `vb()`'s, and the CLI's for every command
 * but its local ones. `inProcess` refuses what only the CLI can do. Returns the exit code.
 */
export async function run(handle: () => Board, argv: readonly string[], io: Io, { inProcess = false } = {}): Promise<number> {
  let flags: Flags
  let positionals: string[]
  try {
    ;({ flags, positionals } = parse(argv))
  } catch (error) {
    io.error(terminalText(`error: ${(error as Error).message}`) + '\n')
    return 2
  }
  const [command, ...args] = positionals
  try {
    if (flags.version) throw new UsageError("--version is the CLI's: this runs the board's commands")
    if (inProcess) {
      if (flags.url || flags.handle) throw new UsageError(`--${flags.url ? 'url' : 'handle'} doesn't apply: the board handle you pass says which board and who`)
      if (command !== undefined && LOCAL.has(command)) throw new UsageError(`${command} isn't available in-process: it's about the machine vb runs on`)
    }
    return await commands(command, args)
  } catch (error) {
    // A board's error says what the board said: it can't drive the terminal either.
    io.error(`${terminalText(`error: ${(error as Error).message}`)}\n`)
    return error instanceof UsageError ? 2 : 1
  }

  // What a person reads can't drive their terminal; what a program reads is byte for byte what the board said.
  function out(text: string) {
    io.write(`${terminalText(text)}\n`)
  }
  function printJson(value: unknown) {
    io.write(`${JSON.stringify(value)}\n`)
  }

  /** The handle, as `--as`, `--avatar`, and `--human` say (the CLI's own handle already is). */
  function client(): Board {
    const board = handle()
    if (!inProcess) return board
    if (flags.human) return board.as(null)
    if (flags.as) return board.as(flags.avatar ? { name: flags.as, avatar: flags.avatar } : flags.as)
    return board
  }

  function wrote() {
    io.wrote?.()
  }

  async function text(value: string | undefined): Promise<string> {
    if (value === undefined) throw new UsageError('missing message text')
    if (value !== '-') return value
    if (io.stdin === undefined) throw new UsageError('- reads text from stdin, and there is none here: pass the text')
    const read = typeof io.stdin === 'string' ? io.stdin : await io.stdin()
    return read.replace(/\n$/, '')
  }

  /** Uploads each `--attach` file, reading them all before sending any. */
  async function attachments(board: Board): Promise<Attachment[]> {
    const paths = flags.attach ?? []
    if (paths.length && !io.readFile) throw new UsageError('--attach reads files, and there are none here: pass readFile')
    const files: { name: string; data: Uint8Array }[] = []
    for (const path of paths) {
      const data = await io.readFile!(path)
      if (!data) throw new UsageError(`no such file: ${path}`)
      if (data.byteLength > DIRECT_UPLOAD_BYTES_MAX) throw new UsageError(`${path} is over ${DIRECT_UPLOAD_BYTES_MAX / 1024 / 1024} MB, the most an attachment can be`)
      files.push({ name: basename(path), data })
    }
    const uploaded: Attachment[] = []
    for (const { name, data } of files) uploaded.push(await board.upload({ data: new Uint8Array(data), name }))
    return uploaded
  }

  async function writeFile(path: string, data: Uint8Array) {
    if (!io.writeFile) throw new UsageError('download saves files, and there is nowhere here: pass writeFile, or - for stdout')
    await io.writeFile(path, data)
  }

  /** Aborts on the run's signal (the CLI's: Ctrl-C). */
  function abortable() {
    const controller = new AbortController()
    if (io.signal?.aborted) controller.abort()
    else io.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    return controller
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

  /** A write went through, but some handles in it matched no one: they stayed plain text. */
  function warnUnknownMentions(handles: string[] | undefined) {
    if (!handles?.length) return
    const names = handles.map((handle) => `@${handle}`)
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    const one = names.length === 1
    io.error(terminalText(`warning: ${list} ${one ? 'matches' : 'match'} no one on the board, so ${one ? 'it stays' : 'they stay'} plain text and ${one ? 'notifies' : 'notify'} no one`) + '\n')
  }

  function printMessage(message: MessageView) {
    if (flags.json) printJson(message)
    else out(String(message.id))
  }

  function printEvent(event: BoardEventView) {
    if (flags.json) printJson(event)
    else out(formatEvent(event))
  }

  async function commands(command: string | undefined, args: string[]): Promise<number> {
    switch (command) {
      case undefined:
      case 'help':
        out(HELP)
        return 0

      case 'conformance': {
        if (args.length > 0) throw new UsageError('usage: board conformance [--channel <c>]')
        const report = await conformance(client(), flags.channel ? { channel: flags.channel } : {})
        if (flags.json) printJson(report)
        else out(formatConformance(report))
        return report.ok ? 0 : 1
      }

      case 'channels': {
        const channels = await client().channels()
        if (flags.json) return channels.forEach(printJson), 0
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
        if (flags.json) return actors.forEach(printJson), 0
        for (const actor of actors) out(`@${actor.handle}  ${actor.name}  ${actor.id}${actor.person ? `  → @${actor.person.handle}` : ''}`)
        return 0
      }

      case 'read': {
        const target = args[0]
        const board = client()
        // A platform's link to a message (a Slack permalink, a GitHub comment) reads the board's thread it synced.
        const link = target !== undefined && /^https?:\/\//i.test(target)
        if (target && (link || isMessageRef(target))) {
          const thread = link ? await board.linked(target) : await board.thread(messageId(target))
          // A board older than this CLI answers /links with its discovery document. Its 404 stays: a
          // current board's means the link isn't one it synced.
          if (link && !Array.isArray((thread as { replies?: unknown }).replies))
            throw new Error("this board can't read links: update board where the board is deployed")
          // With filters, the root and only the replies that match them.
          const narrowed = Object.keys(filters()).length > 0
          const replies = narrowed
            ? (await board.messages({ ...filters(), re: thread.message.id, limit: 500 })).messages.filter((m) => m.re !== null)
            : thread.replies
          if (flags.json) return [thread.message, ...replies].forEach(printJson), 0
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
        const old = new Error("this board can't list threads: update board where the board is deployed")
        const page = await board.threads(query).catch((error: unknown) => {
          throw error instanceof BoardError && error.status === 404 ? old : error
        })
        if (!Array.isArray((page as { threads?: unknown }).threads)) throw old
        // Nothing in a channel that doesn't exist is a typo, not an empty channel.
        if (!page.threads.length && target && !(await board.channels()).some((c) => c.path === target || c.path.startsWith(target.replace(/\/?$/, '/'))))
          throw new Error(`no channel ${target}: board channels lists them`)
        if (flags.json) return page.threads.forEach(printJson), 0
        const count = `${page.threads.length} ${page.threads.length === 1 ? 'thread' : 'threads'}`
        out(`${target ?? 'all channels'} · ${count} · cursor ${page.cursor}${page.threads.length ? '\n' : ''}`)
        if (page.threads.length) out(formatThreadSummaries(page.threads, { channel: !target || target.endsWith('/') }))
        return 0
      }

      case 'post': {
        const [target, body] = args
        if (!target) throw new UsageError('usage: board post <channel|id> "<text>"')
        const re = isMessageRef(target) ? messageId(target) : undefined
        if (re !== undefined && flags.sync?.length) throw new UsageError('--sync attaches whole threads: post to a channel, or use vb sync <id> <target>')
        if (flags.sync?.length && flags['no-sync']) throw new UsageError('--sync and --no-sync contradict each other')
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
        wrote()
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
        wrote()
        warnUnknownMentions(message.unknownMentions)
        printMessage(message)
        return 0
      }

      case 'schedule': {
        if (args[0] === 'cancel' && args.length === 2) {
          const { schedule, canceled } = await client().cancelSchedule(scheduleId(args[1]))
          if (flags.json) printJson(schedule)
          else out(canceled ? `canceled s${schedule.id}` : `s${schedule.id} is already ${schedule.state}`)
          return 0
        }
        const [target, body] = args
        if (!target) throw new UsageError('usage: board schedule <channel|id> "<text>" (--in 1d | --at <time> | --every 30m)')
        if (!flags.in && !flags.at && !flags.every) throw new UsageError('say when: --in 1d, --at <time>, or --every 30m')
        if (flags.sync?.length) throw new UsageError('a schedule posts where you point it: --sync is for post')
        const times = flags.times === undefined ? undefined : Number(flags.times)
        if (times !== undefined && !(Number.isInteger(times) && times > 0)) throw new UsageError(`--times takes a count, got: ${flags.times}`)
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
        wrote()
        warnUnknownMentions(schedule.unknownMentions)
        if (flags.json) printJson(schedule)
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
        if (flags.json) return list.forEach(printJson), 0
        if (list.length === 0) return out(flags.all ? 'no schedules' : 'no pending schedules'), 0
        out(list.map((schedule) => formatSchedule(schedule)).join('\n'))
        return 0
      }

      case 'edit': {
        const { unknownMentions } = await client().edit(messageId(args[0]), await text(args[1]))
        warnUnknownMentions(unknownMentions)
        return 0
      }

      case 'delete': {
        await client().delete(messageId(args[0]))
        return 0
      }

      case 'react': {
        const id = messageId(args[0])
        if (!args[1]) throw new UsageError('usage: board react <id> <emoji> [--remove]')
        let emoji: string
        try {
          emoji = normalizeEmoji(args[1])
        } catch (error) {
          throw new UsageError((error as Error).message)
        }
        await client().react(id, emoji, flags.remove ? { remove: true } : {})
        return 0
      }

      case 'label': {
        const id = messageId(args[0])
        const set = labelPairs(args.slice(1))
        const unset = flags.unset ?? []
        if (Object.keys(set).length === 0 && unset.length === 0)
          throw new UsageError('usage: board label <id> k=v... [--unset k]...')
        await client().label(id, { set, unset })
        return 0
      }

      case 'typing': {
        const id = messageId(args[0])
        const status = args.slice(1).join(' ').trim()
        const targets = await client().typing(id, status || undefined)
        if (flags.json) printJson({ targets })
        return 0
      }

      case 'sync': {
        const id = messageId(args[0])
        if (!args[1]) {
          const { targets } = await client().sync(id)
          if (flags.json) return targets.forEach(printJson), 0
          out(targets.length ? formatSynced(targets) : 'not synced anywhere')
          return 0
        }
        const result = await client().sync(id, args[1])
        if (flags.json) printJson(result)
        else out(result.attached ? `synced with ${result.target}` : `already synced with ${result.target}`)
        return 0
      }

      case 'download': {
        const id = args[0]
        if (!id) throw new UsageError('usage: board download <attachment> [path]   (the id `vb read` shows on a file line)')
        const response = await client().download(id)
        const data = new Uint8Array(await response.arrayBuffer())
        if (args[1] === '-') return io.write(data), 0
        const disposition = response.headers.get('content-disposition') ?? ''
        const named = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1]
        const path = args[1] ?? basename(named ? decodeURIComponent(named) : id)
        await writeFile(path, data)
        out(path)
        return 0
      }

      case 'inbox': {
        const key = args[0]
        if (!key) throw new UsageError('usage: board inbox <key> [channel] [--limit N]')
        const events = await client().inbox(key, {
          ...(args[1] ? { channel: args[1] } : {}),
          ...(flags.limit ? { limit: Number(flags.limit) } : {}),
        })
        if (flags.json) return events.forEach(printJson), 0
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
          if (flags.json) return sync.forEach(printJson), 0
          if (sync.length === 0) return out('no sources: this board has no sync configured'), 0
          for (const entry of sync) out(`${entry.key}  ${entry.platform}`)
          return 0
        }
        if (sub === 'join' && target) {
          const joined = await client().joinSource(key, target)
          if (flags.json) return printJson(joined), 0
          const label = joined.name ? `#${joined.name}` : joined.channel
          return out(joined.joined ? `joined ${label}` : `already in ${label}`), 0
        }
        if (sub !== 'read' || !target) throw new UsageError('usage: board sources <key> read <channel|thread|link> [--limit N], or sources <key> join <channel|link>')
        const read = await client().readSource(key, target, flags.limit ? { limit: Number(flags.limit) } : {})
        if (flags.json) return printJson(read), 0
        return out(formatSourceRead(key, read)), 0
      }

      case 'tail': {
        const controller = abortable()
        for await (const event of client().events(
          { ...filters(args[0]), ...(flags.all ? { all: true } : {}) },
          { signal: controller.signal },
        ))
          printEvent(event)
        return 0
      }

      case 'wait': {
        const controller = abortable()
        const event = await client().wait(filters(args[0]), {
          timeout: flags.timeout ?? '30m',
          signal: controller.signal,
        })
        if (!event) {
          if (!controller.signal.aborted) io.error('timed out\n')
          return 124
        }
        printEvent(event)
        return 0
      }

      default:
        throw new UsageError(`unknown command: ${command} (run \`board help\`)`)
    }
  }
}

/** A path's last part, `/` or `\`-separated. */
const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
