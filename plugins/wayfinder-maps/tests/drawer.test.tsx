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

/** A second frontier ticket for the design map, for "Start all frontier". */
const AUDIENCE = 'R/.scratch/design/issues/06-audience.md'
const MORE: Record<string, string> = { [AUDIENCE]: '# Who is it for?\n\nType: grilling\nStatus: open\n\n## Question\n\nWho?' }

type Run = { argv: string[]; cwd?: string }

/**
 * Answers the host calls the drawer makes, from the fake project in fixtures,
 * on Windows unless `os` says otherwise. `runs` keeps every command but gh.
 */
function fakeHost(on: any, { os = 'Windows_NT', files = FILES }: { os?: string; files?: Record<string, string> } = {}) {
  const d = dirs(files)
  const sent: string[] = []
  const runs: Run[] = []
  let now = 1_000
  on('session.root', () => ({ value: 'R' }))
  on('clock.now', () => ({ value: (now += 1000) }))
  on('env.get', ($: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? os : undefined }))
  on('fs.list', ($: unknown, e: { path: string }) => ({
    value: (d[fake(e.path)] ?? []).map(x => ({ ...x, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', ($: unknown, e: { path: string }) => ({ value: files[fake(e.path)] ?? '' }))
  on('process.run', ($: unknown, e: { argv: string[]; init?: { cwd?: string } }) => {
    if (e.argv[0] === 'gh' || e.argv[0] === 'git') return { value: { exitCode: 1, stdout: '', stderr: 'not a GitHub repo' } }
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Darwin\n' : '', stderr: '' } }
  })
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
  /** The commands that opened new chats (uname, asked once, aside). */
  const chats = () => runs.filter(r => r.argv[0] !== 'uname')
  return { sent, runs, chats }
}

/** The prompt a new chat was opened on: the last argument, or the link's `q`. */
const promptOf = (r: Run) => {
  const last = r.argv.at(-1)!
  return /^claude(-cli)?:/.test(last) ? new URL(last).searchParams.get('q') : last
}

const keys = async (ui: { findAll: (q: object) => Promise<{ key?: string }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => String(b.key))

/** The tickets drawn as cards (Clients), by id. */
const cards = async (ui: { findAll: (q: object) => Promise<{ key?: string }[]> }) =>
  (await ui.findAll({ type: 'Client' })).map(c => String(c.key)).filter(k => k.startsWith('card:')).map(k => k.slice(5))

/** A click on a card, on a row away from its title: the whole card is the target. */
const clickCard = (ui: any, id: string, y = 2) => ui.pointer({ type: 'up', x: 3, y, button: 'left', in: `card:${id}` })

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
      expect(await cards(ui)).toHaveLength(4)
      expect((await keys(ui)).filter(k => k.startsWith('t:'))).toHaveLength(0)
      expect(await ui.find({ text: /after 01/, in: `card:${P2}` })).toBeDefined()
    })

    test('a whole card is one target: a click on any row, or Enter, opens its ticket', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await clickCard(ui, P2, 2)
      expect(await keys(ui)).toContain('back-map')
      expect(await ui.find({ text: /Which direction\?/ })).toBeDefined()
      await ui.press({ key: 'back-map' })
      await ui.key({ key: 'return', in: `card:${P3}` })
      expect(await ui.find({ text: /What shell\?/ })).toBeDefined()
    })

    test('the pointer over a card lights the whole card', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      const title = async () => (await ui.find({ text: /^Look of the AI video tools/, in: `card:${P1}` })) as any
      expect((await title()).props.underline).toBeFalsy()
      await ui.pointer({ type: 'enter', x: 1, y: 1, in: `card:${P1}` })
      expect((await title()).props.underline).toBe(true)
      await ui.pointer({ type: 'leave', x: 1, y: 1, in: `card:${P1}` })
      expect((await title()).props.underline).toBeFalsy()
    })

    test('one press each: open a map, open a ticket page, back to map, back to all maps', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)

      await ui.press({ key: MAP })
      expect(await keys(ui)).toContain('back')

      await clickCard(ui, P2)
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
      expect(await cards(ui)).toContain(P2)

      await ui.press({ key: 'back' })
      expect(await keys(ui)).not.toContain('back')
      expect(await keys(ui)).toContain(MAP)
    })

    test('a ticket page links to the tickets around it', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await clickCard(ui, P2)
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
      await clickCard(ui, P3)
      expect(await ui.find({ text: /Type: grilling/ })).toBeUndefined()
      expect(await ui.find({ text: /file:\/\/\/R\/\.scratch\/design\/issues\/02-direction\.md/ })).toBeDefined()
    })

    test('the status chips show only that status', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      const k = await keys(ui)
      expect(k).toContain('filter:claimed')
      expect(k).not.toContain('filter:waiting')
      await ui.press({ key: 'filter:claimed' })
      expect(await cards(ui)).toEqual(['R/.scratch/design/issues/04-name.md'])
      await ui.press({ key: 'filter:done' })
      expect(await cards(ui)).toEqual([P1])
    })

    test('a resolved ticket shows its answer and no Work button', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      await clickCard(ui, P1)
      expect(await keys(ui)).not.toContain(`work:${P1}`)
      expect(await ui.find({ text: /Dark and dense/ })).toBeDefined()
    })

    test('the filters narrow the tickets, and Tree lists them as a tree', async ($, on) => {
      fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      // Steps draw cards; Tree draws a button per ticket.
      const rows = async () => (await keys(ui)).filter(k => k.startsWith('t:')).length
      expect(await cards(ui)).toHaveLength(4)
      await ui.press({ key: 'filter:unresolved' })
      expect(await cards(ui)).toHaveLength(3)
      await ui.press({ key: 'filter:frontier' })
      expect(await cards(ui)).toHaveLength(1)
      await ui.press({ key: 'layout:tree' })
      expect(await ui.find({ text: /^STEP 1$/ })).toBeUndefined()
      expect(await cards(ui)).toHaveLength(0)
      expect(await rows()).toBe(1)
      await ui.press({ key: 'filter:all' })
      expect(await rows()).toBe(4)
      await ui.press({ key: `t:${P3}` })
      expect(await ui.find({ text: /What shell\?/ })).toBeDefined()
      await ui.press({ key: 'back-map' })
      await ui.press({ key: 'layout:steps' })
      expect(await ui.find({ text: /^STEP 1$/ })).toBeDefined()
    })

    test('Work buttons open a new chat on the configured prompt, none in this one', async ($, on) => {
      const host = fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      expect(((await ui.find({ key: 'work-next' })) as any).props.label).toBe('Work next: 02 ↗')
      await ui.press({ key: 'work-next' })
      await clickCard(ui, P3)
      await ui.press({ key: `work:${P3}` })
      await ui.press({ key: 'back-map' })
      await ui.press({ key: 'back' })
      await ui.press({ key: SPEC })
      // A spec is implemented whole, not a ticket at a time.
      expect(await ui.find({ key: 'work-next' })).toBeUndefined()
      expect(((await ui.find({ key: 'work-spec' })) as any).props.label).toBe('Implement spec ↗')
      expect(((await ui.find({ key: 'work-frontier' })) as any).props.label).toBe('Implement frontier · 1 ↗')
      await ui.press({ key: 'work-frontier' })
      // The wave's tickets are taken: the button steps aside until the next wave.
      expect(await ui.find({ key: 'work-frontier' })).toBeUndefined()
      expect(await ui.find({ text: /new chat ↗/, in: `card:${STORE}` })).toBeDefined()
      await ui.press({ key: 'work-spec' })
      await clickCard(ui, STORE)
      await ui.press({ key: `work:${STORE}` })
      expect(host.sent).toEqual([])
      expect(host.chats().map(promptOf)).toEqual([
        '/mattpocock-skills:wayfinder .scratch/design/map.md .scratch/design/issues/02-direction.md',
        '/mattpocock-skills:wayfinder .scratch/design/map.md .scratch/design/issues/03-shell.md',
        '/wayfinder-maps:implement-frontier .scratch/build/spec.md',
        '/mattpocock-skills:implement-spec .scratch/build/spec.md',
        '/mattpocock-skills:implement .scratch/build/issues/02-store.md',
      ])
      const first = host.chats()[0]!
      if (surface === 'desktop') {
        // A new session in the app, in the project's folder.
        expect(first.argv.slice(0, 2)).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler'])
        expect(first.argv[2]!.startsWith('claude://code/new?')).toBe(true)
        expect(new URL(first.argv[2]!).searchParams.get('folder')).toBe('R')
      } else {
        // A terminal window of its own, running claude in the project.
        expect(first.argv.slice(0, 6)).toEqual(['cmd.exe', '/d', '/c', 'start', 'Wayfinder 02', 'claude'])
        expect(fake(first.cwd ?? '')).toBe('R')
      }
    })

    test('"Work next" moves on past a ticket opened in a new chat', async ($, on) => {
      fakeHost(on, { files: { ...FILES, ...MORE } })
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      const label = async (key: string) => ((await ui.find({ key })) as any)?.props.label
      expect(await label('work-next')).toBe('Work next: 02 ↗')
      await ui.press({ key: 'work-next' })
      expect(await label('work-next')).toBe('Work next: 06 ↗')
      expect(await ui.find({ text: /new chat ↗/, in: `card:${P2}` })).toBeDefined()
      expect(await ui.find({ key: 'start-all' })).toBeUndefined()
    })

    test('with "workIn: here" the Work buttons run in this chat', { options: { workIn: 'here' } }, async ($, on) => {
      const host = fakeHost(on)
      const ui = await mountPane($, surface)
      await ui.press({ key: MAP })
      expect(((await ui.find({ key: 'work-next' })) as any).props.label).toBe('Work next: 02 →')
      await ui.press({ key: 'work-next' })
      expect(host.sent).toEqual(['/mattpocock-skills:wayfinder .scratch/design/map.md .scratch/design/issues/02-direction.md'])
      expect(host.chats()).toHaveLength(0)
    })
  })
}

describe('new chats on macOS', () => {
  test('from the terminal, Work next opens the terminal link, its prompt ready to send', async ($, on) => {
    const host = fakeHost(on, { os: '' })
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: MAP })
    await ui.press({ key: 'work-next' })
    expect(host.chats().map(r => r.argv[0])).toEqual(['open'])
    expect(host.chats()[0]!.argv[1]!.startsWith('claude-cli://open?')).toBe(true)
  })
})

describe('steps layout', () => {
  test('a wide drawer puts several cards across a step; a narrow one stacks them', async ($, on) => {
    fakeHost(on)
    const wide = await mountPane($, 'desktop', 140)
    await wide.press({ key: MAP })
    const wideCard = (await wide.findAll({ type: 'Client' })).find((b: any) => String(b.key).startsWith('card:'))
    await wide.unmount()
    // The drawer remembers it was on the map.
    const narrow = await mountPane($, 'desktop', 40)
    const narrowCard = (await narrow.findAll({ type: 'Client' })).find((b: any) => String(b.key).startsWith('card:'))
    expect((wideCard as any)?.props?.width).toBeLessThan(50)
    expect((narrowCard as any)?.props?.width).toBe(38)
    // Every card states its height, so the pane can scroll to the last one.
    const heights: unknown[] = (await narrow.findAll({ type: 'Client' })).map((c: any) => c.props?.height)
    expect(heights.every(h => typeof h === 'number' && h >= 4)).toBe(true)
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
