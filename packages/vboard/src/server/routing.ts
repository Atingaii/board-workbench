import { z } from 'zod'
import { routes } from '../api/routes.ts'
import type { Method } from '../api/protocol.ts'
import { ATTACHMENT_BYTES_MAX } from '../contract/schemas.ts'
import { VERSION } from '../version.ts'
import type { BackendRoute } from './backend.ts'
import { badRequest, HttpError } from './errors.ts'

/** What a request is for: one of board()'s own routes, a protocol method, or one of the backend's routes. */
export type Target = { kind: 'board'; name: 'discovery' | 'avatar' | 'openapi' } | { kind: 'protocol'; name: Method } | { kind: 'backend'; route: BackendRoute }

export type Match = { target: Target; base: string; param: string | null }

type Pattern = { method: string; pattern: RegExp; target: Target; segments: number; literals: number; own: boolean }

/** Every protocol method, by the route it's served at. */
export const METHODS: readonly Method[] = [
  'me', 'channels', 'actors', 'identity', 'messages', 'threads', 'message', 'post', 'edit', 'delete', 'react', 'label', 'typing',
  'schedule', 'schedules', 'cancelSchedule', 'upload', 'attachment', 'watchers', 'register', 'matches', 'ack', 'events',
]

const escape = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function compile(method: string, path: string, target: Target, own: boolean): Pattern {
  const parts = path.split('/').filter(Boolean)
  const source = parts.map((part) => (part.startsWith(':') ? '/([^/]+)' : `/${escape(part)}`)).join('')
  return {
    method,
    pattern: new RegExp(`${source}$`),
    target,
    segments: parts.length,
    literals: parts.filter((part) => !part.startsWith(':')).length,
    own,
  }
}

/**
 * The routes a board answers, most specific first: each is matched as a suffix of the request's
 * path, so `/api/board/messages/12` is `GET /messages/:id` under `/api/board`. A backend's own
 * route at a protocol path takes its place.
 */
export function createRouter(backendRoutes: readonly BackendRoute[], basePath?: string) {
  const patterns: Pattern[] = [
    compile('GET', '/avatars/:name', { kind: 'board', name: 'avatar' }, false),
    compile('GET', '/openapi.json', { kind: 'board', name: 'openapi' }, false),
    ...METHODS.map((name) => compile(routes[name].method, routes[name].path, { kind: 'protocol', name }, false)),
    ...backendRoutes.map((route) => compile(route.method, route.path, { kind: 'backend', route }, true)),
  ].sort((a, b) => b.segments - a.segments || b.literals - a.literals || Number(b.own) - Number(a.own))

  /** A segment that isn't URI-encoded names nothing: no route. */
  const found = (candidate: Pattern, base: string, param: string | undefined): Match | null => {
    if (param === undefined) return { target: candidate.target, base, param: null }
    try {
      return { target: candidate.target, base, param: decodeURIComponent(param) }
    } catch {
      return null
    }
  }

  return function route(method: string, pathname: string): Match | null {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
    if (basePath !== undefined) {
      const base = basePath.replace(/\/+$/, '')
      if (path !== base && !path.startsWith(`${base}/`)) return null
      const rest = path.slice(base.length) || '/'
      if (rest === '/') return method === 'GET' ? { target: { kind: 'board', name: 'discovery' }, base, param: null } : null
      for (const candidate of patterns) {
        const hit = candidate.method === method ? rest.match(new RegExp(`^${candidate.pattern.source}`)) : null
        if (hit) return found(candidate, base, hit[1])
      }
      return null
    }
    for (const candidate of patterns) {
      if (candidate.method !== method) continue
      const hit = path.match(candidate.pattern)
      if (hit) return found(candidate, path.slice(0, hit.index), hit[1])
    }
    return method === 'GET' ? { target: { kind: 'board', name: 'discovery' }, base: path === '/' ? '' : path, param: null } : null
  }
}

export function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    out[key] = values.length > 1 ? values : values[0]!
  }
  return out
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('request body is not valid JSON')
  }
}

const tooLarge = () => new HttpError(413, 'too_large', `attachments are at most ${ATTACHMENT_BYTES_MAX / 1024 / 1024} MB`)

/** The body, refused as soon as it's past `max`: with or without a `content-length`, it never reads more. */
export async function readCapped(request: Request, max: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') ?? 0) > max) throw tooLarge()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength
    if (size > max) throw tooLarge()
    chunks.push(chunk)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return body
}

export function openapi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const [name, definition] of Object.entries(routes)) {
    const path = definition.path.replace(/:(\w+)/g, '{$1}')
    const operation: Record<string, unknown> = { operationId: name }
    if ('query' in definition) operation['x-query-schema'] = z.toJSONSchema(definition.query, { io: 'input' })
    if ('body' in definition)
      operation.requestBody = {
        content: { 'application/json': { schema: z.toJSONSchema(definition.body, { io: 'input' }) } },
      }
    ;(paths[path] ??= {})[definition.method.toLowerCase()] = operation
  }
  return { openapi: '3.1.0', info: { title: 'vboard', version: VERSION }, paths }
}
