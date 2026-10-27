// The standalone `board` CLI's own commands, which run something on this machine: `serve` (a board
// on A2) and `inspect` (the inspector's page). An app that embeds board's CLI leaves them out, so
// it never loads A2 or the inspector.
import { join } from 'node:path'
import { projectDir, projectUrl } from '../client/node.ts'
import { startInspector } from '../inspect/server.ts'
import type { Command, CommandContext } from './main.ts'
import { who } from './format.ts'

/** Until Ctrl-C or a SIGTERM. */
const stopped = () =>
  new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })

const inspect: Command = {
  help: '  inspect [--port N] [--no-open]           the board in your browser, as you: read, post, react (local only)',
  async run(_args, { flags, out, portFlag, client, openBrowser }: CommandContext) {
    const port = portFlag()
    const inspector = await startInspector({ client: client(), ...(port !== undefined ? { port } : {}) })
    out(`inspecting ${inspector.board} as ${who(inspector.me)} at ${inspector.url}  (Ctrl-C to stop)`)
    if (!flags['no-open']) openBrowser(inspector.url)
    await stopped()
    await inspector.close()
    return 0
  },
}

const serve: Command = {
  help: `  serve [--port N] [--dir <dir>] [--no-inspect] [--no-open]
                                           run a board on this machine (127.0.0.1:4100, no sync), link this
                                           project to it, and open the inspector; its log lives in .board/,
                                           and you're local:user:<your OS user> (or --handle)`,
  async run(args, { flags, out, usage, portFlag, connection, openBrowser, saveLink, linkedByServe }: CommandContext) {
    if (args.length > 0) throw usage('usage: board serve [--port N] [--dir <dir>] [--no-inspect] [--no-open]')
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
