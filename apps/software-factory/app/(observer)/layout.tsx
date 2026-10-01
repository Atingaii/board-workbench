import type { ReactNode } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { localOnly, observerBoard } from '@/lib/observer'

export default async function ObserverLayout({ children }: { children: ReactNode }) {
  localOnly()
  await connection()
  const board = await observerBoard()
  let channels: Awaited<ReturnType<typeof board.channels>> = []
  let error: string | null = null
  try {
    channels = await board.channels()
  } catch (e) {
    error = (e as Error).message
  }

  // Channels grouped by path prefix, like Just Chat's sidebar.
  const groups = new Map<string, typeof channels>()
  for (const channel of channels) {
    const at = channel.path.lastIndexOf('/')
    const group = at === -1 ? 'channels' : channel.path.slice(0, at)
    groups.set(group, [...(groups.get(group) ?? []), channel])
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">software factory</div>
        <Link href="/">activity</Link>
        {[...groups].map(([group, list]) => (
          <div key={group}>
            <h2>{group}</h2>
            {list.map((channel) => (
              <Link key={channel.path} href={`/c/${channel.path}`}>
                <span>#{channel.path.slice(channel.path.lastIndexOf('/') + 1)}</span>
                <span className="count">{channel.threads}</span>
              </Link>
            ))}
          </div>
        ))}
        <h2>inbox</h2>
        <Link href="/inbox/slack">slack</Link>
        <Link href="/inbox/github">github</Link>
        {error && <p className="empty">{error}</p>}
      </nav>
      <main className="main">{children}</main>
    </div>
  )
}
