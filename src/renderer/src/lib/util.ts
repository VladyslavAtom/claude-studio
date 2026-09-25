export function uid(): string {
  return crypto.randomUUID()
}

export function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

export function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/g, '/')
}

/** "src/lib/jwt.ts" -> ["src/lib/", "jwt.ts"]; the directory part is what gets truncated in lists */
export function splitPath(path: string): [string, string] {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? ['', path] : [path.slice(0, idx + 1), path.slice(idx + 1)]
}

export function slugify(input: string): string {
  const translit: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  return (
    input
      .toLowerCase()
      .split('')
      .map((ch) => translit[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session'
  )
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Reorder in place for drag-and-drop lists. Lives here rather than next to the drag handlers:
 * the reducer reorders projects, sessions and tabs, and must not pull DOM types in to do it.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  // splice back what splice took out: indexing the removed slice would type as possibly missing,
  // and an `items[from]!` would be a claim about bounds instead of the check made just above
  const moved = next.splice(from, 1)
  next.splice(to, 0, ...moved)
  return next
}
