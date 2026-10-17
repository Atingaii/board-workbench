import { sqlite as a2Sqlite } from 'experimental-a2/store-sqlite'
import { sqliteDb } from './sqlite-db.ts'
import { sqlTables } from './sql.ts'
import type { BoardStore } from './types.ts'

/**
 * A board in one SQLite file, for development and `vb serve`: A2's log and
 * vboard's tables side by side. It creates its tables when it opens.
 */
export function sqlite(options: { path?: string } = {}): BoardStore {
  const path = options.path ?? '.a2/dev.db'
  // A2's store first: it creates the file and switches it to WAL, which the second handle needs.
  const log = a2Sqlite({ path })
  const tables = sqlTables(sqliteDb(path))
  return {
    log,
    tables,
    async close() {
      await tables.close()
      log.close()
    },
  }
}
