import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tmp, useBoard, vb } from './cli-harness.ts'

useBoard()

const SANDBOX = {
  type: 'object',
  required: ['id', 'action'],
  properties: { id: { type: 'string' }, action: { enum: ['started', 'stopped'] } },
}

describe('cli schemas', () => {
  it('lists the built-ins, registers a version from a file, and shows it', async () => {
    // Each row fits 80 columns: a description that doesn't is cut.
    expect(await vb(['schemas'])).toEqual({
      code: 0,
      stderr: '',
      stdout: [
        'git-commit@1         built in  A Git commit, by its full SHA and the first line…',
        'vercel-deployment@1  built in  A Vercel deployment, by its URL and optionally t…',
        '',
      ].join('\n'),
    })

    const dir = await tmp('schemas-')
    await writeFile(join(dir, 'sandbox.schema.json'), JSON.stringify(SANDBOX))
    const created = await vb(['schemas', 'create', 'sandbox@1', '--file', 'sandbox.schema.json', '--description', 'What a sandbox did.'], {}, undefined, dir)
    expect(created).toEqual({ code: 0, stderr: '', stdout: 'created sandbox@1\n' })
    // The same file again registers nothing, and says so.
    expect((await vb(['schemas', 'create', 'sandbox@1', '--file', 'sandbox.schema.json', '--description', 'What a sandbox did.'], {}, undefined, dir)).stdout).toBe('sandbox@1 is already registered\n')

    expect((await vb(['schemas', 'list'])).stdout).toMatch(/\nsandbox@1 {12}\d{1,2}s {7,8}What a sandbox did\.\n$/)
    expect((await vb(['schemas', 'inspect', 'sandbox@1'])).stdout).toBe(
      [
        'sandbox@1  What a sandbox did.',
        '',
        '    {',
        '      "type": "object",',
        '      "required": [',
        '        "id",',
        '        "action"',
        '      ],',
        '      "properties": {',
        '        "id": {',
        '          "type": "string"',
        '        },',
        '        "action": {',
        '          "enum": [',
        '            "started",',
        '            "stopped"',
        '          ]',
        '        }',
        '      }',
        '    }',
        '',
      ].join('\n'),
    )
  }, 30_000)

  it('takes the JSON Schema from stdin, and answers --json with what it registered', async () => {
    const inline = await vb(['schemas', 'create', 'ping@1', '--file', '-', '--json'], {}, '{"type":"object","required":["at"]}')
    expect(JSON.parse(inline.stdout)).toMatchObject({ outcome: 'created', schema: { id: 'ping@1', name: 'ping', version: 1, description: null, schema: { type: 'object', required: ['at'] }, builtIn: false } })
    const again = await vb(['schemas', 'create', 'ping@1', '--file', '-', '--json'], {}, '{ "required": ["at"], "type": "object" }\n')
    expect(JSON.parse(again.stdout)).toMatchObject({ outcome: 'unchanged', schema: { id: 'ping@1' } })
    expect(JSON.parse((await vb(['schemas', 'inspect', 'ping@1', '--json'])).stdout)).toEqual({ schema: JSON.parse(inline.stdout).schema })
    const listed = JSON.parse((await vb(['schemas', '--json'])).stdout) as { schemas: { id: string }[] }
    expect(listed.schemas.map((schema) => schema.id)).toEqual(expect.arrayContaining(['git-commit@1', 'ping@1']))
  }, 30_000)

  it("says what the board refused, and how to see a version that's there with another definition", async () => {
    expect((await vb(['schemas', 'create', 'taken@1', '--file', '-'], {}, '{"type":"object"}')).code).toBe(0)
    const changed = await vb(['schemas', 'create', 'taken@1', '--file', '-'], {}, '{"type":"object","required":["id"]}')
    expect(changed).toMatchObject({ code: 1, stdout: '' })
    expect(changed.stderr).toMatch(/^error: Can't register schema taken@1\.\n {2}taken@1 is registered with another definition[^\n]*\n\n {2}See what it's registered as:\n {4}vb schemas inspect taken@1\n$/)

    const invalid = await vb(['schemas', 'create', 'refs@1', '--file', '-'], {}, '{"type":"object","properties":{"next":{"$ref":"#"}}}')
    expect(invalid).toMatchObject({ code: 2, stdout: '' })
    expect(invalid.stderr).toMatch(/^error: Can't register schema refs@1\.\n {2}schemas don't take "\$ref"/)
    expect((await vb(['schemas', 'inspect', 'refs@1'])).stderr).toBe("error: Couldn't find schema refs@1.\n")

    const reserved = await vb(['schemas', 'create', 'git-commit@2', '--file', '-', '--json'], {}, '{"type":"object"}')
    expect(reserved.code).toBe(1)
    expect(JSON.parse(reserved.stderr)).toMatchObject({ status: 'error', reason: 'reserved_schema' })
  }, 30_000)

  it('names what a command line is missing before it asks the board anything', async () => {
    const dir = await tmp('schemas-')
    await writeFile(join(dir, 'sandbox.schema.json'), JSON.stringify(SANDBOX))
    await writeFile(join(dir, 'notes.md'), 'What a sandbox did.')
    await writeFile(join(dir, 'list.json'), '[1]')
    const misuses: [string[], RegExp][] = [
      [['schemas', 'create'], /^error: Missing the schema to create: its name and version, like sandbox@1\.\n/],
      [['schemas', 'create', 'sandbox'], /^error: sandbox doesn't name a schema\. One is name@version, like sandbox@1\.\n/],
      [['schemas', 'create', 'sandbox@9'], /^error: Missing --file: its JSON Schema, from a file, or - for stdin\.\n/],
      [['schemas', 'create', 'sandbox@9', '--file', 'notes.md'], /^error: notes\.md isn't JSON\.\n/],
      // The option's old name, and its old way to name a file.
      [['schemas', 'create', 'sandbox@9', '--schema', '@sandbox.schema.json'], /^error: --schema is --file now\.\n\n {2}Name the file without the @, or - for stdin:\n {4}vb schemas create <SCHEMA> --file <PATH>\n$/],
      [['schemas', 'create', 'sandbox@9', '--file', 'nowhere.json'], /^error: Can't read nowhere\.json\. There's no such file\.\n/],
      [['schemas', 'create', 'sandbox@9', '--file', 'list.json'], /^error: A schema is a JSON object: \{"type":"object", …\}\.\n/],
      [['schemas', 'inspect'], /^error: Missing the schema to inspect: its name and version, like sandbox@1\.\n/],
      [['schemas', 'show', 'sandbox@1'], /^error: Unknown command show for vb schemas\.\n/],
    ]
    for (const [args, stderr] of misuses) expect(await vb(args, {}, undefined, dir), args.join(' ')).toMatchObject({ code: 2, stdout: '', stderr: expect.stringMatching(stderr) })
    // None of them registered anything.
    expect((await vb(['schemas', 'inspect', 'sandbox@9'])).code).toBe(1)
  }, 60_000)
})
