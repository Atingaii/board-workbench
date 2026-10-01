/** Just Chat's tokens: mono, quiet, one accent. Buttons keep the default cursor; scrolling is never smooth. */
export const CSS = `
:root {
  --bg: #fafafa;
  --bright: #040404;
  --dim: #303030;
  --muted: #646464;
  --faint: #909090;
  --hairline: #d9d9d9;
  --shade: #f0f0f0;
  --shade-hover: #e3e3e3;
  --accent: rgb(255, 108, 2);
  --accent-transparent: rgba(255, 108, 2, 0.2);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #040404;
    --bright: #fafafa;
    --dim: #dedede;
    --muted: #909090;
    --faint: #646464;
    --hairline: #252525;
    --shade: #161616;
    --shade-hover: #1b1b1b;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: auto; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--dim);
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: -0.02em;
  line-height: 1.5;
}
a { color: inherit; text-decoration: none; cursor: pointer; }
button { cursor: default; font: inherit; color: inherit; background: none; border: 0; padding: 0; }
input, textarea { font: inherit; color: var(--bright); letter-spacing: inherit; }
::selection { background: var(--accent-transparent); }
:focus-visible { outline: 2px dashed var(--accent); outline-offset: 2px; }

.boot { display: grid; place-items: center; height: 100dvh; color: var(--faint); }
.boot.error { color: var(--accent); }
.empty, .error { padding: 20px; margin: 0; color: var(--faint); }
.error { color: var(--accent); }

.shell { display: flex; height: 100dvh; }

.sidebar {
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--hairline);
  overflow-y: auto;
  padding: 12px 8px;
}
.sidebar h2 { margin: 16px 8px 4px; font-size: 11px; font-weight: 500; color: var(--faint); text-transform: lowercase; }
.sidebar .item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  border-radius: 4px;
  color: var(--muted);
}
.sidebar .item:hover, .sidebar .item[aria-current='page'] { background: var(--shade); color: var(--bright); }
.sidebar .item.unread { color: var(--bright); font-weight: 600; }
.sidebar .count { color: var(--faint); font-size: 11px; font-weight: 400; }
.sidebar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.brand { padding: 4px 8px 8px; color: var(--bright); font-weight: 600; }
.whoami { margin-top: auto; padding: 16px 8px 0; color: var(--muted); font-size: 11px; }
.whoami .url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane .composer .hint { display: none; }
.faint { color: var(--faint); }

.main, .pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.main { flex: 1; }
.pane { width: min(460px, 42vw); flex-shrink: 0; border-left: 1px solid var(--hairline); }
@media (max-width: 900px) {
  .sidebar { display: none; }
  .pane { position: fixed; inset: 0; width: auto; background: var(--bg); z-index: 5; }
}

.header {
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid var(--hairline);
  white-space: nowrap;
}
.header .title { color: var(--bright); font-weight: 600; }
.header .meta { color: var(--faint); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.header .spacer { flex: 1; }
.header .close { color: var(--faint); padding: 2px 6px; border-radius: 4px; }
.header .close:hover { background: var(--shade); color: var(--bright); }

.live { display: flex; align-items: center; gap: 6px; color: var(--faint); font-size: 11px; }
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
.live.live i { background: var(--accent); }

.feed-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.feed { flex: 1; overflow-y: auto; padding: 8px 0 16px; display: flex; flex-direction: column; }
/* A short conversation sits on the composer, like any chat. */
.feed > div { margin-top: auto; }
.jump {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 10px;
  border: 1px solid var(--accent);
  border-radius: 12px;
  background: var(--bg);
  color: var(--accent);
  font-size: 11px;
}

.thread { padding: 4px 12px; border-bottom: 1px solid var(--hairline); }
.thread.open { border-bottom: 0; }
.divider { margin: 6px 8px; color: var(--faint); font-size: 11px; display: flex; align-items: center; gap: 8px; }
.divider::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }

.message {
  position: relative;
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 4px;
}
.message.reply { margin-left: 36px; }
.message:hover, .message.active { background: var(--shade); }
.message.pending { opacity: 0.55; }
.message.failed { opacity: 1; }
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: var(--shade-hover);
  color: var(--muted);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.body { min-width: 0; }
.meta-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.author { color: var(--bright); font-weight: 600; }
.where { color: var(--accent); font-size: 11px; }
.where:hover { text-decoration: underline; }
.time, .id { color: var(--faint); font-size: 11px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dim); }
.text a { color: var(--bright); text-decoration: underline; text-decoration-color: var(--hairline); }
.text a:hover { text-decoration-color: var(--accent); }
.mention { color: var(--accent); }
.removed { color: var(--faint); font-style: italic; }
.undelivered { margin-top: 4px; font-size: 11px; color: var(--accent); }
.undelivered button { text-decoration: underline; }

.badge, .label, .chip {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid var(--hairline);
  background: var(--bg);
  color: var(--muted);
  line-height: 18px;
}
.badge.slack, .badge.github { border-color: var(--accent-transparent); color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip:hover, .label:hover { background: var(--shade-hover); }
.label:hover { text-decoration: line-through; }
.chip.mine { border-color: var(--accent); color: var(--bright); }
.replies { margin-top: 4px; color: var(--accent); font-size: 11px; font-weight: 600; }
.replies:hover { text-decoration: underline; }
.replies .time { font-weight: 400; }

.actions {
  position: absolute;
  top: -12px;
  right: 8px;
  display: none;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--bg);
  z-index: 2;
}
.message:hover .actions, .message.active .actions, .actions:focus-within { display: flex; }
.actions > button { padding: 0 6px; border-radius: 4px; color: var(--muted); font-size: 11px; line-height: 22px; }
.actions > button:hover { background: var(--shade); color: var(--bright); }
.picker {
  position: fixed;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--bg);
  z-index: 20;
}
.picker button { font-size: 16px; line-height: 30px; border-radius: 4px; }
.picker button:hover { background: var(--shade); }

.inline { display: grid; gap: 2px; margin: 4px 0; }
.inline textarea, .composer textarea, .composer .channel {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--bg);
  resize: none;
  outline: none;
}
.inline textarea:focus, .composer textarea:focus, .composer .channel:focus { border-color: var(--muted); }
.hint { color: var(--faint); font-size: 11px; }

.composer { flex-shrink: 0; display: grid; gap: 6px; padding: 10px 16px 12px; border-top: 1px solid var(--hairline); }
.composer textarea { min-height: 36px; }
.composer .row { display: flex; align-items: center; gap: 12px; color: var(--faint); font-size: 11px; }
.composer .row label { display: flex; align-items: center; gap: 4px; }
.composer .row .hint { margin-left: auto; }
.send { padding: 2px 10px; border: 1px solid var(--hairline); border-radius: 4px; background: var(--shade); color: var(--bright); font-size: 12px; }
.send:hover { background: var(--shade-hover); }
.send:disabled { opacity: 0.4; }

.inbox-row { display: grid; grid-template-columns: 70px 90px 1fr; gap: 12px; padding: 6px 20px; border-bottom: 1px solid var(--hairline); }
.inbox-row pre { margin: 4px 0 0; color: var(--faint); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }

.toasts { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 10; }
.toast { max-width: 420px; padding: 8px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--bg); color: var(--accent); }
`
