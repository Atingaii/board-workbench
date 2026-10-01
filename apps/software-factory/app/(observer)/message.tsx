import type { MessageView } from 'just-board'
import { ago } from '@/lib/observer'

const EMOJI: Record<string, string> = {
  eyes: '👀',
  white_check_mark: '✅',
  thumbs_up: '👍',
  '+1': '👍',
  heart: '❤️',
  tada: '🎉',
  rocket: '🚀',
  x: '❌',
}

/** "claude via julian" for a profile, the name otherwise. */
export function authorName(message: MessageView): string {
  const author = message.author
  if (!author) return message.by.actor
  const slash = author.handle.indexOf('/')
  return message.by.profile !== null && slash !== -1 ? `${author.name} via ${author.handle.slice(0, slash)}` : author.name
}

export function Message({ message, reply = false }: { message: MessageView; reply?: boolean }) {
  const name = authorName(message)
  return (
    <div className={`message${reply ? ' reply' : ''}`}>
      <div className="avatar">
        {message.author?.avatar ? <img src={message.author.avatar} alt="" /> : name.slice(0, 1).toUpperCase()}
      </div>
      <div>
        <div className="meta-line">
          <span className="author">{name}</span>
          {message.from && <span className={`badge ${message.from}`}>{message.from}</span>}
          <span className="time">{ago(message.createdAt)}</span>
          <span className="id">#{message.id}</span>
          {message.editedAt && <span className="time">(edited)</span>}
          {message.noSync && <span className="badge">board only</span>}
        </div>
        {message.deleted ? (
          <div className="removed">message removed</div>
        ) : (
          <div className="text">{message.text}</div>
        )}
        {(Object.keys(message.labels).length > 0 || Object.keys(message.reactions).length > 0) && (
          <div className="chips">
            {Object.entries(message.labels).map(([key, value]) => (
              <span key={key} className="label">
                {key}={value}
              </span>
            ))}
            {Object.entries(message.reactions).map(([emoji, actors]) => (
              <span key={emoji} className="chip" title={actors.join(', ')}>
                {EMOJI[emoji] ?? `:${emoji}:`} {actors.length}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Roots in order, each followed by its replies. */
export function Threads({ messages }: { messages: MessageView[] }) {
  const replies = new Map<number, MessageView[]>()
  const roots: MessageView[] = []
  for (const message of messages) {
    if (message.re === null) roots.push(message)
    else replies.set(message.re, [...(replies.get(message.re) ?? []), message])
  }
  if (roots.length === 0) return <p className="empty">nothing here yet</p>
  return (
    <>
      {roots.map((root) => (
        <div key={root.id} className="thread">
          <Message message={root} />
          {(replies.get(root.id) ?? []).map((reply) => (
            <Message key={reply.id} message={reply} reply />
          ))}
        </div>
      ))}
    </>
  )
}
