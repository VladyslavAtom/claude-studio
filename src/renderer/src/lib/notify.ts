import type { NotificationConfig } from '../../../shared/types'

let ctx: AudioContext | null = null

/**
 * The browser lets nothing sound until the user has pressed something: the context is created
 * suspended and stays silent. So it is woken on the very first action in the window — otherwise
 * the first call is lost and the next one sounds late.
 */
if (typeof window !== 'undefined') {
  const wake = (): void => {
    try {
      ctx = ctx ?? new AudioContext()
      if (ctx.state === 'suspended') void ctx.resume()
    } catch {
      /* the system has no sound */
    }
  }
  window.addEventListener('pointerdown', wake, { once: true })
  window.addEventListener('keydown', wake, { once: true })
}

/** short two-tone chime, synthesised so the app carries no audio assets */
export function playChime(): void {
  try {
    ctx = ctx ?? new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.12
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.18)
    }
  } catch {
    /* audio unavailable — the visual badge is still there */
  }
}

export async function notifyAttention(
  cfg: NotificationConfig,
  opts: { title: string; body: string; tabActive: boolean },
): Promise<void> {
  if (!cfg.enabled) return
  const focused = await window.api.system.isFocused()
  // an active tab in a focused window needs no interruption: the user is looking at it
  if (focused && opts.tabActive) return
  if (cfg.onlyWhenUnfocused && focused) return
  if (cfg.sound) playChime()
  void window.api.system.notify(opts.title, opts.body)
}
