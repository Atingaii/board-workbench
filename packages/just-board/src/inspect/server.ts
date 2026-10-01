import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Me } from '../api/routes.ts'
import { BoardError, type BoardClient } from '../client/client.ts'
import * as views from './views.ts'

/** A browser UI for one board, on this machine, reading and writing as the client's identity. */
export type Inspector = {
  url: string
  board: string
  me: Me
  close(): Promise<void>
}

export const DEFAULT_PORT = 4747

class InputError extends Error {}

/**
 * Serves the inspector on 127.0.0.1. It writes as you, so every request must
 * name this server's own host (no DNS rebinding), and every write must come
 * from its own pages: same `Origin`, plus a token only those pages carry.
 */
export async function startInspector(options: { client: BoardClient; port?: number }): Promise<Inspector> {
  const { client } = options
  const me = await client.me()
  const sync = (await client.discovery().catch(() => null))?.sync ?? []
  const token = randomBytes(24).toString('base64url')
  let origins = new Set<string>()
  const streams = new Set<AbortController>()

  const actions: Record<string, (body: Record<string, unknown>) => Promise<Record<string, unknown> | void>> = {
    post: async (body) => {
      const channel = text(body.channel, 'channel').trim().replace(/^#/, '')
      return { id: (await client.post(channel, { text: text(body.text, 'text'), ...(yes(body.noSync) ? { noSync: true } : {}) })).id }
    },
    reply: async (body) => ({
      id: (await client.reply(messageId(body.id), { text: text(body.text, 'text'), ...(yes(body.noSync) ? { noSync: true } : {}) })).id,
    }),
    react: async (body) => void (await client.react(messageId(body.id), text(body.emoji, 'emoji'), { remove: yes(body.remove) })),
    edit: async (body) => void (await client.edit(messageId(body.id), text(body.text, 'text'))),
    delete: async (body) => void (await client.delete(messageId(body.id))),
    label: async (body) => {
      const value = text(body.label, 'label').trim()
      if (value.startsWith('-')) return void (await client.label(messageId(body.id), { unset: [value.slice(1)] }))
      const at = value.indexOf('=')
      if (at <= 0) throw new InputError('labels look like key=value, or -key to remove one')
      await client.label(messageId(body.id), { set: { [value.slice(0, at)]: value.slice(at + 1) } })
    },
  }

  async function view(path: string, viewer: views.Viewer): Promise<views.View> {
    if (path === '/') {
      const { messages, cursor } = await client.messages({ limit: 100 })
      return { title: 'activity', meta: `latest 100 · cursor ${cursor}`, feed: views.threads(messages, viewer), composer: views.newThread() }
    }
    if (path.startsWith('/c/')) {
      const channel = path.slice(3)
      const { messages, cursor } = await client.messages({ channel, limit: 200 })
      return {
        title: `#${channel}`,
        meta: `cursor ${cursor}`,
        live: channel,
        feed: views.threads(messages, viewer),
        composer: views.newThread(channel),
      }
    }
    const thread = /^\/t\/(\d+)$/.exec(path)
    if (thread) {
      const { message, replies } = await client.thread(Number(thread[1]))
      return {
        title: `#${message.channel} · thread #${message.id}`,
        live: message.channel,
        feed: views.threads([message, ...replies], viewer),
        composer: views.replyTo(message.id),
      }
    }
    if (path.startsWith('/inbox/')) {
      const key = path.slice(7)
      return {
        title: `inbox · ${key}`,
        meta: 'raw platform events, newest first',
        live: 'off',
        feed: views.inbox(await client.inbox(key, { limit: 100 })),
      }
    }
    throw new BoardError('not_found', `nothing at ${path}`, 404)
  }

  async function page(request: IncomingMessage, response: ServerResponse, url: URL) {
    let path: string
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return send(response, 400, 'text/plain; charset=utf-8', 'bad path')
    }
    const viewer = { me, path }
    let status = 200
    let shown: views.View
    try {
      shown = await view(path, viewer)
    } catch (error) {
      status = error instanceof BoardError && error.status >= 400 ? error.status : 502
      shown = { title: 'error', live: 'off', feed: views.failure((error as Error).message) }
    }
    if (request.headers['x-inspect-fragment'] === '1') return send(response, status, 'text/html; charset=utf-8', shown.feed.value)
    const nonce = randomBytes(16).toString('base64')
    const channels = await client.channels().catch(() => [])
    const body = views.page({ ...viewer, board: client.url, sync, channels, token, nonce }, shown)
    send(response, status, 'text/html; charset=utf-8', body, {
      'content-security-policy': [
        "default-src 'none'",
        'img-src https: http://localhost:* http://127.0.0.1:* data:',
        "style-src 'unsafe-inline'",
        `script-src 'nonce-${nonce}'`,
        "connect-src 'self'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    })
  }

  /** Board events, relayed so the page knows when to re-render. */
  async function relay(request: IncomingMessage, response: ServerResponse, url: URL) {
    const controller = new AbortController()
    streams.add(controller)
    request.on('close', () => controller.abort())
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.write(': live\n\n')
    const channel = url.searchParams.get('channel')
    try {
      for await (const event of client.events(channel ? { channel } : {}, { signal: controller.signal }))
        response.write(`data: ${JSON.stringify({ index: event.index, type: event.type })}\n\n`)
    } catch {
      // The board refused the stream; the page shows it as reconnecting.
    } finally {
      streams.delete(controller)
      response.end()
    }
  }

  async function act(request: IncomingMessage, response: ServerResponse, action: string) {
    const given = String(request.headers['x-inspect-token'] ?? '')
    if (!origins.has(String(request.headers.origin)) || !sameSecret(given, token))
      return json(response, 403, { error: { code: 'forbidden', message: "writes come only from the inspector's own pages" } })
    const run = actions[action]
    if (!run) return json(response, 404, { error: { code: 'not_found', message: `no action: ${action}` } })
    try {
      const body = JSON.parse(await read(request)) as unknown
      if (!body || typeof body !== 'object') throw new InputError('expected a JSON object')
      json(response, 200, { ok: true, ...(await run(body as Record<string, unknown>)) })
    } catch (error) {
      const status =
        error instanceof BoardError && error.status >= 400 ? error.status : error instanceof InputError || error instanceof SyntaxError ? 400 : 500
      json(response, status, { error: { code: error instanceof BoardError ? error.code : 'error', message: (error as Error).message } })
    }
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://inspector')
    const handled = !origins.has(`http://${request.headers.host}`)
      ? send(response, 421, 'text/plain; charset=utf-8', 'wrong host')
      : request.method === 'POST' && url.pathname.startsWith('/do/')
        ? act(request, response, url.pathname.slice(4))
        : request.method !== 'GET'
          ? send(response, 405, 'text/plain; charset=utf-8', 'method not allowed')
          : url.pathname === '/events'
            ? relay(request, response, url)
            : page(request, response, url)
    Promise.resolve(handled).catch((error: unknown) => {
      if (response.headersSent) response.end()
      else send(response, 500, 'text/plain; charset=utf-8', `error: ${(error as Error).message}`)
    })
  })

  const port = await listen(server, options.port ?? DEFAULT_PORT, options.port === undefined)
  origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  return {
    url: `http://127.0.0.1:${port}`,
    board: client.url,
    me,
    close: () =>
      new Promise<void>((resolve) => {
        for (const stream of streams) stream.abort()
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new InputError(`missing ${name}`)
  return value
}

function messageId(value: unknown): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new InputError('missing message id')
  return id
}

const yes = (value: unknown) => value === true || value === 'on' || value === 'true' || value === '1'

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function read(request: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new InputError('request too large'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(response: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}) {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  response.end(body)
}

const json = (response: ServerResponse, status: number, body: unknown) =>
  send(response, status, 'application/json', JSON.stringify(body))

/** Listens on the port, or any free one when the default port is taken. */
async function listen(server: Server, port: number, fallback: boolean): Promise<number> {
  try {
    return await listenOn(server, port)
  } catch (error) {
    if (fallback && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') return listenOn(server, 0)
    throw error
  }
}

function listenOn(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}
