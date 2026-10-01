import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { MessageView } from '../../api/routes.ts'
import { ago, authorName } from '../../cli/format.ts'
import { displayEmoji } from '../../contract/emoji.ts'
import { EMOJI_TABLE } from '../../contract/emoji-table.ts'
import * as board from './board.ts'
import type { Pending } from './store.ts'

// --- navigation: history API, no reloads -------------------------------------------

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}

export function useLocation(): { path: string; thread: number | null } {
  const read = () => {
    const thread = Number(new URLSearchParams(location.search).get('thread'))
    return { path: location.pathname, thread: Number.isInteger(thread) && thread > 0 ? thread : null }
  }
  const [where, setWhere] = useState(read)
  useEffect(() => {
    const update = () => setWhere(read())
    addEventListener('popstate', update)
    return () => removeEventListener('popstate', update)
  }, [])
  return where
}

export function Link(props: { to: string; className?: string; current?: boolean; title?: string; children: ReactNode }) {
  return (
    <a
      href={props.to}
      className={props.className}
      title={props.title}
      aria-current={props.current ? 'page' : undefined}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(props.to)
      }}
    >
      {props.children}
    </a>
  )
}

/** The current time, ticking, so "2m" ages without a reload. */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}

// --- messages ----------------------------------------------------------------------

const QUICK_REACTIONS = ['eyes', 'check', 'thumbs_up', 'party']
const PICKER = Object.entries(EMOJI_TABLE).map(([name, entry]) => ({ name, character: entry.characters[0]! }))

const TOKENS = /(https?:\/\/[^\s<>"]+|(?<![\w@])@[a-z0-9][\w./-]*)/gi

/** Text with links and @mentions picked out. */
export function Text({ text }: { text: string }) {
  const parts = text.split(TOKENS)
  return (
    <div className="text">
      {parts.map((part, i) => {
        if (i % 2 === 0) return part
        if (part.startsWith('@')) return <span key={i} className="mention">{part}</span>
        const trail = /[.,;:!?)\]]+$/.exec(part)?.[0] ?? ''
        const url = part.slice(0, part.length - trail.length)
        return (
          <span key={i}>
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
            {trail}
          </span>
        )
      })}
    </div>
  )
}

export function Avatar({ name, url }: { name: string; url: string | null | undefined }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="avatar">
      {url && !broken ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : name.slice(0, 1).toUpperCase()}
    </div>
  )
}

const PICKER_COLUMNS = 12
const PICKER_WIDTH = PICKER_COLUMNS * 32 + 12
const PICKER_HEIGHT = Math.ceil(PICKER.length / PICKER_COLUMNS) * 32 + 12

/** Every reaction at once, placed against the window so no scrolling list can clip it. */
function Picker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (event: MouseEvent) => ref.current && !ref.current.contains(event.target as Node) && onClose()
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    // It's fixed in place, so it would drift from its message.
    const scrolled = (event: Event) => !ref.current?.contains(event.target as Node) && onClose()
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', scrolled, true)
    }
  }, [onClose])
  const below = anchor.bottom + 4 + PICKER_HEIGHT <= innerHeight
  const style = {
    top: below ? anchor.bottom + 4 : Math.max(8, anchor.top - PICKER_HEIGHT - 4),
    left: Math.max(8, Math.min(anchor.right - PICKER_WIDTH, innerWidth - PICKER_WIDTH - 8)),
    width: PICKER_WIDTH,
  }
  return (
    <div className="picker" ref={ref} style={style}>
      {PICKER.map(({ name, character }) => (
        <button key={name} title={`:${name}:`} onClick={() => onPick(name)}>
          {character}
        </button>
      ))}
    </div>
  )
}

/** A one-line editor: Enter saves, Escape cancels. */
function Inline(props: { initial: string; placeholder?: string; multiline?: boolean; onSave: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])
  return (
    <div className="inline">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={props.placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            props.onCancel()
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (value.trim()) props.onSave(value.trim())
          }
        }}
      />
      <span className="hint">enter to save · esc to cancel</span>
    </div>
  )
}

export type RowOptions = {
  me: string
  now: number
  /** Opens the message's thread; unset inside the thread itself. */
  openThread?: (id: number) => void
  /** Shown before the author, e.g. the channel in the activity view. */
  context?: ReactNode
  /** For a root in a channel: its replies, summarized. */
  replies?: MessageView[]
  reply?: boolean
}

export function MessageRow({ m, options }: { m: MessageView; options: RowOptions }) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'label' | 'pick'>('idle')
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const name = authorName(m)
  const mine = m.by.actor === options.me
  const reacted = (emoji: string) => (m.reactions[emoji] ?? []).includes(options.me)
  const toggle = (emoji: string) => void board.react(m.id, emoji, reacted(emoji))
  const root = m.re === null
  const replies = options.replies ?? []
  const last = replies[replies.length - 1]
  return (
    <div className={`message${options.reply ? ' reply' : ''}${mode !== 'idle' ? ' active' : ''}`} id={`m${m.id}`}>
      <Avatar name={name} url={m.author?.avatar} />
      <div className="body">
        <div className="meta-line">
          {options.context}
          <span className="author">{name}</span>
          {m.from && <span className={`badge ${m.from}`}>{m.from}</span>}
          <span className="time" title={new Date(m.createdAt).toLocaleString()}>
            {ago(m.createdAt, options.now)}
          </span>
          <span className="id">#{m.id}</span>
          {m.editedAt && <span className="time">(edited)</span>}
          {m.noSync && <span className="badge">board only</span>}
        </div>
        {m.deleted ? (
          <div className="removed">message removed</div>
        ) : mode === 'edit' ? (
          <Inline
            initial={m.text}
            multiline
            onCancel={() => setMode('idle')}
            onSave={(text) => {
              setMode('idle')
              if (text !== m.text) void board.edit(m.id, text)
            }}
          />
        ) : (
          <Text text={m.text} />
        )}
        {mode === 'label' && (
          <Inline
            initial=""
            placeholder="key=value, or -key to remove"
            onCancel={() => setMode('idle')}
            onSave={(value) => {
              setMode('idle')
              if (value.startsWith('-')) return void board.label(m.id, {}, [value.slice(1)])
              const at = value.indexOf('=')
              if (at <= 0) return board.toast('labels look like key=value, or -key to remove one')
              void board.label(m.id, { [value.slice(0, at)]: value.slice(at + 1) }, [])
            }}
          />
        )}
        {(Object.keys(m.labels).length > 0 || Object.keys(m.reactions).length > 0) && (
          <div className="chips">
            {Object.entries(m.labels).map(([key, value]) => (
              <button key={key} className="label" title={`remove ${key}`} onClick={() => void board.label(m.id, {}, [key])}>
                {key}={value}
              </button>
            ))}
            {Object.entries(m.reactions).map(([emoji, actors]) => (
              <button key={emoji} className={`chip${reacted(emoji) ? ' mine' : ''}`} title={`:${emoji}: ${actors.join(', ')}`} onClick={() => toggle(emoji)}>
                {displayEmoji(emoji)} {actors.length}
              </button>
            ))}
          </div>
        )}
        {Object.entries(m.undelivered ?? {}).map(([target, error]) => (
          <div key={target} className="undelivered">
            ✗ didn't reach {target}: {error}
          </div>
        ))}
        {root && options.openThread && replies.length > 0 && (
          <button className="replies" onClick={() => options.openThread!(m.id)}>
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            {last && <span className="time"> · last {ago(last.createdAt, options.now)}</span>}
          </button>
        )}
        {!m.deleted && (
          <div className="actions">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} title={`${reacted(emoji) ? 'remove' : 'react'} :${emoji}:`} onClick={() => toggle(emoji)}>
                {displayEmoji(emoji)}
              </button>
            ))}
            <button
              title="more reactions"
              onClick={(event) => {
                setAnchor(event.currentTarget.getBoundingClientRect())
                setMode(mode === 'pick' ? 'idle' : 'pick')
              }}
            >
              ＋
            </button>
            {options.openThread && (
              <button onClick={() => options.openThread!(m.re ?? m.id)}>{root ? 'reply' : 'thread'}</button>
            )}
            <button onClick={() => setMode('label')}>label</button>
            {mine && <button onClick={() => setMode('edit')}>edit</button>}
            {mine && (
              <button onClick={() => confirm(`Delete #${m.id}?`) && void board.remove(m.id)}>delete</button>
            )}
            {mode === 'pick' && anchor && (
              <Picker
                anchor={anchor}
                onClose={() => setMode('idle')}
                onPick={(emoji) => {
                  setMode('idle')
                  toggle(emoji)
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A post on its way, or one that didn't make it. */
export function PendingRow({ post, me, reply }: { post: Pending; me: { name: string; avatar: string | null }; reply?: boolean }) {
  return (
    <div className={`message pending${reply ? ' reply' : ''}${post.error ? ' failed' : ''}`}>
      <Avatar name={me.name} url={me.avatar} />
      <div className="body">
        <div className="meta-line">
          <span className="author">{me.name}</span>
          <span className="time">{post.error ? "didn't send" : 'sending…'}</span>
        </div>
        <Text text={post.text} />
        {post.error && (
          <div className="undelivered">
            ✗ {post.error} · <button onClick={() => void board.retry(post)}>retry</button> ·{' '}
            <button onClick={() => board.discard(post.key)}>discard</button>
          </div>
        )}
      </div>
    </div>
  )
}

// --- composing ---------------------------------------------------------------------

const drafts = new Map<string, string>()

/** Enter sends, Shift+Enter breaks a line. Each place keeps its own draft. */
export function Composer(props: {
  scope: string
  placeholder: string
  pickChannel?: boolean
  onSend: (text: string, options: { noSync: boolean; channel: string }) => void
}) {
  const [text, setText] = useState(() => drafts.get(props.scope) ?? '')
  const [channel, setChannel] = useState('')
  const [noSync, setNoSync] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    setText(drafts.get(props.scope) ?? '')
    ref.current?.focus()
  }, [props.scope])
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])
  const submit = () => {
    const value = text.trim()
    if (!value) return
    const target = channel.trim().replace(/^#/, '')
    if (props.pickChannel && !target) return board.toast('pick a channel to post in')
    props.onSend(value, { noSync, channel: target })
    setText('')
    drafts.delete(props.scope)
  }
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {props.pickChannel && (
        <input className="channel" list="channels" placeholder="channel, e.g. www/errors" value={channel} onChange={(event) => setChannel(event.target.value)} />
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={props.placeholder}
        onChange={(event) => {
          setText(event.target.value)
          drafts.set(props.scope, event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="row">
        <label>
          <input type="checkbox" checked={noSync} onChange={(event) => setNoSync(event.target.checked)} /> board only
        </label>
        <span className="hint">enter to send · shift+enter for a new line</span>
        <button className="send" disabled={!text.trim()}>
          send
        </button>
      </div>
    </form>
  )
}

// --- the scrolling list --------------------------------------------------------------

/**
 * Keeps to the bottom while you're there, holds still while you read history,
 * and keeps your place when older messages load above.
 */
export function Feed(props: {
  scope: string
  first: number
  last: number
  older?: () => Promise<boolean>
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const loading = useRef(false)
  const done = useRef(false)
  const first = useRef(props.first)
  first.current = props.first
  const lastSeen = useRef(props.last)
  const [behind, setBehind] = useState(false)

  const toBottom = () => {
    const el = ref.current!
    el.scrollTop = el.scrollHeight
    pinned.current = true
    setBehind(false)
  }

  useLayoutEffect(() => {
    toBottom()
    lastSeen.current = props.last
    done.current = false
  }, [props.scope])

  useLayoutEffect(() => {
    const el = ref.current!
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
    } else if (pinned.current) el.scrollTop = el.scrollHeight
    else if (props.last > lastSeen.current) setBehind(true)
    lastSeen.current = props.last
  }, [props.first, props.last])

  // Reactions, edits, and images change heights without changing the list.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (pinned.current && !restore.current) ref.current!.scrollTop = ref.current!.scrollHeight
    })
    observer.observe(content.current!)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="feed-wrap">
      <div
        className="feed"
        ref={ref}
        onScroll={() => {
          const el = ref.current!
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          if (pinned.current) setBehind(false)
          if (el.scrollTop < 240 && props.older && !loading.current && !done.current) {
            loading.current = true
            const before = first.current
            restore.current = { height: el.scrollHeight, top: el.scrollTop }
            void props.older().then((more) =>
              // After the render that shows them: if nothing came in above, there's no place to keep.
              requestAnimationFrame(() => {
                if (first.current === before) restore.current = null
                loading.current = false
                done.current = !more
              }),
            )
          }
        }}
      >
        <div ref={content}>{props.children}</div>
      </div>
      {behind && (
        <button className="jump" onClick={toBottom}>
          new messages ↓
        </button>
      )}
    </div>
  )
}

export function Toasts() {
  const toasts = board.useToasts()
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  )
}
