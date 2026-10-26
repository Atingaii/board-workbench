import { dirname, join, sep } from 'node:path'

/**
 * How to put A2 beside the CLI at `self`, which only finds it next to its own install: npx runs
 * both packages at once, a global install takes it globally, and a project's install takes it in
 * the project. Node is at `execPath`: npm's global packages sit under its prefix.
 */
export function installA2(self: string, version: string, execPath = process.execPath): string {
  const spec = `experimental-a2@${version}`
  if (/[\\/]_npx[\\/]/.test(self)) return `npx -p @vercel/board -p ${spec} board serve`
  const bin = dirname(execPath)
  const global = [join(dirname(bin), 'lib', 'node_modules'), join(bin, 'node_modules')]
  return global.some((dir) => self.startsWith(dir + sep)) ? `npm i -g ${spec}` : `npm i ${spec}`
}
