import { observerBoard } from '@/lib/observer'
import { Live } from '../../live'
import { Threads } from '../../message'

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const board = await observerBoard()
  const thread = await board.thread(Number((await params).id))
  return (
    <>
      <header className="header">
        #{thread.message.channel} · thread #{thread.message.id}
        <Live channel={thread.message.channel} />
      </header>
      <div className="feed">
        <Threads messages={[thread.message, ...thread.replies]} />
      </div>
    </>
  )
}
