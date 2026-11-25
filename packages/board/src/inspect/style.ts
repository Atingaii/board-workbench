// Modified for Board Workbench. Upstream license and attribution are in LICENSE and README.md.
/**
 * Board Workbench focus visual system: quiet cool-gray sidebar, one continuous
 * white work surface with a single thin hairline, aligned two-line task rows,
 * slim bottom-docked composer strip, blue reserved for links and focus rings,
 * green and warm tones for status. Default cursor everywhere except text; no
 * smooth scrolling.
 */
export const CSS = `
:root {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface-2: #f8f9fb;
  --bright: #14171c;
  --dim: #2b303a;
  --muted: #606774;
  --faint: #8a919e;
  --hairline: #e6e8ec;
  --hairline-strong: #d5d9e0;
  --shade: #eef0f3;
  --shade-hover: #e5e8ed;

  --side-bg: #f5f6f8;
  --side-surface: #ffffff;
  --side-hover: #eceef2;
  --side-active: #ffffff;
  --side-active-border: #dcdfe5;
  --side-hairline: #e6e8ec;
  --side-bright: #14171c;
  --side-text: #4b5260;
  --side-faint: #848b98;

  /* Neutral ink for primary actions; blue is reserved strictly for links and focus rings. */
  --ink: #181b20;
  --ink-hover: #2d323c;
  --ink-label: #ffffff;

  --accent: #2b5fa8;
  --accent-hover: #214c89;
  --accent-soft: rgba(43, 95, 168, 0.1);
  --accent-transparent: rgba(43, 95, 168, 0.24);
  --label: #ffffff;

  --green: #1e7a4f;
  --green-soft: rgba(30, 122, 79, 0.11);
  --amber: #b46914;
  --amber-soft: rgba(180, 105, 20, 0.12);
  --red: #c23934;
  --red-soft: rgba(194, 57, 52, 0.1);
  --blue: #2b5fa8;
  --blue-soft: rgba(43, 95, 168, 0.1);

  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04);
  --shadow-lg: 0 20px 52px rgba(15, 23, 42, 0.14), 0 4px 12px rgba(15, 23, 42, 0.06);
  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 10px;

  --sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317;
    --surface: #171a20;
    --surface-2: #1d2128;
    --bright: #f0f2f6;
    --dim: #cfd4de;
    --muted: #8f96a4;
    --faint: #676e7c;
    --hairline: #252a33;
    --hairline-strong: #353c49;
    --shade: #1f242c;
    --shade-hover: #272c36;

    --side-bg: #111317;
    --side-surface: #171a20;
    --side-hover: #1c2028;
    --side-active: #1c2028;
    --side-active-border: #323846;
    --side-hairline: #252a33;
    --side-bright: #f0f2f6;
    --side-text: #a1a8b6;
    --side-faint: #6b7280;

    --ink: #eceef2;
    --ink-hover: #ffffff;
    --ink-label: #111317;

    --accent: #7fb0f5;
    --accent-hover: #9cc2f8;
    --accent-soft: rgba(127, 176, 245, 0.14);
    --accent-transparent: rgba(127, 176, 245, 0.26);
    --label: #111317;

    --green: #4fb886;
    --green-soft: rgba(79, 184, 134, 0.14);
    --amber: #e2a44e;
    --amber-soft: rgba(226, 164, 78, 0.15);
    --red: #f0716b;
    --red-soft: rgba(240, 113, 107, 0.15);
    --blue: #7fb0f5;
    --blue-soft: rgba(127, 176, 245, 0.14);

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
  outline: 2px solid var(--blue);
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
.name-gate input:focus { outline: 2px solid var(--blue); outline-offset: -1px; border-color: var(--blue); }
.name-gate .send { justify-self: end; }

.empty, .error { padding: 24px 20px; margin: 0; color: var(--muted); }
.empty.error { color: var(--red); }
.empty-state {
  display: grid;
  justify-items: start;
  gap: 6px;
  margin: 18px 20px;
  padding: 18px 20px;
  border: 1px dashed var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  max-width: 520px;
}
.empty-icon { color: var(--muted); margin-bottom: 2px; }
.empty-title { margin: 0; color: var(--bright); font-size: 13.5px; font-weight: 600; }
.empty-hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
.faint { color: var(--faint); }
.grow { flex: 1; min-width: 0; }
.hint { color: var(--faint); font-size: 11px; }

/* --- shell layout: quiet cool-gray sidebar + one continuous white work surface --- */
.shell {
  display: flex;
  gap: 0;
  width: 100%;
  max-width: 100vw;
  height: 100dvh;
  padding: 8px 8px 8px 0;
  overflow: hidden;
  background: var(--bg);
}
.shell.collapsed {
  padding-left: 8px;
}

/* --- quiet light-gray sidebar (graphite in dark mode) --- */
.sidebar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  padding: 0 6px;
  background: var(--side-bg);
  color: var(--side-text);
}
.sidebar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 2px 12px; }
.sidebar-foot {
  flex-shrink: 0;
  display: grid;
  gap: 3px;
  padding: 8px 2px 2px;
  border-top: 1px solid var(--side-hairline);
}
.brand {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 0 4px;
  color: var(--side-bright);
  font-weight: 600;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 5px;
  background: var(--ink);
  color: var(--ink-label);
}
.brand .which { display: grid; min-width: 0; flex: 1; line-height: 1.2; }
.brand .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; letter-spacing: -0.015em; color: var(--side-bright); }
.sidebar-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
}
.sidebar-projects-btn { position: relative; }
.sidebar-projects-btn .tool-badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 12px;
  height: 12px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--ink-label);
  font: 8.5px/12px var(--mono);
  text-align: center;
}
.sidebar .tool { color: var(--side-faint); border-radius: var(--radius-sm); min-width: 22px; height: 22px; padding: 0 3px; }
.sidebar .tool:hover, .sidebar .tool[data-popup-open] { background: var(--side-hover); color: var(--side-bright); }
.sidebar .tool.on { color: var(--side-bright); background: var(--side-surface); }

.sidebar-group + .sidebar-group { margin-top: 14px; }
.sidebar h2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 20px;
  margin: 0 8px 4px;
  font-size: 11px;
  font-weight: 550;
  letter-spacing: 0.01em;
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
  border-radius: 7px;
  color: var(--side-text);
  font-size: 12.5px;
  cursor: default;
}
.sidebar .item + .item { margin-top: 1px; }
.sidebar .item:hover { background: var(--side-hover); color: var(--side-bright); }
.sidebar .item[aria-current='page'] {
  background: var(--side-active);
  color: var(--side-bright);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--side-active-border), var(--shadow-sm);
}
.sidebar .item-icon { flex-shrink: 0; color: var(--side-faint); }
.sidebar .item:hover .item-icon,
.sidebar .item[aria-current='page'] .item-icon { color: var(--side-bright); }
.sidebar .item.channel { font-size: 12.5px; }
.sidebar .channel-hash {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--side-faint);
  flex-shrink: 0;
}
.sidebar .item[aria-current='page'] .channel-hash { color: var(--side-bright); }
.sidebar .item.settings { gap: 8px; color: var(--side-text); font-size: 12.5px; }
.sidebar .item.settings:hover, .sidebar .item.settings[aria-current='page'] { color: var(--side-bright); }
.sidebar .item .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar .item.unread { color: var(--side-bright); font-weight: 600; }
.sidebar .count {
  padding: 0 5px;
  border-radius: 999px;
  color: var(--side-faint);
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 17px;
  font-weight: 500;
}
.sidebar .item[aria-current='page'] .count { color: var(--muted); }
.sidebar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--amber); flex-shrink: 0; }

/* Status dots: green/warm/neutral only, no blue */
.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--faint);
}
.status-dot.ready { background: var(--dim); }
.status-dot.claimed { background: var(--amber); }
.status-dot.blocked { background: var(--amber); box-shadow: inset 0 0 0 1.5px var(--surface); }
.status-dot.completed { background: var(--green); }
.status-dot.failed { background: var(--red); }
.status-dot.waiting, .status-dot.canceled, .status-dot.open, .status-dot.all { background: var(--faint); }

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
.new-channel input:focus { outline: 1px solid var(--blue); border-color: var(--blue); }
.new-channel input::placeholder { color: var(--side-faint); }

.whoami-wrap { padding-top: 2px; }
.whoami {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  color: var(--side-text);
  font-size: 12px;
  text-align: left;
}
.whoami:hover, .whoami[data-popup-open] { background: var(--side-hover); color: var(--side-bright); }
.whoami .as { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.whoami .avatar { background: var(--shade); color: var(--bright); }
.whoami.naming { flex-direction: column; align-items: stretch; gap: 6px; background: var(--side-surface); padding: 8px; border: 1px solid var(--side-hairline); }
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
.whoami.naming input:focus { outline: 1px solid var(--blue); border-color: var(--blue); }
.choice { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.choice svg { color: var(--bright); }
.status-menu-option { display: inline-flex; align-items: center; gap: 8px; }

/* --- resize handle --- */
.resize { position: absolute; top: 8px; bottom: 8px; width: 8px; z-index: 5; cursor: col-resize; display: flex; justify-content: center; outline: none; }
.resize.right { right: -4px; }
.resize.left { left: -4px; }
.resize i { width: 2px; height: 100%; border-radius: 2px; background: transparent; }
.resize:hover i { background: var(--hairline-strong); }
.resize.dragging i, .resize:focus-visible i { background: var(--blue); }

/* --- single continuous white work surface --- */
.main {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}
.view-surface {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.view-surface.is-hidden {
  visibility: hidden;
  pointer-events: none;
}
.thread-surface {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}

.header {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
  min-width: 0;
}
.header .title { color: var(--bright); font-size: 13px; font-weight: 600; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header .title.mono { font-family: var(--mono); font-size: 12.5px; }
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
.header > .tool:first-child { margin-left: -4px; }

/* Status menu trigger in Tasks header */
.status-menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--surface);
  color: var(--dim);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.status-menu-trigger:hover, .status-menu-trigger[data-popup-open] {
  background: var(--surface-2);
  border-color: var(--hairline-strong);
  color: var(--bright);
}

/* --- settings tabs --- */
.tabs {
  flex-shrink: 0;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  min-height: 38px;
  padding: 5px 16px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tabs.plain { border-bottom: 0; background: transparent; padding: 6px 16px 4px; }
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
}
.tab:hover { color: var(--bright); background: var(--surface-2); }
.tab[aria-current='page'] {
  background: var(--surface-2);
  border-color: var(--hairline-strong);
  color: var(--bright);
  font-weight: 600;
}
.tab-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; flex-shrink: 0; }
.tab-actions .act { height: 26px; }
.text-link { color: var(--blue); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; white-space: nowrap; cursor: default; }
.text-link:hover { text-decoration-color: currentColor; }
.tool.only-narrow, .scrim { display: none; }

.live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: transparent;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
.live.live { color: var(--green); }
.live.live i { background: var(--green); }
.live.reconnecting { color: var(--amber); }
.live.reconnecting i { background: var(--amber); }

/* --- feed and messages --- */
.feed-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.feed { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 0 14px; display: flex; flex-direction: column; overflow-anchor: none; }
.feed > div { margin-top: auto; min-width: 0; }
.thread-surface .feed > div { margin-top: 0; }
.jump {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  border: 1px solid var(--hairline-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--bright);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--shadow-md);
}
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 18px 6px;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 11px;
}
.divider::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }

.message {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 18px 8px 16px;
}
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
  font-weight: 600;
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.wb-avatar {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  overflow: hidden;
  border-radius: inherit;
  user-select: none;
}
.wb-avatar span {
  position: absolute;
  box-sizing: border-box;
}

/* Person 0: Bob Cut (Sage) */
.wb-p0 { background: #e1ece3; }
.wb-p0 .wb-torso { bottom: -6%; left: 18%; width: 64%; height: 34%; border-radius: 50% 50% 0 0; background: #3e5a48; }
.wb-p0 .wb-hair-back { top: 18%; left: 23%; width: 54%; height: 52%; border-radius: 46% 46% 36% 36%; background: #2b2320; }
.wb-p0 .wb-head { top: 25%; left: 30%; width: 40%; height: 44%; border-radius: 42%; background: #fbdac4; }
.wb-p0 .wb-bangs { top: 19%; left: 27%; width: 46%; height: 20%; border-radius: 45% 45% 20% 20%; background: #2b2320; }
.wb-p0 .wb-eye-l { top: 42%; left: 38%; width: 9%; height: 9%; border-radius: 50%; background: #261f1d; }
.wb-p0 .wb-eye-r { top: 42%; left: 53%; width: 9%; height: 9%; border-radius: 50%; background: #261f1d; }

/* Person 1: Short Crop + Glasses (Dusty Rose) */
.wb-p1 { background: #fbe7e5; }
.wb-p1 .wb-torso { bottom: -6%; left: 16%; width: 68%; height: 35%; border-radius: 50% 50% 0 0; background: #683a45; }
.wb-p1 .wb-head { top: 24%; left: 30%; width: 40%; height: 44%; border-radius: 44%; background: #f5c8ac; }
.wb-p1 .wb-hair-short { top: 15%; left: 28%; width: 46%; height: 22%; border-radius: 50% 50% 25% 10%; background: #382821; }
.wb-p1 .wb-glasses-frame { top: 38%; left: 32%; width: 36%; height: 16%; border: 1.5px solid #231b19; border-radius: 4px; background: rgba(255, 255, 255, 0.2); }
.wb-p1 .wb-eye-l { top: 42%; left: 37%; width: 7%; height: 7%; border-radius: 50%; background: #201815; }
.wb-p1 .wb-eye-r { top: 42%; left: 56%; width: 7%; height: 7%; border-radius: 50%; background: #201815; }

/* Person 2: Topknot Bun (Lavender) */
.wb-p2 { background: #e8e9fb; }
.wb-p2 .wb-torso { bottom: -6%; left: 18%; width: 64%; height: 34%; border-radius: 50% 50% 0 0; background: #4d4f73; }
.wb-p2 .wb-topknot { top: 7%; left: 37%; width: 26%; height: 26%; border-radius: 50%; background: #211c1e; }
.wb-p2 .wb-head { top: 27%; left: 30%; width: 40%; height: 43%; border-radius: 42%; background: #f1c3a2; }
.wb-p2 .wb-hair-sides { top: 21%; left: 27%; width: 46%; height: 22%; border-radius: 50% 50% 30% 30%; background: #211c1e; }
.wb-p2 .wb-eye-l { top: 43%; left: 38%; width: 8%; height: 8%; border-radius: 50%; background: #211c1e; }
.wb-p2 .wb-eye-r { top: 43%; left: 54%; width: 8%; height: 8%; border-radius: 50%; background: #211c1e; }

/* Person 3: Curly Afro Cloud (Warm Sand) */
.wb-p3 { background: #faebd8; }
.wb-p3 .wb-torso { bottom: -6%; left: 16%; width: 68%; height: 35%; border-radius: 50% 50% 0 0; background: #8a4831; }
.wb-p3 .wb-afro { top: 12%; left: 19%; width: 62%; height: 56%; border-radius: 50%; background: #1c1917; }
.wb-p3 .wb-head { top: 27%; left: 29%; width: 42%; height: 43%; border-radius: 45%; background: #a66642; }
.wb-p3 .wb-eye-l { top: 43%; left: 38%; width: 8%; height: 8%; border-radius: 50%; background: #fdf5eb; }
.wb-p3 .wb-eye-r { top: 43%; left: 54%; width: 8%; height: 8%; border-radius: 50%; background: #fdf5eb; }

/* Person 4: Beanie + Beard (Mist Blue) */
.wb-p4 { background: #e1eef8; }
.wb-p4 .wb-torso { bottom: -6%; left: 18%; width: 64%; height: 34%; border-radius: 50% 50% 0 0; background: #345275; }
.wb-p4 .wb-head { top: 24%; left: 30%; width: 40%; height: 44%; border-radius: 42%; background: #f6c8a7; }
.wb-p4 .wb-beard { top: 45%; left: 28%; width: 44%; height: 28%; border-radius: 0 0 50% 50%; background: #35271e; }
.wb-p4 .wb-beanie { top: 14%; left: 27%; width: 46%; height: 26%; border-radius: 48% 48% 15% 15%; background: #c67824; }
.wb-p4 .wb-eye-l { top: 38%; left: 37%; width: 8%; height: 8%; border-radius: 50%; background: #261b14; }
.wb-p4 .wb-eye-r { top: 38%; left: 55%; width: 8%; height: 8%; border-radius: 50%; background: #261b14; }

/* Person 5: Long Straight Hair + Fringe (Heather Mauve) */
.wb-p5 { background: #f0e4ee; }
.wb-p5 .wb-hair-long { top: 18%; left: 20%; width: 60%; height: 60%; border-radius: 40% 40% 15% 15%; background: #352220; }
.wb-p5 .wb-torso { bottom: -6%; left: 21%; width: 58%; height: 34%; border-radius: 50% 50% 0 0; background: #5c3955; }
.wb-p5 .wb-head { top: 25%; left: 30%; width: 40%; height: 43%; border-radius: 42%; background: #fbe0cc; }
.wb-p5 .wb-fringe { top: 19%; left: 28%; width: 44%; height: 18%; border-radius: 45% 45% 20% 20%; background: #352220; }
.wb-p5 .wb-eye-l { top: 42%; left: 38%; width: 8%; height: 8%; border-radius: 50%; background: #241615; }
.wb-p5 .wb-eye-r { top: 42%; left: 54%; width: 8%; height: 8%; border-radius: 50%; background: #241615; }

/* Agent 0: Retro TV Monitor Box Bot (Cool Cyan) */
.wb-a0 { background: #def3f4; }
.wb-a0 .wb-ant-stem { top: 8%; left: 47%; width: 6%; height: 16%; background: #445963; }
.wb-a0 .wb-ant-ball { top: 4%; left: 41%; width: 18%; height: 18%; border-radius: 50%; background: #0ea89b; }
.wb-a0 .wb-bot-base { bottom: 0; left: 32%; width: 36%; height: 16%; border-radius: 15% 15% 0 0; background: #2b3941; }
.wb-a0 .wb-bot-head { top: 22%; left: 22%; width: 56%; height: 50%; border-radius: 20%; background: #3a4c56; }
.wb-a0 .wb-screen { top: 30%; left: 28%; width: 44%; height: 32%; border-radius: 14%; background: #131c21; }
.wb-a0 .wb-eye-l { top: 42%; left: 35%; width: 10%; height: 10%; border-radius: 20%; background: #2ee6ca; }
.wb-a0 .wb-eye-r { top: 42%; left: 55%; width: 10%; height: 10%; border-radius: 20%; background: #2ee6ca; }

/* Agent 1: Capsule Dome Bot (Warm Amber Gold) */
.wb-a1 { background: #fcf1de; }
.wb-a1 .wb-ear-l { top: 37%; left: 14%; width: 13%; height: 22%; border-radius: 50%; background: #9c6c24; }
.wb-a1 .wb-ear-r { top: 37%; right: 14%; width: 13%; height: 22%; border-radius: 50%; background: #9c6c24; }
.wb-a1 .wb-bot-base { bottom: 0; left: 30%; width: 40%; height: 16%; border-radius: 20% 20% 0 0; background: #3b2f20; }
.wb-a1 .wb-dome-head { top: 18%; left: 22%; width: 56%; height: 56%; border-radius: 50% 50% 24% 24%; background: #554432; }
.wb-a1 .wb-visor { top: 37%; left: 27%; width: 46%; height: 20%; border-radius: 999px; background: #1a140d; }
.wb-a1 .wb-glow-l { top: 42%; left: 34%; width: 11%; height: 10%; border-radius: 50%; background: #f8ad32; }
.wb-a1 .wb-glow-r { top: 42%; left: 55%; width: 11%; height: 10%; border-radius: 50%; background: #f8ad32; }

/* Agent 2: Angular Cyber Mech (Steel Slate Blue) */
.wb-a2 { background: #e4e9fa; }
.wb-a2 .wb-fin-l { top: 11%; left: 22%; width: 10%; height: 22%; border-radius: 40% 0 0 0; background: #3e527a; transform: rotate(-15deg); }
.wb-a2 .wb-fin-r { top: 11%; right: 22%; width: 10%; height: 22%; border-radius: 0 40% 0 0; background: #3e527a; transform: rotate(15deg); }
.wb-a2 .wb-bot-base { bottom: 0; left: 27%; width: 46%; height: 18%; border-radius: 12% 12% 0 0; background: #212c42; }
.wb-a2 .wb-hex-head { top: 22%; left: 21%; width: 58%; height: 50%; border-radius: 18%; background: #2f3e60; }
.wb-a2 .wb-visor-strip { top: 38%; left: 25%; width: 50%; height: 16%; border-radius: 6%; background: #0f1624; box-shadow: inset 0 0 0 1px #46a1f8, 0 0 4px #46a1f8; }

/* Agent 3: Industrial Cyclops Scanner (Emerald Sage) */
.wb-a3 { background: #dff4e8; }
.wb-a3 .wb-dish { top: 9%; left: 37%; width: 26%; height: 12%; border-radius: 50% 50% 0 0; background: #2b5e43; }
.wb-a3 .wb-bot-base { bottom: 0; left: 28%; width: 44%; height: 16%; border-radius: 14% 14% 0 0; background: #1d3326; }
.wb-a3 .wb-box-head { top: 20%; left: 22%; width: 56%; height: 52%; border-radius: 26%; background: #2d4c3a; }
.wb-a3 .wb-eye-ring { top: 30%; left: 32%; width: 36%; height: 36%; border-radius: 50%; background: #112117; }
.wb-a3 .wb-eye-core { top: 37%; left: 39%; width: 22%; height: 22%; border-radius: 50%; background: #33e185; }
.wb-a3 .wb-eye-glint { top: 39%; left: 41%; width: 7%; height: 7%; border-radius: 50%; background: #ffffff; }

/* Agent 4: Spherical Floating Droid (Neon Violet) */
.wb-a4 { background: #eee4fc; }
.wb-a4 .wb-halo { top: 9%; left: 28%; width: 44%; height: 9%; border-radius: 999px; border: 1.5px solid #9464f8; }
.wb-a4 .wb-orb-base { bottom: 0; left: 38%; width: 24%; height: 14%; border-radius: 50% 50% 0 0; background: #2c1d3f; }
.wb-a4 .wb-orb-head { top: 20%; left: 23%; width: 54%; height: 54%; border-radius: 50%; background: #44325e; }
.wb-a4 .wb-orb-visor { top: 34%; left: 28%; width: 44%; height: 26%; border-radius: 35% 35% 45% 45%; background: #160d21; }
.wb-a4 .wb-eye-pill-l { top: 42%; left: 34%; width: 11%; height: 8%; border-radius: 999px; background: #d76ef5; }
.wb-a4 .wb-eye-pill-r { top: 42%; left: 55%; width: 11%; height: 8%; border-radius: 999px; background: #d76ef5; }

/* Agent 5: Vintage Bolt Robot (Copper Coral) */
.wb-a5 { background: #fee8e1; }
.wb-a5 .wb-coil { top: 6%; left: 46%; width: 8%; height: 17%; border-radius: 3px; background: #684136; }
.wb-a5 .wb-bolt-l { top: 38%; left: 13%; width: 10%; height: 18%; border-radius: 20%; background: #7c4c3e; }
.wb-a5 .wb-bolt-r { top: 38%; right: 13%; width: 10%; height: 18%; border-radius: 20%; background: #7c4c3e; }
.wb-a5 .wb-bot-base { bottom: 0; left: 32%; width: 36%; height: 15%; border-radius: 12% 12% 0 0; background: #3b201a; }
.wb-a5 .wb-cyl-head { top: 21%; left: 22%; width: 56%; height: 52%; border-radius: 18% 18% 26% 26%; background: #5b352c; }
.wb-a5 .wb-eye-l { top: 33%; left: 32%; width: 11%; height: 11%; border-radius: 50%; background: #ffba3b; }
.wb-a5 .wb-eye-r { top: 33%; left: 57%; width: 11%; height: 11%; border-radius: 50%; background: #ffba3b; }
.wb-a5 .wb-grille { top: 52%; left: 34%; width: 32%; height: 10%; border-radius: 3px; background: #200f0b; box-shadow: inset 0 0 0 1px #7c4c3e; }

@media (prefers-color-scheme: dark) {
  .wb-p0 { background: #233529; }
  .wb-p0 .wb-torso { background: #2a4032; }
  .wb-p0 .wb-head { background: #dfb79e; }
  .wb-p0 .wb-bangs, .wb-p0 .wb-hair-back { background: #171311; }

  .wb-p1 { background: #3b2628; }
  .wb-p1 .wb-torso { background: #4a252e; }
  .wb-p1 .wb-head { background: #d49f82; }
  .wb-p1 .wb-hair-short { background: #1d1410; }
  .wb-p1 .wb-glasses-frame { border-color: #120d0b; }

  .wb-p2 { background: #282b42; }
  .wb-p2 .wb-torso { background: #353752; }
  .wb-p2 .wb-head { background: #cfa07e; }
  .wb-p2 .wb-topknot, .wb-p2 .wb-hair-sides { background: #141113; }

  .wb-p3 { background: #3d3121; }
  .wb-p3 .wb-torso { background: #612f1e; }
  .wb-p3 .wb-head { background: #884e2e; }
  .wb-p3 .wb-afro { background: #100e0c; }

  .wb-p4 { background: #223142; }
  .wb-p4 .wb-torso { background: #22374f; }
  .wb-p4 .wb-head { background: #d3a37f; }
  .wb-p4 .wb-beanie { background: #965715; }
  .wb-p4 .wb-beard { background: #1f1611; }

  .wb-p5 { background: #372636; }
  .wb-p5 .wb-torso { background: #3f233a; }
  .wb-p5 .wb-head { background: #dbb7a0; }
  .wb-p5 .wb-hair-long, .wb-p5 .wb-fringe { background: #1e1211; }

  .wb-a0 { background: #1a3337; }
  .wb-a0 .wb-bot-head { background: #26343b; }
  .wb-a0 .wb-bot-base { background: #1a242a; }

  .wb-a1 { background: #3d2e1c; }
  .wb-a1 .wb-dome-head { background: #382c1e; }
  .wb-a1 .wb-bot-base { background: #241c13; }

  .wb-a2 { background: #232a40; }
  .wb-a2 .wb-hex-head { background: #1b2438; }
  .wb-a2 .wb-bot-base { background: #141b2a; }

  .wb-a3 { background: #1a3426; }
  .wb-a3 .wb-box-head { background: #1d3326; }
  .wb-a3 .wb-bot-base { background: #122118; }

  .wb-a4 { background: #312345; }
  .wb-a4 .wb-orb-head { background: #281c3a; }
  .wb-a4 .wb-orb-base { background: #181124; }

  .wb-a5 { background: #3f241d; }
  .wb-a5 .wb-cyl-head { background: #3a1f18; }
  .wb-a5 .wb-bot-base { background: #22120e; }
}
.body { min-width: 0; max-width: 820px; }
.meta-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-bottom: 2px; }
.author { color: var(--bright); font-weight: 600; font-size: 13px; }
.where { color: var(--faint); font-size: 12px; }
.where a { color: var(--blue); font-family: var(--mono); font-size: 11.5px; cursor: default; }
.where a:hover { text-decoration: underline; }
.time, .id { color: var(--faint); font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 11px; }
.meta-line .time { margin-left: auto; }

/* --- Thread detail timeline --- */
.thread-body { display: flex; flex-direction: column; min-width: 0; }
.thread-root { padding-top: 4px; }
.thread-timeline { position: relative; min-width: 0; }
.thread-timeline.has-items::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 14px;
  left: 33px;
  width: 1px;
  background: var(--hairline);
  pointer-events: none;
}
.thread-timeline .message { padding-left: 16px; }
.thread-timeline .avatar-wrap { position: relative; z-index: 1; }
.thread-timeline .avatar { box-shadow: 0 0 0 3px var(--surface); }
.thread-timeline .message.active .avatar { box-shadow: 0 0 0 3px var(--surface-2); }

/* --- message markdown --- */
.text { overflow-wrap: anywhere; color: var(--dim); font-size: 13.5px; line-height: 1.65; cursor: text; }
.text > :first-child { margin-top: 0; }
.text > :last-child { margin-bottom: 0; }
.text > p:last-child, .text > p:has(+ .edited) { display: inline; }
.text p { margin: 0 0 6px; }
.text a { color: var(--blue); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; overflow-wrap: anywhere; }
.text a:hover { text-decoration-color: currentColor; }
.text strong { color: var(--bright); font-weight: 650; }
.text h1, .text h2, .text h3, .text h4 { margin: 10px 0 4px; color: var(--bright); font-size: 14px; font-weight: 650; }
.text ul, .text ol { margin: 3px 0 6px; padding-left: 20px; }
.text li + li { margin-top: 2px; }
.text blockquote { margin: 5px 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--hairline-strong); color: var(--muted); }
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
.mention { padding: 0 3px; border-radius: 3px; background: var(--shade); color: var(--bright); font-weight: 600; }
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
.badge.slack, .badge.github { border-color: var(--hairline-strong); background: var(--surface-2); color: var(--dim); }
.label:hover, .chip:hover { color: var(--bright); border-color: var(--hairline-strong); background: var(--shade); }
.label button { color: var(--faint); display: inline-flex; }
.label button:hover { color: var(--bright); }
.chip.mine { border-color: var(--hairline-strong); background: var(--shade); color: var(--bright); font-weight: 600; }

.links { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.link-embed { padding: 4px 0 4px 12px; border-left: 2px solid var(--hairline-strong); }
.link-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 12px; color: var(--muted); }
.link-meta .author { font-size: 12.5px; }
.link-meta a, .link-file a { color: var(--blue); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; overflow-wrap: anywhere; }
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
.composer-files { margin: 4px 0 2px; }
.replies {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 5px 0 0 -6px;
  padding: 3px 8px 3px 6px;
  border-radius: var(--radius-sm);
  color: var(--blue);
  font-size: 12px;
  font-weight: 550;
}
.replies:hover { background: var(--blue-soft); }
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
.editor textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-soft); }

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
  font-size: 12px;
}
.tool:hover, .tool[data-popup-open] { background: var(--shade); color: var(--bright); }
.tool.on { color: var(--bright); background: var(--shade); font-weight: 550; }
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
  background: var(--surface-2);
}
.suggest input { width: 100%; min-width: 0; height: 28px; border: 0; outline: none; background: none; font-size: 13px; }
.suggest:focus-within { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-soft); }
.suggest .prefix { color: var(--faint); font-family: var(--mono); font-size: 11px; margin-right: 4px; }
.suggest input::placeholder { color: var(--faint); }
.label-add > .suggest { width: 38%; }

/* --- filters --- */
.filter-bar { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 18px 4px; border-bottom: 1px solid var(--hairline); }
.clear { color: var(--muted); font-size: 11.5px; }
.clear:hover { color: var(--blue); text-decoration: underline; }
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
  background: var(--surface-2);
  color: var(--muted);
  font-size: 12px;
}
.segment:hover { color: var(--bright); border-color: var(--hairline-strong); }
.segment.on { border-color: var(--ink); background: var(--ink); color: var(--ink-label); font-weight: 550; }

/* --- slim bottom-docked composer strip --- */
.composer {
  flex-shrink: 0;
  border-top: 1px solid var(--hairline);
  background: var(--surface);
  padding: 7px 14px;
}
.composer.expanded {
  padding: 8px 14px 10px;
  background: var(--surface-2);
}
.composer-box {
  display: flex;
  flex-direction: column;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: text;
}
.composer.expanded .composer-box {
  border-color: var(--hairline-strong);
  background: var(--surface);
  padding: 8px 10px 6px;
}
.composer.expanded .composer-box:focus-within {
  border-color: var(--blue);
  box-shadow: 0 0 0 2px var(--blue-soft);
}
.composer-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.composer-compact-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.composer-box textarea {
  flex: 1;
  min-width: 0;
  width: 100%;
  min-height: 28px;
  max-height: 160px;
  padding: 3px 2px;
  border: 0;
  outline: none;
  background: none;
  color: var(--bright);
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  overflow-y: auto;
}
.composer.expanded .composer-box textarea {
  min-height: 44px;
  padding: 4px 2px;
}
.composer-box textarea::placeholder { color: var(--faint); }
.composer-channel { margin: 0 0 6px; align-self: flex-start; width: min(280px, 100%); }
.composer-labels { margin: 0 0 6px; }
.composer-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px;
  min-height: 32px;
  padding-top: 6px;
  border-top: 1px solid var(--hairline);
  margin-top: 6px;
}
.composer-footer .hint { margin-left: auto; margin-right: 8px; }
.send {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  background: var(--ink);
  color: var(--ink-label);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
}
.send:hover:not(:disabled) { background: var(--ink-hover); }
.send.small { height: 26px; padding: 0 10px; font-size: 12px; }
.send:disabled { opacity: 0.35; }

/* --- non-feed pages and facts --- */
.page { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 6px 0 18px; }
.more { display: block; margin: 10px 18px; }
.facts { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.facts dt { color: var(--faint); font-size: 11.5px; line-height: 19px; }
.facts dd { margin: 0; color: var(--dim); overflow-wrap: anywhere; }
.segment.small { height: 22px; padding: 0 8px; font-size: 11px; }

/* --- action buttons and ask forms --- */
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.acts .act[aria-haspopup] { padding: 0 7px; }
.act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--dim);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.act:hover, .act[data-popup-open] { background: var(--surface-2); border-color: var(--hairline-strong); color: var(--bright); }
.act.primary { border-color: var(--ink); background: var(--ink); color: var(--ink-label); font-weight: 550; }
.act.primary:hover { border-color: var(--ink-hover); background: var(--ink-hover); color: var(--ink-label); }
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
  background: var(--surface-2);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}
.ask textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-soft); }
.ask .hint { margin: 0; }
.ask .suggest .prefix { margin-right: 6px; font-size: 11px; white-space: nowrap; }
.ask .send { justify-self: end; }

/* --- tasks: quiet status marks, aligned two-line rows, flat detail summary --- */
.task-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--shade);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
  width: fit-content;
}
.task-state.icon-only {
  padding: 0;
  width: 20px;
  height: 20px;
  justify-content: center;
  background: transparent;
}
.task-state svg { flex-shrink: 0; }
.task-state.ready { background: var(--shade); color: var(--dim); }
.task-state.claimed { background: var(--amber-soft); color: var(--amber); }
.task-state.blocked { background: var(--amber-soft); color: var(--amber); }
.task-state.completed { background: var(--green-soft); color: var(--green); }
.task-state.failed { background: var(--red-soft); color: var(--red); }
.task-state.waiting, .task-state.canceled { background: var(--shade); color: var(--faint); }
.task-state.icon-only.ready,
.task-state.icon-only.claimed,
.task-state.icon-only.blocked,
.task-state.icon-only.completed,
.task-state.icon-only.failed,
.task-state.icon-only.waiting,
.task-state.icon-only.canceled { background: transparent; }

.task-state-text {
  font-size: 11px;
  font-weight: 500;
  color: var(--faint);
  white-space: nowrap;
}
.task-state-text.ready { color: var(--muted); }
.task-state-text.claimed, .task-state-text.blocked { color: var(--amber); }
.task-state-text.completed { color: var(--green); }
.task-state-text.failed { color: var(--red); }

.task-line, .task-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.task-line { margin-top: 6px; color: var(--muted); font-size: 12px; }
.task-head-meta { color: var(--muted); font-size: 12px; }
.task-note { color: var(--dim); overflow-wrap: anywhere; }
.lease { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--amber); }
.needs { display: inline-flex; flex-wrap: wrap; gap: 2px 8px; }
.need { color: var(--blue); font-family: var(--mono); font-size: 11.5px; cursor: default; }
.need:hover { text-decoration: underline; }
.need-state { margin-left: 4px; font-family: var(--sans); color: var(--faint); }
.need-state.completed { color: var(--green); }
.need-state.failed { color: var(--red); }

/* Flat detail task bar (no heavy card chrome) */
.task-card {
  flex-shrink: 0;
  display: grid;
  gap: 7px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--hairline);
  background: transparent;
  font-size: 12px;
}
.task-head { color: var(--dim); }
.task-head .task-state { font-size: 11.5px; font-weight: 600; }
.task-card .hint { margin: 0; }
.task-facts-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
}
.task-fact-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.task-facts-inline dt {
  color: var(--faint);
  font-size: 11.5px;
  white-space: nowrap;
}
.task-facts-inline dd {
  color: var(--dim);
  font-size: 12px;
}

/* Aligned two-line lightweight task rows */
.task-rows { display: flex; flex-direction: column; gap: 2px; padding: 2px 10px; }
.task-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 7px;
  outline: none;
}
.task-row:hover {
  background: var(--surface-2);
}
.task-row[aria-current] {
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--hairline-strong);
}
.task-row:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.task-row > .task-state { margin-top: 1px; }
.task-row-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.task-row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.task-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  color: var(--bright);
  font-size: 13px;
  font-weight: 500;
}
.task-subject { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-id { flex-shrink: 0; font-family: var(--mono); font-size: 11px; color: var(--faint); font-weight: 400; }
.task-title .label { flex-shrink: 0; }
.task-row-right {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}
.task-row-sub {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
}
.task-where { color: var(--faint); font-family: var(--mono); font-size: 11px; white-space: nowrap; flex-shrink: 0; }
.task-sep { color: var(--hairline-strong); flex-shrink: 0; }
.task-now { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.task-now .needs { display: inline; }
.task-now .need + .need { margin-left: 6px; }
.task-row .time { text-align: right; white-space: nowrap; flex-shrink: 0; }

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
.task-place:hover { border-color: var(--hairline-strong); background: var(--surface-2); }
.task-place .name { flex: 1; min-width: 0; font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-place .count { color: var(--faint); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; }

.composer-task { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 6px; }
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
.message.active .block-head { background: var(--shade); }
.block-schema { color: var(--bright); font-family: var(--mono); font-size: 11.5px; font-weight: 600; cursor: default; }
.block-schema:hover { color: var(--blue); text-decoration: underline; }
.block-schema .faint { font-weight: 400; }
.block-fields { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 14px; margin: 0; padding: 8px 10px; cursor: text; }
.block-field { display: contents; }
.block-field dt { color: var(--faint); font-family: var(--mono); font-size: 11.5px; }
.block-field dd { margin: 0; color: var(--dim); overflow-wrap: anywhere; }
.block-field a { color: var(--blue); text-decoration: underline; text-decoration-color: var(--accent-transparent); text-underline-offset: 3px; }
.block-raw { margin: 0; padding: 8px 10px; color: var(--dim); font-family: var(--mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; }

/* --- schemas --- */
.schema { margin: 0 10px; }
.schema-row {
  display: grid;
  grid-template-columns: minmax(120px, 200px) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
}
.schema-row:hover { background: var(--surface-2); }
.schema-name { color: var(--bright); font-family: var(--mono); font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.schema-versions { display: flex; gap: 10px; font-family: var(--mono); }
.schema-versions .tab { padding: 0; margin: 0; }
.schema-about { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.small { font-size: 11px; }
.schema-detail {
  display: grid;
  gap: 10px;
  margin: 4px 10px 14px;
  padding: 14px 16px;
  max-width: 860px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--surface-2);
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
  background: var(--surface);
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
  margin: 16px 18px 6px;
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
  margin: 0 10px;
  padding: 5px 10px;
  border-radius: var(--radius-md);
}
.grant-row:hover { background: var(--surface-2); }
.grant-who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bright); font-weight: 500; }
.grant-who .badge { margin-left: 8px; }
.grant-can { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.grant-can b { color: var(--bright); font-weight: 650; }
.grant-row .act { height: 24px; }
.explain { display: grid; gap: 10px; padding: 4px 18px 8px; }
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
  background: var(--surface-2);
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
  margin: 0 10px;
  padding: 5px 10px;
  border-radius: var(--radius-md);
}
.sched-row:hover { background: var(--surface-2); }
.sched-when { color: var(--bright); font-family: var(--mono); font-size: 12px; white-space: nowrap; }
.sched-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dim); }
.sched-row .act { height: 24px; justify-self: end; }
.watch-row {
  display: grid;
  grid-template-columns: minmax(90px, 180px) minmax(0, 1fr);
  gap: 14px;
  margin: 0 10px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
}
.watch-row:hover { background: var(--surface-2); }
.watch-id { color: var(--bright); font-family: var(--mono); font-size: 12px; font-weight: 600; }
.watch-row code { color: var(--dim); font-size: 12px; overflow-wrap: anywhere; }
.thread-facts { flex-shrink: 0; padding: 8px 18px; border-bottom: 1px solid var(--hairline); background: transparent; font-size: 12px; }
.thread-facts .fact { display: contents; }
.copies { display: flex; flex-wrap: wrap; gap: 2px 12px; }
.label-add.end { justify-content: flex-end; gap: 12px; }
.suggest input:disabled { opacity: 0.4; }

.inbox-row {
  display: grid;
  grid-template-columns: 74px 96px minmax(0, 1fr);
  gap: 12px;
  margin: 0 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
}
.inbox-row:hover { background: var(--surface-2); }
.inbox-row pre { margin: 4px 0 0; color: var(--faint); font-family: var(--mono); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }

/* --- toasts --- */
.toasts { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 60; max-width: calc(100vw - 32px); }
.toast {
  max-width: 420px;
  padding: 9px 14px;
  border: 1px solid var(--hairline-strong);
  border-left: 3px solid var(--ink);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--bright);
  box-shadow: var(--shadow-md);
  font-size: 12.5px;
}

/* --- responsive breakpoints (tablet + 390px narrow screen, zero horizontal overflow) --- */
@media (max-width: 900px) {
  .shell, .shell.collapsed { padding: 0; gap: 0; }
  .main { border: 0; border-radius: 0; }
  .sidebar { display: none; }
  .resize { display: none; }
  .tool.only-narrow { display: inline-flex; }
  .shell.nav .sidebar {
    display: flex;
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 41;
    width: min(272px, 84vw) !important;
    opacity: 1 !important;
    padding: 4px 6px 8px;
    border-right: 1px solid var(--hairline);
    background: var(--side-bg);
    box-shadow: var(--shadow-lg);
  }
  .shell.nav .scrim { display: block; position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, 0.34); }
}

@media (max-width: 700px) {
  .header { padding: 0 10px 0 12px; gap: 6px; }
  .tabs { padding: 4px 12px; gap: 4px 10px; }
  .filter-bar { padding: 8px 12px 4px; }
  .composer { padding: 6px 10px; }
  .composer.expanded { padding: 8px 10px; }
  .composer-footer .hint { display: none; }
  .composer-footer .send { margin-left: auto; }
  .message { padding: 8px 12px 8px 10px; gap: 8px; }
  .thread-timeline.has-items::before { left: 27px; }
  .divider { margin: 12px 12px 5px; }
  .empty, .error { padding: 18px 14px; }
  .empty-state { margin: 14px 12px; padding: 16px; }
  .task-card { padding: 10px 12px; }
  .task-rows { padding: 0 6px; }
  .task-row { padding: 9px 8px; gap: 8px; }
  .task-row-right { gap: 6px; }
  .task-state-text { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
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
