import { useEffect, useRef, useState, type ReactNode } from 'react'

// Navigation with the History API: no reloads. Links act on mouse down, like
// native lists, and keep the browser's own behavior for new tabs.

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}

export type Where = { path: string; thread: number | null }

export function useLocation(): Where {
  const read = (): Where => {
    const thread = Number(new URLSearchParams(location.search).get('thread'))
    return { path: location.pathname, thread: Number.isInteger(thread) && thread > 0 ? thread : null }
  }
  const [where, setWhere] = useState(read)
  useEffect(() => {
    const update = () => setWhere(read())
    addEventListener('popstate', update)
    return () => removeEventListener('popstate', update)
  }, [])
  return where
}

export function Link(props: { to: string; className?: string; current?: boolean; title?: string; children: ReactNode }) {
  const navigatedAt = useRef(0)
  const plain = (event: React.MouseEvent | React.PointerEvent) =>
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  return (
    <a
      href={props.to}
      className={props.className}
      title={props.title}
      aria-current={props.current ? 'page' : undefined}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse' || !plain(event)) return
        navigatedAt.current = Date.now()
        navigate(props.to)
      }}
      onClick={(event) => {
        if (!plain(event)) return
        event.preventDefault()
        if (Date.now() - navigatedAt.current > 500) navigate(props.to)
      }}
    >
      {props.children}
    </a>
  )
}

/** The current time, ticking, so "2m" ages without a reload. */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}

/** Typing anywhere that isn't a field focuses the composer; the keystroke lands in it. */
export function useTypeToFocus(composer: string) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return
      const target = event.target as HTMLElement
      if (target !== document.body && target.closest('input, textarea, select, [contenteditable], [role="menu"], [role="dialog"], [role="listbox"]'))
        return
      document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${CSS.escape(composer)}"]`)?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [composer])
}
