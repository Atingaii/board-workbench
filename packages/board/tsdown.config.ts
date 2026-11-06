import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, defineConfig, type InlineConfig, type Rolldown } from 'tsdown'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// `inspect`'s page: one prebuilt file, React included, so installing the
// package installs no UI dependencies.
const page = {
  config: false,
  cwd: here('.'),
  entry: { app: 'src/inspect/app/main.tsx' },
  outDir: 'dist/inspect',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  dts: false,
  clean: true,
  hash: false,
  fixedExtension: false,
  outExtensions: () => ({ js: '.js' }),
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warn',
} satisfies InlineConfig

export default defineConfig([
  {
    entry: {
      // `@vercel/board` has a `node` build, which finds boards and credentials in the environment and
      // serves them, and a default one with nothing that needs Node, for browsers.
      index: 'src/server/index.default.ts',
      'index.node': 'src/server/index.ts',
      access: 'src/access/index.ts',
      conformance: 'src/conformance/index.ts',
      // `@vercel/board/backend-local`: a board kept in this process, Node only.
      'backend-local': 'src/backend-local/index.ts',
      sync: 'src/sync/index.ts',
      'sync-chat-sdk': 'src/sync/chat-sdk.ts',
      'sync-slack': 'src/sync/slack.ts',
      'sync-github': 'src/sync/github.ts',
      'sync-linear': 'src/sync/linear.ts',
      cli: 'src/cli/bin.ts',
      // `@vercel/board/cli`: the CLI for another one to embed, as `vercel board`, without `serve`
      // or the inspector's page, which the app fetches (`INSPECTOR_PAGE`).
      'cli-embedded': 'src/cli/embedded.ts',
      // `@vercel/board/cli/commands`: the CLI's commands as data, for a host to render, with no imports.
      'cli-commands': 'src/cli/commands.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // A module one entry shares with a lazily loaded chunk stays in a chunk of its own: merged
    // into the entry, it would load that entry (the CLI, say) wherever the chunk loads.
    inputOptions: { experimental: { chunkOptimization: false } },
    dts: true,
    // The local board's engine is inlined: what board runs of experimental-a2 ships in dist, its types
    // too, so installing board installs no experimental-a2, and nothing else from node_modules is.
    deps: {
      alwaysBundle: [/^experimental-a2(\/|$)/],
      onlyBundle: [/^experimental-a2(\/|$)/],
      dts: { alwaysBundle: [/^experimental-a2(\/|$)/] },
    },
    plugins: [pageDigest()],
    clean: true,
  },
])

/**
 * `inspect`'s page is built first, into `dist/inspect/app.js`, which the CLI reads where board is
 * installed, and running from source too. Its SHA-256 goes in place of `src/inspect/digest.ts`:
 * a CLI that bundles board's (`vercel board`) has no file beside it, so it fetches this version's
 * from npm and checks it against that.
 */
function pageDigest(): Rolldown.Plugin {
  const module = here('src/inspect/digest.ts')
  let digest: Promise<string> | undefined
  const built = () => (digest ??= build(page).then(async () => createHash('sha256').update(await readFile(here('dist/inspect/app.js'))).digest('hex')))
  return {
    name: 'board:inspector-page',
    buildStart() {
      void built()
    },
    async load(id) {
      if (id !== module) return null
      return `export const PAGE_SHA256 = ${JSON.stringify(await built())}`
    },
  }
}
