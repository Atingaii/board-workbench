// `inspect`: the inspector's page, as you, until Ctrl-C. Only the standalone `board` has it
// (`local.ts`), and loads it only when it runs, with the page it's installed with.
import { page as installed } from '../inspect/page.ts'
import { startInspector } from '../inspect/server.ts'
import { Failed, type CommandContext } from './main.ts'
import { who } from './format.ts'

/** Until Ctrl-C or a SIGTERM, whichever comes first: then neither is listened for. */
export const stopped = () =>
  new Promise<void>((resolve) => {
    const done = () => {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      resolve()
    }
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
  })

/** The page to serve, before anything starts: an install without one says so, and serves nothing. */
async function pageOf(): Promise<string> {
  const found = await installed()
  if (found === null)
    throw new Failed({
      class: 'unknown',
      reason: 'no_inspector_page',
      message: "The inspector's page isn't installed with this CLI.",
      next: [{ instruction: 'Reinstall or update the CLI' }],
    })
  return found
}

export async function inspect({ flags, out, portFlag, client, openBrowser }: CommandContext): Promise<number> {
  const port = portFlag()
  const page = await pageOf()
  const inspector = await startInspector({ client: client(), page, ...(port !== undefined ? { port } : {}) })
  out(`inspecting ${inspector.board} as ${who(inspector.me)} at ${inspector.url}  (Ctrl-C to stop)`)
  if (!flags['no-open']) openBrowser(inspector.url)
  await stopped()
  await inspector.close()
  return 0
}
