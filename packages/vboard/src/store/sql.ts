import type { BoardEvent } from '../contract/contract.ts'
import type { Message } from '../contract/reducers.ts'
import { concernedMessageId, project, type Before, type Change } from './project.ts'
import type { MessageFilter, MessageTables, Page, ThreadSummary } from './types.ts'

/** One statement, with `$1`-style placeholders on every dialect. */
export type Sql = { text: string; values: unknown[] }

/** A database the tables run on: Postgres or SQLite, behind three calls. */
export type Db = {
  readonly dialect: 'postgres' | 'sqlite'
  all(query: Sql): Promise<Record<string, unknown>[]>
  /** Each query's rows, all from one snapshot. */
  read(queries: Sql[]): Promise<Record<string, unknown>[][]>
  /**
   * Runs `claim`, then `writes`, in one transaction. False, with nothing
   * written, when the claim returns no row.
   */
  commit(claim: Sql, writes: Sql[]): Promise<boolean>
  close(): Promise<void>
}

/** The projection's name in `vboard_positions`, and the A2 consumer that runs it. */
export const TABLES_CONSUMER = 'vboard-tables'

/** The tables, as statements for one dialect. Postgres users apply them from `schema.sql`. */
export function ddl(dialect: Db['dialect']): string[] {
  const big = dialect === 'postgres' ? 'bigint' : 'integer'
  const bool = dialect === 'postgres' ? 'boolean' : 'integer'
  return [
    `create table if not exists vboard_positions (
  consumer text primary key,
  log_index ${big} not null
)`,
    `create table if not exists vboard_messages (
  id ${big} primary key,
  event_id text not null unique,
  channel text not null,
  re ${big},
  by_actor text not null,
  by_principal text not null,
  by_profile text,
  from_key text,
  no_sync ${bool} not null,
  text_lower text not null,
  deleted ${bool} not null,
  created_at ${big} not null,
  replies integer not null default 0,
  at ${big},
  data text not null
)`,
    'create index if not exists vboard_messages_channel on vboard_messages (channel, id)',
    'create index if not exists vboard_messages_re on vboard_messages (re, id)',
    'create index if not exists vboard_messages_by_actor on vboard_messages (by_actor, id)',
    'create index if not exists vboard_messages_by_principal on vboard_messages (by_principal, id)',
    'create index if not exists vboard_threads_at on vboard_messages (at) where re is null',
    'create index if not exists vboard_threads_channel on vboard_messages (channel, at) where re is null',
    `create table if not exists vboard_versions (
  log_index ${big} primary key,
  message_id ${big} not null,
  data text not null
)`,
    'create index if not exists vboard_versions_message on vboard_versions (message_id, log_index)',
    `create table if not exists vboard_terms (
  message_id ${big} not null,
  term text not null,
  value text not null,
  primary key (message_id, term, value)
)`,
    'create index if not exists vboard_terms_term on vboard_terms (term, value, message_id)',
  ]
}

/** Postgres refuses NUL in text; nothing a reader filters on needs one. */
const clean = (value: string) => value.replaceAll('\u0000', '')

/** A mention's term. Label keys start with a letter or digit, so it's never a label's. */
const MENTION = '@'

class Params {
  readonly values: unknown[] = []
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
  list(values: readonly unknown[]): string {
    return values.map((value) => this.add(value)).join(', ')
  }
}

const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

/** A channel, or a channel and everything under it, on the messages table aliased `alias`. */
function channelClause(alias: string, channel: NonNullable<MessageFilter['channel']>, p: Params): string {
  const path = p.add(channel.path)
  if (!channel.subtree) return `${alias}.channel = ${path}`
  // Compared, not matched with `like`: channel segments may hold `_`. The cast tells Postgres the parameter's type.
  const prefix = `cast(${p.add(`${channel.path}/`)} as text)`
  return `(${alias}.channel = ${path} or substr(${alias}.channel, 1, length(${prefix})) = ${prefix})`
}

/** The filter as `where` clauses on the messages table aliased `m`. */
function clauses(filter: MessageFilter, p: Params): string[] {
  const out: string[] = []
  if (filter.channel) out.push(channelClause('m', filter.channel, p))
  if (filter.re !== undefined) {
    const re = p.add(filter.re)
    out.push(`(m.id = ${re} or m.re = ${re})`)
  }
  if (filter.by) {
    const { actors, principals } = filter.by
    const either = [
      ...(actors.length ? [`m.by_actor in (${p.list(actors)})`] : []),
      ...(principals.length ? [`m.by_principal in (${p.list(principals)})`] : []),
    ]
    out.push(either.length ? `(${either.join(' or ')})` : '1 = 0')
  }
  if (filter.mentions) {
    out.push(
      filter.mentions.length
        ? `exists (select 1 from vboard_terms t where t.message_id = m.id and t.term = '${MENTION}' and t.value in (${p.list(filter.mentions)}))`
        : '1 = 0',
    )
  }
  if (filter.from !== undefined) out.push(`coalesce(m.from_key, 'board') = ${p.add(filter.from)}`)
  if (filter.text !== undefined) out.push(`m.text_lower like ${p.add(`%${likeEscape(filter.text)}%`)} escape '\\'`)
  for (const label of filter.labels ?? []) {
    const values = label.values === null ? '' : ` and t.value in (${p.list(label.values)})`
    out.push(`exists (select 1 from vboard_terms t where t.message_id in (m.id, m.re) and t.term = ${p.add(label.key)}${values})`)
  }
  return out
}

const parse = (row: Record<string, unknown> | undefined): Message | null =>
  row === undefined || row.data === null || row.data === undefined ? null : (JSON.parse(String(row.data)) as Message)

/** The tables on a SQL database. */
export function sqlTables(db: Db): MessageTables {
  const positionSql: Sql = { text: 'select log_index from vboard_positions where consumer = $1', values: [TABLES_CONSUMER] }
  const position = (rows: Record<string, unknown>[]) => (rows[0] ? Number(rows[0].log_index) : 0)

  const claim = (index: number): Sql => ({
    text: `insert into vboard_positions (consumer, log_index) values ($1, $2)
  on conflict (consumer) do update set log_index = excluded.log_index
  where vboard_positions.log_index < excluded.log_index
  returning 1 as claimed`,
    values: [TABLES_CONSUMER, index],
  })

  /** Only the event right after the position: never ahead of events the tables haven't applied. */
  const claimNext = (index: number): Sql => ({
    text: 'update vboard_positions set log_index = $2 where consumer = $1 and log_index = $3 returning 1 as claimed',
    values: [TABLES_CONSUMER, index, index - 1],
  })

  async function row(id: number) {
    const [found] = await db.all({ text: 'select data, replies, at from vboard_messages where id = $1', values: [id] })
    return found
  }

  async function before(event: BoardEvent, id: number): Promise<Before> {
    const found = event.type === 'message.posted' ? undefined : await row(id)
    const message = parse(found) ?? undefined
    const rootId = event.type === 'message.posted' ? event.payload.re : (message?.re ?? null)
    if (rootId === null) return { message, root: undefined }
    const rootRow = await row(rootId)
    const root = rootRow ? { replies: Number(rootRow.replies), at: Number(rootRow.at) } : undefined
    if (event.type === 'message.deleted' && message && !message.deleted && root?.at === id) {
      const [newest] = await db.all({
        text: 'select max(id) as id from vboard_messages where re = $1 and not deleted and id <> $2',
        values: [rootId, id],
      })
      return { message, root, previousLast: newest?.id === null || newest?.id === undefined ? null : Number(newest.id) }
    }
    return { message, root }
  }

  function writes(event: BoardEvent, change: Change): Sql[] {
    const out: Sql[] = []
    if (change.message) {
      const { after: m, created, terms } = change.message
      const data = JSON.stringify(m)
      if (created)
        out.push({
          text: `insert into vboard_messages
  (id, event_id, channel, re, by_actor, by_principal, by_profile, from_key, no_sync, text_lower, deleted, created_at, data)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          values: [
            m.id, event.id, m.channel, m.re, clean(m.by.actor), clean(m.by.principal), m.by.profile === null ? null : clean(m.by.profile),
            m.from, m.noSync, clean(m.text.toLowerCase()), m.deleted, Date.parse(m.createdAt), data,
          ],
        })
      else
        out.push({
          text: 'update vboard_messages set text_lower = $1, deleted = $2, data = $3 where id = $4',
          values: [clean(m.text.toLowerCase()), m.deleted, data, m.id],
        })
      out.push({ text: 'insert into vboard_versions (log_index, message_id, data) values ($1, $2, $3)', values: [event.index, m.id, data] })
      if (terms) {
        if (!created) out.push({ text: 'delete from vboard_terms where message_id = $1', values: [m.id] })
        const rows = [
          ...Object.entries(m.labels).map(([key, value]) => [key, clean(value)] as const),
          ...[...new Set(m.mentions)].map((actor) => [MENTION, clean(actor)] as const),
        ]
        if (rows.length > 0) {
          const p = new Params()
          const tuples = rows.map(([term, value]) => `(${p.add(m.id)}, ${p.add(term)}, ${p.add(value)})`)
          out.push({ text: `insert into vboard_terms (message_id, term, value) values ${tuples.join(', ')}`, values: p.values })
        }
      }
    }
    if (change.summary)
      out.push({
        text: 'update vboard_messages set replies = $1, at = $2 where id = $3',
        values: [change.summary.replies, change.summary.at, change.summary.root],
      })
    return out
  }

  function threadsQuery(filter: MessageFilter, page: Page): Sql {
    const p = new Params()
    const where = ['r.re is null']
    // A thread's messages are all in its root's channel: that filter goes on the root, where an index has it.
    const { channel, ...rest } = filter
    if (channel) where.push(channelClause('r', channel, p))
    const matching = clauses(rest, p)
    if (matching.length > 0)
      where.push(`r.id in (select coalesce(m.re, m.id) from vboard_messages m where ${matching.join(' and ')})`)
    if (page.after !== undefined) where.push(`r.at > ${p.add(page.after)}`)
    const order = page.after !== undefined ? 'asc' : 'desc'
    return {
      text: `select r.data as data, r.replies as replies, l.data as last
from vboard_messages r left join vboard_messages l on l.id = r.at and r.at <> r.id
where ${where.join(' and ')}
order by r.at ${order} limit ${p.add(page.limit)}`,
      values: p.values,
    }
  }

  return {
    async position() {
      return position(await db.all(positionSql))
    },

    async apply(event) {
      // Applied already, most often by the writer that wrote it: skip the reads.
      if (position(await db.all(positionSql)) >= event.index) return
      const id = concernedMessageId(event)
      const change = id === null ? {} : project(await before(event, id), event)
      await db.commit(claim(event.index), writes(event, change))
    },

    async applyNext(event) {
      const id = concernedMessageId(event)
      const change = id === null ? {} : project(await before(event, id), event)
      return db.commit(claimNext(event.index), writes(event, change))
    },

    async message(id) {
      return parse(await row(id))
    },

    async byEventId(eventId) {
      const [found] = await db.all({ text: 'select data from vboard_messages where event_id = $1', values: [eventId] })
      return parse(found)
    },

    async messagesAt(ids, index) {
      const out = new Map<number, Message>()
      if (ids.length === 0) return out
      const p = new Params()
      const rows = await db.all({
        text: `select v.message_id as id, v.data as data from vboard_versions v
where v.message_id in (${p.list([...new Set(ids)])})
  and v.log_index = (select max(w.log_index) from vboard_versions w where w.message_id = v.message_id and w.log_index <= ${p.add(index)})`,
        values: p.values,
      })
      for (const found of rows) out.set(Number(found.id), parse(found)!)
      return out
    },

    async thread(root) {
      const rows = await db.all({ text: 'select data from vboard_messages where id = $1 or re = $1 order by id', values: [root] })
      return rows.map((found) => parse(found)!)
    },

    async messages(filter, page) {
      const p = new Params()
      const where = clauses(filter, p)
      if (page.before !== undefined) where.push(`m.id < ${p.add(page.before)}`)
      if (page.after !== undefined) where.push(`m.id > ${p.add(page.after)}`)
      const order = page.after !== undefined ? 'asc' : 'desc'
      const query: Sql = {
        text: `select m.data as data from vboard_messages m${where.length ? ` where ${where.join(' and ')}` : ''} order by m.id ${order} limit ${p.add(page.limit)}`,
        values: p.values,
      }
      const [positions, rows] = await db.read([positionSql, query])
      const messages = rows!.map((found) => parse(found)!)
      return { messages: page.after !== undefined ? messages : messages.reverse(), position: position(positions!) }
    },

    async threads(filter, page) {
      const [positions, rows] = await db.read([positionSql, threadsQuery(filter, page)])
      const threads: ThreadSummary[] = rows!.map((found) => ({
        root: parse(found)!,
        replies: Number(found.replies),
        last: found.last === null || found.last === undefined ? null : (JSON.parse(String(found.last)) as Message),
      }))
      return { threads: page.after !== undefined ? threads : threads.reverse(), position: position(positions!) }
    },

    close: () => db.close(),
  }
}
