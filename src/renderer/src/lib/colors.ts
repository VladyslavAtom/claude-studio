/** agent badges are told apart by eye, so a new colour is picked far from the ones already taken */
function hueOf(hex: string): number | null {
  const [, digits] = /^#([0-9a-f]{6})$/i.exec(hex.trim()) ?? []
  if (!digits) return null
  const int = parseInt(digits, 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return null
  const d = max - min
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

/** s and l arrive as percentages: the formula needs fractions, or a channel goes negative */
function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    const byte = Math.max(0, Math.min(255, Math.round(255 * c)))
    return byte.toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Colour for a new badge: saturated and light enough to read on a dark background, and set
 * apart in hue from the ones already in use.
 */
export function pickAgentColor(taken: string[]): string {
  const usedHues = taken.map(hueOf).filter((h): h is number => h !== null)
  const distance = (h: number): number =>
    usedHues.length === 0 ? 360 : Math.min(...usedHues.map((u) => Math.min(Math.abs(h - u), 360 - Math.abs(h - u))))

  let best = Math.random() * 360
  let bestDistance = -1
  for (let i = 0; i < 48; i++) {
    const h = Math.random() * 360
    const d = distance(h)
    if (d > bestDistance) {
      best = h
      bestDistance = d
    }
    if (bestDistance > 45) break
  }
  const saturation = 62 + Math.random() * 20
  const lightness = 62 + Math.random() * 10
  return hslToHex(best, saturation, lightness)
}
