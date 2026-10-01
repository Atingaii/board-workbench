import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.node': 'src/index.node.ts',
    server: 'src/server/index.ts',
    contract: 'src/contract/index.ts',
    cli: 'src/cli/main.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
})
