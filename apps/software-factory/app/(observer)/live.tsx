'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Re-renders the page whenever a matching board event arrives. */
export function Live({ channel }: { channel?: string }) {
  const router = useRouter()
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const source = new EventSource(`/observer/events${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`)
    let pending: ReturnType<typeof setTimeout> | undefined
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = () => {
      clearTimeout(pending)
      pending = setTimeout(() => router.refresh(), 150)
    }
    return () => {
      clearTimeout(pending)
      source.close()
    }
  }, [channel, router])
  return (
    <span className={`live${connected ? ' on' : ''}`}>
      <i />
      {connected ? 'live' : 'connecting'}
    </span>
  )
}
