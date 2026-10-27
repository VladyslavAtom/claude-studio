/**
 * Which colour a project marks the window with.
 *
 * A project opened from now on is given the first colour no open project has. One opened before
 * colours existed carries none, and gets one derived from its path — stable across starts and tab
 * reorders, and nothing is written to the state on its behalf: absent stays «never chosen».
 */
import { PROJECT_COLORS, type Project, type ProjectColor } from '../../../shared/types'

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

export function colorOf(project: Pick<Project, 'color' | 'path'>): ProjectColor {
  // the state file is read unvalidated: a name we do not know is treated as never chosen
  const chosen = PROJECT_COLORS.find((c) => c === project.color)
  return chosen ?? PROJECT_COLORS[hash(project.path) % PROJECT_COLORS.length] ?? 'blue'
}

/** the first colour none of `projects` shows; when all are taken, the least used one */
export function freeColor(projects: readonly Pick<Project, 'color' | 'path'>[]): ProjectColor {
  const used = new Map<ProjectColor, number>()
  for (const p of projects) used.set(colorOf(p), (used.get(colorOf(p)) ?? 0) + 1)
  let best: ProjectColor = PROJECT_COLORS[0]
  for (const c of PROJECT_COLORS) if ((used.get(c) ?? 0) < (used.get(best) ?? 0)) best = c
  return best
}

/** the token, for a `style` attribute: the value itself lives in the theme */
export function colorVar(color: ProjectColor): string {
  return `var(--project-${color})`
}
