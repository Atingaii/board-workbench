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
  min-height: 32px;
  padding: 6px 9px;
  border: 1px solid var(--side-hairline);
  border-radius: 6px;
  background: var(--side-surface);
  color: var(--side-text);
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  cursor: default;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.workbench-side-tools button:hover,
.workbench-side-btn:hover {
  background: var(--side-hover);
  border-color: var(--side-active);
  color: var(--side-bright);
}
.workbench-side-tools button:focus-visible,
.workbench-side-btn:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 1px;
}
.workbench-side-tools button svg,
.workbench-side-btn svg {
  flex: none;
  color: var(--blue);
  opacity: 0.95;
  transition: color 0.12s ease;
}
.workbench-side-tools button:hover svg,
.workbench-side-btn:hover svg {
  color: var(--side-bright);
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
  background: rgba(0, 0, 0, 0.48);
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
  border-radius: 12px;
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
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
}
.workbench-dialog-title {
  margin: 0;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 600;
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
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: default;
  transition: background 0.12s ease, color 0.12s ease;
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

/* --- Command search bar and Proper UI Command Menu list --- */
.workbench-search-wrap {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--hairline-strong);
  border-radius: 8px;
  background: var(--surface-2);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
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
  height: 38px;
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
  font-weight: 600;
  color: var(--faint);
  letter-spacing: 0.02em;
}
.workbench-group-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
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
  transition: background 0.1s ease, color 0.1s ease;
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
  transition: color 0.1s ease;
}
.workbench-command:hover .workbench-command-icon,
.workbench-command:focus-visible .workbench-command-icon {
  color: var(--blue);
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
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid var(--hairline-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--dim);
  font-size: 12px;
  font-weight: 500;
  cursor: default;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.workbench-action:hover:not(:disabled) {
  background: var(--shade);
  border-color: var(--hairline-strong);
  color: var(--bright);
}
.workbench-action.primary {
  border-color: var(--blue);
  background: var(--blue);
  color: #ffffff;
  font-weight: 550;
}
.workbench-action.primary:hover:not(:disabled) {
  border-color: var(--blue);
  background: var(--blue);
  filter: brightness(0.92);
  color: #ffffff;
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
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.workbench-project {
  display: grid;
  gap: 9px;
  padding: 12px 14px;
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
  font-size: 13.5px;
  font-weight: 600;
  color: var(--bright);
  overflow-wrap: anywhere;
}
.workbench-project-channel {
  padding: 2px 7px;
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
  padding: 9px 16px;
  border-bottom: 1px solid var(--hairline);
  background: var(--blue-soft);
  font-size: 12px;
  color: var(--dim);
  overflow-wrap: anywhere;
}
.workbench-project-context-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--bright);
  font-weight: 600;
}
.workbench-project-context-name svg { color: var(--blue); flex: none; }
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
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--surface);
  color: var(--blue);
  font-size: 12px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.workbench-project-context a:hover {
  background: var(--shade);
  border-color: var(--blue);
  color: var(--blue);
}

@media (pointer: coarse) {
  .workbench-search { font-size: 16px; }
  .workbench-command { min-height: 40px; }
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
