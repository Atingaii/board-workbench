import { Ellipsis, MessageSquare, SmilePlus, Tag } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { MessageView } from '../../api/routes.ts'
import { ago, authorName, who } from '../../cli/format.ts'
import { displayEmoji } from '../../contract/emoji.ts'
import * as board from './board.ts'
import { continues, type Groupable, type Pending } from './store.ts'
import { ContextMenuArea, EmojiPicker, LabelEditor, LabelPopover, Menu, MenuEmojiRow, MenuItem, MenuSeparator, nativeMenu, type KnownLabels } from './ui.tsx'

const MENU_EMOJI = ['thumbs_up', 'heart', 'laugh', 'party', 'eyes', 'check']

export type RowOptions = {
  me: string
  now: number
  known: KnownLabels
  /** Opens a message's thread; unset inside the thread itself. */
  openThread?: (id: number) => void
  /** Shown before the author, e.g. the channel in the activity view. */
  context?: (m: MessageView) => ReactNode
  /** A root's replies, summarized under it. */
  replies?: (m: MessageView) => MessageView[]
}

const URLS_AND_MENTIONS = /(https?:\/\/[^\s<>"]+|(?<![\w@])@[a-z0-9][\w./-]*)/gi

/** Text with links and @mentions picked out. Right-clicking it gives the browser's menu. */
export function Text({ text, edited = false }: { text: string; edited?: boolean }) {
  return (
    <div className="text" {...nativeMenu}>
      {text.split(URLS_AND_MENTIONS).map((part, i) => {
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
      {edited && <span className="edited"> (edited)</span>}
    </div>
  )
}

export function Avatar({ name, url, size = 28 }: { name: string; url: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.43 }}>
      {url && !broken ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

const day = (iso: string) => new Date(iso).toDateString()

function dayLabel(iso: string, now: number): string {
  const date = new Date(iso)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return 'today'
  if (date.toDateString() === new Date(now - 86_400_000).toDateString()) return 'yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function DayDivider({ iso, now }: { iso: string; now: number }) {
  return <div className="divider">{dayLabel(iso, now)}</div>
}

/**
 * A list of messages with day dividers and author grouping. `after` is what
 * came just before the list (a thread's root), so its day isn't repeated.
 */
export function Messages(props: { messages: MessageView[]; options: RowOptions; now: number; after?: MessageView }) {
  const rows: ReactNode[] = []
  props.messages.forEach((m, i) => {
    const previous = props.messages[i - 1]
    const before = previous ?? props.after
    if (!before || day(before.createdAt) !== day(m.createdAt)) rows.push(<DayDivider key={`d${m.id}`} iso={m.createdAt} now={props.now} />)
    const grouped = continues(previous, m, previous ? (props.options.replies?.(previous).length ?? 0) > 0 : false)
    rows.push(<MessageRow key={m.id} m={m} options={props.options} continued={grouped} />)
  })
  return <>{rows}</>
}

function Editor({ m }: { m: MessageView }) {
  const [value, setValue] = useState(m.text)
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
  const save = () => {
    board.setEditing(null)
    if (value.trim() && value.trim() !== m.text) void board.edit(m.id, value.trim())
  }
  return (
    <div className="editor" {...nativeMenu}>
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            board.setEditing(null)
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            save()
          }
        }}
      />
      <span className="hint">enter to save · esc to cancel</span>
    </div>
  )
}

const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => board.toast(`copied ${what}`),
    () => board.toast(`couldn't copy ${what}`),
  )

export function MessageRow({ m, options, continued = false }: { m: MessageView; options: RowOptions; continued?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const editing = board.useEditing() === m.id
  const name = authorName(m)
  const mine = m.by.actor === options.me
  const reacted = (emoji: string) => (m.reactions[emoji] ?? []).includes(options.me)
  const toggle = (emoji: string) => void board.react(m.id, emoji, reacted(emoji))
  const replies = m.re === null ? (options.replies?.(m) ?? []) : []
  const thread = m.re ?? m.id

  const items = (
    <>
      <MenuEmojiRow emojis={MENU_EMOJI} onPick={toggle} />
      <MenuSeparator />
      {options.openThread && <MenuItem onClick={() => options.openThread!(thread)}>{m.re === null ? 'reply in thread' : 'open thread'}</MenuItem>}
      <MenuItem onClick={() => setLabelsOpen(true)}>labels…</MenuItem>
      <MenuItem onClick={() => void copy(m.text, 'text')}>copy text</MenuItem>
      <MenuItem onClick={() => void copy(String(m.id), `#${m.id}`)} hint={`#${m.id}`}>
        copy id
      </MenuItem>
      {mine && (
        <>
          <MenuSeparator />
          <MenuItem onClick={() => board.setEditing(m.id)}>edit message</MenuItem>
          <MenuItem danger onClick={() => confirm(`Delete #${m.id}? It's removed on Slack and GitHub too.`) && void board.remove(m.id)}>
            delete message
          </MenuItem>
        </>
      )}
    </>
  )

  const active = (hovered || menuOpen || labelsOpen) && !editing
  const element = (
      <div
        ref={row}
        id={`m${m.id}`}
        className={`message${continued ? ' continued' : ''}${active ? ' active' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="gutter">
          {continued ? (
            <span className="gutter-time" {...nativeMenu}>
              {new Date(m.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')}
            </span>
          ) : (
            <Avatar name={name} url={m.author?.avatar} />
          )}
        </div>
        <div className="body">
          {!continued && (
            <div className="meta-line">
              {options.context?.(m)}
              <span className="author" {...nativeMenu}>
                {name}
              </span>
              {m.from && <span className={`badge ${m.from}`}>{m.from}</span>}
              <span className="time" title={new Date(m.createdAt).toLocaleString()} {...nativeMenu}>
                {ago(m.createdAt, options.now)}
              </span>
              <span className="id">#{m.id}</span>
              {m.noSync && <span className="badge">board only</span>}
            </div>
          )}
          {m.deleted ? (
            <div className="removed" {...nativeMenu}>
              message removed
            </div>
          ) : editing ? (
            <Editor m={m} />
          ) : (
            <Text text={m.text} edited={m.editedAt !== null} />
          )}
          {(Object.keys(m.labels).length > 0 || Object.keys(m.reactions).length > 0) && (
            <div className="chips">
              {Object.entries(m.labels).map(([key, value]) => (
                <button key={key} className="label" title="edit labels" onClick={() => setLabelsOpen(true)}>
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
          {replies.length > 0 && options.openThread && (
            <button className="replies" onClick={() => options.openThread!(m.id)}>
              <span className="faces">
                {[...new Map(replies.map((r) => [r.by.actor, r])).values()].slice(-3).map((r) => (
                  <Avatar key={r.by.actor} name={authorName(r)} url={r.author?.avatar} size={16} />
                ))}
              </span>
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              <span className="time"> · last {ago(replies.at(-1)!.createdAt, options.now)}</span>
            </button>
          )}
        </div>
        {active && !m.deleted && (
          <div className="actions">
            <button className="tool" title={`${reacted('thumbs_up') ? 'remove' : 'react'} 👍`} onClick={() => toggle('thumbs_up')}>
              👍
            </button>
            <EmojiPicker trigger={<SmilePlus size={15} strokeWidth={1.75} />} onPick={toggle} onOpenChange={setMenuOpen} />
            {options.openThread && (
              <button className="tool" title={m.re === null ? 'reply in thread' : 'open thread'} onClick={() => options.openThread!(thread)}>
                <MessageSquare size={15} strokeWidth={1.75} />
              </button>
            )}
            <button className="tool" title="labels" onClick={() => setLabelsOpen(true)}>
              <Tag size={15} strokeWidth={1.75} />
            </button>
            <Menu trigger={<Ellipsis size={15} strokeWidth={1.75} />} title="more" onOpenChange={setMenuOpen}>
              {items}
            </Menu>
          </div>
        )}
        <LabelPopover open={labelsOpen} onOpenChange={setLabelsOpen} anchor={row}>
          <LabelEditor
            labels={m.labels}
            known={options.known}
            onSet={(key, value) => void board.label(m.id, { [key]: value }, [])}
            onUnset={(key) => void board.label(m.id, {}, [key])}
          />
        </LabelPopover>
      </div>
  )
  if (m.deleted) return element
  return (
    <ContextMenuArea menu={items} onOpenChange={setMenuOpen}>
      {element}
    </ContextMenuArea>
  )
}

type Me = { actor: string; name: string; handle: string; profile: string | null; avatar: string | null }

/**
 * Posts on their way, after `after` (the last message shown). Each is grouped
 * exactly as its message will be, so nothing moves when the board confirms it.
 */
export function Pendings(props: { posts: Pending[]; me: Me; after?: MessageView; afterHasReplies?: boolean }) {
  const seen = (post: Pending): Groupable => ({ by: { actor: props.me.actor } as MessageView['by'], createdAt: post.createdAt, deleted: false, channel: post.channel, re: post.re })
  return (
    <>
      {props.posts.map((post, i) => {
        const previous = i === 0 ? props.after : seen(props.posts[i - 1]!)
        const continued = continues(previous, seen(post), i === 0 ? (props.afterHasReplies ?? false) : false)
        return <PendingRow key={post.key} post={post} me={props.me} continued={continued} />
      })}
    </>
  )
}

/** A post on its way, or one that didn't make it. */
export function PendingRow({ post, me, continued = false }: { post: Pending; me: Me; continued?: boolean }) {
  const status = post.error ? "didn't send" : 'sending…'
  return (
    <div className={`message pending${continued ? ' continued' : ''}${post.error ? ' failed' : ''}`}>
      <div className="gutter">
        {continued ? (
          <span className="gutter-time shown" title={status}>
            …
          </span>
        ) : (
          <Avatar name={who(me)} url={me.avatar} />
        )}
      </div>
      <div className="body">
        {!continued && (
          <div className="meta-line">
            <span className="author">{who(me)}</span>
            <span className="time">{status}</span>
          </div>
        )}
        <Text text={post.text} />
        {post.error && (
          <div className="undelivered">
            ✗ {post.error} · <button onClick={() => void board.retry(post)}>retry</button> · <button onClick={() => board.discard(post.key)}>discard</button>
          </div>
        )}
      </div>
    </div>
  )
}
