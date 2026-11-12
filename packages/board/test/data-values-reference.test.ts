import ajv from 'ajv'
import ajvFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { SCHEMA_FORMATS } from '../src/contract/data-schemas.ts'
import { checkValue } from '../src/contract/data-values.ts'

// `checkValue` against the validator Vercel's API checks a value with, set up as that API sets it
// up: a board anywhere and Vercel's give a value one answer. The versions are pinned in
// `devDependencies`: a format's edges moved between releases of ajv-formats.

/** Whether the reference takes `value` under `schema`, or null for a schema it won't compile. */
function reference(schema: Record<string, unknown>): ((value: unknown) => boolean) | null {
  // Both are CommonJS: their classes and functions are their modules' `default`.
  const validator = new ajv.default({ strict: true, allowUnionTypes: true, allErrors: false, logger: false })
  ajvFormats.default(validator, [...SCHEMA_FORMATS])
  try {
    const validate = validator.compile(schema)
    return (value) => validate(value) === true
  } catch {
    return null
  }
}

const x = (count: number) => 'x'.repeat(count)

/** What each format is asked about: what it ordinarily holds, and its edges. */
const SAMPLES: Record<(typeof SCHEMA_FORMATS)[number], string[]> = {
  date: ['2026-11-11', '2026-13-01', '2026-00-10', '2026-11-31', '2026-1-1', '02026-11-11', '2026-11-11T', '0000-01-01', '2100-02-29', '2000-02-29', '2024-02-29', '2026-11-00', '2026-04-31', '9999-12-31', '2026/11/11', ' 2026-11-11', '2026-11-11\n', ''],
  time: [
    '10:00:00', '10:00:00Z', '10:00:00z', '24:00:00Z', '10:00:60Z', '23:59:60Z', '23:59:60', '23:59:60+01:00', '00:00:60Z', '10:60:00Z',
    '10:00:00+24:00', '10:00:00+02', '10:00:00+0200', '10:00:00+02:00', '10:00:00+2', '10:00:00+02:0', '10:00:00+23:59', '10:00:00+99:99', '10:00:00+02:60', '10:00:00-0260', '10:00:00-00:60', '10:00:00+2400',
    '10:00:00.123456789Z', '10:00:00.5', '10:00:00.Z', '10:00Z', '10:00:00 Z', '1:00:00Z', '10:00:00Zz', '',
  ],
  'date-time': [
    '2026-11-11T10:00:00Z', '2026-11-11t10:00:00z', '2026-11-11 10:00:00Z', '2026-11-11T10:00:00', '2026-11-11T10:00:00.5', '2026-11-11T10:00:00+02:00', '2026-11-11T10:00:00+0200', '2026-11-11T10:00:00+02',
    '2026-11-11T10:00:60Z', '2026-11-11T23:59:60Z', '2026-11-11T24:00:00Z', '2026-02-29T10:00:00Z', '2026-02-30T10:00:00Z', '2026-11-11', '2026-11-11T', 'T10:00:00Z', '2026-11-11T10:00:00Z ', '2026-11-11  10:00:00Z',
    '2026-11-11T10:00:00.Z', '2026-11-11Tt10:00:00Z', '2026-11-11T10:00:00Zt', '2026-11-11 10:00:00 Z', '2026-11-11\t10:00:00Z', '2026-11-11\n10:00:00Z', '2026-11-11\u00a010:00:00Z', '2026-11-11T10:00:00T', '',
  ],
  email: [
    'ada@example.com', 'a@b', 'a@b.c', 'a.@b.c', '.a@b.c', 'a..b@c.d', 'a@-b.c', 'a@b-.c', 'a@b.c.', 'a b@c.d', '"a"@b.c', 'a@[1.2.3.4]', 'a@b_c.d', 'ü@b.c', 'a+b@c.d', 'a@localhost', 'a@b@c.d', '@b.c', 'a@', 'A@B.C', 'a@b.c-d', 'a@1.2',
    `${x(65)}@b.c`, `a@${x(64)}.com`, `a@${`${x(60)}.`.repeat(5)}com`, "a!#$%&'*+/=?^_`{|}~-@b.c", 'a@b..c', 'a@.b.c', '',
  ],
  uri: [
    'https://vercel.com/x?y=1', 'https://x.com/<a>', 'a:b', 'http://x.com/a b', 'mailto:ada@example.com', 'urn:uuid:123e4567-e89b-12d3-a456-426614174000', 'https://x.com/%zz', 'https://x.com/a%20b', 'https://[::1]/', 'https://[::1', 'HTTP://X.COM',
    'x:', 'a:', 'a://', 'https://', '1a:b', 'https://x.com/"q"', 'https://x.com/{a}', 'https://x.com/a\\b', 'https://x.com/a^b', 'https://x.com/`', 'https://x.com/|', 'ftp://user:pw@host:21/x', 'https://x.com#frag', 'https://x.com?#',
    'https://x.com/a#b#c', '#frag', '//x.com', 'https://x.com/ü', 'https://x.com:port/', 'https://x.com:8080/', 'https://x.com/[a]', 'file:///etc/hosts', 'a+b.c-d:e', 'https://exa_mple.com', 'vercel.com', 'a:/', 'a:?', 'a:#', 'https://256.1.1.1/', 'https://1.2.3.4:/', '',
  ],
  uuid: ['123e4567-e89b-12d3-a456-426614174000', 'urn:uuid:123e4567-e89b-12d3-a456-426614174000', '123E4567-E89B-12D3-A456-426614174000', 'URN:UUID:123e4567-e89b-12d3-a456-426614174000', '123e4567e89b12d3a456426614174000', '{123e4567-e89b-12d3-a456-426614174000}', '123e4567', '123e4567-e89b-12d3-a456-42661417400g', '123e4567-e89b-12d3-a456-4266141740000', '00000000-0000-0000-0000-000000000000', ''],
  hostname: [
    'api.vercel.com', 'a', 'a.', 'a..b', '-a', 'a-', 'a-b', 'a_b', 'A.B', x(63), x(64), `${x(63)}.${x(63)}.${x(63)}.${x(61)}`, `${x(63)}.${x(63)}.${x(63)}.${x(62)}`, `${x(63)}.${x(63)}.${x(63)}.${x(61)}.`, `${x(63)}.${x(63)}.${x(63)}.${x(62)}.`,
    '1.2.3.4', '', '.', 'a.b.', 'a.b..', 'a b', 'ü.com', 'xn--bcher-kva.com', '-api.vercel.com', 'api-.vercel.com',
  ],
  ipv4: ['1.2.3.4', '10.0.0.255', '10.0.0.256', '01.2.3.4', '1.2.3.04', '10.0.0.01', '00.0.0.0', '000.0.0.0', '0000.0.0.0', '1.2.3.004', '09.1.1.1', '199.1.1.1', '299.1.1.1', '1.2.3', '1.2.3.4.5', '0.0.0.0', '255.255.255.255', '1.2.3.4 ', '1.2.3.-4', '1.2.3.', '.1.2.3', '1..2.3', '1.2.3.4\n', '1.2.3.1e1', '١.2.3.4', ''],
  ipv6: [
    '::', '::1', '1::', '2001:db8::1', '2001:db8::1::', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '::ffff:1.2.3.4', '1::2::3', 'fe80::1%eth0', '12345::', 'g::1', '::1.2.3.256', '1:2:3:4:5:6:1.2.3.4', '::01.2.3.4', '::1.2.3.04', ':1', '1:',
    '1:2:3:4:5:6:7::', '::2:3:4:5:6:7:8', '1:2:3:4:5:6:7:1.2.3.4', '1:2:3:4:5::1.2.3.4', 'ABCD::abcd', '::1.2.3.4', '1.2.3.4', '1::2:3:4:5:6:7:8', '1::2:3:4:5:6:7', '::1.2.3', ':::', '1:::2', '1:2:3:4::5:1.2.3.4', '1:2:3:4:5:6::1.2.3.4', '',
  ],
}

// A small generator, the same every run: definitions the registry's keywords make, and values for them.
function generator(start: number) {
  let seed = start
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const int = (below: number) => Math.floor(random() * below)
  const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!
  const NAMES = ['a', 'b', 'c', 'id', 'n']
  const STRINGS = ['', 'a', 'ab', 'started', 'stopped', x(5), '😀', 'é😀a', '2026-11-11', '10:00:00Z', '1.2.3.4', 'a@b.c', 'https://x.com']
  const NUMBERS = [0, 1, -1, 2, 3, 1.5, 2.5, 10, 0.1, 100]
  function value(depth = 0): unknown {
    const kind = int(depth > 2 ? 5 : 7)
    if (kind === 0) return null
    if (kind === 1) return random() < 0.5
    if (kind === 2) return pick(NUMBERS)
    if (kind === 3 || kind === 4) return pick(STRINGS)
    if (kind === 5) return Array.from({ length: int(4) }, () => value(depth + 1))
    return Object.fromEntries(Array.from({ length: int(4) }, () => [pick(NAMES), value(depth + 1)]))
  }
  /** A definition the reference's strict mode takes more often than not: a keyword for one type comes with that type, and `required` names declared properties. */
  function schema(depth = 0): Record<string, unknown> | boolean {
    if (depth > 0 && random() < 0.04) return random() < 0.7
    const out: Record<string, unknown> = {}
    const type = pick(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null', undefined, ['string', 'null'], ['integer', 'null'], ['object', 'array']] as const)
    if (type !== undefined) out.type = type
    const is = (name: string) => type === name || (Array.isArray(type) && (type as readonly string[]).includes(name))
    const sub = () => schema(depth + 1)
    const deep = depth < 3
    if (is('object')) {
      const names = deep && random() < 0.7 ? [...new Set(Array.from({ length: int(3) + 1 }, () => pick(NAMES)))] : []
      if (names.length > 0) out.properties = Object.fromEntries(names.map((name) => [name, sub()]))
      const required = names.filter(() => random() < 0.5)
      if (required.length > 0) out.required = required
      if (random() < 0.3) out.additionalProperties = deep && random() < 0.5 ? sub() : random() < 0.5
    }
    if (is('array')) {
      // One schema for every item, or a list of them, one for each place: the reference takes a list only with both bounds at its length.
      if (deep && random() < 0.3) {
        const list = Array.from({ length: int(3) + 1 }, sub)
        Object.assign(out, { items: list, minItems: list.length, maxItems: list.length })
      } else {
        if (deep && random() < 0.5) out.items = sub()
        if (random() < 0.3) out.minItems = int(3)
        if (random() < 0.3) out.maxItems = int(4)
      }
    }
    if (is('string')) {
      if (random() < 0.3) out.minLength = int(3)
      if (random() < 0.3) out.maxLength = int(6)
      if (random() < 0.3) out.format = pick(SCHEMA_FORMATS)
    }
    if (is('number') || is('integer')) {
      if (random() < 0.3) out.minimum = pick(NUMBERS)
      if (random() < 0.3) out.maximum = pick(NUMBERS)
      if (random() < 0.2) out.exclusiveMinimum = pick(NUMBERS)
      if (random() < 0.2) out.exclusiveMaximum = pick(NUMBERS)
      if (random() < 0.2) out.multipleOf = pick([1, 2, 0.5, 3, 0.1])
    }
    if (random() < 0.15) out.enum = Array.from({ length: int(3) + 1 }, () => value(2))
    if (random() < 0.1) out.const = value(2)
    for (const keyword of ['oneOf', 'anyOf', 'allOf']) if (deep && random() < 0.12) out[keyword] = Array.from({ length: int(3) + 1 }, sub)
    if (deep && random() < 0.08) out.not = sub()
    return out
  }
  return { schema, value }
}

describe('a value, as Vercel\'s API would take it', () => {
  it('gets the same answer for every format, at what it ordinarily holds and at its edges', () => {
    const disagree: string[] = []
    for (const format of SCHEMA_FORMATS) {
      const schema = { type: 'object', properties: { v: { type: 'string', format } } }
      const takes = reference(schema)!
      for (const sample of SAMPLES[format]) {
        const ours = checkValue(schema, { v: sample }) === null
        if (ours !== takes({ v: sample })) disagree.push(`${format} ${JSON.stringify(sample)}: board ${ours ? 'takes' : 'refuses'} it`)
      }
    }
    expect(disagree).toEqual([])
    // The reference is listening: it has these formats, and parts them as the API does.
    const takes = (format: string, sample: string) => checkValue({ type: 'object', properties: { v: { type: 'string', format } } }, { v: sample }) === null
    expect([takes('ipv4', '10.0.0.01'), takes('uri', 'https://x.com/<a>'), takes('time', '10:00:60Z'), takes('time', '10:00:00+99:99'), takes('date-time', '2026-11-11\t10:00:00Z')]).toEqual([true, false, false, true, true])
  })

  it('checks each item of a list by its place when a schema gives a list of them', () => {
    const schema = { type: 'object', properties: { pair: { type: 'array', items: [{ type: 'string' }, { type: 'integer' }], minItems: 2, maxItems: 2 } } }
    const takes = reference(schema)!
    const values = [{ pair: ['cpu', 4] }, { pair: [4, 'cpu'] }, { pair: ['cpu', 'four'] }, { pair: ['cpu'] }, { pair: ['cpu', 4, true] }, { pair: [] }, {}]
    expect(values.map((value) => checkValue(schema, value) === null)).toEqual(values.map(takes))
    expect(checkValue(schema, { pair: [4, 'cpu'] })).toBe('pair[0] must be a string')
    expect(checkValue(schema, { pair: ['cpu', 4] })).toBeNull()
  })

  it('gets the same answer across generated definitions and values', () => {
    const { schema, value } = generator(7)
    const disagree: unknown[] = []
    let compared = 0
    for (let round = 0; round < 1500; round++) {
      const definition = { ...(schema() as Record<string, unknown>), type: 'object' }
      const takes = reference(definition)
      // What the reference won't compile, the API registers none of.
      if (!takes) continue
      for (let each = 0; each < 6; each++) {
        // Half the values are objects, as a block's data is.
        const candidate = each % 2 === 0 ? value() : Object.fromEntries(Array.from({ length: 3 }, (_, index) => [['a', 'b', 'c'][index]!, value(1)]))
        compared++
        if ((checkValue(definition, candidate) === null) !== takes(candidate)) disagree.push({ definition, candidate })
      }
    }
    expect(disagree.slice(0, 3)).toEqual([])
    // Enough of them compiled to mean something.
    expect(compared).toBeGreaterThan(2000)
  }, 60_000)
})
