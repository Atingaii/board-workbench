// The standalone `board` CLI's own commands, which run something on this machine: `inspect`, the
// board in your browser, and `serve`, a `local()` board. An app that embeds board's CLI leaves them
// out, so it never loads the inspector or a local board.
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectDir } from '../client/node.ts'
import { startInspector } from '../inspect/server.ts'
import { option } from './commands.ts'
import { stopped } from './inspect.ts'
import type { Command, CommandContext } from './main.ts'

/** Keeps the local board's log (`.board/`) out of the project's Git. */
async function ignoreLog(root: string) {
  const path = join(root, '.gitignore')
  const ignore = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  if (!ignore.split(/\r?\n/).some((line) => /^\/?\.board\/?$/.test(line)))
    await appendFile(path, `${ignore && !ignore.endsWith('\n') ? '\n' : ''}.board/\n`)
}

const inspect: Command = {
  spec: {
    name: 'inspect',
    description: 'the board in your browser, as you: read, post, react (local only)',
    arguments: [],
    options: [option('port', 'the port to listen on (default: a free one)'), option('no-open')],
    examples: [{ name: 'open the board in your browser', value: 'inspect' }],
  },
  async run(args, context: CommandContext) {
    if (args.length > 0) throw context.usage('inspect takes no arguments: pass its port with --port.')
    // Loaded only now: the page comes with it.
    return (await import('./inspect.ts')).inspect(context)
  },
}

const serve: Command = {
  spec: {
    name: 'serve',
    description:
      "run a board on this machine (127.0.0.1:4100, no sync) and open the inspector: other commands reach it with --url or BOARD_URL. Its log lives in .board/, and you're local:user:<your OS user>",
    arguments: [],
    options: [option('port', 'the port to listen on (default: 4100)'), option('dir'), option('no-inspect'), option('no-open')],
    examples: [{ name: 'run a board here, and open it', value: 'serve' }],
  },
  async run(args, { flags, out, usage, portFlag, connection, openBrowser }: CommandContext) {
    if (args.length > 0) throw usage('serve takes no arguments: pass its port with --port, and its directory with --dir.')
    const port = portFlag()
    const root = projectDir()
    const { serveLocal } = await import('./serve.ts')
    const local = await serveLocal({
      dir: flags.dir ?? join(root, '.board'),
      ...(port !== undefined ? { port } : {}),
    })
    let inspector: Awaited<ReturnType<typeof startInspector>> | null = null
    try {
      if (!flags.dir) await ignoreLog(root)
      out(`serving a local board at ${local.url} as ${local.principal}, its log in ${local.dir}  (Ctrl-C to stop)`)
      out(`reach it with --url ${local.url}, or BOARD_URL=${local.url}`)
      if (!flags['no-inspect']) {
        // With this board's token, whatever BOARD_TOKEN says.
        const { board } = connection(local.url, { token: local.token })
        inspector = await startInspector({ client: board.as(null) })
        out(`inspector at ${inspector.url}`)
        if (!flags['no-open']) openBrowser(inspector.url)
      }
      await stopped()
    } finally {
      await inspector?.close()
      await local.close()
    }
    return 0
  },
}

/** The commands only the standalone `board` has, in the order its help lists them. */
export const local: Record<string, Command> = { inspect, serve }
