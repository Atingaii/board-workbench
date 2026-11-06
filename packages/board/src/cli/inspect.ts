// `inspect`: the inspector's page, as you, until Ctrl-C. Every CLI that runs board's has it, and
// loads it only when it runs. Its page is the app's when it hands one (`createApp`'s
// `inspectorPage`), or else the one board is installed with.
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

/** The page to serve, before anything starts: a run that can't have one says so, and serves nothing. */
async function pageOf(provided: (() => Promise<string>) | undefined): Promise<string> {
  if (provided)
    try {
      return await provided()
    } catch (error) {
      // Not `network`: the app's likeliest other failure is a page that didn't check out, which
      // trying again doesn't fix.
      throw new Failed({ class: 'unknown', reason: 'inspector_page_unavailable', message: `Couldn't get the inspector's page: ${(error as Error).message}` })
    }
  const found = await installed()
  if (found === null)
    throw new Failed({
      class: 'unknown',
      reason: 'no_inspector_page',
      message: "The inspector's page isn't beside board's CLI.",
      next: [
        { instruction: "An app that bundles board's CLI passes it to createApp as inspectorPage" },
        { instruction: 'From source, build board first: pnpm --filter @vercel/board build' },
      ],
    })
  return found
}

export async function inspect({ flags, out, portFlag, client, openBrowser, inspectorPage }: CommandContext): Promise<number> {
  const port = portFlag()
  const page = await pageOf(inspectorPage)
  const inspector = await startInspector({ client: client(), page, ...(port !== undefined ? { port } : {}) })
  out(`inspecting ${inspector.board} as ${who(inspector.me)} at ${inspector.url}  (Ctrl-C to stop)`)
  if (!flags['no-open']) openBrowser(inspector.url)
  await stopped()
  await inspector.close()
  return 0
}
