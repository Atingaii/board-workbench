import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { http } from '../src/backend-http/index.ts'
import { conformance } from '../src/conformance/index.ts'
import { local } from '../src/local/index.ts'
import { bearer, BOARD_URL, localBoard, personToken } from './harness.ts'

const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})
const scratch = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-local-'))
  made.push(dir)
  return dir
}

/** A handle on the board behind `fetch`, as `vb conformance` checks it, with `token`'s credentials. */
const over = (fetch: (request: Request) => Promise<Response>, token: () => Promise<string>) =>
  board({ backend: http(BOARD_URL, { fetch: bearer((input, init) => fetch(new Request(input, init)), token) }) }).as(null)

describe('local()', () => {
  it('passes the whole conformance kit, schedules and files included', async () => {
    const team = localBoard()
    try {
      const report = await conformance(over(team.fetch, () => personToken()), { withToken: (secret) => over(team.fetch, async () => secret) })
      expect(report.checks.filter((check) => check.status !== 'passed')).toEqual([])
      expect([...new Set(report.checks.map((check) => check.group))]).toEqual(['core', 'schedules', 'grants', 'tokens', 'attachments', 'watchers', 'sync'])
    } finally {
      await team.close()
    }
  }, 30_000)

  it("keeps each name's board in its own file, its files beside it, and finds it again after a restart", async () => {
    const dir = await scratch()
    const open = (name?: string) => {
      const backend = local({ dir })
      return { backend, team: board({ backend, ...(name !== undefined ? { name } : {}) }) }
    }
    const first = open('security')
    const shot = await first.team.upload({ data: new TextEncoder().encode('pixels'), name: 'shot.txt' })
    const posted = await first.team.post('dev', { text: 'rotate the keys', attachments: [shot] })
    const general = open()
    await general.team.post('dev', 'on the default board')
    await Promise.all([first.backend.close(), general.backend.close()])
    // A board's files folder is there once it keeps a file.
    expect((await readdir(dir)).filter((name) => !/-(wal|shm)$/.test(name)).sort()).toEqual(['local.db', 'security', 'security.db'])

    // Another process, by the same name in another case: the same board, its file included.
    const again = open('SECURITY')
    expect((await again.team.messages({ channel: 'dev' })).messages.map((m) => m.text)).toEqual(['rotate the keys'])
    expect(await (await again.team.download(posted.attachments[0]!.id)).text()).toBe('pixels')
    await again.backend.close()
  })

  it("names a file for any other name so that none is another's or the default board's", async () => {
    const dir = await scratch()
    for (const name of ['Security Team', 'local', 'con']) {
      const backend = local({ dir })
      await board({ backend, name }).post('dev', `on ${name}`)
      await backend.close()
    }
    const files = (await readdir(dir)).filter((name) => name.endsWith('.db')).sort()
    expect(files).toEqual([expect.stringMatching(/^con-[0-9a-f]{8}\.db$/), expect.stringMatching(/^local-[0-9a-f]{8}\.db$/), expect.stringMatching(/^security-team-[0-9a-f]{8}\.db$/)])
  })

  it("keeps one board per name whatever its team: there's one team here", async () => {
    const dir = await scratch()
    const acme = local({ dir })
    await board({ backend: acme, team: 'acme', name: 'security' }).post('dev', 'from acme')
    await acme.close()
    const ours = local({ dir })
    expect((await board({ backend: ours, name: 'security' }).messages({ channel: 'dev' })).messages.map((m) => m.text)).toEqual(['from acme'])
    await ours.close()
    const other = local({ dir })
    expect((await board({ backend: other, team: 'acme' }).messages({ channel: 'dev' })).messages).toEqual([])
    await other.close()
    expect((await readdir(dir)).filter((name) => name.endsWith('.db')).sort()).toEqual(['local.db', 'security.db'])
  })

  it('keeps nothing on disk in memory, and nothing outlives the backend', async () => {
    const dir = await scratch()
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      const team = board({ backend: local({ memory: true }) })
      await team.post('dev', 'only here')
      expect((await team.messages({ channel: 'dev' })).messages.map((m) => m.text)).toEqual(['only here'])
      expect((await board({ backend: local({ memory: true }) }).messages({ channel: 'dev' })).messages).toEqual([])
      expect(await readdir(dir)).toEqual([])
    } finally {
      process.chdir(cwd)
    }
  })

  it("says where it couldn't keep the board, on the first call", async () => {
    const dir = await scratch()
    // A file where its directory would be.
    await writeFile(join(dir, 'taken'), '')
    const team = board({ backend: local({ dir: join(dir, 'taken') }) })
    await expect(team.post('dev', 'hi')).rejects.toMatchObject({ status: 500, code: 'no_store', message: expect.stringContaining(`can't open the board at ${join(dir, 'taken', 'local.db')}`) })
  })
})
