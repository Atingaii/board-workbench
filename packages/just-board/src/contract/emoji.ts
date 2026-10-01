// Short names ↔ characters for the common reactions. Unknown names display as `:name:`.
const EMOJI: Record<string, string> = {
  eyes: '👀',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  '+1': '👍',
  thumbsup: '👍',
  '-1': '👎',
  thumbsdown: '👎',
  heart: '❤️',
  tada: '🎉',
  rocket: '🚀',
  fire: '🔥',
  warning: '⚠️',
  bug: '🐛',
  pray: '🙏',
  raised_hands: '🙌',
  thinking_face: '🤔',
  hourglass: '⌛',
  rotating_light: '🚨',
  ship: '🚢',
}

const BY_CHARACTER = new Map(
  Object.entries(EMOJI).map(([name, character]) => [character.replace(/️/g, ''), name]),
)

/** `eyes`, `:eyes:`, or 👀 → `eyes`. */
export function normalizeEmoji(input: string): string {
  const trimmed = input.trim()
  const named = trimmed.match(/^:?([a-z0-9_+-]+):?$/i)
  if (named) return named[1]!.toLowerCase()
  const name = BY_CHARACTER.get(trimmed.replace(/️/g, ''))
  if (name) return name
  throw new Error(`unknown emoji: ${input} (use a short name like eyes or white_check_mark)`)
}

export const displayEmoji = (name: string): string => EMOJI[name] ?? `:${name}:`
