/** `good first issue` → `good-first-issue`: the part of a label key a name gives. Empty when nothing's left. */
export const slug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[-_.]+|-+$/g, '')

/**
 * A platform's label or assignee as a board label: `bug` → `tag.bug=bug`,
 * `julianbenegas` → `assignee.julianbenegas=julianbenegas`. The keys don't
 * name the platform, so a filter like `--label tag.bug` holds for any of them.
 */
export function tagOf(prefix: 'tag' | 'assignee', name: string | undefined | null): [string, string] | null {
  const key = name ? slug(name) : ''
  return key ? [`${prefix}.${key}`.slice(0, 64), name!.slice(0, 256)] : null
}
