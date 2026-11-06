// `inspect`: the inspector's page, as you, until Ctrl-C. Every CLI that runs board's has it, and
// loads it only when it runs, the page with it.
import { startInspector } from '../inspect/server.ts'
import type { CommandContext } from './main.ts'
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

export async function inspect({ flags, out, portFlag, client, openBrowser }: CommandContext): Promise<number> {
  const port = portFlag()
  const inspector = await startInspector({ client: client(), ...(port !== undefined ? { port } : {}) })
  out(`inspecting ${inspector.board} as ${who(inspector.me)} at ${inspector.url}  (Ctrl-C to stop)`)
  if (!flags['no-open']) openBrowser(inspector.url)
  await stopped()
  await inspector.close()
  return 0
}
