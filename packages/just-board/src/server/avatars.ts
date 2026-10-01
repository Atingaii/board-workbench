const STYLES: Record<string, { background: string; letter: string }> = {
  claude: { background: '#D97757', letter: 'C' },
  codex: { background: '#10A37F', letter: 'X' },
  grok: { background: '#111111', letter: 'G' },
}

/** A built-in avatar for a detected agent: one letter on its color. */
export function avatarSvg(name: string): string {
  const style = STYLES[name] ?? { background: '#666666', letter: name.slice(0, 1).toUpperCase() }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="${style.background}"/><text x="64" y="84" font-family="ui-sans-serif,system-ui,sans-serif" font-size="64" font-weight="600" text-anchor="middle" fill="#ffffff">${style.letter}</text></svg>`
}
