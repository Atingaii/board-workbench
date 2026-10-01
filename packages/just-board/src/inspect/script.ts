/**
 * The page's only script. Actions POST JSON with the session token; live board
 * events re-render the feed in place, never while you're typing in it.
 */
export const SCRIPT = `
const token = document.querySelector('meta[name="inspect-token"]').content
const feed = document.getElementById('feed')
const live = document.getElementById('live')
const flash = document.getElementById('flash')

function show(message) {
  flash.textContent = message
  flash.hidden = false
  clearTimeout(show.timer)
  show.timer = setTimeout(() => (flash.hidden = true), 6000)
}

async function act(action, body) {
  const response = await fetch('/do/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-inspect-token': token },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data.error && data.error.message) || response.statusText)
  return data
}

let pending = false
const busy = () =>
  (feed.contains(document.activeElement) && document.activeElement.matches('textarea, input')) ||
  feed.querySelector('details[open]')

async function refresh(toBottom) {
  if (!feed) return
  if (busy()) return void (pending = true)
  const atBottom = toBottom || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48
  const top = feed.scrollTop
  const response = await fetch(location.pathname + location.search, { headers: { 'x-inspect-fragment': '1' } })
  if (!response.ok) return
  feed.innerHTML = await response.text()
  feed.scrollTop = atBottom ? feed.scrollHeight : top
}

if (feed) {
  if (!location.hash) feed.scrollTop = feed.scrollHeight
  feed.addEventListener('focusout', () => setTimeout(() => pending && !busy() && ((pending = false), refresh())))
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-do]')
  if (!button) return
  event.preventDefault()
  if (button.dataset.do === 'edit-open') {
    const details = document.getElementById(button.dataset.target)
    details.open = true
    details.querySelector('textarea').focus()
    return
  }
  if (button.dataset.confirm && !confirm(button.dataset.confirm)) return
  try {
    await act(button.dataset.do, JSON.parse(button.dataset.args || '{}'))
    await refresh()
  } catch (error) {
    show(error.message)
  }
})

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-do]')
  if (!form) return
  event.preventDefault()
  const body = { ...JSON.parse(form.dataset.args || '{}'), ...Object.fromEntries(new FormData(form)) }
  const button = form.querySelector('button')
  if (button) button.disabled = true
  try {
    await act(form.dataset.do, body)
    if (!form.dataset.keep) form.reset()
    const details = form.closest('details')
    if (details) details.open = false
    document.activeElement.blur()
    pending = false
    await refresh(form.classList.contains('composer'))
  } catch (error) {
    show(error.message)
  } finally {
    if (button) button.disabled = false
  }
})

document.addEventListener('keydown', (event) => {
  const field = event.target
  if (event.key === 'Escape' && field.closest('details[open]')) field.closest('details').open = false
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !field.matches('textarea[data-enter]')) return
  event.preventDefault()
  field.form.requestSubmit()
})

if (feed && feed.dataset.live !== 'off') {
  const channel = feed.dataset.live
  const source = new EventSource('/events' + (channel ? '?channel=' + encodeURIComponent(channel) : ''))
  let timer
  source.onopen = () => {
    live.className = 'live on'
    live.lastChild.textContent = 'live'
  }
  source.onerror = () => {
    live.className = 'live'
    live.lastChild.textContent = 'reconnecting'
  }
  source.onmessage = () => {
    clearTimeout(timer)
    timer = setTimeout(() => refresh(), 150)
  }
}
`
