import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { block, findBlocks } from '../src/contract/blocks.ts'

const F = '```'
const lines = (...parts: string[]) => parts.join('\n')
/** What each block found in `text` names and holds. */
const found = (text: string) => findBlocks(text).map(({ id, data, problem }) => ({ id, ...(data !== undefined ? { data } : {}), ...(problem !== undefined ? { problem: true } : {}) }))

describe('blocks in a message’s text', () => {
  it('reads a block out of the prose around it, and several in order', () => {
    const text = lines('sandbox sbx-123 started', '', `${F}json#sandbox@1`, '{ "id": "sbx-123", "action": "started", "config": { "vcpus": 4 } }', F, '', 'and its commit', '', `${F}json#git-commit@1`, '{', '  "sha": "abc",', '  "title": "fix it"', '}', F, 'done')
    expect(findBlocks(text)).toMatchObject([
      { id: 'sandbox@1', name: 'sandbox', version: 1, data: { id: 'sbx-123', action: 'started', config: { vcpus: 4 } } },
      { id: 'git-commit@1', name: 'git-commit', version: 1, data: { sha: 'abc', title: 'fix it' } },
    ])
  })

  it('reads a message that is only its block', () => {
    expect(found(lines(`${F}json#sandbox@1`, '{"id":"sbx-9"}', F))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
  })

  it('says where each block is, so what reads the text can take the fence out', () => {
    const fence = lines(`${F}json#sandbox@1`, '{"id":"sbx-9"}', F)
    const text = `before\n${fence}\nafter\n${fence}`
    const [first, second] = findBlocks(text)
    expect(text.slice(first!.start, first!.end)).toBe(fence)
    expect(text.slice(second!.start, second!.end)).toBe(fence)
    expect(first!.source).toBe('{"id":"sbx-9"}')
  })

  it("leaves a fence that names no schema alone: it's code", () => {
    expect(found(lines(`${F}json`, '{"id":"sbx-9"}', F, `${F}ts`, 'const a = 1', F, F, 'plain', F))).toEqual([])
  })

  it('takes a block shown inside a longer fence as that fence’s text, not as a block', () => {
    const shown = lines('To post one:', '', '````markdown', 'sandbox started', '', `${F}json#sandbox@1`, '{"id":"sbx-9"}', F, '````', '', 'and a real one:', `${F}json#sandbox@1`, '{"id":"sbx-10"}', F)
    expect(found(shown)).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-10' } }])
    // A tilde fence holds a backtick one too, and closes only with tildes.
    expect(found(lines('~~~', `${F}json#sandbox@1`, '{"id":"sbx-9"}', F, '~~~'))).toEqual([])
    expect(found(lines('~~~json#sandbox@1', '{"id":"sbx-9"}', F, '~~~'))).toEqual([{ id: 'sandbox@1', problem: true }])
    expect(found(lines('~~~json#sandbox@1', '{"id":"sbx-9"}', '~~~'))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
  })

  it('reads none from a quote or indented code: quoting a block does not post it again', () => {
    const fence = [`${F}json#sandbox@1`, '{"id":"sbx-9"}', F]
    expect(found(fence.map((line) => `> ${line}`).join('\n'))).toEqual([])
    expect(found(fence.map((line) => `    ${line}`).join('\n'))).toEqual([])
    expect(found(`inline \`${F}json#sandbox@1\` isn't a fence`)).toEqual([])
    // Up to three spaces is still a fence.
    expect(found(fence.map((line) => `   ${line}`).join('\n'))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
  })

  it("ends a quote's or a list item's fence with it, so none hides a block after it", () => {
    const real = [`${F}json#sandbox@1`, '{"id":"sbx-9"}', F]
    const one = [{ id: 'sandbox@1', data: { id: 'sbx-9' } }]
    // A fence that starts a list item and closes inside it.
    expect(found(lines(`- ${F}json`, '  {"id":"shown"}', `  ${F}`, ...real))).toEqual(one)
    // One left open in an item ends where the item does, and one left open in a quote, with the quote.
    expect(found(lines(`- ${F}json`, '  {"id":"shown"}', ...real))).toEqual(one)
    expect(found(lines(`> ${F}`, '> quoted', '', ...real))).toEqual(one)
    expect(found(lines(`1. ${F}json#sandbox@1`, '   {"id":"shown"}', `   ${F}`, '', ...real))).toEqual(one)
  })

  it('reads none from under a list item, until the list ends', () => {
    const under = [`  ${F}json#sandbox@1`, '  {"id":"sbx-9"}', `  ${F}`]
    expect(found(lines('- the event:', '', ...under))).toEqual([])
    // Text right under an item's text is still the item's, and so is the fence after it.
    expect(found(lines('- the event', 'is this one', ...under))).toEqual([])
    // Once something else starts, a fence is the message's own again.
    expect(found(lines('- an item', '', 'and then', '', `${F}json#sandbox@1`, '{"id":"sbx-9"}', F))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
    expect(found(lines('- an item', `${F}json#sandbox@1`, '{"id":"sbx-9"}', F))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
  })

  it('finds the fences a markdown reader calls the message’s own, in messages made of every kind of line', () => {
    // CommonMark, as the inspector's renderer reads it: the code blocks at the top level of the document.
    const parser = unified().use(remarkParse)
    const flat = (value: string) => value.split('\n').map((line) => line.trimStart()).join('\n').trimEnd()
    const reference = (text: string) =>
      parser.parse(text).children.flatMap((node) => (node.type === 'code' && /^json#/.test(node.lang ?? '') ? [`${node.lang}|${flat(node.value)}`] : []))
    const ours = (text: string) => findBlocks(text).map((block) => `json#${block.id}|${flat(block.source)}`)
    const LINES = [
      '', '', 'some text', 'more text', '{ "id": 1 }', '{}',
      F, F, `${F}json`, `${F}json#a@1`, `${F}json#a@1`, `${F}json#b@2`, `${F}${F}`, `${F}${F}markdown`, '~~~', '~~~json#a@1',
      ` ${F}`, `  ${F}`, `   ${F}json#a@1`, `    ${F}json#a@1`, `    ${F}`,
      '> quoted', `> ${F}`, `> ${F}json#a@1`, '> {}', `>${F}`,
      '- item', `- ${F}json`, `- ${F}json#a@1`, `  ${F}`, `  ${F}json#a@1`, '  {}', '  text in item', `1. ${F}`, `   ${F}`, '* item',
    ]
    // The same messages every run.
    let seed = 7
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    let withBlocks = 0
    for (let round = 0; round < 4000; round++) {
      const text = Array.from({ length: 2 + Math.floor(next() * 10) }, () => LINES[Math.floor(next() * LINES.length)]).join('\n')
      const want = reference(text)
      if (want.length > 0) withBlocks++
      expect(ours(text), text).toEqual(want)
    }
    // Enough of them carry one for the comparison to mean something.
    expect(withBlocks).toBeGreaterThan(1000)
  })

  it('closes a fence only with one as long, of its own, with nothing after', () => {
    expect(found(lines(`${F}${F}json#sandbox@1`, '{"id":', F, '"sbx-9"}', `${F}${F}`))).toEqual([{ id: 'sandbox@1', problem: true }])
    expect(found(lines(`${F}json#sandbox@1`, '{"id":"sbx-9"}', `${F}${F}  `))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
    expect(found(lines(`${F}json#sandbox@1`, '{"id":"sbx-9"}', `${F} not a close`, F))).toEqual([{ id: 'sandbox@1', problem: true }])
  })

  it('finds a block it can’t read, and says why, so a write can refuse it', () => {
    const problems = (text: string) => findBlocks(text).map((found) => found.problem)
    expect(problems(lines(`${F}json#sandbox@1`, '{ id: sbx-9 }', F))).toEqual(["the sandbox@1 block isn't JSON"])
    expect(problems(lines(`${F}json#sandbox@1`, '["sbx-9"]', F))).toEqual(["the sandbox@1 block isn't a JSON object"])
    expect(problems(lines(`${F}json#sandbox@1`, F))).toEqual(["the sandbox@1 block isn't JSON"])
    expect(problems(lines(`${F}json#sandbox@1`, '{"id":"sbx-9"}'))).toEqual(["the sandbox@1 block's fence never closes"])
    expect(problems(lines(`${F}json#Sandbox`, '{"id":"sbx-9"}', F))).toEqual(['Sandbox names no schema: one is name@version, like sandbox@1'])
    expect(findBlocks(lines(`${F}json#sandbox@1`, '{ id: sbx-9 }', F))[0]).not.toHaveProperty('data')
  })

  it('reads the same with Windows line endings', () => {
    expect(found([`${F}json#sandbox@1`, '{', '  "id": "sbx-9"', '}', F, 'after'].join('\r\n'))).toEqual([{ id: 'sandbox@1', data: { id: 'sbx-9' } }])
  })

  it('writes a block that reads back as its data, whatever the data holds', () => {
    const data = { id: 'sbx-9', note: `a fence in a string:\n${F}\n${F}json#other@1\n{}\n${F}`, nested: { list: [1, 'two', null, { deep: true }] }, emoji: '😀' }
    const text = `before\n\n${block('sandbox@1', data)}\n\nafter`
    expect(found(text)).toEqual([{ id: 'sandbox@1', data }])
    // Alone, it's the whole message.
    const alone = block('sandbox@1', data)
    expect(findBlocks(alone)).toMatchObject([{ start: 0, end: alone.length, data }])
    expect(() => block('Sandbox', data)).toThrow(TypeError)
  })
})
