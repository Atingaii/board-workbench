// Blocks: JSON in a message's text, in a code fence that names its schema (```json#sandbox@1).
// The text stays the message: a block is read out of it, never kept beside it. Pure, with no
// imports but the schema ID's shape, so a board and a handle anywhere read the same blocks.

import { parseSchemaId } from './data-schemas.ts'

/** A fence in a message's text that names a schema, and what it holds. */
export type FoundBlock = {
  /** The schema as its fence names it: `sandbox@1`, or whatever follows `json#` when that names none. */
  id: string
  /** Its name and version, when `id` is one. */
  name?: string
  version?: number
  /** What's between its fences, as written. */
  source: string
  /** Its data, when the source is a JSON object. */
  data?: Record<string, unknown>
  /** Why it has no data: its ID names no schema, its JSON doesn't parse or isn't an object, or its fence never closes. */
  problem?: string
  /** Where it is in the text: from the start of its opening fence's line to the end of its closing fence. */
  start: number
  end: number
}

// A fence opens a line, indented three spaces at most: more is indented code, and a quote's or a
// list's own fence starts with their marker, so quoting a block doesn't post it again.
const OPENING = /^( {0,3})(`{3,}|~{3,})(.*)$/
const BLOCK_INFO = /^json#(\S*)/

type Open = { fence: string; info: string; start: number; content: number }

/** Whether `line` closes `open`: the same character, at least as many, and nothing after but spaces. */
function closes(line: string, open: Open): boolean {
  const found = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  return found !== null && found[1]![0] === open.fence[0] && found[1]!.length >= open.fence.length
}

/** What a block's source holds: its data, or why it has none. */
function read(id: string, source: string): Pick<FoundBlock, 'name' | 'version' | 'data' | 'problem'> {
  const named = parseSchemaId(id)
  if (!named) return { problem: `${id || 'json#'} names no schema: one is name@version, like sandbox@1` }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ...named, problem: `the ${id} block isn't JSON` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...named, problem: `the ${id} block isn't a JSON object` }
  return { ...named, data: parsed as Record<string, unknown> }
}

/**
 * The blocks in `text`, in order: each code fence whose info string is `json#<name>@<version>`.
 * A fence inside another fence is that fence's text, so a message can show one without posting it,
 * in a longer fence. One with a `problem` has no `data`.
 */
export function findBlocks(text: string): FoundBlock[] {
  const blocks: FoundBlock[] = []
  let open: Open | null = null
  let at = 0
  const emit = (to: Open, sourceEnd: number, end: number, unclosed = false) => {
    const id = BLOCK_INFO.exec(to.info)?.[1]
    if (id === undefined) return
    const source = text.slice(to.content, Math.max(to.content, sourceEnd))
    blocks.push({ id, source, ...(unclosed ? { ...(parseSchemaId(id) ?? {}), problem: `the ${id} block's fence never closes` } : read(id, source)), start: to.start, end })
  }
  while (at <= text.length) {
    const newline = text.indexOf('\n', at)
    const end = newline === -1 ? text.length : newline
    const line = text.slice(at, end).replace(/\r$/, '')
    if (open) {
      if (closes(line, open)) {
        // The source ends before the line break that starts the closing fence's line.
        emit(open, at - 1, at + line.length)
        open = null
      }
    } else {
      const found = OPENING.exec(line)
      // A backtick fence's info string has no backtick in it: that's inline code.
      if (found && !(found[2]![0] === '`' && found[3]!.includes('`'))) open = { fence: found[2]!, info: found[3]!.trim(), start: at, content: Math.min(text.length, end + 1) }
    }
    if (newline === -1) break
    at = newline + 1
  }
  if (open) emit(open, text.length, text.length, true)
  return blocks
}

/** A block as a message's view shows it: its schema's name and version, and its data. */
export type Block = { schema: string; version: number; data: Record<string, unknown> }

/** The blocks `text` holds, as a view lists them: each fence that names a schema and holds a JSON object. */
export function blocksIn(text: string): Block[] {
  // Most messages name no schema: nothing to read.
  if (!text.includes('json#')) return []
  return findBlocks(text).flatMap(({ name, version, data }) => (name !== undefined && version !== undefined && data !== undefined ? [{ schema: name, version, data }] : []))
}

/**
 * A block as text: `data` in a fence that names schema `id`. Alone, it's a message that is only
 * its data; among prose, a message that says something and carries data.
 */
export function block(id: string, data: Record<string, unknown>): string {
  if (!parseSchemaId(id)) throw new TypeError(`${id} names no schema: one is name@version, like sandbox@1`)
  // JSON never has a line that is only a fence, so three backticks always hold it.
  return `\`\`\`json#${id}\n${JSON.stringify(data, null, 2)}\n\`\`\``
}
