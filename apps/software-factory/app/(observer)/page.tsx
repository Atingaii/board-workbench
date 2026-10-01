import { observerBoard } from '@/lib/observer'
import { Live } from './live'
import { Threads } from './message'

export default async function Activity() {
  const board = await observerBoard()
  const page = await board.messages({ limit: 100 })
  return (
    <>
      <header className="header">
        activity
        <span className="meta">{board.url} · cursor {page.cursor}</span>
        <Live />
      </header>
      <div className="feed">
        <Threads messages={page.messages} />
      </div>
    </>
  )
}
