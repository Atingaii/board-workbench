import type { ChannelView, Discovery, InboxEntry, Me, MessageView } from '../api/routes.ts'
import { ago, authorName } from '../cli/format.ts'
import { displayEmoji } from '../contract/emoji.ts'
import { html, raw, type Html } from './html.ts'
import { SCRIPT } from './script.ts'
import { CSS } from './style.ts'

/** What rendering a message needs: who's looking, and where. */
export type Viewer = { me: Me; path: string }

export type Layout = Viewer & {
  board: string
  sync: Discovery['sync']
  channels: ChannelView[]
  token: string
  nonce: string
}

export type View = {
  title: string
  meta?: string
  /** The channel whose events refresh the feed; `'off'` for none, unset for every channel. */
  live?: string
  feed: Html
  composer?: Html
}

const QUICK_REACTIONS = ['eyes', 'check', 'thumbs_up', 'party']

/** "claude via julian" for a profile, the name otherwise. */
export const who = (me: Pick<Me, 'name' | 'handle' | 'profile'>): string =>
  me.profile !== null && me.handle.includes('/') ? `${me.name} via ${me.handle.slice(0, me.handle.indexOf('/'))}` : me.name

const args = (value: Record<string, unknown>) => JSON.stringify(value)

const URLS = /(https?:\/\/[^\s<>"]+)/

/** Text with its URLs linked; everything else escaped. */
function linkify(text: string): Html {
  return html`${text.split(URLS).map((part, i) => {
    if (i % 2 === 0) return part
    const trail = /[.,;:!?)\]]+$/.exec(part)?.[0] ?? ''
    const url = part.slice(0, part.length - trail.length)
    return html`<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${trail}`
  })}`
}

function message(m: MessageView, viewer: Viewer, reply: boolean): Html {
  const name = authorName(m)
  const me = viewer.me.actor
  const mine = m.by.actor === me
  const avatar = m.author?.avatar
    ? html`<img src="${m.author.avatar}" alt="" referrerpolicy="no-referrer">`
    : name.slice(0, 1).toUpperCase()
  const reacted = (emoji: string) => (m.reactions[emoji] ?? []).includes(me)
  const chips = [
    ...Object.entries(m.labels).map(([key, value]) => html`<span class="label">${key}=${value}</span>`),
    ...Object.entries(m.reactions).map(
      ([emoji, actors]) =>
        html`<button class="chip${reacted(emoji) ? ' mine' : ''}" title="${actors.join(', ')}" data-do="react" data-args="${args({ id: m.id, emoji, remove: reacted(emoji) })}">${displayEmoji(emoji)} ${actors.length}</button>`,
    ),
  ]
  const actions = m.deleted
    ? null
    : html`<div class="actions">
        ${QUICK_REACTIONS.map(
          (emoji) =>
            html`<button title="${reacted(emoji) ? 'remove' : 'react'} :${emoji}:" data-do="react" data-args="${args({ id: m.id, emoji, remove: reacted(emoji) })}">${displayEmoji(emoji)}</button>`,
        )}
        ${m.re === null && !viewer.path.startsWith('/t/') ? html`<a href="/t/${m.id}">reply</a>` : null}
        <button data-do="edit-open" data-target="label-${m.id}">label</button>
        ${mine
          ? html`<button data-do="edit-open" data-target="edit-${m.id}">edit</button>
              <button data-do="delete" data-args="${args({ id: m.id })}" data-confirm="Delete #${m.id}?">delete</button>`
          : null}
      </div>`
  const forms = m.deleted
    ? null
    : html`<details class="edit" id="label-${m.id}"><summary></summary>
        <form class="inline" data-do="label" data-args="${args({ id: m.id })}">
          <input type="text" name="label" placeholder="key=value, or -key to remove" required>
          <button class="send">set</button>
        </form>
      </details>
      ${mine
        ? html`<details class="edit" id="edit-${m.id}"><summary></summary>
            <form class="inline" data-do="edit" data-args="${args({ id: m.id })}" data-keep="1">
              <textarea name="text" rows="2" data-enter required>${m.text}</textarea>
              <button class="send">save</button>
            </form>
          </details>`
        : null}`
  return html`<div class="message${reply ? ' reply' : ''}" id="m${m.id}">
    <div class="avatar">${avatar}</div>
    <div class="body">
      <div class="meta-line">
        <span class="author">${name}</span>
        ${m.from ? html`<span class="badge ${m.from}">${m.from}</span>` : null}
        <a class="time" href="/t/${m.re ?? m.id}#m${m.id}" title="${m.createdAt}">${ago(m.createdAt)}</a>
        <span class="id">#${m.id}</span>
        ${m.editedAt ? html`<span class="time">(edited)</span>` : null}
        ${m.noSync ? html`<span class="badge">board only</span>` : null}
      </div>
      ${m.deleted ? html`<div class="removed">message removed</div>` : html`<div class="text">${linkify(m.text)}</div>`}
      ${chips.length > 0 ? html`<div class="chips">${chips}</div>` : null}
      ${Object.entries(m.undelivered ?? {}).map(
        ([target, error]) => html`<div class="undelivered">✗ didn't reach ${target}: ${error}</div>`,
      )}
      ${forms}
      ${actions}
    </div>
  </div>`
}

/** Threads in log order, each root followed by its replies. Replies whose root isn't loaded say which thread they're in. */
export function threads(messages: MessageView[], viewer: Viewer): Html {
  const replies = new Map<number, MessageView[]>()
  const roots: MessageView[] = []
  for (const m of messages) {
    if (m.re === null) roots.push(m)
    else replies.set(m.re, [...(replies.get(m.re) ?? []), m])
  }
  const rootIds = new Set(roots.map((root) => root.id))
  const blocks = roots.map((root) => ({
    at: root.id,
    html: html`<div class="thread">${message(root, viewer, false)}${(replies.get(root.id) ?? []).map((r) => message(r, viewer, true))}</div>`,
  }))
  for (const [re, list] of replies)
    if (!rootIds.has(re))
      blocks.push({
        at: list[0]!.id,
        html: html`<div class="thread"><div class="context"><a href="/t/${re}">↳ in thread #${re}</a></div>${list.map((r) => message(r, viewer, true))}</div>`,
      })
  if (blocks.length === 0) return html`<p class="empty">nothing here yet</p>`
  return html`${blocks.sort((a, b) => a.at - b.at).map((block) => block.html)}`
}

const SEND_ROW = html`<div class="row">
  <label><input type="checkbox" name="noSync"> board only</label>
  <span class="hint">enter to send · shift+enter for a new line</span>
  <button class="send">send</button>
</div>`

/** A new thread in `channel`, or in a channel you type when it's unset. */
export function newThread(channel?: string): Html {
  return html`<form class="composer" data-do="post"${channel ? html` data-args="${args({ channel })}"` : null}>
    ${channel ? null : html`<input type="text" name="channel" placeholder="channel, e.g. www/errors" list="channels" required>`}
    <textarea name="text" placeholder="${channel ? `message #${channel}` : 'start a thread'}" data-enter required></textarea>
    ${SEND_ROW}
  </form>`
}

export function replyTo(id: number): Html {
  return html`<form class="composer" data-do="reply" data-args="${args({ id })}">
    <textarea name="text" placeholder="reply in thread #${id}" data-enter required></textarea>
    ${SEND_ROW}
  </form>`
}

/** Raw platform events: "did Slack even send it?" */
export function inbox(entries: InboxEntry[]): Html {
  if (entries.length === 0) return html`<p class="empty">no events yet</p>`
  return html`${entries.map((entry) => {
    const event = entry.event as { kind: string; text?: string; type?: string; emoji?: string; author?: { handle?: string } }
    return html`<div class="inbox-row">
      <span class="time" title="${entry.createdAt}">${ago(entry.createdAt)}</span>
      <span><span class="badge">${event.kind}</span></span>
      <div>
        <div><span class="author">${event.author?.handle ?? '—'}</span> ${event.text ?? event.type ?? event.emoji ?? ''}</div>
        <pre>${entry.channel} · ${entry.event.thread}</pre>
      </div>
    </div>`
  })}`
}

export const failure = (message: string): Html => html`<p class="error">error: ${message}</p>`

function sidebar(layout: Layout): Html {
  const groups = new Map<string, ChannelView[]>()
  for (const channel of layout.channels) {
    const at = channel.path.lastIndexOf('/')
    const group = at === -1 ? 'channels' : channel.path.slice(0, at)
    groups.set(group, [...(groups.get(group) ?? []), channel])
  }
  const link = (href: string, body: Html | string) =>
    html`<a href="${href}"${layout.path === href ? html` aria-current="page"` : null}>${body}</a>`
  return html`<nav class="sidebar">
    <div class="brand">just-board</div>
    <div class="whoami" title="${layout.me.actor}">${layout.board}<br>as ${who(layout.me)}</div>
    ${link('/', 'activity')}
    ${[...groups].map(
      ([group, channels]) => html`<h2>${group}</h2>${channels.map((channel) =>
        link(
          `/c/${channel.path}`,
          html`<span>#${channel.path.slice(channel.path.lastIndexOf('/') + 1)}</span><span class="count">${channel.threads}</span>`,
        ),
      )}`,
    )}
    ${layout.sync.length > 0
      ? html`<h2>inbox</h2>${layout.sync.map((entry) =>
          link(`/inbox/${entry.key}`, html`<span>${entry.key}</span><span class="count">${entry.platform}</span>`),
        )}`
      : null}
    <datalist id="channels">${layout.channels.map((channel) => html`<option value="${channel.path}">`)}</datalist>
  </nav>`
}

export function page(layout: Layout, view: View): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="inspect-token" content="${layout.token}">
<title>${view.title} · just-board</title>
<style>${raw(CSS)}</style>
</head>
<body>
<div class="shell">
  ${sidebar(layout)}
  <main class="main">
    <header class="header">
      ${view.title}
      ${view.meta ? html`<span class="meta">${view.meta}</span>` : null}
      ${view.live === 'off' ? null : html`<span class="live" id="live"><i></i>connecting</span>`}
    </header>
    <div class="feed" id="feed" data-live="${view.live ?? ''}">${view.feed}</div>
    ${view.composer ?? null}
  </main>
</div>
<div class="flash" id="flash" role="alert" hidden></div>
<script nonce="${layout.nonce}">${raw(SCRIPT)}</script>
</body>
</html>`.value
}
