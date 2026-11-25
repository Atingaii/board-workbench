// Modified for Board Workbench. Upstream license and attribution are in LICENSE and README.md.
/**
 * Board Workbench neutral visual system: cool-gray continuous workspace, white
 * inset panels with thin hairlines, rounded gray-blue selected rows, restrained
 * slate-blue accent, system sans body with selective monospace for IDs, code,
 * and timestamps. Default cursor everywhere except text; no smooth scrolling.
 */
export const CSS = `
:root {
  --bg: #f3f4f6;
  --surface: #ffffff;
  --surface-2: #f7f8fa;
  --bright: #14171f;
  --dim: #2e3440;
  --muted: #5a6270;
  --faint: #848c9a;
  --hairline: #e2e5ea;
  --hairline-strong: #cfd4dd;
  --shade: #eceef2;
  --shade-hover: #e3e7ee;

  --side-bg: #f3f4f6;
  --side-surface: #ffffff;
  --side-hover: #e8ebf0;
  --side-active: #e2eaf6;
  --side-active-border: rgba(49, 92, 152, 0.22);
  --side-hairline: #e2e5ea;
  --side-bright: #14171f;
  --side-text: #464e5c;
  --side-faint: #7c8494;

  --accent: #315c98;
  --accent-hover: #26497b;
  --accent-soft: rgba(49, 92, 152, 0.1);
  --accent-transparent: rgba(49, 92, 152, 0.22);
  --label: #ffffff;

  --green: #22734d;
  --green-soft: rgba(34, 115, 77, 0.11);
  --amber: #a36214;
  --amber-soft: rgba(163, 98, 20, 0.12);
  --red: #c23934;
  --red-soft: rgba(194, 57, 52, 0.1);
  --blue: #315c98;
  --blue-soft: rgba(49, 92, 152, 0.1);

  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.05);
  --shadow-lg: 0 20px 52px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(15, 23, 42, 0.07);
  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 11px;

  --sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121418;
    --surface: #181b21;
    --surface-2: #1e222a;
    --bright: #f1f3f7;
    --dim: #d2d6df;
    --muted: #939aa8;
    --faint: #6c7382;
    --hairline: #272c36;
    --hairline-strong: #373e4c;
    --shade: #21252e;
    --shade-hover: #292e3a;

    --side-bg: #121418;
    --side-surface: #181b21;
    --side-hover: #1f232c;
    --side-active: #212c3d;
    --side-active-border: rgba(159, 189, 237, 0.24);
    --side-hairline: #272c36;
    --side-bright: #f1f3f7;
    --side-text: #a2a9b8;
    --side-faint: #6f7787;

    --accent: #9fbded;
    --accent-hover: #b6cef3;
    --accent-soft: rgba(159, 189, 237, 0.14);
    --accent-transparent: rgba(159, 189, 237, 0.24);
    --label: #101622;

    --green: #4fb886;
    --green-soft: rgba(79, 184, 134, 0.14);
    --amber: #e2a44e;
    --amber-soft: rgba(226, 164, 78, 0.15);
    --red: #f0716b;
    --red-soft: rgba(240, 113, 107, 0.15);
    --blue: #9fbded;
    --blue-soft: rgba(159, 189, 237, 0.14);

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.24);
    --shadow-md: 0 10px 28px rgba(0, 0, 0, 0.42), 0 1px 3px rgba(0, 0, 0, 0.28);
    --shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.56), 0 4px 14px rgba(0, 0, 0, 0.36);
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: auto; -webkit-tap-highlight-color: var(--accent-transparent); }
body {
  margin: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--dim);
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  cursor: default;
}
a { color: inherit; text-decoration: none; cursor: default; }
button { cursor: default; font: inherit; color: inherit; background: none; border: 0; padding: 0; letter-spacing: inherit; }
input, textarea { font: inherit; color: var(--bright); letter-spacing: inherit; cursor: text; }
code, pre, kbd, .mono { font-family: var(--mono); }
::selection { background: var(--accent-transparent); }
a:focus-visible, button:focus-visible, [role='separator']:focus-visible, [role='link']:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* --- boot, error, name gate, and empty states --- */
.boot {
  display: grid;
  place-items: center;
  height: 100dvh;
  padding: 24px;
  background: var(--bg);
  color: var(--muted);
}
.boot-card {
  display: grid;
  gap: 10px;
  width: min(380px, 100%);
  padding: 24px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  color: var(--dim);
}
.boot-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--bright);
  font-weight: 650;
  font-size: 14px;
}
.boot-card p { margin: 0; color: var(--muted); font-size: 13px; }
.boot.error, .error { color: var(--red); }
.boot.error .boot-card { border-color: var(--red-soft); }
.name-gate {
  display: grid;
  gap: 12px;
  width: min(380px, 100%);
  padding: 24px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  color: var(--bright);
}
.name-gate label { font-size: 15px; font-weight: 650; color: var(--bright); }
.name-gate p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.name-gate input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  background: var(--bg);
  font-size: 16px;
}
.name-gate input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
.name-gate .send { justify-self: end; }

.empty, .error { padding: 24px 22px; margin: 0; color: var(--muted); }
.empty.error { color: var(--red); }
.empty-state {
  display: grid;
  justify-items: start;
  gap: 6px;
  margin: 18px 22px;
  padding: 20px 22px;
  border: 1px dashed var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--surface);
  max-width: 520px;
}
.empty-icon { color: var(--accent); margin-bottom: 2px; }
.empty-title { margin: 0; color: var(--bright); font-size: 14px; font-weight: 600; }
.empty-hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
.faint { color: var(--faint); }
.grow { flex: 1; min-width: 0; }
.hint { color: var(--faint); font-size: 11px; }

/* --- shell layout: continuous cool-gray workspace with white inset panels --- */
.shell {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 100vw;
  height: 100dvh;
  padding: 8px;
  overflow: hidden;
  background: var(--bg);
}

/* --- neutral light-gray sidebar (graphite in dark mode) --- */
.sidebar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  background: var(--side-bg);
  color: var(--side-text);
}
.sidebar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 4px 12px; }
.sidebar-foot {
  flex-shrink: 0;
  display: grid;
  gap: 4px;
  padding: 8px 4px 2px;
  border-top: 1px solid var(--side-hairline);
}
.brand {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 8px;
  border-bottom: 1px solid var(--side-hairline);
  color: var(--side-bright);
  font-weight: 650;
  gap: 8px;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--accent);
  color: var(--label);
}
.brand .which { display: grid; min-width: 0; flex: 1; line-height: 1.25; }
.brand .name, .brand .at { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brand .name { font-size: 13px; letter-spacing: -0.01em; color: var(--side-bright); }
.brand .at { color: var(--side-faint); font-family: var(--mono); font-size: 10px; font-weight: 400; }
.sidebar .tool { color: var(--side-faint); border-radius: var(--radius-sm); }
.sidebar .tool:hover, .sidebar .tool[data-popup-open] { background: var(--side-hover); color: var(--side-bright); }
.sidebar .tool.on { color: var(--accent); background: var(--side-surface); }

.sidebar-group + .sidebar-group { margin-top: 14px; }
.sidebar h2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 20px;
  margin: 0 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--side-faint);
}
.sidebar h2.subgroup {
  margin-top: 10px;
  margin-bottom: 3px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--side-faint);
}
.sidebar h2 .tool { min-width: 20px; height: 20px; margin-right: -4px; padding: 0; color: var(--side-faint); }
.sidebar .item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 5px 8px;
  border-radius: 6px;
  color: var(--side-text);
  font-size: 13px;
  cursor: default;
}
.sidebar .item + .item { margin-top: 1px; }
.sidebar .item:hover { background: var(--side-hover); color: var(--side-bright); }
.sidebar .item[aria-current='page'] {
  background: var(--side-active);
  color: var(--side-bright);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--side-active-border);
}
.sidebar .item-icon { flex-shrink: 0; color: var(--side-faint); }
.sidebar .item:hover .item-icon { color: var(--side-bright); }
.sidebar .item[aria-current='page'] .item-icon { color: var(--accent); }
.sidebar .item.channel { font-size: 12.5px; }
.sidebar .channel-hash {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--side-faint);
  flex-shrink: 0;
}
.sidebar .item[aria-current='page'] .channel-hash { color: var(--accent); }
.sidebar .item.settings { gap: 8px; color: var(--side-text); font-size: 12.5px; }
.sidebar .item.settings:hover, .sidebar .item.settings[aria-current='page'] { color: var(--side-bright); }
.sidebar .item .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar .item.unread { color: var(--side-bright); font-weight: 600; }
.sidebar .count {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--shade);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 17px;
  font-weight: 500;
}
.sidebar .item[aria-current='page'] .count { background: var(--surface); color: var(--accent); }
.sidebar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

.new-channel { display: flex; align-items: center; gap: 4px; margin: 4px 0 6px; }
.new-channel input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--side-hairline);
  border-radius: var(--radius-sm);
  background: var(--side-surface);
  color: var(--side-bright);
  font-family: var(--mono);
  font-size: 12px;
}
.new-channel input:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
.new-channel input::placeholder { color: var(--side-faint); }

.whoami-wrap { padding-top: 2px; }
.whoami {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  color: var(--side-text);
  font-size: 12px;
  text-align: left;
}
.whoami:hover, .whoami[data-popup-open] { background: var(--side-hover); color: var(--side-bright); }
.whoami .as { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.whoami .avatar { background: var(--side-active); color: var(--side-bright); }
.whoami.naming { flex-direction: column; align-items: stretch; gap: 6px; background: var(--side-surface); padding: 8px; }
.whoami.naming .send { align-self: flex-end; }
.whoami.naming input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--side-hairline);
  border-radius: var(--radius-sm);
  background: var(--side-bg);
  color: var(--side-bright);
  font-size: 12px;
}
.whoami.naming input:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
.choice { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.choice svg { color: var(--accent); }

/* --- resize handles --- */
.resize { position: absolute; top: 8px; bottom: 8px; width: 8px; z-index: 5; cursor: col-resize; display: flex; justify-content: center; outline: none; }
.resize.right { right: -8px; }
.resize.left { left: -8px; }
.resize i { width: 2px; height: 100%; border-radius: 2px; background: transparent; }
.resize:hover i { background: var(--hairline-strong); }
.resize.dragging i, .resize:focus-visible i { background: var(--accent); }

/* --- inset white main and thread panels --- */
.main, .pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.main { flex: 1; overflow: hidden; }
.pane { position: relative; flex-shrink: 0; }
.pane > .header { border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.pane > .composer { border-radius: 0 0 var(--radius-lg) var(--radius-lg); }

.header {
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
  min-width: 0;
}
.header .title { color: var(--bright); font-size: 13.5px; font-weight: 650; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header .title.mono { font-family: var(--mono); font-size: 13px; }
.header .meta {
  color: var(--faint);
  font-family: var(--mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.header .spacer { flex: 1; min-width: 4px; }
.header.flat { border-bottom: 0; }
.header > .tool:first-child { margin-left: -6px; }

/* --- E-Ink Segmented Control inspired tabs --- */
.tabs {
  flex-shrink: 0;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  min-height: 40px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-2);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tabs.plain { border-bottom: 0; background: transparent; padding: 6px 16px 4px; }
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 27px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
}
.tab:hover { color: var(--bright); background: var(--shade); }
.tab[aria-current='page'] {
  background: var(--surface);
  border-color: var(--hairline-strong);
  color: var(--bright);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.tab-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; flex-shrink: 0; }
.tab-actions .act { height: 26px; }
.text-link { color: var(--accent); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; white-space: nowrap; cursor: default; }
.text-link:hover { text-decoration-color: currentColor; }
.tool.only-narrow, .scrim { display: none; }

.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--shade);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
.live.live { background: var(--green-soft); color: var(--green); }
.live.live i { background: var(--green); }
.live.reconnecting { background: var(--amber-soft); color: var(--amber); }
.live.reconnecting i { background: var(--amber); }

/* --- feed and messages --- */
.feed-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.feed { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 0 14px; display: flex; flex-direction: column; overflow-anchor: none; }
.feed > div { margin-top: auto; min-width: 0; }
.pane .feed > div { margin-top: 0; }
.jump {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  background: var(--surface);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--shadow-md);
}
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 20px 6px;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 11px;
}
.divider::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }

.message {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 18px 8px 14px;
  border-top: 1px solid transparent;
}
.message + .message:not(.continued) { border-top-color: var(--hairline); }
.message.continued { padding-top: 2px; padding-bottom: 3px; }
.message.active { background: var(--surface-2); }
.message.pending { opacity: 0.58; }
.message.failed { opacity: 1; }
.gutter { display: flex; justify-content: center; align-items: flex-start; padding-top: 2px; }
.gutter-time { visibility: hidden; color: var(--faint); font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 10px; line-height: 20px; }
.message.active .gutter-time, .gutter-time.shown { visibility: visible; }
.avatar {
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  background: var(--shade);
  color: var(--bright);
  font-weight: 650;
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.body { min-width: 0; }
.meta-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-bottom: 2px; }
.author { color: var(--bright); font-weight: 650; font-size: 13px; }
.where { color: var(--faint); font-size: 12px; }
.where a { color: var(--accent); font-family: var(--mono); font-size: 11.5px; cursor: default; }
.where a:hover { text-decoration: underline; }
.time, .id { color: var(--faint); font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 11px; }
.meta-line .time { margin-left: auto; }

/* --- Cubby UI Timeline-inspired thread pane structure --- */
.thread-body { display: flex; flex-direction: column; min-width: 0; }
.thread-root { padding-top: 4px; }
.thread-timeline { position: relative; min-width: 0; }
.thread-timeline.has-items::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 14px;
  left: 32px;
  width: 1px;
  background: var(--hairline);
  pointer-events: none;
}
.thread-timeline .message { padding-left: 14px; }
.thread-timeline .avatar-wrap { position: relative; z-index: 1; }
.thread-timeline .avatar { box-shadow: 0 0 0 3px var(--surface); }
.thread-timeline .message.active .avatar { box-shadow: 0 0 0 3px var(--shade); }

/* --- message markdown --- */
.text { overflow-wrap: anywhere; color: var(--dim); font-size: 13.5px; line-height: 1.6; cursor: text; }
.text > :first-child { margin-top: 0; }
.text > :last-child { margin-bottom: 0; }
.text > p:last-child, .text > p:has(+ .edited) { display: inline; }
.text p { margin: 0 0 6px; }
.text a { color: var(--accent); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; overflow-wrap: anywhere; }
.text a:hover { text-decoration-color: currentColor; }
.text strong { color: var(--bright); font-weight: 650; }
.text h1, .text h2, .text h3, .text h4 { margin: 10px 0 4px; color: var(--bright); font-size: 14px; font-weight: 650; }
.text ul, .text ol { margin: 3px 0 6px; padding-left: 20px; }
.text li + li { margin-top: 2px; }
.text blockquote { margin: 5px 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--accent-transparent); color: var(--muted); }
.text code { padding: 1px 5px; border-radius: 4px; background: var(--shade); color: var(--bright); font-family: var(--mono); font-size: 0.88em; }
.message.active .text code { background: var(--shade-hover); }
.text pre { margin: 6px 0 8px; padding: 10px 12px; overflow-x: auto; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface-2); line-height: 1.5; }
.text pre code, .message.active .text pre code { padding: 0; border-radius: 0; background: none; font-size: 12.5px; }
.text table { margin: 6px 0 8px; border-collapse: collapse; font-size: 12px; display: block; overflow-x: auto; max-width: 100%; }
.text th, .text td { padding: 4px 10px; border: 1px solid var(--hairline); text-align: left; white-space: nowrap; }
.text th { color: var(--bright); font-weight: 600; background: var(--surface-2); }
.text img { max-width: 100%; max-height: 260px; border-radius: var(--radius-sm); vertical-align: middle; }
.text hr { border: 0; height: 1px; margin: 10px 0; background: var(--hairline); }
.text input[type='checkbox'] { margin: 0 6px 0 0; vertical-align: middle; }
.text ul.contains-task-list { list-style: none; padding-left: 2px; }
.avatar-wrap { position: relative; display: inline-flex; }
.source {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 15px;
  height: 15px;
  padding: 2px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  color: var(--bright);
}
.source svg { display: block; width: 100%; height: 100%; }
.source.text { display: grid; place-items: center; font-family: var(--mono); font-size: 9px; font-weight: 600; }
.mention { padding: 0 3px; border-radius: 3px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.removed { color: var(--faint); font-style: italic; }
.edited { color: var(--faint); font-size: 11px; margin-left: 4px; }
.undelivered { margin-top: 5px; font-size: 11.5px; color: var(--red); }
.undelivered button { text-decoration: underline; }

/* --- badges, labels, reactions, attachments --- */
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.badge, .label, .chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 11px;
  line-height: 17px;
}
.label { font-family: var(--mono); font-size: 10.5px; }
.badge.slack, .badge.github { border-color: var(--accent-transparent); background: var(--accent-soft); color: var(--accent); }
.label:hover, .chip:hover { color: var(--bright); border-color: var(--hairline-strong); background: var(--shade); }
.label button { color: var(--faint); display: inline-flex; }
.label button:hover { color: var(--bright); }
.chip.mine { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }

.links { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.link-embed { padding: 4px 0 4px 12px; border-left: 2px solid var(--hairline-strong); }
.link-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 12px; color: var(--muted); }
.link-meta .author { font-size: 12.5px; }
.link-meta a, .link-file a { color: var(--accent); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; overflow-wrap: anywhere; }
.link-meta a:hover, .link-file a:hover { text-decoration-color: currentColor; }
.link-file { display: flex; gap: 5px; align-items: center; margin-top: 3px; font-size: 12px; color: var(--muted); }
.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.attachment-media { display: block; width: 320px; max-width: 100%; height: 200px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface-2); overflow: hidden; }
.attachment-media img, .attachment-media video { display: block; width: 100%; height: 100%; object-fit: contain; }
.file { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 9px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface); color: var(--dim); font-size: 12px; }
button.file:hover { background: var(--shade); border-color: var(--hairline-strong); color: var(--bright); }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file button { color: var(--faint); display: inline-flex; }
.file button:hover { color: var(--bright); }
.composer-files { margin: 0 12px 6px; }
.replies {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 5px 0 0 -6px;
  padding: 3px 8px 3px 6px;
  border-radius: var(--radius-sm);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
.replies:hover { background: var(--accent-soft); }
.replies .time { font-weight: 400; color: var(--muted); }
.replies .faces { display: inline-flex; }
.replies .faces .avatar + .avatar { margin-left: -4px; }

.editor { display: grid; gap: 4px; margin: 3px 0; }
.editor textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  resize: none;
  outline: none;
  font-size: 14px;
}
.editor textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

/* --- hover actions --- */
.actions {
  position: absolute;
  top: -12px;
  right: 18px;
  z-index: 5;
  display: flex;
  padding: 2px;
  gap: 1px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 28px;
  height: 26px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 12.5px;
}
.tool:hover, .tool[data-popup-open] { background: var(--shade); color: var(--bright); }
.tool.on { color: var(--accent); background: var(--accent-soft); }
.tool .count, .tool .tool-label { font-size: 11px; font-weight: 500; }

/* --- menus and popovers --- */
.positioner { z-index: 50; outline: none; }
.frame { position: relative; isolation: isolate; }
.dots { display: none; }
.menu {
  min-width: 184px;
  padding: 5px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  outline: none;
}
.menu.list { max-height: 260px; overflow-y: auto; }
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  color: var(--dim);
  outline: none;
  cursor: default;
  white-space: nowrap;
}
.item[data-highlighted] { background: var(--shade); color: var(--bright); }
.item.danger, .item.danger[data-highlighted] { color: var(--red); }
.item.danger[data-highlighted] { background: var(--red-soft); }
.item .hint { margin-left: 12px; min-width: 0; max-width: 22ch; overflow: hidden; text-overflow: ellipsis; font-family: var(--mono); }
.separator { height: 1px; margin: 4px 0; background: var(--hairline); }
.empty-item { padding: 8px; color: var(--faint); font-size: 12px; }
.emoji-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; }
.item.emoji { justify-content: center; padding: 6px 0; font-size: 15px; }
.emoji-grid { display: grid; grid-template-columns: repeat(10, 30px); gap: 2px; padding: 6px; max-width: calc(100vw - 24px); overflow-x: auto; }
.emoji-grid .emoji { height: 30px; border-radius: var(--radius-sm); font-size: 16px; }
.emoji-grid .emoji:hover { background: var(--shade); }
.popover { width: min(390px, calc(100vw - 24px)); padding: 14px; }
.popover-title { margin: 0 0 10px; color: var(--bright); font-size: 13px; font-weight: 650; }

.labels-editor { display: grid; gap: 10px; }
.labels-editor > .hint { margin: 0; }
.label-rows { display: grid; gap: 2px; }
.label-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto; align-items: center; gap: 8px; padding: 3px 4px 3px 8px; border-radius: var(--radius-sm); }
.label-row:hover { background: var(--shade); }
.label-key { color: var(--bright); font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.label-value { color: var(--muted); font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.label-add { display: flex; align-items: center; gap: 6px; min-width: 0; }
.suggest {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 9px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
.suggest input { width: 100%; min-width: 0; height: 28px; border: 0; outline: none; background: none; }
.suggest:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.suggest .prefix { color: var(--faint); font-family: var(--mono); font-size: 11px; margin-right: 4px; }
.suggest input::placeholder { color: var(--faint); }
.label-add > .suggest { width: 38%; }

/* --- filters --- */
.filter-bar { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 20px 2px; }
.clear { color: var(--muted); font-size: 11.5px; }
.clear:hover { color: var(--accent); text-decoration: underline; }
.filter-form { display: grid; gap: 12px; }
.filter-form > .clear { justify-self: start; }
.filter-row { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: start; gap: 10px; }
.filter-name { color: var(--muted); font-size: 11.5px; line-height: 28px; font-weight: 500; }
.filter-row .grow { display: grid; gap: 6px; }
.segments { display: flex; flex-wrap: wrap; gap: 4px; }
.segment {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--muted);
  font-size: 12px;
}
.segment:hover { color: var(--bright); border-color: var(--hairline-strong); }
.segment.on { border-color: var(--accent); background: var(--accent); color: var(--label); font-weight: 550; }

/* --- composer --- */
.composer { flex-shrink: 0; padding: 8px 20px 16px; }
.composer-box {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: text;
}
.composer-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.composer-box textarea {
  width: 100%;
  min-height: 54px;
  max-height: 160px;
  padding: 11px 14px 4px;
  border: 0;
  outline: none;
  background: none;
  color: var(--bright);
  font-size: 14px;
  line-height: 1.55;
  resize: none;
  overflow-y: auto;
}
.composer-box textarea::placeholder { color: var(--faint); }
.composer-channel { margin: 10px 10px 0; align-self: flex-start; width: min(320px, calc(100% - 20px)); }
.composer-labels { margin: 8px 12px 0; }
.composer-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px;
  min-height: 40px;
  padding: 4px 10px 8px;
  border-top: 1px solid var(--hairline);
  margin-top: 4px;
}
.composer-footer .hint { margin-left: auto; margin-right: 8px; }
.pane .composer { padding: 8px 14px 14px; }
.pane .composer-footer .hint { display: none; }
.pane .composer-footer .send { margin-left: auto; }
.send {
  height: 30px;
  padding: 0 13px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--label);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}
.send:hover:not(:disabled) { background: var(--accent-hover); }
.send.small { height: 28px; padding: 0 11px; font-size: 12px; }
.send:disabled { opacity: 0.45; }

/* --- non-feed pages and facts --- */
.page { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 0 20px; }
.more { display: block; margin: 10px 20px; }
.facts { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.facts dt { color: var(--faint); font-size: 11.5px; line-height: 19px; }
.facts dd { margin: 0; color: var(--dim); overflow-wrap: anywhere; }
.segment.small { height: 22px; padding: 0 8px; font-size: 11px; }

/* --- action buttons and ask forms --- */
.acts { display: flex; flex-wrap: wrap; gap: 6px; }
.acts .act[aria-haspopup] { padding: 0 8px; }
.act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--dim);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.act:hover, .act[data-popup-open] { background: var(--shade); border-color: var(--hairline-strong); color: var(--bright); }
.act.primary { border-color: var(--accent); background: var(--accent); color: var(--label); font-weight: 600; }
.act.primary:hover { border-color: var(--accent-hover); background: var(--accent-hover); color: var(--label); }
.act.danger { color: var(--red); border-color: var(--red-soft); }
.act.quiet { visibility: hidden; border-color: transparent; background: none; color: var(--muted); }
:hover > .act.quiet, :focus-within > .act.quiet { visibility: visible; }
.act.quiet:hover, .act.quiet:focus-visible { background: var(--red-soft); color: var(--red); }
.act:disabled { opacity: 0.45; }

.ask { display: grid; gap: 9px; }
.ask textarea {
  width: 100%;
  min-height: 68px;
  padding: 7px 9px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}
.ask textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.ask .hint { margin: 0; }
.ask .suggest .prefix { margin-right: 6px; font-size: 11px; white-space: nowrap; }
.ask .send { justify-self: end; }

/* --- tasks: semantic state badges, queue table, and task card --- */
.task-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--shade);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
  width: fit-content;
}
.task-state svg { flex-shrink: 0; }
.task-state.ready { background: var(--accent-soft); color: var(--accent); }
.task-state.claimed { background: var(--blue-soft); color: var(--blue); }
.task-state.blocked { background: var(--amber-soft); color: var(--amber); }
.task-state.completed { background: var(--green-soft); color: var(--green); }
.task-state.failed { background: var(--red-soft); color: var(--red); }
.task-state.waiting, .task-state.canceled { background: var(--shade); color: var(--muted); }

.task-line, .task-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.task-line { margin-top: 6px; color: var(--muted); font-size: 12px; }
.task-note { color: var(--dim); overflow-wrap: anywhere; }
.lease { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--blue); }
.needs { display: inline-flex; flex-wrap: wrap; gap: 2px 8px; }
.need { color: var(--accent); font-family: var(--mono); font-size: 11.5px; cursor: default; }
.need:hover { text-decoration: underline; }
.need-state { margin-left: 4px; font-family: var(--sans); color: var(--faint); }
.need-state.completed { color: var(--green); }
.need-state.failed { color: var(--red); }

.task-card {
  flex-shrink: 0;
  display: grid;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
  background: var(--bg);
  font-size: 12px;
}
.task-head { color: var(--dim); }
.task-head .task-state { font-size: 12px; font-weight: 600; }
.task-card .hint { margin: 0; }

.task-rows { display: grid; padding: 0 12px; gap: 2px; }
.task-row {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  outline: none;
}
.task-row:hover { background: var(--surface-2); }
.task-row[aria-current] {
  background: var(--side-active);
  box-shadow: inset 0 0 0 1px var(--side-active-border);
}
.task-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.task-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--bright);
  font-weight: 500;
}
.task-subject { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-id { flex-shrink: 0; font-family: var(--mono); font-size: 11px; color: var(--faint); font-weight: 400; }
.task-title .label { flex-shrink: 0; }
.task-now { max-width: 24ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.task-now .needs { display: inline; }
.task-now .need + .need { margin-left: 8px; }
.task-where { color: var(--faint); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; }
.task-row .time { text-align: right; white-space: nowrap; flex-shrink: 0; }

/* When the thread pane shares the viewport, move status detail & channel to a quiet second line so the title stays readable and time never wraps. */
.shell:has(.pane) .task-row {
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 4px 10px;
}
.shell:has(.pane) .task-row .task-state { grid-column: 1; grid-row: 1; }
.shell:has(.pane) .task-row .task-title { grid-column: 2; grid-row: 1; }
.shell:has(.pane) .task-row .time { grid-column: 3; grid-row: 1; }
.shell:has(.pane) .task-row .task-now { grid-column: 2; grid-row: 2; max-width: none; }
.shell:has(.pane) .task-row .task-now:empty { display: none; }
.shell:has(.pane) .task-row .task-where { grid-column: 3; grid-row: 2; justify-self: end; }

.task-places { display: grid; gap: 4px; padding: 0 20px; max-width: 560px; }
.task-place {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--bright);
}
.task-place:hover { border-color: var(--accent); background: var(--surface-2); }
.task-place .name { flex: 1; min-width: 0; font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-place .count { color: var(--faint); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; }

.composer-task { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 10px 0; }
.composer-task .suggest { flex: 1; min-width: 140px; }
.composer-task .prefix { margin-right: 6px; font-size: 11px; white-space: nowrap; }

/* --- structured data blocks --- */
.block {
  max-width: 640px;
  margin: 6px 0;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--surface);
  overflow: hidden;
  font-size: 12px;
}
.block-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 4px 0 10px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-2);
}
.block-head .spacer { flex: 1; }
.block-head .tool { height: 24px; }
.message.active .block-head { background: var(--shade-hover); }
.block-schema { color: var(--bright); font-family: var(--mono); font-size: 11.5px; font-weight: 600; cursor: default; }
.block-schema:hover { color: var(--accent); text-decoration: underline; }
.block-schema .faint { font-weight: 400; }
.block-fields { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 14px; margin: 0; padding: 8px 10px; cursor: text; }
.block-field { display: contents; }
.block-field dt { color: var(--faint); font-family: var(--mono); font-size: 11.5px; }
.block-field dd { margin: 0; color: var(--dim); overflow-wrap: anywhere; }
.block-field a { color: var(--accent); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; }
.block-raw { margin: 0; padding: 8px 10px; color: var(--dim); font-family: var(--mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; }

/* --- schemas --- */
.schema { margin: 0 12px; }
.schema-row {
  display: grid;
  grid-template-columns: minmax(120px, 200px) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
}
.schema-row:hover { background: var(--surface); }
.schema-name { color: var(--bright); font-family: var(--mono); font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.schema-versions { display: flex; gap: 10px; font-family: var(--mono); }
.schema-versions .tab { padding: 0; margin: 0; }
.schema-about { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.small { font-size: 11px; }
.schema-detail {
  display: grid;
  gap: 10px;
  margin: 4px 12px 14px;
  padding: 14px 16px;
  max-width: 860px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.schema-detail .hint { margin: 0; font-size: 12px; }
.schema-detail code { color: var(--bright); font-family: var(--mono); }
.schema-fields { display: grid; grid-template-columns: max-content max-content minmax(0, 1fr); gap: 4px 16px; font-size: 12px; cursor: text; }
.schema-field { display: contents; }
.field-name { color: var(--bright); font-family: var(--mono); }
.schema-json { position: relative; }
.schema-json pre {
  margin: 0;
  padding: 12px 14px;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--dim);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  cursor: text;
}
.schema-json .act { position: absolute; top: 8px; right: 8px; background: var(--surface); }
.ask textarea.code { min-height: 180px; font-family: var(--mono); font-size: 12px; white-space: pre; }
.suggest.version { width: 64px; flex-shrink: 0; }
.error-text { color: var(--red); }

/* --- access & settings sections --- */
.page h3 {
  margin: 18px 20px 6px;
  color: var(--faint);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.page h3 b { color: var(--bright); font-weight: 650; }
.page > h3:first-child, .page > section:first-child h3 { margin-top: 6px; }
.grant-row {
  display: grid;
  grid-template-columns: 36px minmax(120px, 320px) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  margin: 0 12px;
  padding: 5px 10px;
  border-radius: var(--radius-md);
}
.grant-row:hover { background: var(--surface); }
.grant-who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bright); font-weight: 500; }
.grant-who .badge { margin-left: 8px; }
.grant-can { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.grant-can b { color: var(--bright); font-weight: 650; }
.grant-row .act { height: 24px; }
.explain { display: grid; gap: 10px; padding: 4px 20px 8px; }
.explain-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.explain-ask > .suggest { width: 200px; max-width: 100%; }
.who-fields { display: flex; flex-wrap: wrap; gap: 6px; }
.who-fields .suggest { width: 190px; max-width: 100%; }
.ask .who-fields .suggest { flex: 1; width: auto; min-width: 140px; }
.ask textarea.code.can { min-height: 68px; }
.explained {
  display: grid;
  gap: 8px;
  max-width: 900px;
  padding: 12px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--surface);
  cursor: text;
}
.explained p { margin: 0; color: var(--dim); font-size: 13.5px; }
.explained b { color: var(--bright); font-weight: 650; }
.explained .facts { grid-template-columns: 64px minmax(0, 1fr); font-size: 12px; }
.explained .grant-row { margin: 0 -10px; padding: 4px 10px; }
.explained .grant-row:hover { background: var(--shade); }

/* --- schedules, watchers, sync, and thread facts --- */
.sched-row {
  display: grid;
  grid-template-columns: 76px minmax(110px, 190px) minmax(0, 1fr) auto auto 72px;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  margin: 0 12px;
  padding: 5px 10px;
  border-radius: var(--radius-md);
}
.sched-row:hover { background: var(--surface); }
.sched-when { color: var(--bright); font-family: var(--mono); font-size: 12px; white-space: nowrap; }
.sched-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dim); }
.sched-row .act { height: 24px; justify-self: end; }
.watch-row {
  display: grid;
  grid-template-columns: minmax(90px, 180px) minmax(0, 1fr);
  gap: 14px;
  margin: 0 12px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
}
.watch-row:hover { background: var(--surface); }
.watch-id { color: var(--bright); font-family: var(--mono); font-size: 12px; font-weight: 600; }
.watch-row code { color: var(--dim); font-size: 12px; overflow-wrap: anywhere; }
.thread-facts { flex-shrink: 0; padding: 10px 16px; border-bottom: 1px solid var(--hairline); background: var(--surface); font-size: 12px; }
.thread-facts .fact { display: contents; }
.copies { display: flex; flex-wrap: wrap; gap: 2px 12px; }
.label-add.end { justify-content: flex-end; gap: 12px; }
.suggest input:disabled { opacity: 0.4; }

.inbox-row {
  display: grid;
  grid-template-columns: 74px 96px minmax(0, 1fr);
  gap: 12px;
  margin: 0 12px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
}
.inbox-row:hover { background: var(--surface); }
.inbox-row pre { margin: 4px 0 0; color: var(--faint); font-family: var(--mono); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }

/* --- toasts --- */
.toasts { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 60; max-width: calc(100vw - 32px); }
.toast {
  max-width: 420px;
  padding: 9px 14px;
  border: 1px solid var(--hairline-strong);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--bright);
  box-shadow: var(--shadow-md);
  font-size: 12.5px;
}

/* --- responsive breakpoints (tablet + 390px narrow screen, zero horizontal overflow) --- */
@media (max-width: 900px) {
  .shell { padding: 0; gap: 0; }
  .main { border: 0; border-radius: 0; box-shadow: none; }
  .sidebar { display: none; }
  .pane {
    position: fixed;
    inset: 0;
    width: 100% !important;
    max-width: 100vw;
    border: 0;
    border-radius: 0;
    background: var(--surface);
    box-shadow: none;
    z-index: 30;
  }
  .pane > .header, .pane > .composer { border-radius: 0; }
  .resize { display: none; }
  .tool.only-narrow { display: inline-flex; }
  .shell.nav .sidebar {
    display: flex;
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 41;
    width: min(280px, 84vw) !important;
    opacity: 1 !important;
    padding: 4px 6px 8px;
    border-right: 1px solid var(--hairline);
    background: var(--side-bg);
    box-shadow: var(--shadow-lg);
  }
  .shell.nav .scrim { display: block; position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, 0.36); }
}

@media (max-width: 700px) {
  .header { padding: 0 10px 0 12px; gap: 8px; }
  .tabs { padding: 0 12px; gap: 4px 14px; }
  .filter-bar { padding: 8px 12px 2px; }
  .composer { padding: 6px 12px 12px; }
  .composer-footer .hint { display: none; }
  .composer-footer .send { margin-left: auto; }
  .message { padding: 7px 12px 6px 10px; gap: 8px; }
  .thread-timeline.has-items::before { left: 28px; }
  .divider { margin: 12px 12px 5px; }
  .empty, .error { padding: 18px 14px; }
  .empty-state { margin: 14px 12px; padding: 16px; }
  .task-rows { padding: 0 8px; }
  .task-row { grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; padding: 8px 10px; }
  .task-row .task-state { grid-column: 1; grid-row: 1; }
  .task-row .task-title { grid-column: 2; grid-row: 1; }
  .task-row .time { grid-column: 3; grid-row: 1; white-space: nowrap; }
  .task-now { grid-column: 1 / 3; grid-row: 2; max-width: none; }
  .task-now:empty { display: none; }
  .task-where { grid-column: 3; grid-row: 2; justify-self: end; max-width: 14ch; overflow: hidden; text-overflow: ellipsis; }
  .schema { margin: 0 8px; }
  .schema-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 2px; }
  .schema-about { grid-column: 1 / -1; grid-row: 2; }
  .schema-row > .small { display: none; }
  .grant-row { grid-template-columns: 32px minmax(0, 1fr) auto; row-gap: 4px; margin: 0 8px; padding: 7px 10px; }
  .grant-can { grid-column: 2 / -1; grid-row: 2; }
  .grant-row > .small { display: none; }
  .explain { padding: 4px 12px 8px; }
  .sched-row { grid-template-columns: 72px minmax(0, 1fr) auto; row-gap: 2px; margin: 0 8px; padding: 7px 10px; }
  .sched-row > .faint { display: none; }
  .sched-text { grid-column: 1 / -1; grid-row: 2; }
  .watch-row { grid-template-columns: minmax(0, 1fr); gap: 3px; margin: 0 8px; }
  .inbox-row { grid-template-columns: 64px minmax(0, 1fr); gap: 4px 10px; margin: 0 8px; }
  .inbox-row > div { grid-column: 1 / -1; }
  .page h3 { margin: 16px 14px 6px; }
}

/* --- touch device: iOS zooms in on a focused field under 16px --- */
@media (pointer: coarse) {
  input, textarea, select { font-size: 16px !important; }
}
`
