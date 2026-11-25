// Modified for Board Workbench. Upstream license and attribution are in LICENSE and README.md.
import type { Discovery, MessageView, PrincipalView, ScheduleView } from '../../api/routes.ts'
import type { ScheduleTiming } from '../../server/index.default.ts'

// How the page says things: names, times, and sizes. Each is a few lines any UI on a board writes
// for itself, so the page keeps its own rather than reaching into the package for the CLI's.

type Named = { name: string; via?: { name: string; environment: string | null } | undefined }

/** An actor as people see it: `claude via julian`, `Malte via www (preview)`, or just a name. */
export function shownName(actor: Named): string {
  if (!actor.via) return actor.name
  const { name, environment } = actor.via
  return `${actor.name} 经由 ${name}${environment !== null && environment !== 'production' ? `（${environment}）` : ''}`
}

/** A message's author as people see them, or their ID when the board says nothing more. */
export const authorName = (message: Pick<MessageView, 'author' | 'by'>): string => (message.author ? shownName(message.author) : message.by.actor)

/** `12s`, `4m`, `3h`, `2d`: how long ago. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86_400)} 天前`
}

/** `120 KB`, `3.4 MB`: a file's size the way people read it. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** What went wrong, as the board or the handle said it. */
export const said = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A message's first line, for a row that shows one. */
export const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''

/** `58:12`, or `1h 02m` past an hour: how long is left. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const two = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours} 小时 ${two(minutes)} 分钟` : `${minutes}:${two(seconds % 60)}`
}

const REFUSALS: Record<string, string> = {
  claim_lost: '此标签页对任务的认领已结束，可能已释放、被接手或已到期。请重新认领后继续。',
  task_claimed: '此任务已被认领，可以在认领到期后接手。',
  task_assigned: '此任务已指派给其他人，只有对方可以认领。',
  task_waiting: '此任务仍在等待前置任务。',
  task_blocked: '此任务正在等待人工处理，请先解除阻塞。',
  task_finished: '此任务已经结束。',
  task_not_owned: '请由任务所有者或具有频道管理权限的人修改。',
  already_a_task: '这个讨论串已经是任务。',
  not_a_task: '这个讨论串还未转为任务。',
  reserved_label: '以 board. 开头的标签由看板管理，任务操作会更新它们。',
}

/** What a refusal means, in the page's words, or the board's own where the page has none. */
export function refusal(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return (typeof code === 'string' && REFUSALS[code]) || said(error)
}

/** Who a grant names, the way people say it. */
export function principalName(principal: PrincipalView): string {
  switch (principal.kind) {
    case 'user':
      return principal.email ?? principal.userId
    case 'project':
      return `${principal.name ?? principal.projectId} (${principal.environments.join(', ')})`
    case 'github':
      return [principal.repository, principal.workflow, principal.branch, principal.event].filter(Boolean).join(' · ')
    case 'oidc':
      return `${principal.issuer} ${Object.entries(principal.claims).map(([name, value]) => `${name}=${[value].flat().join('|')}`).join(' ')}`.trim()
    case 'app':
      return principal.name ?? principal.clientId
    case 'all-users':
      return '所有用户'
    case 'all-projects':
      return `所有项目（${principal.environments.join('、')}）`
    case 'all-apps':
      return '所有应用'
    case 'everyone':
      return '所有人'
  }
}

const SPANS: [string, number][] = [
  ['天', 86_400_000],
  ['小时', 3_600_000],
  ['分钟', 60_000],
  ['秒', 1000],
]

/** `in 21h`, `in 5m`, `now`: how long until a time, by its largest whole unit. */
export function until(iso: string, now = Date.now()): string {
  const left = Date.parse(iso) - now
  if (left < 1000) return '现在'
  const [unit, size] = SPANS.find(([, size]) => left >= size)!
  return `${Math.floor(left / size)} ${unit}后`
}

/** `1d`, `90m`, `36h`: a span of milliseconds in the largest unit that divides it. */
export function span(ms: number): string {
  const [unit, size] = SPANS.find(([, size]) => ms >= size && ms % size === 0) ?? ['秒', 1000]
  return `${Math.round(ms / size)} ${unit}`
}

/** How often a schedule sends, and how far along it is: `every 1d · 2 of 4 sent`. */
export function cadence(schedule: Pick<ScheduleView, 'every' | 'times' | 'sent' | 'until'>): string {
  const parts = [schedule.every === null ? '仅一次' : `每 ${span(schedule.every)}`]
  if (schedule.times !== null) parts.push(`已发送 ${schedule.sent}/${schedule.times} 次`)
  else if (schedule.sent > 0) parts.push(`已发送 ${schedule.sent} 次`)
  if (schedule.until !== null) parts.push(`截至 ${new Date(schedule.until).toLocaleDateString('zh-CN')}`)
  return parts.join(' · ')
}

/** A time as `<input type="datetime-local">` takes one: local, to the minute. Nothing, for what isn't a time. */
export function localInput(at: string | Date): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

/** A timing as the send-later form's fields start out, so reopening it to change one keeps the rest. */
export function laterFields(timing: ScheduleTiming | null): { after: string; at: string; every: string; times: string } {
  return {
    after: timing?.in ?? '',
    at: timing?.at !== undefined && timing.in === undefined ? localInput(timing.at) : '',
    every: timing?.every ?? '',
    times: timing?.times ? String(timing.times) : '',
  }
}

/** A timing in a few words: `in 2h`, `at Nov 12, 9:00 AM, every 1d`. */
export const timingWords = (later: ScheduleTiming): string =>
  [later.in ? `${later.in} 后` : later.at ? `于 ${new Date(later.at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '', later.every ? `每 ${later.every}` : '']
    .filter(Boolean)
    .join(', ')

/**
 * Which board a page is on, in two lines: its name and its host where it has a name (a team's
 * board in Vercel's API), else its host and where on it. Before its discovery answers, just `board`.
 */
export function boardWords(discovery: Pick<Discovery, 'url' | 'name'> | null): { name: string; at: string | null } {
  if (!discovery) return { name: '看板', at: null }
  let url: URL
  try {
    url = new URL(discovery.url)
  } catch {
    return { name: discovery.name ?? discovery.url, at: null }
  }
  if (discovery.name) return { name: discovery.name, at: url.host }
  const path = url.pathname.replace(/\/+$/, '')
  return { name: url.host, at: path || null }
}
