import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MessageView } from '../src/api/routes.ts'
import { tmp, useBoard, vb } from './cli-harness.ts'
import { create, failure, ok, task } from './cli-tasks-harness.ts'

// `vb tasks create <channel> --tasks-file`: a plan of tasks from a JSON file, against a served local board.

useBoard()

/** A plan, written where a run reads it. */
async function planFile(tasks: unknown, name = 'plan.json'): Promise<string> {
  const path = join(await tmp('board-plan-'), name)
  await writeFile(path, typeof tasks === 'string' ? tasks : JSON.stringify(tasks))
  return path
}

const rows = (stdout: string) => stdout.split('\n').filter(Boolean)
const idOf = (row: string) => /^#(\S+)/.exec(row)![1]!

describe('vb tasks create --tasks-file', () => {
  it('makes the tasks a JSON file holds, each waiting for the ones it names, and prints them as the list does', async () => {
    const before = await create('plans', 'cut the release branch')
    const path = await planFile([
      { key: 'fix', text: 'fix CVE-123 in acme/web', labels: { step: 'fix' } },
      { key: 'review', text: 'review the fix for CVE-123', labels: { step: 'review' }, needs: [{ key: 'fix' }] },
      // What was there is named by its ID, written as the CLI prints it or as JSON has a number, and an assignee by a profile's name.
      { text: 'ship it', needs: [{ key: 'review' }, `#${before}`, Number(before)], for: 'Shipper' },
    ])
    const made = await vb(['tasks', 'create', 'plans', '--tasks-file', path, '--idempotency-key', 'cve-123'])
    expect(made).toMatchObject({ code: 0, stderr: '' })
    const [fix, review, ship] = rows(made.stdout).map(idOf)
    // A line a task, as `vb tasks` shows them: the same rows, after the one that was there.
    const listed = await ok(['tasks', 'plans'])
    expect(rows(listed).slice(1)).toEqual(rows(made.stdout))
    expect(rows(made.stdout).map((row) => row.replace(/\s+/g, ' '))).toEqual([
      `#${fix} ready fix CVE-123 in acme/web step=fix`,
      `#${review} waiting review the fix for CVE-123 step=review needs #${fix}`,
      `#${ship} waiting ship it needs #${before} #${review}`,
    ])
    expect((await task(ship!)).task).toMatchObject({ state: 'waiting', needs: [before, review], for: expect.stringMatching(/\+shipper$/) })
    // The same key and file again make nothing: the tasks, as they are now.
    await ok(['tasks', 'claim', fix!])
    const again = await ok(['tasks', 'create', 'plans', '--tasks-file', path, '--idempotency-key', 'cve-123'])
    expect(rows(again).map((row) => row.replace(/\s+/g, ' ').split(' ').slice(0, 2))).toEqual([[`#${fix}`, 'claimed'], [`#${review}`, 'waiting'], [`#${ship}`, 'waiting']])
    expect(rows(await ok(['tasks', 'plans']))).toHaveLength(4)
    // Without a key, the same file again is the same tasks again.
    await ok(['tasks', 'create', 'plans', '--tasks-file', path])
    expect(rows(await ok(['tasks', 'plans']))).toHaveLength(7)
    // The key with another plan is another write's.
    const other = await planFile([{ text: 'another plan under the same key' }])
    const reused = await vb(['tasks', 'create', 'plans', '--tasks-file', other, '--idempotency-key', 'cve-123', '--json'])
    expect([reused.code, failure(reused).reason]).toEqual([1, 'duplicate_id'])
  }, 60_000)

  it('reads a plan from stdin for -, and prints one JSON document with --json', async () => {
    const plan = JSON.stringify([{ key: 'build', text: 'build a1b2c3' }, { text: 'deploy a1b2c3', needs: [{ key: 'build' }] }])
    const made = await vb(['tasks', 'create', 'piped', '--tasks-file', '-', '--json'], {}, plan)
    expect(made).toMatchObject({ code: 0, stderr: '' })
    const { tasks, ...rest } = JSON.parse(made.stdout) as { tasks: MessageView[] }
    expect(rest).toEqual({})
    expect(tasks.map((root) => [root.text, root.channel, root.task?.state, root.task?.needs])).toEqual([
      ['build a1b2c3', 'piped', 'ready', []],
      ['deploy a1b2c3', 'piped', 'waiting', [tasks[0]!.id]],
    ])
  }, 60_000)

  it('refuses what is no plan as misuse, before the board is asked', async () => {
    const misused = async (args: string[], stdin?: string) => {
      const ran = await vb(['tasks', 'create', ...args], {}, stdin)
      expect([ran.code, ran.stdout], args.join(' ')).toEqual([2, ''])
      return ran.stderr.split('\n')[0]
    }
    const plan = await planFile([{ text: 'one task' }])
    expect(await misused(['none', '--tasks-file', '/nowhere/plan.json'])).toBe("error: Can't read /nowhere/plan.json. There's no such file.")
    expect(await misused(['none', '--tasks-file', await planFile('not json', 'notes.txt')])).toMatch(/^error: \S+notes\.txt isn't JSON\.$/)
    expect(await misused(['none', '--tasks-file', '-'], '{"text": "one task"}')).toBe('error: stdin holds no tasks. A plan is a JSON array of tasks: [{"key": "fix", "text": "…"}, {"text": "…", "needs": [{"key": "fix"}]}].')
    expect(await misused(['none', '--tasks-file', await planFile([])])).toMatch(/ holds no tasks\. A plan is a JSON array of tasks/)
    expect(await misused(['none', '--tasks-file', await planFile(['a task'])])).toMatch(/ holds no tasks\. A plan is a JSON array of tasks/)
    // What says one task's own text, labels, or needs goes in the file.
    expect(await misused(['none', 'a task of its own', '--tasks-file', plan])).toBe("error: Text is one task's: with --tasks-file, each task in the file has its own.")
    for (const flag of [['--label', 'step=fix'], ['--needs', '812'], ['--for', 'fixer'], ['--claim'], ['--no-sync'], ['--text-file', plan]])
      expect(await misused(['none', '--tasks-file', plan, ...flag])).toBe(`error: ${flag[0]} is one task's: with --tasks-file, each task in the file has its own.`)
    const thread = await create('elsewhere', 'a thread that is there')
    expect(await misused([thread, '--tasks-file', plan])).toBe(`error: --tasks-file starts threads in a channel, and #${thread} is a thread.`)
    expect(await ok(['channels'])).not.toMatch(/^none\b/m)
    // What the board refuses of a plan is said by what the command was doing, with its words under it.
    const cycle = await planFile([{ key: 'a', text: 'a', needs: [{ key: 'b' }] }, { key: 'b', text: 'b', needs: [{ key: 'a' }] }])
    const refused = await vb(['tasks', 'create', 'none', '--tasks-file', cycle])
    expect(refused).toMatchObject({ code: 2, stdout: '' })
    expect(refused.stderr.split('\n').slice(0, 2)).toEqual(["error: Can't create tasks in none. A task's needs are tasks you can read, or keys of the plan's own.", '  needs: the tasks with the keys "a", "b" wait for each other'])
  }, 60_000)

  it('says what a plan that stopped midway made, and the command that makes the rest under the same key', async () => {
    // 120 steps, each after the one before: more than one write holds. The 111th also waits for a task that isn't there.
    const steps = Array.from({ length: 120 }, (_, n) => ({ key: `step-${n}`, text: `migrate shard ${n}`, ...(n > 0 ? { needs: [{ key: `step-${n - 1}` }] } : {}) }))
    const broken = await planFile(steps.map((step, n) => (n === 110 ? { ...step, needs: [...step.needs!, '999999'] } : step)), 'shards.json')
    const stopped = await vb(['tasks', 'create', 'shards', '--tasks-file', broken])
    expect(stopped).toMatchObject({ code: 2, stdout: '' })
    const made = rows(await ok(['tasks', 'shards', '--state', 'all', '--limit', '500'])).map(idOf)
    expect(made).toHaveLength(100)
    const lines = stopped.stderr.split('\n')
    const key = /--idempotency-key (\S+)$/.exec(lines[5]!)?.[1]
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(lines).toEqual([
      "error: Can't create tasks in shards. A task's needs are tasks you can read, or keys of the plan's own.",
      "  needs: #999999 isn't a task",
      `  made 100 of 120: #${made[0]} to #${made[99]}`,
      '',
      '  Make the rest, under the same key: what was made stays as it is:',
      `    vb tasks create shards --tasks-file ${broken} --idempotency-key ${key}`,
      '',
    ])
    // The same file under that key stops at the same task, and makes nothing more.
    const again = await vb(['tasks', 'create', 'shards', '--tasks-file', broken, '--idempotency-key', key!])
    expect(again.stderr.split('\n').slice(2, 6)).toEqual([lines[2], '', lines[4], lines[5]])
    expect(rows(await ok(['tasks', 'shards', '--state', 'all', '--limit', '500']))).toHaveLength(100)
    // Fixed, the command it named makes the rest: the first hundred stay the tasks they were.
    const fixed = await planFile(steps, 'shards.json')
    const finished = await vb(['tasks', 'create', 'shards', '--tasks-file', fixed, '--idempotency-key', key!])
    expect(finished).toMatchObject({ code: 0, stderr: '' })
    expect(rows(finished.stdout).map(idOf).slice(0, 100)).toEqual(made)
    expect(rows(finished.stdout)).toHaveLength(120)
    expect(rows(await ok(['tasks', 'shards', '--state', 'all', '--limit', '500']))).toHaveLength(120)
    // For a program: the failure as one document, with what was made and the command in it.
    const json = await vb(['tasks', 'create', 'shards-again', '--tasks-file', broken, '--idempotency-key', 'shards-again-1', '--json'])
    expect(json).toMatchObject({ code: 2, stdout: '' })
    const document = failure(json) as ReturnType<typeof failure> & { data: { created: string[]; total: number; error: { code: string } } }
    expect(document).toMatchObject({ reason: 'invalid_needs', data: { total: 120, error: { code: 'invalid_needs', status: 400 } } })
    expect(document.data.created).toHaveLength(100)
    expect(document.next).toEqual([expect.objectContaining({ argv: ['vb', 'tasks', 'create', 'shards-again', '--tasks-file', broken, '--json', '--idempotency-key', 'shards-again-1'] })])
    // A plan whose first write is refused made nothing: it says so by saying nothing of what was made.
    const first = await planFile([{ text: 'waits for nothing there', needs: ['999999'] }])
    const none = await vb(['tasks', 'create', 'nothing', '--tasks-file', first])
    expect(none.stderr).toBe("error: Can't create tasks in nothing. A task's needs are tasks you can read, or keys of the plan's own.\n  needs: #999999 isn't a task\n\n  See the tasks there are:\n    vb tasks --state all\n")
  }, 120_000)
})
