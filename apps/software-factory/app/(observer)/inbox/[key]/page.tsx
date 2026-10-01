import { observerBoard, ago } from '@/lib/observer'

/** Raw platform events: "did Slack even send it?" */
export default async function InboxPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const board = await observerBoard()
  let events: Awaited<ReturnType<typeof board.inbox>> = []
  let error: string | null = null
  try {
    events = await board.inbox(key, { limit: 100 })
  } catch (e) {
    error = (e as Error).message
  }
  return (
    <>
      <header className="header">
        inbox · {key}
        <span className="meta">raw platform events, newest first</span>
      </header>
      <div className="feed">
        {error && <p className="empty">{error}</p>}
        {!error && events.length === 0 && <p className="empty">no events yet</p>}
        {events.map((entry) => {
          const event = entry.event as { kind: string; text?: string; type?: string; emoji?: string; author?: { handle: string } }
          return (
            <div key={entry.id} className="inbox-row">
              <span className="time">{ago(entry.createdAt)}</span>
              <span className="badge">{event.kind}</span>
              <div>
                <div>
                  <span className="author">{event.author?.handle ?? '—'}</span> {event.text ?? event.type ?? event.emoji ?? ''}
                </div>
                <pre>{entry.channel} · {entry.event.thread}</pre>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
