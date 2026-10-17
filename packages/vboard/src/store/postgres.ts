import { postgres as a2Postgres } from 'experimental-a2/store-postgres'
import { postgresDb, type PgPool } from './postgres-db.ts'
import { sqlTables } from './sql.ts'
import type { BoardStore } from './types.ts'

/** `pg` is an optional peer, installed by the apps that use Postgres. */
const PG: string = 'pg'

export type PostgresOptions = {
  /** The database: A2's log and vboard's tables, which `schema.sql` creates. */
  connectionString: string
  /** A direct connection to the same database, for live updates by notification. */
  listenConnectionString?: string
  /** Connections vboard's own pool may open; A2 keeps a pool of its own. Default 5. */
  max?: number
}

/**
 * A board on Postgres (`npm i pg`). Apply `node_modules/vboard/sql/postgres/schema.sql`
 * before the first deploy: neither A2 nor vboard creates tables in Postgres.
 */
export function postgres(options: PostgresOptions): BoardStore {
  const log = a2Postgres({
    connectionString: options.connectionString,
    ...(options.listenConnectionString ? { listenConnectionString: options.listenConnectionString } : {}),
  })
  let pool: Promise<PgPool> | null = null
  const open = () =>
    (pool ??= import(PG).then(({ default: pg }) => {
      const opened = new pg.Pool({ connectionString: options.connectionString, max: options.max ?? 5 })
      // A connection the server closes (a restart, a database that scales to zero) is reported here;
      // unheard, it ends the process. The query it cut off fails on its own, and is retried.
      opened.on('error', () => {})
      return opened as unknown as PgPool
    }))
  const tables = sqlTables(postgresDb(open))
  return {
    log,
    tables,
    async close() {
      if (pool) await tables.close()
      await log.close()
    },
  }
}
