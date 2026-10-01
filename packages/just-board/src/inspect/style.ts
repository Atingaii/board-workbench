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
.text a { color: var(--bright); text-decoration: underline; text-decoration-color: var(--hairline); }
button { cursor: default; font: inherit; color: inherit; }
input, textarea { font: inherit; color: var(--bright); }
::selection { background: var(--accent-transparent); }
:focus-visible { outline: 2px dashed var(--accent); outline-offset: 2px; }

.shell { display: flex; height: 100dvh; }
.sidebar {
  width: 224px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  overflow-y: auto;
  padding: 12px 8px;
}
.sidebar h2 {
  margin: 16px 8px 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--faint);
  text-transform: lowercase;
}
.sidebar a {
  display: flex;
  justify-content: space-between;
  padding: 3px 8px;
  border-radius: 4px;
  color: var(--muted);
}
.sidebar a:hover, .sidebar a[aria-current='page'] { background: var(--shade); color: var(--bright); }
.sidebar .count { color: var(--faint); font-size: 11px; }
.brand { padding: 4px 8px 0; color: var(--bright); font-weight: 600; }
.whoami { padding: 0 8px 8px; color: var(--faint); font-size: 11px; overflow-wrap: anywhere; }

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.header {
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid var(--hairline);
  color: var(--bright);
  font-weight: 600;
  white-space: nowrap;
}
.header .meta { color: var(--faint); font-weight: 400; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.feed { flex: 1; overflow-y: auto; padding: 12px 0 24px; }
.empty { padding: 20px; color: var(--faint); }
.error { padding: 20px; color: var(--accent); }

.thread { padding: 8px 20px; border-bottom: 1px solid var(--hairline); }
.context { margin-left: 40px; color: var(--faint); font-size: 11px; }
.message { position: relative; display: grid; grid-template-columns: 40px 1fr; padding: 4px 0; }
.message.reply { margin-left: 40px; }
.message:hover { background: linear-gradient(90deg, transparent, var(--shade) 8%, var(--shade) 92%, transparent); }
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: var(--shade);
  color: var(--muted);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; }
.body { min-width: 0; }
.meta-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.author { color: var(--bright); font-weight: 600; }
.time, .id { color: var(--faint); font-size: 11px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.removed { color: var(--faint); font-style: italic; }
.undelivered { margin-top: 4px; font-size: 11px; color: var(--accent); }

.badge, .label, .chip {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid var(--hairline);
  background: var(--shade);
  color: var(--muted);
}
.badge.slack, .badge.github { border-color: var(--accent-transparent); color: var(--accent); }
.chip:hover { background: var(--shade-hover); }
.chip.mine { border-color: var(--accent); color: var(--bright); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }

.actions {
  position: absolute;
  top: -10px;
  right: 0;
  display: none;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  background: var(--bg);
}
.message:hover > .body > .actions, .actions:focus-within { display: flex; }
.actions button, .actions a {
  padding: 0 6px;
  border: 0;
  border-radius: 3px;
  background: none;
  color: var(--muted);
  font-size: 11px;
  line-height: 20px;
}
.actions button:hover, .actions a:hover { background: var(--shade); color: var(--bright); }

details.edit { margin-top: 4px; }
details.edit > summary { display: none; }
form.inline { display: flex; gap: 6px; margin-top: 4px; }
form.inline input, form.inline textarea, .composer textarea, .composer input[type='text'] {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  background: var(--bg);
  resize: vertical;
}
.composer { flex-shrink: 0; display: grid; gap: 6px; padding: 12px 20px; border-top: 1px solid var(--hairline); }
.composer textarea { min-height: 44px; }
.composer .row { display: flex; align-items: center; gap: 12px; color: var(--faint); font-size: 11px; }
.composer .row label { display: flex; align-items: center; gap: 4px; }
.composer .row .hint { margin-left: auto; }
.send {
  padding: 2px 10px;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  background: var(--shade);
  color: var(--bright);
}
.send:hover { background: var(--shade-hover); }
.send:disabled { opacity: 0.5; }

.inbox-row {
  display: grid;
  grid-template-columns: 90px 120px 1fr;
  gap: 12px;
  padding: 6px 20px;
  border-bottom: 1px solid var(--hairline);
}
.inbox-row pre {
  margin: 4px 0 0;
  color: var(--faint);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.live { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--faint); font-size: 11px; font-weight: 400; }
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
.live.on i { background: var(--accent); }
.flash {
  position: fixed;
  right: 16px;
  bottom: 16px;
  max-width: 420px;
  padding: 8px 12px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--bg);
  color: var(--accent);
}
.flash[hidden] { display: none; }
`
