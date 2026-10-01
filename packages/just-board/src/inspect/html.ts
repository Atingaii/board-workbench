/** Markup that's already safe. Everything else interpolated into `html` is escaped. */
export class Html {
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
  toString(): string {
    return this.value
  }
}

type Part = Html | string | number | null | undefined | false | readonly Part[]

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!)

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return ''
  if (part instanceof Html) return part.value
  if (Array.isArray(part)) return part.map(render).join('')
  return escape(String(part))
}

/** A template that escapes every interpolation; arrays and `null`/`false` render naturally. */
export function html(strings: TemplateStringsArray, ...parts: Part[]): Html {
  let out = strings[0]!
  parts.forEach((part, i) => {
    out += render(part) + strings[i + 1]!
  })
  return new Html(out)
}

export const raw = (value: string): Html => new Html(value)
