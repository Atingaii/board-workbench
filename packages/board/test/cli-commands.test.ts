import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'tsdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, usage, type CliCommand } from '../src/cli/commands.ts'
import { local } from '../src/cli/local.ts'
import { main } from '../src/cli/main.ts'

/** What `run` printed, and the exit code it answered. */
async function capture(run: () => Promise<number>) {
  let stdout = ''
  let stderr = ''
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true))
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true))
  try {
    return { code: await run(), stdout, stderr }
  } finally {
    out.mockRestore()
    err.mockRestore()
  }
}

const app = { name: 'board', commands: local }

/** Every command and subcommand, with the path that names it, and each again by its aliases. */
const paths = (list: readonly CliCommand[]): CliCommand[][] =>
  list.flatMap((command) => [
    ...[command, ...(command.aliases ?? []).map((alias) => ({ ...command, name: alias }))].map((named) => [named]),
    ...(command.subcommands ?? []).map((sub) => [command, sub]),
  ])
const every = paths([...commands, ...Object.values(local).map((command) => command.spec)])

/** A command line as a shell splits it: words, and quoted words whole. */
const words = (line: string) => [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]!)

describe("the CLI's commands, as data", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("shows a command's own page for --help and help <command>, subcommands included", async () => {
    const read = await capture(() => main(['read', '--help'], app))
    expect(read.code).toBe(0)
    expect(read.stdout).toMatch(/^usage: board read \[channel\|id\|link\] \[filters\] \[options\]\n\nthe latest threads/)
    expect(read.stdout).toMatch(/\noptions:\n  -n, --limit <N>  threads to list \(default: 50\)\n/)
    expect(read.stdout).toMatch(/\nfilters:\n  --re <id> +in a thread/)
    expect(read.stdout).toContain("\nexamples:\n  list a channel's latest threads\n    board read dev\n")
    expect((await capture(() => main(['help', 'identity', 'link'], app))).stdout).toMatch(/^usage: board identity link <key> \[options\]\n/)
    expect((await capture(() => main(['sources', 'slack', 'read', '--help'], app))).stdout).toMatch(/^usage: board sources <key> read <target> \[options\]\n/)
    // A word that names no command gets the list of them all.
    expect((await capture(() => main(['nope', '--help'], app))).stdout).toMatch(/^board \S+: a message board you mount in one route\n/)
  })

  it('runs every command it lists: none answers that it is unknown', async () => {
    // Nothing answers here, so a command that reaches the board fails fast instead of doing anything.
    vi.stubEnv('BOARD_URL', 'http://127.0.0.1:9/api/board')
    vi.stubEnv('BOARD_TOKEN', 'test')
    vi.stubEnv('HOME', await mkdtemp(join(tmpdir(), 'board-home-')))
    for (const path of every) {
      const name = path.map((command) => command.name).join(' ')
      // These hold until stopped, or run a server.
      if (['tail', 'wait', 'serve', 'inspect', 'help'].includes(path[0]!.name)) continue
      const argv = path.flatMap((command, at) => [
        command.name,
        ...command.arguments.filter((argument) => argument.required || (command.argumentsBeforeSubcommand && at < path.length - 1)).map((argument) => (argument.name === 'url' ? 'http://127.0.0.1:9/api/board' : argument.name === 'id' ? '1' : 'x')),
      ])
      const ran = await capture(() => main(argv, app))
      expect(ran.stderr, name).not.toMatch(/unknown command/)
    }
  }, 60_000)

  it("parses every example, which lands on its own command's page", async () => {
    for (const path of every)
      for (const example of path.at(-1)!.examples) {
        const shown = await capture(() => main([...words(example.value), '--help'], app))
        expect(shown, example.value).toMatchObject({ code: 0, stderr: '' })
        // An alias's page is its command's, by its own name.
        const named = path.map((command) => commands.find((own) => own.aliases?.includes(command.name)) ?? command)
        expect(shown.stdout.split('\n')[0], example.value).toBe(`usage: board ${usage(named)}${shown.stdout.split('\n')[0]!.endsWith(' [options]') ? ' [options]' : ''}`)
      }
  })

  it('loads nothing but data, so a CLI that runs board can read its commands on every start', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'board-commands-'))
    const entry = join(import.meta.dirname, `.commands-entry-${process.pid}.ts`)
    await writeFile(entry, "export { commands, globalOptions, filters } from '../src/cli/commands.ts'\n")
    try {
      await build({ config: false, entry: { commands: entry }, outDir: dir, platform: 'node', format: 'esm', dts: false, clean: false, logLevel: 'silent', deps: { alwaysBundle: [/.*/], onlyBundle: false } })
      const files = (await readdir(dir)).filter((name) => /\.m?js$/.test(name))
      const code = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('\n')
      expect(files).toHaveLength(1)
      expect(code).not.toMatch(/\bimport\b[^\n]*\bfrom\b/)
      // zod is what the rest of the CLI parses with.
      expect(code).not.toContain('ZodError')
    } finally {
      await rm(entry, { force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
