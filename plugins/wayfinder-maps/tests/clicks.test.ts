import { describe, expect, test } from 'claude-code/testing'

import { ClickGate, ECHO_MS } from '../hooks/clicks'

const desktop = (key: string | undefined, now: number) => ({ key, isPerson: true, isDesktop: true, now })

describe('ClickGate', () => {
  test('desktop: the click that focuses a button runs it once', () => {
    const g = new ClickGate()
    expect(g.focus(desktop('open:a', 0))).toBe(true)
  })

  test('desktop: a redraw re-seating the focus on the same button runs nothing', () => {
    const g = new ClickGate()
    g.focus(desktop('t:1', 0))
    expect(g.focus(desktop('t:1', 2000))).toBe(false)
  })

  test('desktop: a press echoing the focus click runs nothing', () => {
    const g = new ClickGate()
    g.focus(desktop('t:1', 0))
    expect(g.press('t:1', 50)).toBe(false)
  })

  test('desktop: losing then regaining the focus at once runs nothing', () => {
    const g = new ClickGate()
    g.focus(desktop('t:1', 0))
    g.focus(desktop(undefined, 10))
    expect(g.focus(desktop('t:1', 20))).toBe(false)
  })

  test('desktop: a later click on the focused button presses it again', () => {
    const g = new ClickGate()
    g.focus(desktop('t:1', 0))
    expect(g.press('t:1', ECHO_MS + 1)).toBe(true)
  })

  test('desktop: focusing another button runs that one', () => {
    const g = new ClickGate()
    g.focus(desktop('t:1', 0))
    expect(g.focus(desktop('t:2', 10))).toBe(true)
  })

  test('terminal: focus never runs anything, every press does', () => {
    const g = new ClickGate()
    expect(g.focus({ key: 'back', isPerson: true, isDesktop: false, now: 0 })).toBe(false)
    expect(g.press('back', 1)).toBe(true)
    expect(g.press('open:a', 2)).toBe(true)
  })

  test('a plugin’s own focus move runs nothing', () => {
    const g = new ClickGate()
    expect(g.focus({ key: 'back', isPerson: false, isDesktop: true, now: 0 })).toBe(false)
  })
})
