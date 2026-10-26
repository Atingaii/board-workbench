import { describe, expect, it } from 'vitest'
import { installA2 } from '../src/cli/peers.ts'

// Node only finds experimental-a2 next to board's own install, so `board serve` names the
// install that puts it there.
describe("board serve's hint for a missing A2", () => {
  const node = '/Users/ada/.nvm/versions/node/v24.1.0/bin/node'

  it('takes it in the project for a project install', () => {
    expect(installA2('/Users/ada/src/www/node_modules/@vercel/board/dist/cli.mjs', '0.22.0', node)).toBe('npm i experimental-a2@0.22.0')
  })

  it('takes it globally for a global install', () => {
    expect(installA2('/Users/ada/.nvm/versions/node/v24.1.0/lib/node_modules/@vercel/board/dist/cli.mjs', '0.22.0', node)).toBe('npm i -g experimental-a2@0.22.0')
  })

  it('runs both packages under npx', () => {
    expect(installA2('/Users/ada/.npm/_npx/5f1c/node_modules/@vercel/board/dist/cli.mjs', '0.22.0', node)).toBe(
      'npx -p @vercel/board -p experimental-a2@0.22.0 board serve',
    )
  })
})
