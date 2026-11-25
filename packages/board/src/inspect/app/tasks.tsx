// Modified for Board Workbench. Upstream license and attribution are in LICENSE and README.md.
import { ListFilter, ListTodo, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MessageView } from '../../api/routes.ts'
import * as board from './board.ts'
import { Composer } from './composer.tsx'
import { describe } from './filters.tsx'
import { Pendings } from './message.tsx'
import { Ago, here, Link, navigate, useTypeToFocus, type Where } from './nav.tsx'
import { isTask, nameOf, placesUnder, stateNow, tasks, type State, type TaskFilter, type TaskRoot } from './store.ts'
import { Lease, Needs, StateMark, TASK_STATE_LABELS, useLapse } from './task.tsx'
import { Header, nativeMenu, Panel, Suggest, type KnownLabels } from './ui.tsx'
import { firstLine } from './words.ts'

// The board's tasks as a queue: open ones, oldest first, the order they're worked in. Each row is
// its thread, which is where a task is read and worked.

const STATES = ['open', 'waiting', 'ready', 'claimed', 'blocked', 'completed', 'failed', 'canceled', 'all'] as const

const STATE_FILTER_LABELS: Record<(typeof STATES)[number], string> = {
  ...TASK_STATE_LABELS,
  open: '未结束',
  all: '全部',
}

/** The view's filter, from its URL: `/tasks?state=ready&channel=work/&label=step=fix`. */
function readFilter(params: URLSearchParams): TaskFilter {
  const state = params.get('state') ?? 'open'
  const one = (name: 'channel' | 'owner' | 'for') => (params.get(name) ? { [name]: params.get(name)! } : {})
  return {
    state: (STATES as readonly string[]).includes(state) ? (state as TaskFilter['state']) : 'open',
    label: params.getAll('label').filter(Boolean),
    ...one('channel'),
    ...one('owner'),
    ...one('for'),
  }
}

const setFilter = (changes: Record<string, string | string[] | null>) => navigate(here({ params: changes }), true)

export function Tasks(props: { state: State; now: number; lead: ReactNode; where: Where; known: KnownLabels }) {
  const { state, where } = props
  useTypeToFocus('main')
  const query = where.params.toString()
  const filter = useMemo(() => readFilter(where.params), [query])
  const key = JSON.stringify(filter)
  // Where the board's list ended, for the filter it was asked with: the list stops there while the board has more.
  const [listed, setListed] = useState<{ key: string; cursor: string; last: MessageView | undefined; more: boolean } | null>(null)
  // What the board answered instead of the list, when it refused: `tooWide` when its tree holds more channels than one list reads.
  const [refused, setRefused] = useState<{ text: string; tooWide: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let current = true
    setLoading(true)
    // A refusal was the last filter's: this one says its own once the board answers.
    setRefused(null)
    void board.loadTasks(filter).then((page) => {
      if (!current) return
      setLoading(false)
      setRefused('refused' in page ? { text: page.refused, tooWide: page.tooWide } : null)
      setListed('cursor' in page ? { key, ...page } : null)
    })
    return () => {
      current = false
    }
  }, [key])
  const end = listed?.key === key && listed.more ? listed.last : undefined
  const rows = useMemo(() => tasks(state, filter, props.now, end), [state.messages, state.ops, state.actors, key, props.now, end])

  // A task can wait for one this list doesn't hold (a completed one, say): its thread says its state.
  const missing = [...new Set(rows.flatMap((row) => row.task.needs))].filter((id) => !state.messages[id]).slice(0, 30)
  useEffect(() => {
    for (const id of missing) void board.loadThread(id)
  }, [missing.join(' ')])

  const owners = [...new Set(Object.values(state.messages).flatMap((m) => (isTask(m) ? [m.task.owner] : [])))]
  const assignees = [...new Set(Object.values(state.messages).flatMap((m) => (isTask(m) && m.task.for ? [m.task.for] : [])))]
  const chips: { key: string; text: string; drop: Record<string, string | string[] | null> }[] = [
    ...(filter.channel ? [{ key: 'channel', text: `频道 #${filter.channel}`, drop: { channel: null } }] : []),
    ...filter.label.map((label) => ({ key: `label:${label}`, text: describe(label), drop: { label: filter.label.filter((l) => l !== label) } })),
    ...(filter.owner ? [{ key: 'owner', text: `所有者 ${nameOf(state, filter.owner)}`, drop: { owner: null } }] : []),
    ...(filter.for ? [{ key: 'for', text: `指派给 ${nameOf(state, filter.for)}`, drop: { for: null } }] : []),
  ]
  const more = listed?.key === key && listed.more
  // Tasks on their way, and any the board refused, with why.
  const pending = state.pending.filter((post) => post.task !== undefined && post.re === null)
  return (
    <>
      <Header title="任务" meta="最早创建优先" live={state.live} lead={props.lead}>
        <TaskFilterButton filter={filter} channels={Object.keys(state.channels).sort()} owners={owners} assignees={assignees} state={state} known={props.known} count={chips.length} />
      </Header>
      <nav className="tabs task-tabs" aria-label="任务状态筛选">
        {STATES.map((name) => (
          <Link key={name} to={here({ params: { state: name === 'open' ? null : name } })} className="tab" current={filter.state === name}>
            {STATE_FILTER_LABELS[name]}
          </Link>
        ))}
      </nav>
      {chips.length > 0 && (
        <div className="filter-bar">
          {chips.map((chip) => (
            <span key={chip.key} className="label">
              {chip.text}
              <button title="移除筛选条件" onClick={() => setFilter(chip.drop)}>
                <X size={11} />
              </button>
            </span>
          ))}
          <button className="clear" onClick={() => setFilter({ channel: null, label: null, owner: null, for: null })}>
            清除筛选
          </button>
        </div>
      )}
      <div className="page">
        {refused?.tooWide ? (
          <Places channels={Object.keys(state.channels)} under={filter.channel} />
        ) : refused !== null ? (
          <p className="empty error">{refused.text}</p>
        ) : rows.length === 0 && pending.length === 0 ? (
          <div className="empty empty-state">
            <ListTodo size={18} strokeWidth={1.6} className="empty-icon" aria-hidden="true" />
            <p className="empty-title">{loading ? '正在加载…' : chips.length > 0 || filter.state !== 'open' ? '没有符合条件的任务' : '没有未结束的任务'}</p>
            {!loading && (
              <p className="empty-hint">
                {chips.length > 0 || filter.state !== 'open'
                  ? '调整状态标签或筛选条件，即可查看其他任务。'
                  : '在下方输入框发布新任务，或切换状态标签查看历史记录。'}
              </p>
            )}
          </div>
        ) : (
          <div className="task-rows">
            {rows.map((row) => (
              <TaskRow key={row.id} root={row} state={state} open={where.thread === row.id} />
            ))}
          </div>
        )}
        <Pendings posts={pending} me={state.me!} />
        {more && (
          <button
            className="clear more"
            onClick={() => void board.loadTasks(filter, listed.cursor).then((page) => 'cursor' in page && setListed({ key, ...page }))}
          >
            加载更多
          </button>
        )}
      </div>
      <Composer
        scope="tasks"
        role="main"
        placeholder="创建任务…"
        known={props.known}
        channels={Object.keys(state.channels).sort()}
        {...(filter.channel && !filter.channel.endsWith('/') ? { channel: filter.channel } : {})}
        tasks={{ state, always: true }}
        onSend={({ text, noSync, channel, labels, files, task }) => void board.send({ channel, re: null, text, noSync, labels, files, ...(task ? { task } : {}) })}
      />
    </>
  )
}

/**
 * Where to look, when the board lists tasks a tree at a time: Vercel's does for a caller who doesn't
 * read every channel. Each place filters the list to it, and one that's still too big shows its own.
 */
function Places({ channels, under }: { channels: string[]; under: string | undefined }) {
  const places = placesUnder(channels, under)
  return (
    <>
      <p className="empty">
        {under ? `#${under} 下` : '此看板中'}的频道较多。你只有部分频道的读取权限。请选择要查看任务的位置。
      </p>
      <div className="task-places">
        {places.map(({ place, channels: count }) => (
          <Link key={place} to={here({ params: { channel: place } })} className="task-place">
            <span className="name">#{place}</span>
            {place.endsWith('/') && <span className="count">{count} 个频道</span>}
          </Link>
        ))}
      </div>
    </>
  )
}

/** One task: its state, what it says, and the one thing about it that matters now. Opens its thread. */
function TaskRow({ root, state, open }: { root: TaskRoot; state: State; open: boolean }) {
  const { task } = root
  const now = useLapse(task.claim?.until)
  const current = stateNow(task, now)
  const labels = Object.entries(root.labels).filter(([key]) => !key.startsWith('board.'))
  return (
    <div
      className="task-row"
      role="link"
      tabIndex={0}
      aria-current={open ? 'true' : undefined}
      onClick={(event) => {
        // A link inside the row (what it needs) goes where it says.
        if (!(event.target as HTMLElement).closest('a')) navigate(here({ thread: root.id }))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') navigate(here({ thread: root.id }))
      }}
    >
      <StateMark state={current} />
      <span className="task-title" {...nativeMenu}>
        {/* A task can be its files alone. */}
        <span className="task-subject">{firstLine(root.text) || (root.attachments ?? []).map((file) => file.name).join(', ') || '消息已移除'}</span>
        <span className="task-id">#{root.id}</span>
        {labels.map(([key, value]) => (
          <span key={key} className="label">
            {key}={value}
          </span>
        ))}
      </span>
      <span className="task-now">
        {current === 'claimed' && task.claim && (
          <>
            {nameOf(state, task.claim.actor)} · <Lease until={task.claim.until} />
          </>
        )}
        {current === 'ready' && (task.state === 'claimed' ? '认领已过期' : task.for ? `指派给 ${nameOf(state, task.for)}` : '')}
        {current === 'waiting' && (
          <>
            依赖 <Needs ids={task.needs} state={state} />
          </>
        )}
        {current === 'blocked' && (task.blocked?.kind ?? task.blocked?.reason)}
        {current === 'completed' && task.result}
        {(current === 'failed' || current === 'canceled') && task.reason}
      </span>
      <span className="task-where">#{root.channel}</span>
      <Ago iso={root.createdAt} />
    </div>
  )
}

function TaskFilterButton(props: { filter: TaskFilter; channels: string[]; owners: string[]; assignees: string[]; state: State; known: KnownLabels; count: number }) {
  const { filter, state } = props
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState(filter.channel ?? '')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const valueRef = useRef<HTMLDivElement>(null)
  useEffect(() => setChannel(filter.channel ?? ''), [filter.channel])
  // A channel, or with a trailing slash it and everything under it.
  const places = [...new Set(props.channels.flatMap((path) => [path, ...(path.includes('/') ? [`${path.slice(0, path.indexOf('/'))}/`] : [])]))].sort()
  const addLabel = () => {
    const k = key.trim()
    if (!k) return
    const label = value.trim() ? `${k}=${value.trim()}` : k
    if (!filter.label.includes(label)) setFilter({ label: [...filter.label, label] })
    setKey('')
    setValue('')
  }
  const who = (name: 'owner' | 'for', ids: string[]) => (
    <div className="segments">
      {['', ...ids].map((id) => (
        <button key={id || 'any'} className={`segment${(filter[name] ?? '') === id ? ' on' : ''}`} title={id} onClick={() => setFilter({ [name]: id || null })}>
          {id ? nameOf(state, id) : '不限'}
        </button>
      ))}
    </div>
  )
  return (
    <Panel
      title="筛选任务"
      trigger={
        <>
          <ListFilter size={15} strokeWidth={1.75} />
          {props.count > 0 && <span className="count">{props.count}</span>}
        </>
      }
      open={open}
      onOpenChange={setOpen}
    >
      <div className="filter-form">
        <div className="filter-row">
          <span className="filter-name">频道</span>
          <Suggest
            prefix="#"
            value={channel}
            onChange={(next) => {
              setChannel(next)
              // Picking one from the list filters at once; typing waits for Enter.
              if (places.includes(next) || next === '') setFilter({ channel: next || null })
            }}
            items={places}
            placeholder="不限（输入 work/ 查看其下全部频道）"
            onEnter={() => setFilter({ channel: channel.trim().replace(/^#/, '') || null })}
          />
        </div>
        <div className="filter-row">
          <span className="filter-name">标签</span>
          <div className="label-add">
            <Suggest value={key} onChange={setKey} items={[...props.known.keys()].filter((k) => !k.startsWith('board.'))} placeholder="键" onEnter={() => (value ? addLabel() : valueRef.current?.querySelector('input')?.focus())} />
            <span className="faint">=</span>
            <div ref={valueRef} className="grow">
              <Suggest value={value} onChange={setValue} items={[...(props.known.get(key.trim()) ?? [])]} placeholder="不限（或输入 a|b）" onEnter={addLabel} />
            </div>
            <button className="send small" disabled={!key.trim()} onClick={addLabel}>
              添加
            </button>
          </div>
        </div>
        <div className="filter-row">
          <span className="filter-name">所有者</span>
          {who('owner', props.owners)}
        </div>
        <div className="filter-row">
          <span className="filter-name">指派给</span>
          {who('for', props.assignees)}
        </div>
      </div>
    </Panel>
  )
}
