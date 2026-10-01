import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChannelView, InboxEntry } from '../../api/routes.ts'
import { ago, who } from '../../cli/format.ts'
import * as board from './board.ts'
import { Composer, Feed, Link, MessageRow, PendingRow, Toasts, navigate, useLocation, useNow, type RowOptions } from './parts.tsx'
import { channelThreads, recent, thread as threadOf, type State } from './store.ts'

type Route = { view: 'activity' } | { view: 'channel'; channel: string } | { view: 'inbox'; key: string } | { view: 'missing' }

function route(path: string): Route {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return { view: 'missing' }
  }
  if (decoded === '/') return { view: 'activity' }
  if (decoded.startsWith('/c/') && decoded.length > 3) return { view: 'channel', channel: decoded.slice(3) }
  if (decoded.startsWith('/inbox/') && decoded.length > 7) return { view: 'inbox', key: decoded.slice(7) }
  return { view: 'missing' }
}

const withThread = (path: string, id: number | null) => (id === null ? path : `${path}?thread=${id}`)

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export function App() {
  const state = board.useBoard()
  const where = useLocation()
  const now = useNow()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    board.boot().catch((error: Error) => setFailed(error.message))
  }, [])

  // Old links: /t/12 is the thread pane over the activity view.
  useEffect(() => {
    const old = /^\/t\/(\d+)$/.exec(where.path)
    if (old) navigate(`/?thread=${old[1]}`, true)
  }, [where.path])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || where.thread === null) return
      if ((event.target as HTMLElement).closest('textarea, input, .picker')) return
      navigate(where.path)
    }
    addEventListener('keydown', close)
    return () => removeEventListener('keydown', close)
  }, [where])

  const current = route(where.path)
  useEffect(() => {
    document.title = `${current.view === 'channel' ? `#${current.channel}` : current.view === 'inbox' ? `inbox · ${current.key}` : 'activity'} · just-board`
  }, [where.path])

  if (failed) return <div className="boot error">error: {failed}</div>
  if (!state.me) return <div className="boot">connecting…</div>

  const options: RowOptions = { me: state.me.actor, now, openThread: (id) => navigate(withThread(where.path, id)) }
  return (
    <div className="shell">
      <Sidebar state={state} current={current} />
      <main className="main">
        {current.view === 'activity' && <Activity state={state} options={options} />}
        {current.view === 'channel' && <Channel key={current.channel} channel={current.channel} state={state} options={options} />}
        {current.view === 'inbox' && <Inbox key={current.key} entry={current.key} now={now} />}
        {current.view === 'missing' && <p className="empty">nothing here</p>}
      </main>
      {where.thread !== null && <ThreadPane key={where.thread} id={where.thread} state={state} path={where.path} now={now} />}
      <Toasts />
    </div>
  )
}

function Header(props: { title: string; meta?: string; live?: State['live']; children?: ReactNode }) {
  return (
    <header className="header">
      <span className="title">{props.title}</span>
      {props.meta && <span className="meta">{props.meta}</span>}
      <span className="spacer" />
      {props.children}
      {props.live && (
        <span className={`live ${props.live}`} title={props.live === 'live' ? 'receiving board events' : 'the stream reconnects on its own'}>
          <i />
          {props.live === 'live' ? 'live' : props.live}
        </span>
      )}
    </header>
  )
}

// --- sidebar -------------------------------------------------------------------------

function useSeen(state: State, current: Route): Record<string, number> {
  const storage = `just-board.seen:${state.discovery?.url ?? location.host}`
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storage) ?? 'null') ?? {}
    } catch {
      return {}
    }
  })
  const save = (next: Record<string, number>) => {
    setSeen(next)
    try {
      localStorage.setItem(storage, JSON.stringify(next))
    } catch {}
  }
  // The first visit marks everything read; after that, dots mean news.
  useEffect(() => {
    const channels = Object.values(state.channels)
    if (Object.keys(seen).length === 0 && channels.length > 0)
      save(Object.fromEntries(channels.map((channel) => [channel.path, channel.lastIndex])))
  }, [state.channels])
  useEffect(() => {
    if (current.view !== 'channel') return
    const channel = state.channels[current.channel]
    if (channel && (seen[channel.path] ?? 0) < channel.lastIndex) save({ ...seen, [channel.path]: channel.lastIndex })
  }, [current, state.channels])
  return seen
}

function Sidebar({ state, current }: { state: State; current: Route }) {
  const seen = useSeen(state, current)
  const groups = useMemo(() => {
    const out = new Map<string, ChannelView[]>()
    for (const channel of Object.values(state.channels).sort((a, b) => a.path.localeCompare(b.path))) {
      const at = channel.path.lastIndexOf('/')
      const group = at === -1 ? 'channels' : channel.path.slice(0, at)
      out.set(group, [...(out.get(group) ?? []), channel])
    }
    return [...out]
  }, [state.channels])
  const sync = state.discovery?.sync ?? []
  return (
    <nav className="sidebar">
      <div className="brand">just-board</div>
      <Link to="/" className="item" current={current.view === 'activity'}>
        <span>activity</span>
      </Link>
      {groups.map(([group, channels]) => (
        <section key={group}>
          <h2>{group}</h2>
          {channels.map((channel) => {
            const active = current.view === 'channel' && current.channel === channel.path
            const unread = !active && channel.lastIndex > (seen[channel.path] ?? Number.POSITIVE_INFINITY)
            return (
              <Link key={channel.path} to={`/c/${channel.path}`} className={`item${unread ? ' unread' : ''}`} current={active} title={channel.path}>
                <span>#{channel.path.slice(channel.path.lastIndexOf('/') + 1)}</span>
                {unread ? <i className="dot" /> : <span className="count">{channel.threads}</span>}
              </Link>
            )
          })}
        </section>
      ))}
      {sync.length > 0 && (
        <section>
          <h2>inbox</h2>
          {sync.map((entry) => (
            <Link key={entry.key} to={`/inbox/${entry.key}`} className="item" current={current.view === 'inbox' && current.key === entry.key}>
              <span>{entry.key}</span>
              <span className="count">{entry.platform}</span>
            </Link>
          ))}
        </section>
      )}
      <div className="whoami" title={`${state.me!.actor}\n${state.discovery?.url ?? ''}`}>
        <div>as {who(state.me!)}</div>
        <div className="faint url">{state.discovery?.url.replace(/^https?:\/\//, '')}</div>
      </div>
      <datalist id="channels">
        {Object.keys(state.channels).map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
    </nav>
  )
}

// --- views ---------------------------------------------------------------------------

function Activity({ state, options }: { state: State; options: RowOptions }) {
  const messages = useMemo(() => recent(state), [state.messages, state.ops, state.actors])
  const pending = state.pending.filter((post) => post.re === null)
  return (
    <>
      <Header title="activity" meta="the latest across every channel" live={state.live} />
      <Feed scope="activity" first={messages[0]?.id ?? 0} last={(messages.at(-1)?.id ?? 0) + pending.length}>
        {messages.length === 0 && pending.length === 0 && <p className="empty">nothing here yet</p>}
        {messages.map((m) => (
          <div key={m.id} className="thread">
            <MessageRow
              m={m}
              options={{
                ...options,
                context: (
                  <Link to={`/c/${m.channel}${m.re === null ? '' : `?thread=${m.re}`}`} className="where">
                    #{m.channel}
                    {m.re !== null && ` ↳ #${m.re}`}
                  </Link>
                ),
              }}
            />
          </div>
        ))}
        {pending.map((post) => (
          <div key={post.key} className="thread">
            <PendingRow post={post} me={state.me!} />
          </div>
        ))}
      </Feed>
      <Composer
        scope="activity"
        placeholder="start a thread"
        pickChannel
        onSend={(text, { noSync, channel }) => void board.send({ channel, re: null, text, noSync })}
      />
    </>
  )
}

function Channel({ channel, state, options }: { channel: string; state: State; options: RowOptions }) {
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void board.loadChannel(channel).finally(() => setLoading(false))
  }, [channel])
  const { threads, pending } = useMemo(() => channelThreads(state, channel), [state.messages, state.ops, state.pending, state.actors, channel])
  const known = state.channels[channel]
  const lastId = Math.max(threads.at(-1)?.root.id ?? 0, ...threads.map((t) => t.replies.at(-1)?.id ?? 0))
  return (
    <>
      <Header title={`#${channel}`} meta={known ? `${count(known.threads, 'thread')} · ${count(known.messages, 'message')}` : undefined} live={state.live} />
      <Feed scope={channel} first={threads[0]?.root.id ?? 0} last={lastId + pending.length} older={() => board.loadOlder(channel)}>
        {threads.length === 0 && pending.length === 0 && <p className="empty">{loading ? 'loading…' : 'nothing here yet'}</p>}
        {threads.map((t) => (
          <div key={t.root.id} className="thread">
            <MessageRow m={t.root} options={{ ...options, replies: t.replies }} />
            {t.pending.map((post) => (
              <PendingRow key={post.key} post={post} me={state.me!} reply />
            ))}
          </div>
        ))}
        {pending.map((post) => (
          <div key={post.key} className="thread">
            <PendingRow post={post} me={state.me!} />
          </div>
        ))}
      </Feed>
      <Composer
        scope={`channel:${channel}`}
        placeholder={`message #${channel}`}
        onSend={(text, { noSync }) => void board.send({ channel, re: null, text, noSync })}
      />
    </>
  )
}

function ThreadPane({ id, state, path, now }: { id: number; state: State; path: string; now: number }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    void board.loadThread(id).then(() => setMissing(!board.getState().messages[id]))
  }, [id])
  const t = useMemo(() => threadOf(state, id), [state.messages, state.ops, state.pending, state.actors, id])
  const options: RowOptions = { me: state.me!.actor, now }
  return (
    <aside className="pane">
      <Header title="thread" meta={t ? `#${t.root.channel} · #${id}` : `#${id}`}>
        <button className="close" title="close (esc)" onClick={() => navigate(path)}>
          ✕
        </button>
      </Header>
      <Feed scope={`thread:${id}`} first={id} last={(t?.replies.at(-1)?.id ?? id) + (t?.pending.length ?? 0)}>
        {!t ? (
          <p className="empty">{missing ? 'no such thread' : 'loading…'}</p>
        ) : (
          <div className="thread open">
            <MessageRow m={t.root} options={options} />
            <div className="divider">{t.replies.length === 1 ? '1 reply' : `${t.replies.length} replies`}</div>
            {t.replies.map((reply) => (
              <MessageRow key={reply.id} m={reply} options={options} />
            ))}
            {t.pending.map((post) => (
              <PendingRow key={post.key} post={post} me={state.me!} />
            ))}
          </div>
        )}
      </Feed>
      {t && (
        <Composer
          scope={`thread:${id}`}
          placeholder="reply in thread"
          onSend={(text, { noSync }) => void board.send({ channel: t.root.channel, re: id, text, noSync })}
        />
      )}
    </aside>
  )
}

/** Raw platform events: "did Slack even send it?" Not on the board's log, so not live. */
function Inbox({ entry, now }: { entry: string; now: number }) {
  const [events, setEvents] = useState<InboxEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setError(null)
    board.loadInbox(entry).then(setEvents, (e: Error) => setError(e.message))
  }
  useEffect(load, [entry])
  return (
    <>
      <Header title={`inbox · ${entry}`} meta="raw platform events, newest first">
        <button className="send" onClick={load}>
          refresh
        </button>
      </Header>
      <div className="feed-wrap">
        <div className="feed">
          {error && <p className="error">error: {error}</p>}
          {!error && events === null && <p className="empty">loading…</p>}
          {events?.length === 0 && <p className="empty">no events yet</p>}
          {events?.map((row) => {
            const event = row.event as { kind: string; text?: string; type?: string; emoji?: string; author?: { handle?: string } }
            return (
              <div key={row.id} className="inbox-row">
                <span className="time" title={row.createdAt}>
                  {ago(row.createdAt, now)}
                </span>
                <span>
                  <span className="badge">{event.kind}</span>
                </span>
                <div>
                  <div>
                    <span className="author">{event.author?.handle ?? '—'}</span> {event.text ?? event.type ?? event.emoji ?? ''}
                  </div>
                  <pre>
                    {row.channel} · {row.event.thread}
                  </pre>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
