import { PGlite } from '@electric-sql/pglite'
import { ddl, type Db } from '../src/store/sql.ts'

/**
 * The tables' Postgres dialect on PGlite, in process. PGlite has one
 * connection, so calls take turns.
 */
export async function pgliteDb(): Promise<Db> {
  const pg = new PGlite()
  for (const statement of ddl('postgres')) await pg.exec(statement)
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run)
    queue = next.catch(() => {})
    return next
  }
  return {
    dialect: 'postgres',
    all: (query) => serial(async () => (await pg.query<Record<string, unknown>>(query.text, query.values)).rows),
    read: (queries) =>
      serial(() =>
        pg.transaction(async (tx) => {
          const rows: Record<string, unknown>[][] = []
          for (const query of queries) rows.push((await tx.query<Record<string, unknown>>(query.text, query.values)).rows)
          return rows
        }),
      ),
    commit: (claim, writes) =>
      serial(() =>
        pg.transaction(async (tx) => {
          if ((await tx.query(claim.text, claim.values)).rows.length === 0) {
            await tx.rollback()
            return false
          }
          for (const write of writes) await tx.query(write.text, write.values)
          return true
        }),
      ),
    close: () => pg.close(),
  }
}
