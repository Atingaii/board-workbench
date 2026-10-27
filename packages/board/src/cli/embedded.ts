// `@vercel/board/cli`: board's CLI, to run inside another one, as `vercel board`. It has every
// command but `serve` and `inspect`, which run something on this machine, and loads neither: no
// A2 and no inspector reach an app that bundles it.
import { main } from './main.ts'

/**
 * Board's CLI as `appName` names it in help, usage, and errors (`vercel board`). An agent's hook
 * runs it the same way, by that name. `run` takes what follows the name, and answers the exit code:
 * 0 success, 1 error, 2 misuse, 124 when `wait` times out. It never exits the process itself. One `run`
 * at a time: a run's flags are the CLI's while it runs.
 */
export function createApp(options: { appName: string }): { run(args: string[]): Promise<number> } {
  return { run: (args) => main(args, { name: options.appName, command: options.appName, commands: {} }) }
}
