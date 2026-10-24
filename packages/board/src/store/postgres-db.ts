import { ddl, type Db, type Sql } from './sql.ts'

/** What the tables need of a `pg` Pool, or of anything shaped like one. */
export type PgQueryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}
export type PgPool = PgQueryable & {
  connect(): Promise<PgQueryable & { release(): void }>
  end(): Promise<void>
}

export const SCHEMA_FILE = 'node_modules/@vercel/board/sql/postgres/schema.sql'

/** The board's own error for tables that aren't there: the fix is a file to apply. */
export class TablesNotConfiguredError extends Error {
  readonly code = 'STORE_NOT_CONFIGURED'
}

/** Missing tables or columns (42P01, 42703), or missing grants (42501), say what to apply. */
function explain(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code
  if (code === '42P01' || code === '42703')
    return new TablesNotConfiguredError(`board's tables aren't in this database: apply ${SCHEMA_FILE}`, { cause: error })
  if (code === '42501')
    return new TablesNotConfiguredError(`this database role can't use board's tables: grant it select, insert, update, and delete on them`, {
      cause: error,
    })
  return error
}

/**
 * The tables on Postgres, through a pool that `pool()` makes the first time it's
 * needed. `owned`: closing the tables ends the pool.
 */
export function postgresDb(pool: () => Promise<PgPool>, options: { owned: boolean } = { owned: true }): Db {
  const run = async (queryable: PgQueryable, query: Sql) => {
    try {
      return await queryable.query(query.text, query.values)
    } catch (error) {
      throw explain(error)
    }
  }
  /** Runs `body` in a transaction, which commits when it returns true and rolls back otherwise. */
  async function transaction(begin: string, body: (client: PgQueryable) => Promise<boolean>): Promise<boolean> {
    const client = await (await pool()).connect()
    try {
      await client.query(begin)
      const keep = await body(client)
      await client.query(keep ? 'commit' : 'rollback')
      return keep
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  return {
    dialect: 'postgres',
    all: async (query) => (await run(await pool(), query)).rows,
    async read(queries) {
      const rows: Record<string, unknown>[][] = []
      await transaction('begin isolation level repeatable read read only', async (client) => {
        for (const query of queries) rows.push((await run(client, query)).rows)
        return true
      })
      return rows
    },
    commit: (claim, writes) =>
      transaction('begin', async (client) => {
        if ((await run(client, claim)).rows.length === 0) return false
        for (const write of writes) await run(client, write)
        return true
      }),
    async close() {
      if (options.owned) await (await pool()).end()
    },
  }
}

const BREAKPOINT = '\n--> statement-breakpoint\n'

/** The Postgres statements for board's tables, as `sql/postgres/board.sql` ships them. */
export function postgresTablesSql(): string {
  return `-- board's tables, which live next to A2's. schema.sql holds both: apply that.\n\n${ddl('postgres').join(`;${BREAKPOINT}`)};\n`
}

/** `schema.sql`: the bundled A2's file, then board's tables, so a database needs one file. */
export function postgresSchemaSql(a2: string): string {
  return `-- The tables for board/backend-a2/store-postgres: A2's, which keep the board's log, then
-- board's, which it reads from. Apply this file before the first deploy, and
-- again when a board release says the tables changed. Every statement creates
-- only what is missing and leaves existing data alone, so it's safe to re-run.
-- The breakpoint after each statement splits it for migration tools that send
-- one statement per query; to every other tool it's only a comment.

${a2.trimEnd()}${BREAKPOINT}
${postgresTablesSql()}`
}
