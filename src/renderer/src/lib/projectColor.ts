/**
 * Which colour a project marks the window with.
 *
 * A colour picked from the tab menu wins. Otherwise the colour comes from the project's name: a
 * hue on a fixed lightness and chroma per theme (`--project-l`, `--project-c`), so every project
 * gets its own colour while all of them stay as muted as the picked ones. Nothing is written to
 * the state for it: absent stays «never chosen», and a rename recolours the project.
 */
import { PROJECT_COLORS, type Project, type ProjectColor } from '../../../shared/types'

type Colored = Pick<Project, 'id' | 'name' | 'color'>

/** where each picked colour sits on the hue circle, so a derived one keeps away from it */
const PICKED_HUE: Record<ProjectColor, number> = {
  blue: 250,
  teal: 185,
  green: 140,
  olive: 105,
  amber: 75,
  terracotta: 40,
  pink: 350,
  violet: 290,
}

/** FNV-1a: a short name still lands anywhere on the circle */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h
}

export function nameHue(name: string): number {
  return hash(name.trim().toLowerCase()) % 360
}

export function picked(project: Pick<Project, 'color'>): ProjectColor | undefined {
  // the state file is read unvalidated: a name we do not know is treated as never chosen
  return PROJECT_COLORS.find((c) => c === project.color)
}

function distance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * The hue of every project without a picked colour. Two names can hash close together, and two
 * near hues side by side are the confusion this exists to end: a project whose hue is too near
 * one already taken moves to the nearest hue that is far enough, or failing that the farthest.
 * Projects are taken in id order, which no reorder changes, so a project moves only when one
 * that collides with it opens or closes.
 */
export function derivedHues(projects: readonly Colored[]): Map<string, number> {
  const taken = projects.flatMap((p) => {
    const c = picked(p)
    return c ? [PICKED_HUE[c]] : []
  })
  const free = projects.filter((p) => !picked(p)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const gap = Math.min(40, 300 / Math.max(projects.length, 1))
  const out = new Map<string, number>()
  for (const p of free) {
    const want = nameHue(p.name)
    const room = (h: number): number => Math.min(360, ...taken.map((t) => distance(h, t)))
    let best = want
    for (let step = 0; step <= 180; step += 5) {
      const near = [(want + step) % 360, (want - step + 360) % 360].find((h) => room(h) >= gap)
      if (near !== undefined) {
        best = near
        break
      }
      if (room((want + step) % 360) > room(best)) best = (want + step) % 360
    }
    taken.push(best)
    out.set(p.id, best)
  }
  return out
}

/** the CSS colour, for a `style` attribute: lightness and chroma live in the theme */
export function colorVar(color: ProjectColor): string {
  return `var(--project-${color})`
}

export function hueVar(hue: number): string {
  return `oklch(var(--project-l) var(--project-c) ${hue})`
}

/** every project's CSS colour by id */
export function projectColors(projects: readonly Colored[]): Map<string, string> {
  const hues = derivedHues(projects)
  return new Map(
    projects.map((p) => {
      const c = picked(p)
      return [p.id, c ? colorVar(c) : hueVar(hues.get(p.id) ?? nameHue(p.name))]
    }),
  )
}
