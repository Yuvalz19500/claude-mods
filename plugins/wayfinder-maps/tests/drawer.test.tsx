import { describe, expect, test } from 'claude-code/testing'

import { FILES, dirs } from './fixtures'

const PANE: any = { title: 'Wayfinder', isFocused: false, bodyColumns: 70, placement: 'dock' }
const BAND: any = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 }
const MAP = 'open:md:.scratch/design'
const SPEC = 'open:md:.scratch/build'
const TICKET_2 = 't:R/.scratch/design/issues/02-direction.md'

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

    test('one press each: open a map, open a ticket, close it, go back', async ($, on) => {
      fakeHost(on)
      const ui = await $.ui.mount({ plugin: 'wayfinder-maps', surface, component: 'Pane', requestId: 'wayfinder', props: PANE })
      await ui.press({ key: 'refresh' })

      await ui.press({ key: MAP })
      expect(await keys(ui)).toContain('back')
      expect(await ui.find({ text: /Design: from plan to approved design/ })).toBeDefined()

      await ui.press({ key: TICKET_2 })
      expect(await keys(ui)).toContain(`work:R/.scratch/design/issues/02-direction.md`)
      expect(await ui.find({ text: /Which direction\?/ })).toBeDefined()

      await ui.press({ key: TICKET_2 })
      expect(await keys(ui)).not.toContain(`work:R/.scratch/design/issues/02-direction.md`)

      await ui.press({ key: 'back' })
      expect(await keys(ui)).not.toContain('back')
      expect(await keys(ui)).toContain(MAP)
    })

    test('the filters narrow the tree', async ($, on) => {
      fakeHost(on)
      const ui = await $.ui.mount({ plugin: 'wayfinder-maps', surface, component: 'Pane', requestId: 'wayfinder', props: PANE })
      await ui.press({ key: 'refresh' })
      await ui.press({ key: MAP })
      const tickets = async () => (await keys(ui)).filter(k => k.startsWith('t:')).length
      expect(await tickets()).toBe(4)
      await ui.press({ key: 'filter:unresolved' })
      expect(await tickets()).toBe(3)
      await ui.press({ key: 'filter:frontier' })
      expect(await tickets()).toBe(1)
      await ui.press({ key: 'filter:all' })
      expect(await tickets()).toBe(4)
    })

    test('Work buttons send the configured prompts', async ($, on) => {
      const host = fakeHost(on)
      const ui = await $.ui.mount({ plugin: 'wayfinder-maps', surface, component: 'Pane', requestId: 'wayfinder', props: PANE })
      await ui.press({ key: 'refresh' })
      await ui.press({ key: MAP })
      await ui.press({ key: 'work-map' })
      await ui.press({ key: TICKET_2 })
      await ui.press({ key: 'work:R/.scratch/design/issues/02-direction.md' })
      await ui.press({ key: 'back' })
      await ui.press({ key: SPEC })
      await ui.press({ key: 't:R/.scratch/build/issues/02-store.md' })
      await ui.press({ key: 'work:R/.scratch/build/issues/02-store.md' })
      expect(host.sent).toEqual([
        '/mattpocock-skills:wayfinder .scratch/design/map.md',
        '/mattpocock-skills:wayfinder .scratch/design/map.md .scratch/design/issues/02-direction.md',
        '/mattpocock-skills:implement .scratch/build/issues/02-store.md',
      ])
    })

    if (surface === 'desktop') {
      test('draws the dependency graph', async ($, on) => {
        fakeHost(on)
        const ui = await $.ui.mount({ plugin: 'wayfinder-maps', surface, component: 'Pane', requestId: 'wayfinder', props: PANE })
        await ui.press({ key: 'refresh' })
        await ui.press({ key: MAP })
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
      })
    } else {
      test('draws no graph, only the tree', async ($, on) => {
        fakeHost(on)
        const ui = await $.ui.mount({ plugin: 'wayfinder-maps', surface, component: 'Pane', requestId: 'wayfinder', props: PANE })
        await ui.press({ key: 'refresh' })
        await ui.press({ key: MAP })
        expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      })
    }
  })
}

describe('band above the prompt', () => {
  test('hidden until maps are found, then offers the drawer, and hides while it is open', async ($, on) => {
    fakeHost(on)
    const band = await $.ui.mount({ plugin: 'wayfinder-maps', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect(await band.find({ key: 'open-drawer' })).toBeUndefined()

    const pane = await $.ui.mount({ plugin: 'wayfinder-maps', surface: 'desktop', component: 'Pane', requestId: 'wayfinder', props: PANE })
    await pane.press({ key: 'refresh' })
    await band.redraw()
    expect(await band.find({ key: 'open-drawer' })).toBeDefined()
    expect(await band.find({ text: /1 map · 1 spec · 2 ready to take/ })).toBeDefined()

    await band.press({ key: 'open-drawer' })
    await band.redraw()
    expect(await band.find({ key: 'open-drawer' })).toBeUndefined()
  })
})
