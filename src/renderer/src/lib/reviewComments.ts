/**
 * Review comments: notes the person leaves on lines of a diff's new side, gathered per session
 * and sent to that session's agent as one prompt.
 *
 * Pure on purpose — the store's reducer and the prompt are tested without a DOM. The comments
 * live in memory only (`state/ReviewProvider`); see docs/decisions.md for why they are not saved.
 */
import type { EditorState } from '@codemirror/state'

export interface ReviewComment {
  id: string
  /** the directory the diff was taken in, and the file's path inside it */
  cwd: string
  path: string
  /** 1-based lines of the working file, inclusive */
  from: number
  to: number
  /** the lines as they were when the comment was made: what the person was looking at */
  code: string
  text: string
}

/** comments by session id; a session without comments has no entry */
export type ReviewStore = Readonly<Record<string, readonly ReviewComment[]>>

export type ReviewAction =
  | { type: 'added'; sessionId: string; comment: ReviewComment }
  | { type: 'edited'; sessionId: string; id: string; text: string }
  | { type: 'removed'; sessionId: string; ids: readonly string[] }

function withList(store: ReviewStore, sessionId: string, list: readonly ReviewComment[]): ReviewStore {
  const next: Record<string, readonly ReviewComment[]> = { ...store }
  if (list.length) next[sessionId] = list
  else delete next[sessionId]
  return next
}

export function reviewReducer(store: ReviewStore, action: ReviewAction): ReviewStore {
  const list = store[action.sessionId] ?? []
  switch (action.type) {
    case 'added':
      return withList(store, action.sessionId, [...list, action.comment])
    case 'edited': {
      if (!list.some((c) => c.id === action.id)) return store
      return withList(
        store,
        action.sessionId,
        list.map((c) => (c.id === action.id ? { ...c, text: action.text } : c)),
      )
    }
    case 'removed': {
      const drop = new Set(action.ids)
      const kept = list.filter((c) => !drop.has(c.id))
      return kept.length === list.length ? store : withList(store, action.sessionId, kept)
    }
  }
}

/** by file, then by line: the order a reviewer reads a diff in */
export function sortComments(list: readonly ReviewComment[]): ReviewComment[] {
  return [...list].sort((a, b) => {
    const byFile = a.cwd === b.cwd ? a.path.localeCompare(b.path) : a.cwd.localeCompare(b.cwd)
    return byFile || a.from - b.from || a.to - b.to
  })
}

/** a code fence longer than any run of backticks inside the code, so the code cannot close it */
export function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** where a comment points, as the agent in `sessionCwd` would name the file */
export function locationOf(c: ReviewComment, sessionCwd: string): string {
  const file = c.cwd === sessionCwd ? c.path : `${c.cwd.replace(/\/+$/, '')}/${c.path}`
  return c.from === c.to ? `${file}:${c.from}` : `${file}:${c.from}-${c.to}`
}

/**
 * The prompt, in English: it is read by the agent, not by the person, and like the other prompts
 * of this app it is not localised. Plain text with the quoted lines in fences — the shape agents
 * already read in code review — numbered so the answer can refer to "comment 2".
 */
export function formatReviewPrompt(comments: readonly ReviewComment[], sessionCwd: string): string {
  const sorted = sortComments(comments)
  const blocks = sorted.map((c, i) => {
    const fence = fenceFor(c.code)
    const code = c.code.replace(/\r\n?/g, '\n')
    const text = c.text.replace(/\r\n?/g, '\n').trim()
    return `${i + 1}. ${locationOf(c, sessionCwd)}\n${fence}\n${code}\n${fence}\n${text}`
  })
  const head = `Review comments on your changes (${sorted.length}). Address each one; the quoted lines are the working file as the reviewer saw it.`
  return [head, ...blocks].join('\n\n')
}

/** the lines a gutter click on `line` comments: the selection's, when the click is inside it */
export function clickedRange(state: EditorState, line: number): { from: number; to: number } {
  const sel = state.selection.main
  if (sel.empty) return { from: line, to: line }
  const doc = state.doc
  const first = doc.lineAt(sel.from).number
  const end = doc.lineAt(sel.to)
  // a selection ending at the very start of a line does not take that line
  const last = end.from === sel.to && end.number > first ? end.number - 1 : end.number
  return line >= first && line <= last ? { from: first, to: last } : { from: line, to: line }
}

/**
 * What a send did: typed into a live agent tab; woke a sleeping one, which has to start before it
 * can read a paste (the comments are kept); or found no agent tab that can take them.
 */
export type ReviewSendOutcome = 'sent' | 'starting' | 'no-agent'
