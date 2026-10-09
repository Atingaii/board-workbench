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
    // A connector name is enough: vboard builds the adapter, the client, and sign-in.
    expect(imports.filter((from) => !from.startsWith('vboard') && !from.startsWith('experimental-a2'))).toEqual([])
    expect(code).not.toMatch(/withBotToken|client:/)
    expect(code).toMatch(/adapter: '(slack|github)\/acme'/)
  })
})
