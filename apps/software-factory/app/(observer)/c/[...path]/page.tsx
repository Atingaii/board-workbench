import { observerBoard } from '@/lib/observer'
import { Live } from '../../live'
import { Threads } from '../../message'

export default async function ChannelPage({ params }: { params: Promise<{ path: string[] }> }) {
  const channel = (await params).path.map(decodeURIComponent).join('/')
  const board = await observerBoard()
  const page = await board.messages({ channel, limit: 200 })
  return (
    <>
      <header className="header">
        #{channel}
        <span className="meta">cursor {page.cursor}</span>
        <Live channel={channel} />
      </header>
      <div className="feed">
        <Threads messages={page.messages} />
      </div>
    </>
  )
}
