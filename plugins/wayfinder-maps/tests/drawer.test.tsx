import { describe, expect, test } from 'claude-code/testing'

import { FILES, dirs } from './fixtures'

const PANE: any = { title: 'Wayfinder', isFocused: false, bodyColumns: 70, placement: 'dock' }
const BAND: any = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 }
const MAP = 'open:md:.scratch/design'
const SPEC = 'open:md:.scratch/build'
const P1 = 'R/.scratch/design/issues/01-look.md'
const P2 = 'R/.scratch/design/issues/02-direction.md'
const P3 = 'R/.scratch/design/issues/03-shell.md'
const STORE = 'R/.scratch/build/issues/02-store.md'

/** The engine resolves paths against the plugin folder; the fake disk is rooted at R. */
const fake = (path: string) => {
  const p = path.replace(/\\/g, '/')
  if (p === 'R' || p.endsWith('/R')) return 'R'
  const i = p.lastIndexOf('/R/')
  return p.startsWith('R/') ? p : i >= 0 ? 'R/' + p.slice(i + 3) : p
}

/** Answers the host calls the drawer makes, from the fake project in fixtures. */
function fakeHost(on: any) {
  const d = dirs()
  const sent: string[] = []
  let now = 1_000
  on('session.root', () => ({ value: 'R' }))
  on('clock.now', () => ({ value: (now += 1000) }))
  on('fs.list', ($: unknown, e: { path: string }) => ({
    value: (d[fake(e.path)] ?? []).map(x => ({ ...x, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', ($: unknown, e: { path: string }) => ({ value: FILES[fake(e.path)] ?? '' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'not a GitHub repo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.scroll', () => ({ value: {} }))
  // What the engine draws in the band when no plugin draws there.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.run', ($: unknown, e: { command: string; args: string }) => {
    sent.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  return { sent }
}

const keys = async (ui: { findAll: (q: object) => Promise<{ key?: string }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => String(b.key))

async function mountPane($: any, surface: 'desktop' | 'terminal', columns = 70) {
  const ui = await $.ui.mount({
    plugin: 'wayfinder-maps',
    surface,
    component: 'Pane',
    requestId: 'wayfinder',
    props: { ...PANE, bodyColumns: columns },
  })
  await ui.press({ key: 'refresh' })
  return ui
}

for (const surface of ['desktop', 'terminal'] as const) {
  describe(`drawer on ${surface}`, () => {
    test('lists the map and the spec after a refresh', async ($, on) => {
      fakeHost(on)
      const ui = await $.ui.mount({ plugin: 'wayfinder-maps', surface, component: 'Pane', requestId: 'wayfinder', props: PANE })
      expect(await ui.find({ text: /Press Refresh/ })).toBeDefined()
      await ui.press({ key: 'refresh' })
      const k = await keys(ui)
      expect(k).toContain(MAP)
      expect(k).toContain(SPEC)
      expect(await ui.find({ text: /Maps · 1/ })).toBeDefined()
      expect(await ui.find({ text: /Specs · 1/ })).toBeDefined()
    })

    test('a map shows its tickets as cards in steps, with no picture', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ text: /^STEP 1$/ })).toBeDefined()
      expect(await ui.find({ text: /^STEP 3$/ })).toBeDefined()
      expect((await keys(ui)).filter(k => k.startsWith('t:') && !k.includes('#'))).toHaveLength(4)
      expect(await ui.find({ text: /after 01/ })).toBeDefined()
    })

    test('one press each: open a map, open a ticket page, back to map, back to all maps', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)

      await ui.press({ key: MAP })
      expect(await keys(ui)).toContain('back')

      await ui.press({ key: `t:${P2}` })
      const page = await keys(ui)
      expect(page).toContain('back-map')
      expect(page).not.toContain('back')
      expect(page).toContain(`work:${P2}`)
      expect(await ui.find({ text: /Which direction\?/ })).toBeDefined()
      expect(await ui.find({ text: /^WAITS ON$/ })).toBeDefined()
      expect(page).toContain(`dep:${P1}`)
      expect(await ui.find({ text: /^UNBLOCKS$/ })).toBeDefined()
      expect(page).toContain(`next:${P3}`)

      await ui.press({ key: 'back-map' })
      expect(await keys(ui)).toContain('back')
      expect(await keys(ui)).toContain(`t:${P2}`)

      await ui.press({ key: 'back' })
      expect(await keys(ui)).not.toContain('back')
      expect(await keys(ui)).toContain(MAP)
    })

    test('a ticket page links to the tickets around it', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await ui.press({ key: `t:${P2}` })
      await ui.press({ key: `next:${P3}` })
      expect(await ui.find({ text: /What shell\?/ })).toBeDefined()
      expect(await keys(ui)).toContain(`dep:${P2}`)
      await ui.press({ key: `dep:${P2}` })
      expect(await ui.find({ text: /Which direction\?/ })).toBeDefined()
    })

    test('a ticket page shows the body without the tracker lines, its links made absolute', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await ui.press({ key: `t:${P3}` })
      expect(await ui.find({ text: /Type: grilling/ })).toBeUndefined()
      expect(await ui.find({ text: /file:\/\/\/R\/\.scratch\/design\/issues\/02-direction\.md/ })).toBeDefined()
    })

    test('a long title wraps onto several clickable lines', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface, 40)
      await ui.press({ key: MAP })
      expect(await keys(ui)).toContain(`t:${P1}#2`)
      await ui.press({ key: `t:${P1}#2` })
      expect(await keys(ui)).toContain('back-map')
    })

    test('the status chips show only that status', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      const k = await keys(ui)
      expect(k).toContain('filter:claimed')
      expect(k).not.toContain('filter:waiting')
      await ui.press({ key: 'filter:claimed' })
      expect((await keys(ui)).filter(x => x.startsWith('t:') && !x.includes('#'))).toEqual([`t:R/.scratch/design/issues/04-name.md`])
      await ui.press({ key: 'filter:done' })
      expect((await keys(ui)).filter(x => x.startsWith('t:') && !x.includes('#'))).toEqual([`t:${P1}`])
    })

    test('a resolved ticket shows its answer and no Work button', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await ui.press({ key: `t:${P1}` })
      expect(await keys(ui)).not.toContain(`work:${P1}`)
      expect(await ui.find({ text: /Dark and dense/ })).toBeDefined()
    })

    test('the filters narrow the tickets, and Tree lists them as a tree', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      const tickets = async () => (await keys(ui)).filter(k => k.startsWith('t:') && !k.includes('#')).length
      expect(await tickets()).toBe(4)
      await ui.press({ key: 'filter:unresolved' })
      expect(await tickets()).toBe(3)
      await ui.press({ key: 'filter:frontier' })
      expect(await tickets()).toBe(1)
      await ui.press({ key: 'layout:tree' })
      expect(await ui.find({ text: /^STEP 1$/ })).toBeUndefined()
      expect(await tickets()).toBe(1)
      await ui.press({ key: 'filter:all' })
      expect(await tickets()).toBe(4)
      await ui.press({ key: 'layout:steps' })
      expect(await ui.find({ text: /^STEP 1$/ })).toBeDefined()
    })

    test('Work buttons run the configured commands', async ($, on) => {
      const host = fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await ui.press({ key: 'work-map' })
      await ui.press({ key: `t:${P2}` })
      await ui.press({ key: `work:${P2}` })
      await ui.press({ key: 'back-map' })
      await ui.press({ key: 'back' })
      await ui.press({ key: SPEC })
      await ui.press({ key: `t:${STORE}` })
      await ui.press({ key: `work:${STORE}` })
      expect(host.sent).toEqual([
        '/mattpocock-skills:wayfinder .scratch/design/map.md',
        '/mattpocock-skills:wayfinder .scratch/design/map.md .scratch/design/issues/02-direction.md',
        '/mattpocock-skills:implement .scratch/build/issues/02-store.md',
      ])
    })
  })
}

describe('steps layout', () => {
  test('a wide drawer puts several cards across a step; a narrow one stacks them', async ($, on) => {
    fakeHost(on)
    const wide = await mountPane($, 'desktop', 140)
    await wide.press({ key: MAP })
    const wideCard = (await wide.findAll({ type: 'Box' })).find(b => String(b.key).startsWith('card:'))
    await wide.unmount()
    // The drawer remembers it was on the map.
    const narrow = await mountPane($, 'desktop', 40)
    const narrowCard = (await narrow.findAll({ type: 'Box' })).find(b => String(b.key).startsWith('card:'))
    expect((wideCard as any)?.props?.width).toBeLessThan(50)
    expect((narrowCard as any)?.props?.width).toBe(38)
  })
})

describe('band above the prompt', () => {
  test('hidden until maps are found, then offers the drawer, and hides while it is open', async ($, on) => {
    fakeHost(on)
    const band = await $.ui.mount({ plugin: 'wayfinder-maps', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect(await band.find({ key: 'open-drawer' })).toBeUndefined()

    await mountPane($, 'desktop')
    await band.redraw()
    expect(await band.find({ key: 'open-drawer' })).toBeDefined()
    expect(await band.find({ text: /^Wayfinder$/ })).toBeDefined()
    expect(await band.find({ text: /1 map · 1 spec · 2 ready to take/ })).toBeDefined()

    await band.press({ key: 'open-drawer' })
    await band.redraw()
    expect(await band.find({ key: 'open-drawer' })).toBeUndefined()
  })
})
