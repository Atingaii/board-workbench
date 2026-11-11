import { describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { vercel } from '../src/backend-vercel/index.default.ts'
import { as, fakeMessageboard } from './messageboard.ts'

const API = 'http://localhost'

/** A handle on one of the fake team's boards through vercel(), as `principal`: its default board unless `on` names another by ID. */
const handleOn = (api: ReturnType<typeof fakeMessageboard>, principal = 'user:u_jb', on?: string) =>
  board({ backend: vercel({ team: 'team_test', api: API, fetch: as(api, principal), files: api.files, ...(on ? { board: on } : {}) }) })

const SANDBOX = { type: 'object', required: ['id', 'action'], properties: { id: { type: 'string' }, action: { enum: ['started', 'stopped'] } } }

describe("vercel() and the team's schemas", () => {
  it("registers a version in the team's registry, once, and gives back the API's answer as the protocol has it", async () => {
    const api = fakeMessageboard({ boards: [{ name: 'security', id: 'brd_sec' }] })
    const team = handleOn(api)
    const made = await team.createSchema({ name: 'sandbox', version: 1, description: 'What a sandbox did.', schema: SANDBOX })
    // What the API was sent, and kept.
    const kept = api.schemas.get('sandbox@1')!
    expect(kept).toMatchObject({ name: 'sandbox', version: 1, description: 'What a sandbox did.', schema: SANDBOX })
    // Its milliseconds and its actor, as a board says when and who.
    expect(made).toEqual({
      created: true,
      schema: { id: 'sandbox@1', name: 'sandbox', version: 1, description: 'What a sandbox did.', schema: SANDBOX, builtIn: false, by: kept.createdBy!.id, at: new Date(kept.createdAt).toISOString() },
    })
    expect(kept.createdBy).toMatchObject({ principal: { type: 'user', userId: 'u_jb' } })

    // The same again makes nothing, and says so, though the API answers the same either way.
    expect(await team.createSchema({ name: 'sandbox', version: 1, description: 'What a sandbox did.', schema: SANDBOX })).toEqual({ created: false, schema: made.schema })
    expect([...api.schemas.keys()]).toEqual(['sandbox@1'])
    expect(api.requests.filter((request) => request === 'POST /schemas')).toHaveLength(2)

    // One registry for the team: another of its boards has it too.
    expect(await handleOn(api, 'user:u_jb', 'brd_sec').schema('sandbox@1')).toEqual(made.schema)
    // A built-in has no one behind it, and no time.
    expect(await team.schema('git-commit@1')).toMatchObject({ builtIn: true, by: null, at: null, description: 'A Git commit, by its full SHA and the first line of its message.' })
  })

  it("lists the team's own by name, then version as a number, where the API lists them by ID as text", async () => {
    const api = fakeMessageboard()
    const team = handleOn(api)
    for (const [name, version] of [['sandbox', 2], ['sandbox', 10], ['incident.finding', 1]] as const) await team.createSchema({ name, version, schema: { type: 'object' } })
    // As the API has them: sandbox@10 before sandbox@2.
    expect([...api.schemas.keys()].sort()).toEqual(['incident.finding@1', 'sandbox@10', 'sandbox@2'])
    expect((await team.schemas()).map((schema) => schema.id)).toEqual(['git-commit@1', 'vercel-deployment@1', 'incident.finding@1', 'sandbox@2', 'sandbox@10'])
    expect((await team.schema('sandbox@10')).description).toBeNull()
  })

  it("answers what the API refuses as it refuses it: a viewer registers none, and a project's own credentials reach none of it yet", async () => {
    const api = fakeMessageboard()
    const body = { name: 'sandbox', version: 1, schema: SANDBOX }
    await expect(handleOn(api, 'user:u_val').createSchema(body)).rejects.toMatchObject({ status: 403 })
    expect((await handleOn(api, 'user:u_val').schemas()).map((schema) => schema.id)).toEqual(['git-commit@1', 'vercel-deployment@1'])
    const deployment = handleOn(api, 'project:prj_pong:production')
    await expect(deployment.createSchema(body)).rejects.toMatchObject({ status: 403 })
    await expect(deployment.schemas()).rejects.toMatchObject({ status: 403 })
    expect([...api.schemas.keys()]).toEqual([])
    // What the API says of a definition is what the caller hears.
    await expect(handleOn(api).createSchema({ name: 'sandbox', version: 1, schema: { type: 'object', properties: { next: { $ref: '#' } } } })).rejects.toMatchObject({ status: 400, code: 'invalid_schema' })
    await expect(handleOn(api).schema('sandbox@1')).rejects.toMatchObject({ status: 404, code: 'schema_not_found' })
  })
})
