import { CloudOff, FileText, Paperclip, Tag, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileSize } from '../../contract/files.ts'
import { ATTACHMENT_BYTES_MAX, ATTACHMENTS_PER_MESSAGE_MAX } from '../../contract/schemas.ts'
import * as board from './board.ts'
import { LabelEditor, Panel, Suggest, type KnownLabels } from './ui.tsx'

// Just Chat's composer: one outlined box, the textarea, a quiet toolbar.
// Enter sends, Shift+Enter breaks a line, ⌘B / ⌘I / ⌘E format, lists continue,
// ↑ in an empty box edits your last message, and every place keeps its draft.

const MAX_HEIGHT = 160

const draftKey = (scope: string) => `vboard.draft:${scope}`
function readDraft(scope: string): string {
  try {
    return sessionStorage.getItem(draftKey(scope)) ?? ''
  } catch {
    return ''
  }
}
function writeDraft(scope: string, text: string) {
  try {
    if (text) sessionStorage.setItem(draftKey(scope), text)
    else sessionStorage.removeItem(draftKey(scope))
  } catch {}
}

/** Replaces the selection through the browser, so ⌘Z undoes it. */
function insert(el: HTMLTextAreaElement, start: number, end: number, text: string, caret: [number, number]) {
  el.focus()
  el.setSelectionRange(start, end)
  if (!document.execCommand('insertText', false, text)) el.setRangeText(text, start, end, 'end')
  el.setSelectionRange(caret[0], caret[1])
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s(.*)$/

export type Send = { text: string; noSync: boolean; channel: string; labels: Record<string, string>; files: File[] }

export function Composer(props: {
  scope: string
  /** `data-composer`, for typing anywhere to land here. */
  role: string
  placeholder: string
  known: KnownLabels
  channels?: string[]
  onSend: (send: Send) => void
  onEditLast?: () => void
}) {
  const [text, setText] = useState(() => readDraft(props.scope))
  const [channel, setChannel] = useState('')
  const [noSync, setNoSync] = useState(false)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  /** Adds files from the picker or a paste, up to what a message can carry. */
  const attach = (added: File[]) => {
    const fitting = added.filter((file) => {
      if (file.size <= ATTACHMENT_BYTES_MAX) return true
      board.toast(`${file.name} is over ${ATTACHMENT_BYTES_MAX / 1024 / 1024} MB`)
      return false
    })
    setFiles((current) => {
      const next = [...current, ...fitting]
      if (next.length > ATTACHMENTS_PER_MESSAGE_MAX) board.toast(`a message carries at most ${ATTACHMENTS_PER_MESSAGE_MAX} files`)
      return next.slice(0, ATTACHMENTS_PER_MESSAGE_MAX)
    })
    area.current?.focus()
  }

  useEffect(() => {
    setText(readDraft(props.scope))
    if (!matchMedia('(max-width: 900px)').matches && !props.channels) area.current?.focus({ preventScroll: true })
  }, [props.scope])

  useLayoutEffect(() => {
    const el = area.current!
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [text])

  const change = (value: string) => {
    setText(value)
    writeDraft(props.scope, value)
  }

  const target = channel.trim().replace(/^#/, '')
  const canSend = (text.trim().length > 0 || files.length > 0) && (!props.channels || target.length > 0)

  const send = () => {
    if (!text.trim() && files.length === 0) return
    if (props.channels && !target) return board.toast('pick a channel to post in')
    props.onSend({ text: text.trim(), noSync, channel: target, labels, files })
    change('')
    setLabels({})
    setFiles([])
  }

  const wrap = (el: HTMLTextAreaElement, marker: string) => {
    const { selectionStart: start, selectionEnd: end, value } = el
    const selected = value.slice(start, end)
    insert(el, start, end, `${marker}${selected}${marker}`, [start + marker.length, end + marker.length])
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget
    const mod = event.metaKey || event.ctrlKey
    if (event.key === 'Escape') return el.blur()
    if (mod && !event.shiftKey && ['b', 'i', 'e'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      return wrap(el, { b: '**', i: '_', e: '`' }[event.key.toLowerCase()]!)
    }
    if (event.key === 'ArrowUp' && !el.value && props.onEditLast) {
      event.preventDefault()
      return props.onEditLast()
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (mod) {
      event.preventDefault()
      return send()
    }
    if (event.shiftKey) return
    const caret = el.selectionStart
    if (caret === el.selectionEnd) {
      const lineStart = el.value.lastIndexOf('\n', caret - 1) + 1
      const line = el.value.slice(lineStart, caret)
      const item = LIST_ITEM.exec(line)
      if (item) {
        event.preventDefault()
        // An empty item ends the list; otherwise the next one starts.
        if (!item[3]!.trim()) return insert(el, lineStart, caret, '', [lineStart, lineStart])
        const marker = /^\d+\.$/.test(item[2]!) ? `${Number.parseInt(item[2]!, 10) + 1}.` : item[2]!
        const next = `\n${item[1]}${marker} `
        return insert(el, caret, caret, next, [caret + next.length, caret + next.length])
      }
    }
    event.preventDefault()
    send()
  }

  const labelEntries = Object.entries(labels)
  return (
    <div className="composer">
      <div
        className="composer-box"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, [role="dialog"]')) return
          area.current?.focus()
        }}
      >
        {props.channels && (
          <Suggest
            className="composer-channel"
            prefix="#"
            value={channel}
            onChange={setChannel}
            items={props.channels}
            placeholder="channel"
            label={(item) => (
              <>
                <span className="faint">#</span>
                {item}
              </>
            )}
            onEnter={() => area.current?.focus()}
          />
        )}
        {labelEntries.length > 0 && (
          <div className="chips composer-labels">
            {labelEntries.map(([key, value]) => (
              <span key={key} className="label">
                {key}={value}
                <button
                  title={`remove ${key}`}
                  onClick={() =>
                    setLabels((current) => {
                      const next = { ...current }
                      delete next[key]
                      return next
                    })
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          data-composer={props.role}
          rows={2}
          maxLength={10_000}
          value={text}
          placeholder={props.placeholder}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files]
            if (pasted.length === 0) return
            event.preventDefault()
            attach(pasted)
          }}
        />
        {files.length > 0 && (
          <div className="chips composer-files">
            {files.map((file, i) => (
              <span key={i} className="file">
                <FileText size={14} strokeWidth={1.75} />
                <span className="file-name">{file.name}</span>
                <span className="faint">{fileSize(file.size)}</span>
                <button title={`remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-footer">
          <button className="tool" title="attach files (or paste them)" onClick={() => picker.current?.click()}>
            <Paperclip size={14} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              attach([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
          <Panel
            title="labels"
            trigger={
              <>
                <Tag size={14} />
                {labelEntries.length > 0 && <span className="count">{labelEntries.length}</span>}
              </>
            }
            triggerTitle="labels for this message"
            open={labelsOpen}
            onOpenChange={setLabelsOpen}
          >
            <LabelEditor
              labels={labels}
              known={props.known}
              onSet={(key, value) => setLabels((current) => ({ ...current, [key]: value }))}
              onUnset={(key) =>
                setLabels((current) => {
                  const next = { ...current }
                  delete next[key]
                  return next
                })
              }
            />
          </Panel>
          <button
            className={`tool${noSync ? ' on' : ''}`}
            aria-pressed={noSync}
            title={noSync ? 'board only: this message stays off Slack and GitHub' : 'syncs to Slack and GitHub (click to keep it on the board)'}
            onClick={() => setNoSync(!noSync)}
          >
            <CloudOff size={14} />
            {noSync && <span className="tool-label">board only</span>}
          </button>
          <span className="hint">enter to send · shift+enter for a new line</span>
          <button className="send" disabled={!canSend} onMouseDown={(event) => event.preventDefault()} onClick={send}>
            send
          </button>
        </div>
      </div>
    </div>
  )
}
