import { describe, expect, test } from 'claude-code/testing'

import { counts, finishTickets, mapStatus, normalizeStatus, parseHeadDoc, parseTicketFile } from '../hooks/parse'

describe('normalizeStatus', () => {
  test('folds the trackers’ words into five states', () => {
    expect(normalizeStatus('resolved')).toBe('done')
    expect(normalizeStatus('Done')).toBe('done')
    expect(normalizeStatus('closed')).toBe('done')
    expect(normalizeStatus('claimed')).toBe('claimed')
    expect(normalizeStatus('in-progress')).toBe('claimed')
    expect(normalizeStatus('awaiting-design')).toBe('waiting')
    expect(normalizeStatus('ready-for-human')).toBe('waiting')
    expect(normalizeStatus('out of scope')).toBe('dropped')
    expect(normalizeStatus('ready-for-agent')).toBe('open')
    expect(normalizeStatus('open')).toBe('open')
    expect(normalizeStatus('')).toBe('open')
  })
})

describe('parseTicketFile', () => {
  test('reads the plain header lines of a wayfinder ticket', () => {
    const t = parseTicketFile(
      '09-verdict-on-screen.md',
      'R/issues/09-verdict-on-screen.md',
      '# Verdict: what the Validate screen shows\n\nType: grilling\nStatus: resolved\nBlocked by: 03\nAssignee: Yuval (claimed 2026-10-01)\n\n## Question\n\nBlocked by: 99 must not count',
    )!
    expect(t.num).toBe(9)
    expect(t.ref).toBe('09')
    expect(t.title).toBe('Verdict: what the Validate screen shows')
    expect(t.type).toBe('grilling')
    expect(t.rawStatus).toBe('resolved')
    expect(t.blockedBy).toEqual([3])
    expect(t.assignee).toBe('Yuval (claimed 2026-10-01)')
  })

  test('reads bold fields and a listed Blocked by, and drops the number from the title', () => {
    const t = parseTicketFile(
      '109-ripple-engine.md',
      'p',
      '# 109 — Ripple engine\n\n**What to build:** stuff\n\n**Blocked by:**\n\n- 106 — Versions\n- 108 — Project graph\n\n**Status:** ready-for-agent\n\n- [ ] a check',
    )!
    expect(t.title).toBe('Ripple engine')
    expect(t.blockedBy).toEqual([106, 108])
    expect(t.rawStatus).toBe('ready-for-agent')
  })

  test('reads comma lists, GitHub-style numbers and none', () => {
    expect(parseTicketFile('04-a.md', 'p', '# A\nBlocked by: 02, 03')!.blockedBy).toEqual([2, 3])
    expect(parseTicketFile('04-a.md', 'p', '# A\nBlocked by: #12 and #13')!.blockedBy).toEqual([12, 13])
    expect(parseTicketFile('04-a.md', 'p', '# A\nBlocked by: none')!.blockedBy).toEqual([])
    expect(parseTicketFile('10-a.md', 'p', '# 10 · Pack builder\nBlocked by: 7')!.title).toBe('Pack builder')
  })

  test('skips files that are not numbered tickets, and design briefs', () => {
    expect(parseTicketFile('notes.md', 'p', '# x')).toBeNull()
    expect(parseTicketFile('05-a.brief.md', 'p', '# x')).toBeNull()
  })

  test('falls back to the file name for the title', () => {
    expect(parseTicketFile('07-model-registry.md', 'p', 'Status: open')!.title).toBe('model registry')
  })
})

describe('parseHeadDoc', () => {
  test('reads the map title and its own status', () => {
    expect(parseHeadDoc('# Map · Pack Factory\n\nLabel: wayfinder:map')).toEqual({ title: 'Pack Factory', status: undefined })
    expect(parseHeadDoc('# Firstloom\n\nStatus: done').status).toBe('done')
  })
})

describe('finishTickets', () => {
  const base = { id: '', ref: '', title: '', path: '' }
  const t = (num: number, rawStatus: string, blockedBy: number[] = [], assignee?: string) => ({ ...base, num, rawStatus, blockedBy, assignee })

  test('marks blocked, claimed and frontier tickets', () => {
    const out = finishTickets([t(3, 'open', [1, 2]), t(1, 'resolved'), t(2, 'open', [1]), t(4, 'open', [], 'Yuval'), t(5, 'open', [99])])
    const by = Object.fromEntries(out.map(x => [x.num, x]))
    expect(out.map(x => x.num)).toEqual([1, 2, 3, 4, 5])
    expect(by[1]!.status).toBe('done')
    expect(by[2]!.status).toBe('open')
    expect(by[2]!.isFrontier).toBe(true)
    expect(by[3]!.status).toBe('blocked')
    expect(by[3]!.isFrontier).toBe(false)
    expect(by[4]!.status).toBe('claimed')
    // A blocker outside the map does not block.
    expect(by[5]!.status).toBe('open')
  })

  test('an out-of-scope blocker does not block', () => {
    const out = finishTickets([t(1, 'out of scope'), t(2, 'open', [1])])
    expect(out[1]!.status).toBe('open')
  })

  test('a closed GitHub issue counts as done whatever its text says', () => {
    const out = finishTickets([{ ...t(1, 'open'), closedAs: 'done' as const }])
    expect(out[0]!.status).toBe('done')
  })
})

describe('mapStatus and counts', () => {
  const tk = (status: 'done' | 'open' | 'claimed' | 'blocked' | 'waiting' | 'dropped') =>
    ({ id: '', num: 1, ref: '', title: '', rawStatus: '', status, isFrontier: status === 'open', blockedBy: [] })

  test('derives the map status', () => {
    expect(mapStatus('map', [tk('done'), tk('done')], undefined, false)).toBe('done')
    expect(mapStatus('map', [tk('done'), tk('open')], undefined, false)).toBe('active')
    expect(mapStatus('map', [tk('open')], undefined, false)).toBe('open')
    expect(mapStatus('map', [tk('open')], undefined, true)).toBe('graduated')
    expect(mapStatus('spec', [tk('open')], undefined, true)).toBe('open')
    expect(mapStatus('map', [tk('open')], 'closed', false)).toBe('done')
    expect(mapStatus('map', [], undefined, false)).toBe('open')
  })

  test('counts each state, leaving out-of-scope tickets out', () => {
    expect(counts([tk('done'), tk('open'), tk('claimed'), tk('blocked'), tk('waiting'), tk('dropped')])).toEqual({
      total: 5,
      done: 1,
      claimed: 1,
      waiting: 1,
      blocked: 1,
      frontier: 1,
    })
  })
})
