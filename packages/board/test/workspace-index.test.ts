import { describe, expect, it } from 'vitest'
import { matchWorkspaceProject, parseWorkspaceIndex, projectQueue, WORKSPACE_MAX_BYTES } from '../src/inspect/app/workspace-index.ts'

const project = (channel: string, name = 'Board') => ({ name, channel, repository: 'https://github.com/acme/web' })
const manifest = (projects: readonly unknown[], version = 1) => JSON.stringify({ version, projects })

describe('the project directory', () => {
  it('imports projects with optional guides and preserves their configured order', () => {
    const projects = [
      { ...project('work/api-v2', '接口'), guide: 'https://github.com/acme/web/blob/main/AGENTS.md' },
      project('design/components', '界面'),
    ]
    expect(parseWorkspaceIndex(`\uFEFF${manifest(projects)}`)).toEqual({ ok: true, manifest: { version: 1, projects } })
    expect(parseWorkspaceIndex(manifest([]))).toEqual({ ok: true, manifest: { version: 1, projects: [] } })
  })

  it('refuses malformed or unsupported project manifests', () => {
    for (const input of ['{broken-json}', 'null', '[]', manifest([project('work')], 2), JSON.stringify({ version: 1, projects: 'work' })])
      expect(parseWorkspaceIndex(input)).toMatchObject({ ok: false, error: expect.any(String) })
  })

  it('refuses invalid or ambiguous Board channels', () => {
    for (const channel of ['../work', 'work//api', 'work/', 'work?a=b', 'Work/API', 'construction\n']) {
      expect(parseWorkspaceIndex(manifest([project(channel)]))).toMatchObject({ ok: false })
    }
    expect(parseWorkspaceIndex(manifest([project('work/api'), project('work/api', '另一项目')]))).toMatchObject({ ok: false, error: expect.stringContaining('重复') })
  })

  it('refuses links that cannot be opened safely as HTTP or HTTPS', () => {
    for (const url of ['javascript:alert(1)', 'https:example.com', '//example.com/x', 'https://user:password@example.com', 'https://example.com/\u0000', 'file:///tmp/example']) {
      expect(parseWorkspaceIndex(manifest([{ ...project('work'), repository: url }]))).toMatchObject({ ok: false })
      expect(parseWorkspaceIndex(manifest([{ ...project('work'), guide: url }]))).toMatchObject({ ok: false })
    }
  })

  it('bounds imported projects and UTF-8 bytes', () => {
    const projects = Array.from({ length: 65 }, (_, index) => project(`work/p${index}`))
    expect(parseWorkspaceIndex(manifest(projects))).toMatchObject({ ok: false, error: expect.stringContaining('64 个项目') })
    const oversized = manifest([{ ...project('work'), name: '界'.repeat(WORKSPACE_MAX_BYTES / 2) }])
    expect(oversized.length).toBeLessThan(WORKSPACE_MAX_BYTES)
    expect(parseWorkspaceIndex(oversized)).toMatchObject({ ok: false, error: expect.stringContaining('64 KB') })
  })

  it('finds the nearest project by whole segments and links its exact queue', () => {
    const projects = [project('work', '工作区'), project('work/api', '接口'), project('design', '设计')]
    expect(matchWorkspaceProject(projects, 'work/api')).toEqual(projects[1])
    expect(matchWorkspaceProject(projects, 'work/api/incident')).toEqual(projects[1])
    expect(matchWorkspaceProject(projects, 'work/api-gateway')).toEqual(projects[0])
    expect(matchWorkspaceProject(projects, 'workshop/api')).toBeUndefined()
    const destination = new URL(projectQueue('work/api'), 'https://board.example')
    expect(destination.pathname).toBe('/tasks')
    expect(destination.searchParams.get('channel')).toBe('work/api')
  })
})
