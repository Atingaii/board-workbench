import { z } from 'zod'
import { ChannelPath, storable } from '../../contract/schemas.ts'

export const WORKSPACE_MAX_BYTES = 64 * 1024
const WORKSPACE_MAX_PROJECTS = 64

const WebUrl = z.string({ error: '网址必须为文字' }).max(2048, { error: '网址不得超过 2048 个字符' }).refine((value) => {
  if (!/^https?:\/\/[^\s\\\u0000-\u001F\u007F]+$/i.test(value)) return false
  try {
    const url = new URL(value)
    return Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}, '请填写不含用户名和密码的完整 HTTP(S) 网址')

const Project = z.strictObject({
  name: z.string({ error: '项目名称必须为文字' })
    .trim()
    .min(1, { error: '请输入项目名称' })
    .max(80, { error: '项目名称不得超过 80 个字符' })
    .refine((name) => storable(name) && !/[\u0001-\u001F\u007F]/.test(name), '项目名称必须为一行文字'),
  channel: z.custom<string>((channel) => ChannelPath.safeParse(channel).success, { error: '频道须为以斜杠分隔的小写路径，如 product/workbench' }),
  repository: WebUrl,
  guide: WebUrl.optional(),
})

const Workspace = z.strictObject({
  version: z.literal(1, { error: '项目配置版本必须为 1' }),
  projects: z.array(Project, { error: '项目必须按数组列出' }).max(WORKSPACE_MAX_PROJECTS, { error: `项目配置最多可包含 ${WORKSPACE_MAX_PROJECTS} 个项目` }),
})

export type WorkspaceProject = Readonly<z.infer<typeof Project>>
export type WorkspaceManifest = { readonly version: 1; readonly projects: readonly WorkspaceProject[] }
type ParseResult = { ok: true; manifest: WorkspaceManifest } | { ok: false; error: string }

export function parseWorkspaceIndex(text: string): ParseResult {
  if (text.length > WORKSPACE_MAX_BYTES || new TextEncoder().encode(text).byteLength > WORKSPACE_MAX_BYTES)
    return { ok: false, error: '项目配置文件不得超过 64 KB。' }

  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { ok: false, error: '请选择有效的 JSON 项目配置。' }
  }

  const parsed = Workspace.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const field = issue.path.join('.')
    return { ok: false, error: field ? `请检查项目配置的 ${field} 字段。 ${issue.message}。` : '项目配置必须包含 version 和 projects 字段。' }
  }

  const channels = new Set<string>()
  for (const project of parsed.data.projects) {
    if (channels.has(project.channel)) return { ok: false, error: `频道 #${project.channel} 重复出现在项目配置中。` }
    channels.add(project.channel)
  }
  return { ok: true, manifest: parsed.data }
}

/** A nested channel belongs to its closest project, on whole path segments. */
export function matchWorkspaceProject(projects: readonly WorkspaceProject[], channel: string): WorkspaceProject | undefined {
  let match: WorkspaceProject | undefined
  for (const project of projects) {
    const belongs = channel === project.channel || channel.startsWith(`${project.channel}/`)
    if (belongs && (!match || match.channel.length < project.channel.length)) match = project
  }
  return match
}

export function projectQueue(channel: string): string {
  return `/tasks?${new URLSearchParams({ channel })}`
}
