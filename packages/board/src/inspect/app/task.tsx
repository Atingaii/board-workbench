// Modified for Board Workbench. Upstream license and attribution are in LICENSE and README.md.
import { Circle, CircleCheck, CircleDashed, CircleDot, CirclePause, CircleSlash, CircleX, Ellipsis } from 'lucide-react'
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import * as board from './board.ts'
import { here, Link } from './nav.tsx'
import { isTask, moves, nameOf, profilesOf, stateNow, type State, type TaskRoot, type TaskState, type Viewer } from './store.ts'
import { AskForm, Menu, MenuItem, MenuSeparator, nativeMenu, Panel, type AskProps } from './ui.tsx'
import { clock, firstLine } from './words.ts'

// A task is a thread with a state, so it shows as one more line on its root: the state, who holds
// it and for how long, who it's for, what it waits for, and how it ended. The thread pane shows the
// same in full, with what you can do to it.

const MARKS: Record<TaskState, typeof Circle> = {
  waiting: CircleDashed,
  ready: Circle,
  claimed: CircleDot,
  blocked: CirclePause,
  completed: CircleCheck,
  failed: CircleX,
  canceled: CircleSlash,
}

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  waiting: '等待前置任务',
  ready: '待认领',
  claimed: '已认领',
  blocked: '待处理',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
}

export function StateMark({ state }: { state: TaskState }) {
  const Icon = MARKS[state]
  return (
    <span className={`task-state ${state}`}>
      <Icon size={13} strokeWidth={2} />
      {TASK_STATE_LABELS[state]}
    </span>
  )
}

/** The time now, read again the moment a lease ends, so a claim that lapses shows as over without a reload. */
export function useLapse(until: string | undefined): number {
  const [, again] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (until === undefined) return
    const left = Date.parse(until) - Date.now()
    if (left <= 0) return
    // A timer takes at most 2^31 ms; no lease is that long.
    const timer = setTimeout(again, Math.min(left + 50, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [until])
  return Date.now()
}

/** What's left of a lease, counted down a second at a time. */
export function Lease({ until }: { until: string }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])
  const left = Date.parse(until) - Date.now()
  return (
    <span className="lease" title={`有效至 ${new Date(until).toLocaleString('zh-CN')}`}>
      {left > 0 ? `剩余 ${clock(left)}` : '认领已过期'}
    </span>
  )
}

/** The tasks one waits for, each a link to its thread, with its state where the page has it. */
export function Needs({ ids, state }: { ids: string[]; state: State }) {
  return (
    <span className="needs">
      {ids.map((id) => {
        const need = state.messages[id]
        return (
          <Link key={id} to={here({ thread: id })} className="need" title={need ? firstLine(need.text) : `#${id}`}>
            #{id}
            {isTask(need) && <span className={`need-state ${stateNow(need.task, Date.now())}`}>{TASK_STATE_LABELS[stateNow(need.task, Date.now())]}</span>}
          </Link>
        )
      })}
    </span>
  )
}

/** A task in a line, under its root. */
export function TaskLine({ root, state }: { root: TaskRoot; state: State }) {
  const { task } = root
  const now = useLapse(task.claim?.until)
  const current = stateNow(task, now)
  const lapsed = task.state === 'claimed' && current !== 'claimed'
  const finished = current === 'completed' || current === 'failed' || current === 'canceled'
  return (
    <div className="task-line" {...nativeMenu}>
      <StateMark state={current} />
      {current === 'claimed' && task.claim && (
        <>
          <span>{nameOf(state, task.claim.actor)} 已认领</span>
          <Lease until={task.claim.until} />
        </>
      )}
      {lapsed && <span>认领已过期</span>}
      {task.for && !finished && <span>指派给 {nameOf(state, task.for)}</span>}
      {task.needs.length > 0 && !finished && (
        <span>
          依赖 <Needs ids={task.needs} state={state} />
        </span>
      )}
      {current === 'blocked' && task.blocked && (
        <span className="task-note">
          {task.blocked.kind ? `${task.blocked.kind}: ` : ''}
          {task.blocked.reason}
        </span>
      )}
      {current === 'completed' && task.result && <span className="task-note">{task.result}</span>}
      {(current === 'failed' || current === 'canceled') && task.reason && <span className="task-note">{task.reason}</span>}
    </div>
  )
}

/** A profile's actor under a principal, as the board writes one: the profile in lowercase. */
export const actorFor = (principal: string, profile: string) => `${principal}+${profile.trim().toLowerCase()}`

/** `#17 19, 21` as task IDs. */
export const taskIds = (text: string): string[] => [...new Set(text.split(/[\s,]+/).map((id) => id.replace(/^#/, '')).filter(Boolean))]

const HOLD_KINDS = ['needs_input', 'awaiting_approval']

/** What a task's card asks about before it acts. */
type Asked = 'complete' | 'fail' | 'block' | 'assign' | 'cancel'

/** A task in full, at the top of its thread: its facts, and what you can do to it now. */
export function TaskCard({ root, state, viewer }: { root: TaskRoot; state: State; viewer: Viewer }) {
  const { task } = root
  const now = useLapse(task.claim?.until)
  const current = stateNow(task, now)
  const lapsed = task.state === 'claimed' && current !== 'claimed'
  const can = moves(state, root, viewer, now)
  const [busy, setBusy] = useState(false)
  const run = (write: Promise<unknown>) => {
    setBusy(true)
    void write.finally(() => setBusy(false))
  }
  // What it waits for may be anywhere on the board: each need's thread says its state.
  const needs = task.needs.join(' ')
  useEffect(() => {
    for (const id of task.needs) if (!board.getState().messages[id]) void board.loadThread(id)
  }, [needs])

  // What you'd most likely do next is a button; everything else is in one menu, and asks in the same place.
  const [asking, setAsking] = useState<Asked | null>(null)
  const acts = useRef<HTMLDivElement>(null)
  const next: ReactNode[] = []
  if (can.claim)
    next.push(
      <button key="claim" className="act primary" disabled={busy} onClick={() => run(board.claimTask(root.id))}>
        认领
      </button>,
    )
  if (can.held)
    next.push(
      <button key="complete" className="act primary" disabled={busy} onClick={() => setAsking('complete')}>
        完成…
      </button>,
      <button key="release" className="act" disabled={busy} title="释放后，此任务重新进入待认领状态" onClick={() => run(board.releaseTask(root.id))}>
        释放认领
      </button>,
    )
  if (can.unblock)
    next.push(
      <button key="unblock" className="act primary" disabled={busy} onClick={() => run(board.unblockTask(root.id))}>
        恢复任务
      </button>,
    )
  if (can.reopen)
    next.push(
      <button key="reopen" className="act primary" disabled={busy} title="让此任务重新进入待认领状态" onClick={() => run(board.reopenTask(root.id))}>
        重新打开
      </button>,
    )
  const more: ReactNode[] = []
  if (can.held)
    more.push(
      <MenuItem key="renew" onClick={() => run(board.renewTask(root.id))}>
        延长认领
      </MenuItem>,
      <MenuItem key="fail" onClick={() => setAsking('fail')}>
        标记失败…
      </MenuItem>,
    )
  if (can.held || can.hold)
    more.push(
      <MenuItem key="block" onClick={() => setAsking('block')}>
        转为待人工处理…
      </MenuItem>,
    )
  if (can.assign)
    more.push(
      <MenuItem key="assign" onClick={() => setAsking('assign')}>
        指派…
      </MenuItem>,
    )
  if (can.assign && task.for !== null)
    more.push(
      <MenuItem key="pool" onClick={() => run(board.assignTask(root.id, null))}>
        取消指派
      </MenuItem>,
    )
  if (can.cancel)
    more.push(
      <MenuSeparator key="separator" />,
      <MenuItem key="cancel" danger onClick={() => setAsking('cancel')}>
        取消任务…
      </MenuItem>,
    )
  const asks: Record<Asked, { title: string } & AskProps> = {
    complete: {
      title: '完成任务',
      submit: '完成',
      fields: [{ name: 'result', placeholder: '简述任务结果（可选）', long: true }],
      onSubmit: ({ result }) => run(board.completeTask(root.id, result || undefined)),
    },
    fail: {
      title: '标记任务失败',
      submit: '标记失败',
      fields: [{ name: 'reason', placeholder: '失败原因', required: true, long: true }],
      onSubmit: ({ reason }) => run(board.failTask(root.id, reason!)),
    },
    block: {
      title: '转为待人工处理',
      submit: '转为待处理',
      note: can.held ? '此操作会结束你的认领。' : undefined,
      fields: [
        { name: 'kind', placeholder: '类型，例如 needs_input（可选）', items: HOLD_KINDS },
        { name: 'reason', placeholder: '需要人工处理的问题', required: true, long: true },
      ],
      onSubmit: ({ kind, reason }) => run(board.blockTask(root.id, reason!, kind || undefined)),
    },
    assign: {
      title: `指派给 ${nameOf(state, task.owner)} 的某个配置档案`,
      submit: '指派',
      note: '指派后，只有使用该身份的智能体可以认领。',
      fields: [{ name: 'profile', placeholder: '配置档案，例如 fixer', required: true, items: profilesOf(state, task.owner) }],
      onSubmit: ({ profile }) => run(board.assignTask(root.id, actorFor(task.owner, profile!))),
    },
    cancel: {
      title: '取消任务',
      submit: '取消任务',
      note: current === 'claimed' ? '此操作会结束当前认领。' : undefined,
      fields: [{ name: 'reason', placeholder: '取消原因', required: true, long: true }],
      onSubmit: ({ reason }) => run(board.cancelTask(root.id, reason!)),
    },
  }

  return (
    <section className="task-card">
      <div className="task-head" {...nativeMenu}>
        <StateMark state={current} />
        {current === 'claimed' && task.claim && (
          <>
            <span>{nameOf(state, task.claim.actor)} 已认领</span>
            <Lease until={task.claim.until} />
          </>
        )}
        {lapsed && task.claim && <span>{nameOf(state, task.claim.actor)} 的认领已过期</span>}
      </div>
      <dl className="facts" {...nativeMenu}>
        <dt>所有者</dt>
        <dd>{nameOf(state, task.owner)}</dd>
        {task.for && (
          <>
            <dt>指派给</dt>
            <dd>{nameOf(state, task.for)}</dd>
          </>
        )}
        {task.needs.length > 0 && (
          <>
            <dt>前置任务</dt>
            <dd>
              <Needs ids={task.needs} state={state} />
            </dd>
          </>
        )}
        {task.blocked && (
          <>
            <dt>待处理事项</dt>
            <dd>
              {task.blocked.kind && <span className="badge">{task.blocked.kind}</span>} {task.blocked.reason}
            </dd>
          </>
        )}
        {task.result && (
          <>
            <dt>结果</dt>
            <dd>{task.result}</dd>
          </>
        )}
        {task.reason && (
          <>
            <dt>原因</dt>
            <dd>{task.reason}</dd>
          </>
        )}
      </dl>
      {(next.length > 0 || more.length > 0) && (
        <div className="acts" ref={acts}>
          {next}
          {more.length > 0 && (
            <Menu className="act" title="更多操作" trigger={<Ellipsis size={14} strokeWidth={1.75} />}>
              {more}
            </Menu>
          )}
        </div>
      )}
      {asking && (
        <Panel title={asks[asking].title} open onOpenChange={(open) => !open && setAsking(null)} anchor={acts}>
          <AskForm {...asks[asking]} disabled={busy} onDone={() => setAsking(null)} />
        </Panel>
      )}
      {can.held && <p className="hint">此任务由当前标签页认领。刷新页面会失去认领。</p>}
      {can.elsewhere && <p className="hint">你已在另一标签页认领此任务。认领在到期前有效。</p>}
    </section>
  )
}
