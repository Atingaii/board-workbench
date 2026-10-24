import { postgres as a2Postgres } from 'experimental-a2/store-postgres'
import { postgresDb, type PgPool } from './postgres-db.ts'
import { sqlTables } from './sql.ts'
import type { BoardStore } from './types.ts'

/** `pg` is an optional peer, installed by the apps that use Postgres. */
const PG: string = 'pg'

export type PostgresOptions = {
  /** A direct connection to the same database, for live updates by notification. */
  listenConnectionString?: string
} & (
  | {
      /** The database: A2's log and board's tables, which `schema.sql` creates. */
      connectionString: string
      /** Connections board's own pool may open; A2 keeps a pool of its own. Default 5. */
      max?: number
    }
  | {
      /**
       * A `pg` Pool you made, shared by A2's log and board's tables: for a password
       * that comes from a callback, say. Closing the store ends it.
       */
      client: PgPool
    }
)

/**
 * A board on Postgres (`npm i pg`). Apply `node_modules/@vercel/board/sql/postgres/schema.sql`
 * before the first deploy: neither A2 nor board creates tables in Postgres.
 */
export function postgres(options: PostgresOptions): BoardStore {
  const listen = options.listenConnectionString ? { listenConnectionString: options.listenConnectionString } : {}
  if ('client' in options) {
    // board's transactions each need a connection of their own: a pool, not one connection.
    if (typeof options.client.connect !== 'function') throw new TypeError('postgres({ client }) takes a pg Pool, which has connect()')
    const log = a2Postgres({ client: options.client, ...listen })
    // A2 ends the pool when its store closes, so the tables leave it open.
    const tables = sqlTables(postgresDb(async () => options.client, { owned: false }))
    return { log, tables, close: () => log.close() }
  }
  const log = a2Postgres({ connectionString: options.connectionString, ...listen })
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
