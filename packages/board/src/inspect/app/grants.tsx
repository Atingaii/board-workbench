// Modified for Board Workbench. Upstream license and attribution are in LICENSE and README.md.
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Explanation, GrantCan, GrantView, PrincipalInput } from '../../api/routes.ts'
// `@vercel/board/access`, in an app of yours.
import { PERMISSIONS } from '../../server/access.ts'
import type { ExplainPrincipal } from '../../server/index.default.ts'
import * as board from './board.ts'
import { Ago, here, navigate, type Where } from './nav.tsx'
import { Actions } from './settings.tsx'
import { canFromLines, nameOf, type State, type Viewer } from './store.ts'
import { fieldMenu, nativeMenu, Panel, Suggest, Unlisted } from './ui.tsx'
import { principalName, said } from './words.ts'

// Access: what you may do, the grants that let everyone else in, and the board's own answer to
// "who decides this channel, for whom". The page shows what the board says; it works nothing out.

const PERMISSION_LABELS = new Map([
  ['read', '读取'],
  ['post', '发送'],
  ['react', '添加回应'],
  ['label', '修改标签'],
  ['sync', '同步'],
  ['manage', '管理'],
])

const permissionLabels = (permissions: readonly string[]) => permissions.map((permission) => PERMISSION_LABELS.get(permission) ?? permission).join('、')

/** Who a grant, or a question, can be about, and what the page asks to name one. */
const KINDS = {
  user: { label: '用户', fields: [{ name: 'id', placeholder: '邮箱或用户 ID' }] },
  project: {
    label: '项目',
    fields: [
      { name: 'id', placeholder: '项目名称或 ID' },
      { name: 'environment', placeholder: '环境，例如 production' },
    ],
  },
  github: {
    label: 'GitHub',
    fields: [
      { name: 'id', placeholder: '所有者/仓库' },
      { name: 'workflow', placeholder: '工作流，例如 ci.yml（可留空）' },
      { name: 'branch', placeholder: '分支（可留空）' },
    ],
  },
  app: { label: '应用', fields: [{ name: 'id', placeholder: '应用标识或客户端 ID' }] },
} as const
type Kind = keyof typeof KINDS
const isKind = (value: string | null): value is Kind => value !== null && value in KINDS

export function Access(props: { state: State; viewer: Viewer; where: Where }) {
  const { state, viewer } = props
  useEffect(() => {
    void board.loadGrants()
  }, [])
  const me = state.me!
  const grants = state.grants
  const mayGrant = Object.values(me.can).some((permissions) => permissions.includes('manage'))
  return (
    <>
      {mayGrant && (
        <Actions>
          <NewGrant />
        </Actions>
      )}
      <h3>你的权限</h3>
      <div className="grant-row" {...nativeMenu}>
        <span className="faint" />
        <span className="grant-who">{nameOf(state, me.actor)}</span>
        <Can can={me.can} />
      </div>
      <h3>查询权限</h3>
      <Explain state={state} where={props.where} />
      <h3>访问规则</h3>
      <Unlisted listed={grants} />
      {grants.is === 'here' && grants.items.length === 0 && <p className="empty">暂无访问规则</p>}
      {grants.is === 'here' && grants.items.map((grant) => <GrantRow key={grant.id} grant={grant} state={state} revoke={viewer.manages} />)}
    </>
  )
}

/** What a `can` gives, pattern by pattern, as the board wrote it. */
function Can({ can }: { can: Record<string, 'all' | readonly string[]> }) {
  return (
    <span className="grant-can">
      {Object.entries(can).map(([pattern, gives]) => (
        <span key={pattern} className="label">
          <b>{pattern}</b> {gives === 'all' ? '全部权限' : gives.length > 0 ? permissionLabels(gives) : '无权限'}
        </span>
      ))}
    </span>
  )
}

function GrantRow({ grant, state, revoke }: { grant: GrantView; state: State; revoke: boolean }) {
  const who = grant.principals.map(principalName).join(', ')
  return (
    <div className="grant-row" {...nativeMenu}>
      <span className="faint">{grant.id}</span>
      <span className="grant-who" title={who}>
        {who}
        {grant.capped && <span className="badge" title="团队角色限制用户从此规则获取的权限">受角色限制</span>}
      </span>
      <Can can={grant.can} />
      <span className="faint small">
        {grant.by && grant.at ? (
          <>
            {nameOf(state, grant.by)} · <Ago iso={grant.at} />
          </>
        ) : (
          '看板内置'
        )}
      </span>
      {revoke && (
        <button className="act quiet" onClick={() => confirm(`撤销访问规则 ${grant.id}？${who} 从下次请求起将失去通过此规则获得的权限。`) && void board.revokeGrant(grant.id)}>
          撤销
        </button>
      )}
    </div>
  )
}

/** The principal the fields name, as `explain` takes one. */
function whomOf(kind: Kind | 'you', fields: Record<string, string>): ExplainPrincipal {
  const id = fields.id ?? ''
  if (kind === 'user') return { user: id }
  if (kind === 'project') return { project: id, ...(fields.environment ? { environment: fields.environment } : {}) }
  if (kind === 'github') return { github: id, ...(fields.workflow ? { workflow: fields.workflow } : {}), ...(fields.branch ? { branch: fields.branch } : {}) }
  if (kind === 'app') return { app: id }
  return {}
}

/** Picks who it's about: one of the kinds, and what names one. */
function Who<K extends string>(props: { kinds: readonly K[]; labels: Record<K, string>; kind: K; onKind: (kind: K) => void; fields: Record<string, string>; onField: (name: string, value: string) => void }) {
  const named = isKind(props.kind) ? KINDS[props.kind].fields : []
  return (
    <>
      <div className="segments">
        {props.kinds.map((kind) => (
          <button key={kind} type="button" className={`segment${props.kind === kind ? ' on' : ''}`} onClick={() => props.onKind(kind)}>
            {props.labels[kind]}
          </button>
        ))}
      </div>
      {named.length > 0 && (
        <div className="who-fields">
          {named.map((field) => (
            <label key={field.name} className="suggest">
              <input value={props.fields[field.name] ?? ''} placeholder={field.placeholder} spellCheck={false} onChange={(event) => props.onField(field.name, event.target.value)} />
            </label>
          ))}
        </div>
      )}
    </>
  )
}

const EXPLAIN_KINDS = ['you', 'user', 'project', 'github', 'app'] as const
const EXPLAIN_LABELS = { you: '你', user: KINDS.user.label, project: KINDS.project.label, github: KINDS.github.label, app: KINDS.app.label }
const FIELDS = ['id', 'environment', 'workflow', 'branch']

/** Asks the board which grants decide a channel, for you or a principal you name. The question lives in the URL. */
function Explain({ state, where }: { state: State; where: Where }) {
  const asked = where.params.get('channel') ?? ''
  const askedKind = where.params.get('who')
  const [channel, setChannel] = useState(asked)
  const [kind, setKind] = useState<(typeof EXPLAIN_KINDS)[number]>(isKind(askedKind) ? askedKind : 'you')
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((name) => [name, where.params.get(name) ?? ''])))
  const [answer, setAnswer] = useState<{ explanation: Explanation } | { problem: string } | null>(null)
  const query = where.params.toString()
  useEffect(() => {
    if (!asked) return setAnswer(null)
    let current = true
    const params = where.params
    board.explain(asked, whomOf(isKind(params.get('who')) ? (params.get('who') as Kind) : 'you', Object.fromEntries(FIELDS.map((name) => [name, params.get(name) ?? ''])))).then(
      (explanation) => current && setAnswer({ explanation }),
      (error) => current && setAnswer({ problem: said(error) }),
    )
    return () => {
      current = false
    }
  }, [query])
  const ask = () => {
    const place = channel.trim().replace(/^#/, '')
    if (!place) return
    navigate(here({ params: { channel: place, who: kind === 'you' ? null : kind, ...Object.fromEntries(FIELDS.map((name) => [name, kind === 'you' ? null : fields[name]?.trim() || null])) } }))
  }
  const subject = askedKind && isKind(askedKind) ? (where.params.get('id') ?? EXPLAIN_LABELS[askedKind]) : EXPLAIN_LABELS.you
  return (
    <form
      className="explain"
      onSubmit={(event) => {
        event.preventDefault()
        ask()
      }}
      {...fieldMenu}
    >
      <div className="explain-ask">
        <Suggest prefix="#" value={channel} onChange={setChannel} items={Object.keys(state.channels).sort()} placeholder="频道" onEnter={ask} />
        <span className="faint">对象</span>
        <Who kinds={EXPLAIN_KINDS} labels={EXPLAIN_LABELS} kind={kind} onKind={setKind} fields={fields} onField={(name, value) => setFields((current) => ({ ...current, [name]: value }))} />
        <button type="submit" className="send small" disabled={!channel.trim()}>
          查询
        </button>
      </div>
      {answer && 'problem' in answer && <p className="hint error-text">{answer.problem}</p>}
      {answer && 'explanation' in answer && <Explained explanation={answer.explanation} subject={subject} state={state} />}
    </form>
  )
}

/** The board's answer, as it gave it: what they may do there, the pattern that decided, at which level, and the grants that add up to it. */
function Explained({ explanation, subject, state }: { explanation: Explanation; subject: string; state: State }) {
  const { channel, pattern, over, level, grants, capped, can } = explanation
  return (
    <div className="explained" {...nativeMenu}>
      <p>
        {subject} 在 <b>#{channel}</b> 的权限为 {can.length > 0 ? <b>{permissionLabels(can)}</b> : <b>无</b>}。
      </p>
      <dl className="facts">
        <dt>授权依据</dt>
        <dd>
          {pattern === null ? (
            can.length > 0 ? '看板内置代码和部署可直接访问' : '没有访问规则授予权限'
          ) : (
            <>
              <b>{pattern}</b> 匹配{level === 'principal' ? '直接授予该对象的规则' : level === 'group' ? '授予所属群组的规则' : '授予所有对象的规则'}
              {over.length > 0 && <span className="faint">（优先于 {over.join('、')}）</span>}
            </>
          )}
        </dd>
        {capped !== null && (
          <>
            <dt>权限限制</dt>
            <dd>受团队角色 {capped} 限制</dd>
          </>
        )}
      </dl>
      {grants.map((grant) => (
        <GrantRow key={grant.id} grant={grant} state={state} revoke={false} />
      ))}
    </div>
  )
}

const GRANT_KINDS = ['user', 'project', 'github', 'app', 'all-users', 'all-projects', 'all-apps', 'everyone'] as const
const GRANT_LABELS = { user: KINDS.user.label, project: KINDS.project.label, github: KINDS.github.label, app: KINDS.app.label, 'all-users': '所有用户', 'all-projects': '所有项目', 'all-apps': '所有应用', everyone: '所有对象' }

/** The principal the fields name, as a grant takes one. */
function principalOf(kind: (typeof GRANT_KINDS)[number], fields: Record<string, string>): PrincipalInput {
  const id = (fields.id ?? '').trim()
  const environment = (fields.environment ?? '').trim()
  const environments = environment ? { environments: environment.split(',').map((name) => name.trim()).filter(Boolean) } : {}
  if (kind === 'user') return id.includes('@') ? { kind, email: id } : { kind, userId: id }
  if (kind === 'project') return { kind, project: id, ...environments }
  if (kind === 'github') return { kind, repository: id, ...(fields.workflow?.trim() ? { workflow: fields.workflow.trim() } : {}), ...(fields.branch?.trim() ? { branch: fields.branch.trim() } : {}) }
  if (kind === 'app') return { kind, app: id }
  return { kind }
}

/** A new grant: who, and what they may do where. The board checks it, and says what's wrong with one it refuses. */
function NewGrant() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<(typeof GRANT_KINDS)[number]>('user')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [lines, setLines] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setProblem(null), [kind, fields, lines])
  const named = !isKind(kind) || (fields.id ?? '').trim() !== ''
  const grant = async () => {
    const read = canFromLines(lines)
    if ('problem' in read) return setProblem(read.problem)
    setBusy(true)
    // The lines' permissions go as written: which ones there are is the board's to say.
    const refused = await board.createGrant({ principals: [principalOf(kind, fields)], can: read.can as GrantCan })
    setBusy(false)
    if (refused) return setProblem(refused)
    setOpen(false)
    setFields({})
    setLines('')
  }
  return (
    <Panel
      title="新增访问规则"
      trigger={
        <>
          <Plus size={14} /> 新增规则
        </>
      }
      triggerClass="act"
      open={open}
      onOpenChange={setOpen}
    >
      <form
        className="ask"
        onSubmit={(event) => {
          event.preventDefault()
          void grant()
        }}
        {...fieldMenu}
      >
        <Who kinds={GRANT_KINDS} labels={GRANT_LABELS} kind={kind} onKind={setKind} fields={fields} onField={(name, value) => setFields((current) => ({ ...current, [name]: value }))} />
        <textarea className="code can" rows={3} value={lines} spellCheck={false} placeholder={'work/=read,post\nsecrets/=none'} onChange={(event) => setLines(event.target.value)} />
        {problem ? (
          <p className="hint error-text">{problem}</p>
        ) : (
          <p className="hint">每行填写一条匹配规则。权限可填 all、none 或 {PERMISSIONS.join('、')} 中的任意项。</p>
        )}
        <button type="submit" className="send small" disabled={busy || !named || !lines.trim()}>
          授权
        </button>
      </form>
    </Panel>
  )
}
