export const WORKBENCH_CSS = `
/* --- Board Workbench: command palette, project index, and flat thread project context --- */

/* --- Dialog backdrop and container --- */
.workbench-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  background: rgba(15, 23, 42, 0.36);
}
.workbench-dialog {
  position: fixed;
  z-index: 71;
  top: min(11dvh, 96px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 24px));
  max-height: min(660px, 82dvh);
  border: 1px solid var(--hairline-strong);
  border-radius: 10px;
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
  padding: 13px 16px 11px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
}
.workbench-dialog-title {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--bright);
}
.workbench-description {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.workbench-close {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: default;
}
.workbench-close:hover { background: var(--shade); color: var(--bright); }

.workbench-dialog-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 14px;
}
.workbench-dialog-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
  padding: 8px 16px;
  border-top: 1px solid var(--hairline);
  background: var(--surface-2);
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

/* --- Command search bar and list --- */
.workbench-search-wrap {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--hairline-strong);
  border-radius: 7px;
  background: var(--surface-2);
}
.workbench-search-wrap:focus-within {
  border-color: var(--blue);
  box-shadow: 0 0 0 2px var(--blue-soft);
}
.workbench-search-icon {
  justify-self: center;
  color: var(--faint);
}
.workbench-search {
  width: 100%;
  min-width: 0;
  height: 36px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bright);
  font-size: 13px;
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
  margin: 10px 0 0;
  padding: 4px 0 0;
  border-top: 1px solid var(--hairline);
  min-height: 0;
  max-height: min(380px, 48dvh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.workbench-group {
  margin-top: 8px;
}
.workbench-group:first-child {
  margin-top: 2px;
}
.workbench-group-title {
  padding: 4px 8px 3px;
  font-size: 11px;
  font-weight: 550;
  color: var(--faint);
  letter-spacing: 0.01em;
}
.workbench-group-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
}
.workbench-command {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 32px;
  padding: 5px 8px;
  gap: 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  color: var(--bright);
  cursor: default;
  overflow-wrap: anywhere;
}
.workbench-command:hover,
.workbench-command:focus-visible {
  background: var(--shade);
  color: var(--bright);
  outline: none;
}
.workbench-command-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
}
.workbench-command-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workbench-command-icon {
  flex: none;
  color: var(--muted);
}
.workbench-command:hover .workbench-command-icon,
.workbench-command:focus-visible .workbench-command-icon {
  color: var(--bright);
}
.workbench-hint {
  color: var(--faint);
  text-align: right;
  font-family: var(--mono);
  font-size: 11px;
  flex-shrink: 0;
}
.workbench-command:hover .workbench-hint,
.workbench-command:focus-visible .workbench-hint {
  color: var(--muted);
}

/* --- Project Index items and actions --- */
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
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--hairline-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--dim);
  font-size: 12px;
  font-weight: 500;
  cursor: default;
}
.workbench-action:hover:not(:disabled) {
  background: var(--shade);
  border-color: var(--hairline-strong);
  color: var(--bright);
}
.workbench-action.primary {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--ink-label);
  font-weight: 550;
}
.workbench-action.primary:hover:not(:disabled) {
  border-color: var(--ink-hover);
  background: var(--ink-hover);
  color: var(--ink-label);
}
.workbench-action:disabled { opacity: 0.45; }

.workbench-error {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--red-soft);
  color: var(--red);
  font-size: 12px;
}
.workbench-status {
  margin: 10px 0 0;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--green-soft);
  color: var(--green);
  font-size: 12px;
}
.workbench-status:empty { display: none; }
.workbench-empty {
  margin: 12px 0 2px;
  padding: 16px 14px;
  border: 1px dashed var(--hairline-strong);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 12.5px;
}

.workbench-project-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.workbench-project {
  display: grid;
  gap: 8px;
  padding: 11px 13px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--surface-2);
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
  font-size: 13px;
  font-weight: 600;
  color: var(--bright);
  overflow-wrap: anywhere;
}
.workbench-project-channel {
  padding: 1px 7px;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}

/* --- Flat inline project context strip in detail view --- */
.workbench-project-context {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 7px 18px;
  border-bottom: 1px solid var(--hairline);
  background: transparent;
  font-size: 12px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.workbench-project-context-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--bright);
  font-weight: 550;
}
.workbench-project-context-name svg { color: var(--muted); flex: none; }
.workbench-project-context-links {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.workbench-project-context a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--blue);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}
.workbench-project-context a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (pointer: coarse) {
  .workbench-search { font-size: 16px; }
  .workbench-command { min-height: 40px; }
  .workbench-project-context a { min-height: 30px; }
}
@media (max-width: 500px) {
  .workbench-dialog { top: 12px; width: calc(100vw - 16px); max-height: calc(100dvh - 24px); }
  .workbench-dialog-header { padding: 12px 13px 10px; }
  .workbench-dialog-body { padding: 12px 13px; }
  .workbench-dialog-foot { padding: 8px 13px; }
  .workbench-project-context { padding: 7px 12px; gap: 6px 10px; }
  .workbench-project-context-links { margin-left: 0; }
}
`
