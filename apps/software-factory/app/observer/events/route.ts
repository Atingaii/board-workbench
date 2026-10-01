import { observerBoard } from '@/lib/observer'

/** Relays the board's live events to the local observer page, which refreshes on each. */
export async function GET(request: Request) {
  if (process.env.VERCEL) return new Response(null, { status: 404 })
  const board = await observerBoard()
  const channel = new URL(request.url).searchParams.get('channel')
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(stream) {
      stream.enqueue(encoder.encode(': connected\n\n'))
      try {
        for await (const event of board.events(channel ? { channel } : {}, { signal: request.signal }))
          stream.enqueue(encoder.encode(`data: ${JSON.stringify({ index: event.index, type: event.type })}\n\n`))
      } catch {}
      try {
        stream.close()
      } catch {}
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' },
  })
}
