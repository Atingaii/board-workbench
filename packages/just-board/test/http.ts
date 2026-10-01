import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Serves a Fetch API handler over real HTTP on a free local port. */
export async function serve(handler: (request: Request) => Promise<Response>) {
  const server = createServer(async (req, res) => {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === 'string') headers.set(key, value)
    const response = await handler(
      new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers,
        ...(body && body.length > 0 ? { body: new Uint8Array(body) } : {}),
        signal: controller.signal,
      }),
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      try {
        for await (const chunk of response.body) res.write(chunk)
      } catch {}
    }
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
