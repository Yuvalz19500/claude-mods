import { describe, expect, test } from 'claude-code/testing'

import type { WfStatus, WfTicket } from '../types'
import { CARD_MIN, cardLayout, cardRows, dependents, layers, treeRows } from '../hooks/graph'

const t = (num: number, status: WfStatus, blockedBy: number[] = [], title = `Ticket ${num}`): WfTicket => ({
  id: `id${num}`,
  num,
  ref: String(num).padStart(2, '0'),
  title,
  rawStatus: status,
  status,
  isFrontier: status === 'open',
  blockedBy,
})

describe('layers', () => {
  test('puts each ticket one step below its deepest blocker', () => {
    const l = layers([t(1, 'done'), t(2, 'open', [1]), t(3, 'blocked', [1, 2]), t(4, 'open')])
    expect([l.get(1), l.get(2), l.get(3), l.get(4)]).toEqual([0, 1, 2, 0])
  })

  test('survives a cycle', () => {
    const l = layers([t(1, 'open', [2]), t(2, 'open', [1])])
    expect(l.size).toBe(2)
  })
})

describe('treeRows', () => {
  test('nests tickets under their first blocker and marks repeats', () => {
    const rows = treeRows([t(1, 'done'), t(2, 'done'), t(3, 'open', [1, 2])])
    expect(rows.map(r => [r.ticket.num, r.depth, r.isRepeat])).toEqual([
      [1, 0, false],
      [3, 1, false],
      [2, 0, false],
      [3, 1, true],
    ])
    expect(rows[1]!.extraParents).toEqual([2])
  })

  test('shows tickets caught in a cycle at the top level', () => {
    const rows = treeRows([t(1, 'open', [2]), t(2, 'open', [1])])
    expect(rows.filter(r => !r.isRepeat).map(r => r.ticket.num).sort()).toEqual([1, 2])
  })
})

describe('dependents', () => {
  test('lists what a ticket unblocks', () => {
    const all = [t(1, 'done'), t(2, 'open', [1]), t(3, 'blocked', [1, 2]), t(4, 'open')]
    expect(dependents(all, 1).map(x => x.num)).toEqual([2, 3])
    expect(dependents(all, 4)).toEqual([])
  })
})

describe('cardRows', () => {
  test('counts the border, header, title lines and the after line', () => {
    expect(cardRows({ lines: ['Pricing tiers'], after: 'after 10 ◌' })).toBe(5)
    expect(cardRows({ lines: ['Uptime checks: our own or a', 'service?'], after: '' })).toBe(5)
    expect(cardRows({ lines: ['Who is Orbit for?'], after: '' })).toBe(4)
  })
})

describe('cardLayout', () => {
  test('one full-width card in a narrow drawer', () => {
    expect(cardLayout(40)).toEqual({ perRow: 1, cardWidth: 40, gap: 2 })
    expect(cardLayout(20).cardWidth).toBe(20)
  })

  test('several cards across a wide drawer, sharing the row', () => {
    const { perRow, cardWidth, gap } = cardLayout(130)
    expect(perRow).toBe(4)
    expect(cardWidth).toBeGreaterThanOrEqual(CARD_MIN)
    expect(perRow * cardWidth + (perRow - 1) * gap).toBeLessThanOrEqual(130)
  })
})
