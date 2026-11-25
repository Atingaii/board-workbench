import { Dialog } from '@base-ui/react/dialog'
import { Activity, BookOpen, Clock, Copy, ExternalLink, FolderKanban, Hash, ListTodo, Search, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { base, navigate } from './nav.tsx'
import { parseWorkspaceIndex, projectQueue, WORKSPACE_MAX_BYTES, type WorkspaceManifest, type WorkspaceProject } from './workspace-index.ts'

const STORAGE_KEY = `board.workbench.workspace:${base || '/'}`
const NO_PROJECTS: readonly WorkspaceProject[] = []

function readManifest(): WorkspaceManifest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = parseWorkspaceIndex(raw)
    return parsed.ok ? parsed.manifest : null
  } catch {
    return null
  }
}

type DialogName = 'commands' | 'projects'

export function useWorkbench(channels: readonly string[], enabled = true) {
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [manifest, setManifest] = useState(readManifest)
  const projects = manifest?.projects ?? NO_PROJECTS
  const openCommands = () => setDialog('commands')
  const openProjects = () => setDialog('projects')
  const close = () => setDialog(null)
  const openRoute = (path: string) => {
    close()
    navigate(path)
  }

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return
      if (event.metaKey === event.ctrlKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (!event.repeat) setDialog((current) => (current === 'commands' ? null : 'commands'))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])

  const saveManifest = (next: WorkspaceManifest) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setManifest(next)
  }

  const dialogs = enabled && (
    <>
      {dialog === 'commands' && <Commands channels={channels} projects={projects} openProjects={openProjects} openRoute={openRoute} close={close} />}
      {dialog === 'projects' && <Projects manifest={manifest} save={saveManifest} openRoute={openRoute} close={close} />}
    </>
  )
  return { openCommands, openProjects, dialogs, projects }
}

function WorkbenchDialog({
  title,
  description,
  initialFocus,
  close,
  footer,
  children,
}: {
  title: string
  description: string
  initialFocus: RefObject<HTMLElement | null>
  close: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="workbench-backdrop" />
        <Dialog.Popup className="workbench-dialog" initialFocus={initialFocus}>
          <div className="workbench-dialog-header">
            <div>
              <Dialog.Title className="workbench-dialog-title">{title}</Dialog.Title>
              <Dialog.Description className="workbench-description">{description}</Dialog.Description>
            </div>
            <Dialog.Close className="workbench-close" aria-label="关闭窗口">
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="workbench-dialog-body">{children}</div>
          {footer && <div className="workbench-dialog-foot">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type CommandKind = 'activity' | 'tasks' | 'schedules' | 'project' | 'channel'
type Command = { id: string; label: string; kind: CommandKind; keywords?: string; hint?: string; route: string | null }

const SHORTCUTS: readonly Command[] = [
  { id: 'activity', label: '查看动态', kind: 'activity', keywords: 'activity feed', hint: '视图', route: '/' },
  { id: 'ready', label: '待认领任务', kind: 'tasks', keywords: 'tasks ready queue', hint: '任务队列', route: '/tasks?state=ready' },
  { id: 'claimed', label: '已认领任务', kind: 'tasks', keywords: 'tasks claimed queue', hint: '任务队列', route: '/tasks?state=claimed' },
  { id: 'schedules', label: '定时发送', kind: 'schedules', keywords: 'settings schedules', hint: '设置', route: '/settings/schedules' },
  { id: 'projects', label: '项目索引', kind: 'project', keywords: 'home repo projects workspace', hint: '工作区', route: null },
]
const COMMAND_LIMIT = 50

function CommandIcon({ kind }: { kind: CommandKind }) {
  if (kind === 'activity') return <Activity size={14} strokeWidth={1.75} className="workbench-command-icon" aria-hidden="true" />
  if (kind === 'tasks') return <ListTodo size={14} strokeWidth={1.75} className="workbench-command-icon" aria-hidden="true" />
  if (kind === 'schedules') return <Clock size={14} strokeWidth={1.75} className="workbench-command-icon" aria-hidden="true" />
  if (kind === 'project') return <FolderKanban size={14} strokeWidth={1.75} className="workbench-command-icon" aria-hidden="true" />
  return <Hash size={14} strokeWidth={1.75} className="workbench-command-icon" aria-hidden="true" />
}

function Commands({
  channels,
  projects,
  openProjects,
  openRoute,
  close,
}: {
  channels: readonly string[]
  projects: readonly WorkspaceProject[]
  openProjects: () => void
  openRoute: (path: string) => void
  close: () => void
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLUListElement>(null)
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const commands: Command[] = [
    ...SHORTCUTS,
    ...projects.map((project): Command => ({
      id: `project:${project.channel}`,
      label: project.name,
      kind: 'project',
      hint: `项目 · #${project.channel}`,
      keywords: project.repository,
      route: projectQueue(project.channel),
    })),
    ...[...new Set(channels)].sort().map((channel): Command => ({
      id: `channel:${channel}`,
      label: `#${channel}`,
      kind: 'channel',
      hint: '频道',
      route: `/c/${channel}`,
    })),
  ]
  const matched = commands.filter((command) => {
    const text = [command.label, command.keywords, command.hint].filter(Boolean).join(' ').toLowerCase()
    return terms.every((term) => text.includes(term))
  })

  const run = (command: Command) => {
    if (command.route === null) openProjects()
    else openRoute(command.route)
  }

  const move = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const buttons = Array.from(results.current?.querySelectorAll<HTMLButtonElement>('[data-workbench-command]') ?? [])
    if (!buttons.length) return
    const current = buttons.findIndex((button) => event.target === button)
    const next = event.key === 'ArrowDown'
      ? (current + 1) % buttons.length
      : current <= 0 ? buttons.length - 1 : current - 1
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <WorkbenchDialog
      title="命令面板"
      description="输入名称搜索，按 ↑ 或 ↓ 选中，按 Enter 打开。"
      initialFocus={input}
      close={close}
      footer={
        <>
          <span className="workbench-keys">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </span>
          <span className="workbench-hint">共 {matched.length} 项</span>
        </>
      }
    >
      <div className="workbench-search-wrap">
        <Search size={15} strokeWidth={1.75} className="workbench-search-icon" aria-hidden="true" />
        <input
          ref={input}
          className="workbench-search"
          type="text"
          aria-label="搜索命令"
          placeholder="搜索命令、频道或项目"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && matched[0]) {
              event.preventDefault()
              run(matched[0])
            } else move(event)
          }}
        />
        <kbd className="workbench-search-kbd">Esc</kbd>
      </div>
      {matched.length ? (
        <ul className="workbench-results" ref={results} onKeyDown={move}>
          {matched.slice(0, COMMAND_LIMIT).map((command) => (
            <li key={command.id}>
              <button type="button" data-workbench-command="" className="workbench-command" onClick={() => run(command)}>
                <span className="workbench-command-main">
                  <CommandIcon kind={command.kind} />
                  <span>{command.label}</span>
                </span>
                {command.hint && <span className="workbench-hint">{command.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workbench-empty">没有匹配的命令。</p>
      )}
      {matched.length > COMMAND_LIMIT && <p className="workbench-hint">继续输入以缩小搜索范围。</p>}
    </WorkbenchDialog>
  )
}

function Projects({
  manifest,
  save,
  openRoute,
  close,
}: {
  manifest: WorkspaceManifest | null
  save: (manifest: WorkspaceManifest) => void
  openRoute: (path: string) => void
  close: () => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const stillOpen = useRef(true)
  const projects = manifest?.projects ?? NO_PROJECTS
  useEffect(() => {
    stillOpen.current = true
    return () => {
      stillOpen.current = false
    }
  }, [])

  async function importFile(file: File) {
    if (busy) return
    setNotice('')
    setError('')
    if (file.size > WORKSPACE_MAX_BYTES) {
      setError('项目配置文件不得超过 64 KB。')
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      if (!stillOpen.current) return
      const result = parseWorkspaceIndex(text)
      if (!result.ok) {
        setError(result.error)
        return
      }
      save(result.manifest)
      setNotice(`已导入 ${result.manifest.projects.length} 个项目。`)
    } catch {
      if (stillOpen.current) setError('无法读取或保存项目配置。')
    } finally {
      if (stillOpen.current) setBusy(false)
    }
  }

  async function copyManifest() {
    if (!manifest) return
    setError('')
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest))
      setNotice('项目配置已复制。')
    } catch {
      setNotice('')
      setError('无法复制项目配置。')
    }
  }

  return (
    <WorkbenchDialog
      title="项目索引"
      description="从配置打开项目的任务、代码仓库和协作指南。"
      initialFocus={importButton}
      close={close}
      footer={
        <>
          <span>共 {projects.length} 个已索引项目</span>
          <span className="workbench-hint">workspace.json · 最大 64 KB</span>
        </>
      }
    >
      <div className="workbench-actions">
        <button ref={importButton} type="button" className="workbench-action primary" disabled={busy} onClick={() => picker.current?.click()}>
          <Upload size={13} strokeWidth={1.75} aria-hidden="true" />
          导入 JSON
        </button>
        <button type="button" className="workbench-action" disabled={busy || !manifest} onClick={() => void copyManifest()}>
          <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
          复制配置
        </button>
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          aria-label="选择 JSON 项目配置"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importFile(file)
          }}
        />
      </div>
      {error && (
        <p className="workbench-error" role="alert">
          {error}
        </p>
      )}
      <p className="workbench-status" role="status">
        {notice}
      </p>
      {projects.length ? (
        <ul className="workbench-project-list">
          {projects.map((project) => (
            <li className="workbench-project" key={project.channel}>
              <div className="workbench-project-head">
                <h3 className="workbench-project-title">{project.name}</h3>
                <code className="workbench-project-channel workbench-hint">#{project.channel}</code>
              </div>
              <div className="workbench-actions">
                <button type="button" className="workbench-action primary" onClick={() => openRoute(projectQueue(project.channel))}>
                  <ListTodo size={13} strokeWidth={1.75} aria-hidden="true" />
                  查看任务
                </button>
                <a className="workbench-action" href={project.repository} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                  代码仓库
                </a>
                {project.guide && (
                  <a className="workbench-action" href={project.guide} target="_blank" rel="noopener noreferrer">
                    <BookOpen size={13} strokeWidth={1.75} aria-hidden="true" />
                    协作指南
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workbench-empty">导入 Home Repo 的 workspace.json 来添加项目。</p>
      )}
    </WorkbenchDialog>
  )
}
