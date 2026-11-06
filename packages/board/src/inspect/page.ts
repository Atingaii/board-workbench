// The inspector's page, which the build puts in place of this module (`tsdown.config.ts`): in
// `dist`, it's a string in a chunk only `inspect` loads, so a CLI that bundles board's (`vercel
// board`) carries it along. Running from source, it's read from `dist`, where the build writes it.
import { readFile } from 'node:fs/promises'

/** The page's script, or null when it isn't built. */
export const page = (): Promise<string | null> => readFile(new URL('../../dist/inspect/app.js', import.meta.url), 'utf8').catch(() => null)
