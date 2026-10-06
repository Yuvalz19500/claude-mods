import type { WfStatus, WfTicket } from '../types'

/**
 * Each status's color and glyph: the only color the drawer adds to the
 * surface's own theme. Mid-tone hues, legible on light and dark alike.
 */
export const STATUS_STYLE: Record<WfStatus, { fill: string; label: string; glyph: string }> = {
  open: { fill: '#e8702a', label: 'frontier', glyph: '⚑' },
  claimed: { fill: '#4a86e8', label: 'claimed', glyph: '◐' },
  waiting: { fill: '#d4a017', label: 'waiting on you', glyph: '◷' },
  blocked: { fill: '#8a8f98', label: 'blocked', glyph: '◌' },
  done: { fill: '#3fa36b', label: 'done', glyph: '✓' },
  dropped: { fill: '#8a8f98', label: 'out of scope', glyph: '✕' },
}

/** Layer = longest chain of blockers above it, within the shown set. */
export function layers(tickets: WfTicket[]): Map<number, number> {
  const byNum = new Map(tickets.map(t => [t.num, t]))
  const memo = new Map<number, number>()
  const visit = (num: number, seen: Set<number>): number => {
    if (memo.has(num)) return memo.get(num)!
    if (seen.has(num)) return 0
    seen.add(num)
    const t = byNum.get(num)!
    const parents = t.blockedBy.filter(n => byNum.has(n))
    const layer = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(p => visit(p, seen)))
    seen.delete(num)
    memo.set(num, layer)
    return layer
  }
  for (const t of tickets) visit(t.num, new Set())
  return memo
}

/** The tickets a ticket blocks: what opens up once it is done. */
export function dependents(tickets: WfTicket[], num: number): WfTicket[] {
  return tickets.filter(t => t.blockedBy.includes(num))
}

export const CARD_MIN = 30
export const CARD_MAX = 52
export const CARD_GAP = 2

/**
 * How many cards fit across `columns` cells and how wide each is: as many as
 * fit at CARD_MIN, widened to share the row, one full-width card when narrow.
 */
export function cardLayout(columns: number): { perRow: number; cardWidth: number; gap: number } {
  const perRow = Math.max(1, Math.floor((columns + CARD_GAP) / (CARD_MIN + CARD_GAP)))
  const cardWidth = Math.min(CARD_MAX, Math.floor((columns - CARD_GAP * (perRow - 1)) / perRow))
  return { perRow, cardWidth: Math.max(Math.min(columns, CARD_MIN), cardWidth), gap: CARD_GAP }
}

/**
 * The same graph as an indented tree: each ticket under the first ticket that
 * blocks it, later mentions as a pointer back. Rows in display order.
 */
export function treeRows(tickets: WfTicket[]): { ticket: WfTicket; depth: number; isRepeat: boolean; extraParents: number[] }[] {
  const shown = new Set(tickets.map(t => t.num))
  const children = new Map<number, WfTicket[]>()
  const roots: WfTicket[] = []
  for (const t of tickets) {
    const parents = t.blockedBy.filter(n => shown.has(n))
    if (parents.length === 0) roots.push(t)
    else for (const p of parents) children.set(p, [...(children.get(p) ?? []), t])
  }
  const rows: { ticket: WfTicket; depth: number; isRepeat: boolean; extraParents: number[] }[] = []
  const placed = new Set<number>()
  const walk = (t: WfTicket, depth: number, parent: number | null) => {
    if (placed.has(t.num)) {
      rows.push({ ticket: t, depth, isRepeat: true, extraParents: [] })
      return
    }
    placed.add(t.num)
    const extraParents = t.blockedBy.filter(n => shown.has(n) && n !== parent)
    rows.push({ ticket: t, depth, isRepeat: false, extraParents })
    for (const c of children.get(t.num) ?? []) walk(c, depth + 1, t.num)
  }
  for (const r of roots) walk(r, 0, null)
  // Cycles leave tickets unplaced: show them at the top level.
  for (const t of tickets) if (!placed.has(t.num)) walk(t, 0, null)
  return rows
}
