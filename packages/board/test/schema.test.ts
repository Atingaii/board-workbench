import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { postgresSchemaSql, postgresTablesSql } from '../src/store/postgres-db.ts'

const shipped = (name: string) => readFileSync(join(import.meta.dirname, '..', 'sql', 'postgres', name), 'utf8')
const a2 = (name: string) =>
  readFileSync(join(dirname(createRequire(import.meta.url).resolve('experimental-a2/package.json')), 'sql', 'postgres', name), 'utf8')

describe('sql/postgres', () => {
  it('is current: `pnpm build` writes it from board\'s tables and the bundled A2\'s schema', () => {
    expect(shipped('board.sql')).toBe(postgresTablesSql())
    expect(shipped('schema.sql')).toBe(postgresSchemaSql(a2('schema.sql')))
    expect(shipped('notifications.sql')).toBe(a2('notifications.sql'))
  })

  it('applies to an empty database, and again to one that has it', async () => {
    const pg = new PGlite()
    // Split as a migration tool that sends one statement per query does.
    const statements = shipped('schema.sql').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
    for (let run = 0; run < 2; run++) for (const statement of statements) await pg.exec(statement)
    const { rows } = await pg.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    )
    const tables = rows.map((row) => row.table_name)
    expect(tables).toEqual(expect.arrayContaining(['a2_events', 'board_messages', 'board_positions', 'board_terms', 'board_versions']))
    await pg.close()
  })

  it("makes event IDs unique per session on a database board 0.13's file built", async () => {
    const pg = new PGlite()
    await pg.exec(shipped('schema.sql'))
    // The index board 0.13 (A2 0.21) applied, in place of this release's.
    await pg.exec('drop index a2_events_session_event_id; create unique index a2_events_event_id on a2_events (event_id)')
    await pg.exec(shipped('schema.sql'))
    const { rows } = await pg.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where tablename = 'a2_events' and indexname like 'a2_events_%event_id'",
    )
    expect(rows.map((row) => row.indexname)).toEqual(['a2_events_session_event_id'])
    expect(rows[0]!.indexdef).toContain('(session_id, event_id)')
    await pg.close()
  })
})
