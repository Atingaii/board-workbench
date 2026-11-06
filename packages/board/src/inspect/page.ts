// The inspector's page: one prebuilt file, `dist/inspect/app.js` in board's package, which the CLI
// reads where board is installed. An app that bundles board's CLI (`vercel board`) has no such file
// beside it: it fetches this version's, which `INSPECTOR_PAGE` in `@vercel/board/cli` names, and
// hands it to `createApp` as `inspectorPage`.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PAGE_SHA256 } from './digest.ts'

/**
 * Next to the CLI in `dist`, or in `dist` when running from source. Resolved only when asked
 * for: an app that bundles board's CLI as CommonJS may have no `import.meta.url`, and then has
 * none of board's files either.
 */
function files(): URL[] {
  try {
    return [new URL('./inspect/app.js', import.meta.url), new URL('../../dist/inspect/app.js', import.meta.url)]
  } catch {
    return []
  }
}

/**
 * The page's script where board is installed, or null when there's none beside it. A build takes
 * only the page it made: in an app that bundles board's CLI, these paths are the app's, and a file
 * that happens to be there isn't board's.
 */
export async function page(): Promise<string | null> {
  for (const file of files()) {
    const script = await readFile(file, 'utf8').catch(() => null)
    if (script !== null && (PAGE_SHA256 === null || createHash('sha256').update(script).digest('hex') === PAGE_SHA256)) return script
  }
  return null
}
