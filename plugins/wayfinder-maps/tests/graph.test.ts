import { describe, expect, test } from 'claude-code/testing'

import type { WfStatus, WfTicket } from '../types'
import { graphSvg, layers, treeRows } from '../hooks/graph'

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

describe('graphSvg', () => {
  test('draws one card per ticket, one trail per edge, escaped text', () => {
    const { svg, width, height } = graphSvg([t(1, 'done'), t(2, 'open', [1], 'A <b> & "c"'), t(3, 'claimed', [2])], 600)
    expect(width).toBe(600)
    expect(height).toBeGreaterThan(100)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.match(/class="n /g)?.length).toBe(3)
    expect(svg.match(/class="trail/g)?.length).toBe(2)
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;')
    expect(svg).not.toContain('<b>')
    expect(svg).toContain('STEP 3')
  })

  test('a 150-ticket map stays under the Svg element’s size limit', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      t(i + 1, i % 3 === 0 ? 'done' : 'blocked', i > 1 ? [i, i - 1] : [], 'A fairly long ticket title for size'),
    )
    const g = graphSvg(many, 700)
    expect(g.isTooBig).toBe(false)
    expect(g.svg.length).toBeLessThan(131072)
  })

  test('a huge map says it is too big instead of drawing past the limit', () => {
    const huge = Array.from({ length: 600 }, (_, i) => t(i + 1, 'blocked', i > 0 ? [i] : [], 'A fairly long ticket title for size'))
    expect(graphSvg(huge, 700).isTooBig).toBe(true)
  })
})
