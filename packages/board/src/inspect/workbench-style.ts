export const WORKBENCH_CSS = `
/* --- Board Workbench: sidebar tools, command palette, project index, and thread project context --- */
.workbench-side-tools {
  display: grid;
  gap: 5px;
  padding: 2px 0 12px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--side-hairline);
}
.workbench-side-tools button,
.workbench-side-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 33px;
  padding: 6px 9px;
  border: 1px solid var(--side-hairline);
  border-radius: 7px;
  background: var(--side-surface);
  color: var(--side-text);
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  cursor: default;
}
.workbench-side-tools button:hover,
.workbench-side-btn:hover {
  background: var(--side-hover);
  border-color: rgba(255, 255, 255, 0.16);
  color: var(--side-bright);
}
.workbench-side-tools button:focus-visible,
.workbench-side-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.workbench-side-tools button svg,
.workbench-side-btn svg {
  flex: none;
  color: var(--accent);
  opacity: 0.92;
}
.workbench-side-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workbench-side-tools kbd,
.workbench-side-btn kbd {
  margin-left: auto;
  padding: 1px 5px;
  border: 1px solid var(--side-hairline);
  border-radius: 4px;
  background: var(--side-bg);
  color: var(--side-faint);
  font: 10px/1.45 var(--mono);
  white-space: nowrap;
}
.workbench-side-count {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--side-bg);
  color: var(--side-faint);
  font: 10.5px/18px var(--mono);
}

/* --- Dialog backdrop and container --- */
.workbench-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  background: rgba(15, 14, 13, 0.56);
}
.workbench-dialog {
  position: fixed;
  z-index: 71;
  top: min(11dvh, 96px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  width: min(580px, calc(100vw - 24px));
  max-height: min(680px, 82dvh);
  border: 1px solid var(--hairline-strong);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface);
  color: var(--bright);
  box-shadow: var(--shadow-lg);
}
.workbench-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--hairline);
  background: var(--bg);
}
.workbench-dialog-title {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
  font-weight: 650;
  color: var(--bright);
}
.workbench-description {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.workbench-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 7px;
  color: var(--muted);
  cursor: default;
}
.workbench-close:hover { background: var(--shade); color: var(--bright); }

.workbench-dialog-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
.workbench-dialog-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
  padding: 9px 16px;
  border-top: 1px solid var(--hairline);
  background: var(--bg);
  color: var(--faint);
  font-size: 11px;
}
.workbench-keys {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.workbench-keys span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.workbench-keys kbd {
  padding: 0 5px;
  border: 1px solid var(--hairline-strong);
  border-radius: 4px;
  background: var(--surface);
  color: var(--muted);
  font: 10px/1.55 var(--mono);
}

/* --- Command search bar and result rows --- */
.workbench-search-wrap {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--hairline-strong);
  border-radius: 9px;
  background: var(--bg);
}
.workbench-search-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.workbench-search-icon {
  justify-self: center;
  color: var(--faint);
}
.workbench-search {
  width: 100%;
  min-width: 0;
  height: 40px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bright);
  font-size: 13.5px;
}
.workbench-search::placeholder { color: var(--faint); }
.workbench-search-kbd {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  background: var(--surface);
  color: var(--faint);
  font: 10px/1.45 var(--mono);
}

.workbench-results {
  list-style: none;
  margin: 12px 0 0;
  padding: 6px 0 0;
  border-top: 1px solid var(--hairline);
  min-height: 0;
  max-height: min(370px, 46dvh);
  overflow-y: auto;
  display: grid;
  gap: 3px;
}
.workbench-command {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 38px;
  padding: 7px 10px;
  gap: 12px;
  border-radius: 8px;
  text-align: left;
  color: var(--bright);
  cursor: default;
  overflow-wrap: anywhere;
}
.workbench-command:hover,
.workbench-command:focus-visible {
  background: var(--shade);
  outline: none;
  box-shadow: inset 2px 0 0 var(--accent);
}
.workbench-command-main {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
}
.workbench-command-icon { flex: none; color: var(--muted); }
.workbench-command:hover .workbench-command-icon,
.workbench-command:focus-visible .workbench-command-icon { color: var(--accent); }
.workbench-hint {
  color: var(--faint);
  text-align: right;
  font-family: var(--mono);
  font-size: 11px;
  flex-shrink: 0;
}

/* --- Project Index cards and actions --- */
.workbench-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.workbench-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 31px;
  padding: 5px 11px;
  border: 1px solid var(--hairline-strong);
  border-radius: 7px;
  background: var(--surface);
  color: var(--dim);
  font-size: 12px;
  font-weight: 500;
  cursor: default;
}
.workbench-action:hover:not(:disabled) {
  background: var(--shade);
  border-color: var(--accent);
  color: var(--bright);
}
.workbench-action.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--label);
  font-weight: 600;
}
.workbench-action.primary:hover:not(:disabled) {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
  color: var(--label);
}
.workbench-action:disabled { opacity: 0.45; }

.workbench-error {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--red-soft);
  color: var(--red);
  font-size: 12px;
}
.workbench-status {
  margin: 10px 0 0;
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--green-soft);
  color: var(--green);
  font-size: 12px;
}
.workbench-status:empty { display: none; }
.workbench-empty {
  margin: 12px 0 2px;
  padding: 18px 14px;
  border: 1px dashed var(--hairline-strong);
  border-radius: 9px;
  background: var(--bg);
  color: var(--muted);
  font-size: 12.5px;
}

.workbench-project-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.workbench-project {
  display: grid;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  background: var(--bg);
  min-width: 0;
}
.workbench-project-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 10px;
  min-width: 0;
}
.workbench-project-title {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: var(--bright);
  overflow-wrap: anywhere;
}
.workbench-project-channel {
  padding: 2px 8px;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}

/* --- ThreadPane project context strip --- */
.workbench-project-context {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--hairline);
  background: var(--accent-soft);
  font-size: 12px;
  color: var(--dim);
  overflow-wrap: anywhere;
}
.workbench-project-context-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--bright);
  font-weight: 650;
}
.workbench-project-context-name svg { color: var(--accent); flex: none; }
.workbench-project-context-links {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.workbench-project-context a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 3px 9px;
  border: 1px solid var(--accent-transparent);
  border-radius: 6px;
  background: var(--surface);
  color: var(--accent);
  font-size: 12px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
}
.workbench-project-context a:hover {
  background: var(--shade);
  border-color: var(--accent);
  color: var(--bright);
}

@media (pointer: coarse) {
  .workbench-search { font-size: 16px; }
  .workbench-command { min-height: 44px; }
  .workbench-project-context a { min-height: 32px; padding: 4px 10px; }
}
@media (max-width: 500px) {
  .workbench-dialog { top: 12px; width: calc(100vw - 16px); max-height: calc(100dvh - 24px); }
  .workbench-dialog-header { padding: 13px 13px 10px; }
  .workbench-dialog-body { padding: 12px 13px; }
  .workbench-dialog-foot { padding: 8px 13px; }
  .workbench-project-context { padding: 9px 12px; gap: 8px 10px; }
  .workbench-project-context-links { margin-left: 0; }
}
`
