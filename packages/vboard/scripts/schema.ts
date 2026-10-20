// Writes sql/postgres/: vboard's tables, and schema.sql, which is the bundled A2's
// schema.sql followed by them, so a database needs one file. Run by `pnpm build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresSchemaSql, postgresTablesSql } from '../src/store/postgres-db.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const a2 = join(dirname(createRequire(import.meta.url).resolve('experimental-a2/package.json')), 'sql', 'postgres')
const out = join(root, 'sql', 'postgres')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'vboard.sql'), postgresTablesSql())
writeFileSync(join(out, 'schema.sql'), postgresSchemaSql(readFileSync(join(a2, 'schema.sql'), 'utf8')))
writeFileSync(join(out, 'notifications.sql'), readFileSync(join(a2, 'notifications.sql'), 'utf8'))
