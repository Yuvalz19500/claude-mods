/**
 * Decides which focus moves and presses run a Button's action.
 *
 * The desktop app gives a Button the focus on the first click and presses it
 * only on a second one. So on desktop a person's focus move onto one of our
 * buttons runs its action, and the gate keeps each click to one action:
 *
 * - focus landing again on the button that already holds the ring (a redraw
 *   re-seating it) runs nothing;
 * - a press, or a repeat focus, on a button whose action ran in the last
 *   ECHO_MS runs nothing (one click raising both events).
 */
export const ECHO_MS = 600

export type GateFocus = { key: string | undefined; isPerson: boolean; isDesktop: boolean; now: number }

export class ClickGate {
  private ring: string | undefined
  private last = { key: '', at: -Infinity }

  /** True when this focus move should run the button's action. */
  focus({ key, isPerson, isDesktop, now }: GateFocus): boolean {
    const previous = this.ring
    this.ring = key
    if (!key || !isPerson || !isDesktop) return false
    if (key === previous) return false
    if (this.isEcho(key, now)) return false
    this.last = { key, at: now }
    return true
  }

  /** True when this press should run the button's action. */
  press(key: string, now: number): boolean {
    this.ring = key
    if (this.isEcho(key, now)) return false
    this.last = { key, at: now }
    return true
  }

  private isEcho(key: string, now: number): boolean {
    return this.last.key === key && now - this.last.at < ECHO_MS
  }
}
