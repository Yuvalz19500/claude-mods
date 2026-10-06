import { describe, expect, test } from 'claude-code/testing'

import { absolutizeLinks, fileUrl, resolvePath, stripHeaderFields, wrapLines } from '../hooks/text'

describe('stripHeaderFields', () => {
  test('drops the tracker lines above the first section, keeps the rest', () => {
    const body = 'Type: research\nStatus: resolved\nBlocked by: 03\nAssignee: Yuval\n\n## Question\n\nStatus: inside a section stays'
    expect(stripHeaderFields(body)).toBe('## Question\n\nStatus: inside a section stays')
  })

  test('drops a bold Blocked by with its list, keeps other bold lines', () => {
    const body = '**What to build:** a store.\n\n**Blocked by:**\n\n- 01 — Scaffold\n- 02 — Other\n\n**Status:** ready-for-agent\n\n- [ ] a check'
    expect(stripHeaderFields(body)).toBe('**What to build:** a store.\n\n- [ ] a check')
  })
})

describe('resolvePath and fileUrl', () => {
  test('resolves . and .. against a Windows folder', () => {
    expect(resolvePath('C:\\r\\.scratch\\m\\issues', '../../../planning/T12.md')).toBe('C:/r/planning/T12.md')
    expect(resolvePath('C:/r/issues', './03-a.md')).toBe('C:/r/issues/03-a.md')
  })

  test('encodes spaces and a hash', () => {
    expect(fileUrl('C:\\My Repos\\a#b.md')).toBe('file:///C:/My%20Repos/a%23b.md')
  })
})

describe('absolutizeLinks', () => {
  test('turns relative links into file links and lists them', () => {
    const { text, links } = absolutizeLinks(
      'See [the gate](03-gate.md), [`research/x.md`](../research/x.md "notes") and [web](https://a.dev) or [here](#q).',
      'C:/r/.scratch/m/issues/04-crdt.md',
    )
    expect(text).toBe(
      'See [the gate](file:///C:/r/.scratch/m/issues/03-gate.md), [`research/x.md`](file:///C:/r/.scratch/m/research/x.md "notes") and [web](https://a.dev) or [here](#q).',
    )
    expect(links.map(l => l.path)).toEqual(['C:/r/.scratch/m/issues/03-gate.md', 'C:/r/.scratch/m/research/x.md'])
  })

  test('keeps an anchor and decodes an encoded name', () => {
    const { text, links } = absolutizeLinks('[a](My%20Note.md#part)', 'C:/r/x/t.md')
    expect(links[0]!.path).toBe('C:/r/x/My Note.md')
    expect(text).toBe('[a](file:///C:/r/x/My%20Note.md#part)')
  })
})

describe('wrapLines', () => {
  test('fits a title to the card in whole words', () => {
    expect(wrapLines('Can users connect their own Claude or ChatGPT subscription?', 26, 3)).toEqual([
      'Can users connect their',
      'own Claude or ChatGPT',
      'subscription?',
    ])
  })

  test('a short title stays one line', () => {
    expect(wrapLines('Product name', 26, 3)).toEqual(['Product name'])
  })

  test('cuts the last line with an ellipsis past the line limit', () => {
    const lines = wrapLines('one two three four five six seven eight nine ten eleven twelve', 10, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
    expect(lines.every(l => l.length <= 10)).toBe(true)
  })

  test('cuts a single word longer than the line', () => {
    expect(wrapLines('Supercalifragilisticexpialidocious', 10, 3)).toEqual(['Supercali…'])
  })
})
