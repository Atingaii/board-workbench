import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.node': 'src/index.node.ts',
    server: 'src/server/index.ts',
    slack: 'src/sync/slack.ts',
    github: 'src/sync/github.ts',
    contract: 'src/contract/index.ts',
    cli: 'src/cli/main.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
})
