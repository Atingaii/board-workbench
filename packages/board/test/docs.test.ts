import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const docs = new URL('../docs/', import.meta.url)
const page = (path: string) => readFileSync(new URL(path, docs), 'utf8')

/** The first ts code block under a `## heading`. */
function snippet(markdown: string, heading: string): string {
  const section = markdown.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? ''
  const code = /```ts[^\n]*\n([\s\S]*?)```/.exec(section)?.[1]
  if (!code) throw new Error(`no ts snippet under "## ${heading}"`)
  return code
}

describe('the docs show the short way to sync with Vercel Connect', () => {
  const pages = [
    ['index.md', 'Sync Slack and GitHub'],
    ['02-sync/01-overview.md', 'Configure it'],
    ['02-sync/03-slack.md', 'Configure it'],
    ['02-sync/04-github.md', 'Configure it'],
  ] as const

  it.each(pages)('%s "%s" passes connectors, not hand-built adapters', (path, heading) => {
    const code = snippet(page(path), heading)
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]!)
    // A connector name is enough: board builds the adapter, the client, and sign-in.
    expect(imports.filter((from) => !from.startsWith('@vercel/board') && !from.startsWith('experimental-a2'))).toEqual([])
    expect(code).not.toMatch(/withBotToken|client:|botUserId/)
    expect(code).toMatch(/(slack|github)\('(slack|github)\/acme'/)
  })
})

describe('the docs install the A2 board pins', () => {
  it('names experimental-a2 at its peer version everywhere it pins one', async () => {
    const { readdirSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { peerDependencies: Record<string, string> }
    const files = [
      ...readdirSync(docs, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.md')).map((path) => new URL(path, docs)),
      new URL('../README.md', import.meta.url),
      new URL('../../../SPEC.md', import.meta.url),
    ]
    const pinned = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/experimental-a2@([\w.-]+)/g)].map((match) => match[1]))
    expect(pinned.length).toBeGreaterThan(0)
    expect(new Set(pinned)).toEqual(new Set([pkg.peerDependencies['experimental-a2']]))
  })
})
