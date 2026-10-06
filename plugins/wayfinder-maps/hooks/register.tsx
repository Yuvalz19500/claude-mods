import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WfData, WfDetail, WfFilter, WfMap, WfTicket, WfView } from '../types'
import { githubIssueBody, githubRepo, loadGithubMaps } from './github'
import { STATUS_STYLE, graphSvg, treeRows } from './graph'
import { loadMarkdownMaps, readText } from './markdown'
import { ClickGate } from './clicks'
import { counts } from './parse'
import type { Io } from './parse'

const PANE = 'wayfinder'
const TITLE = 'Wayfinder'
const GITHUB_EVERY_MS = 60_000
const POLL_MS = 30_000

const data = atom({ plugin: 'wayfinder-maps', key: 'data' } as const, null)
const isLoading = atom({ plugin: 'wayfinder-maps', key: 'isLoading' } as const, false)
const isPaneOpen = atom({ plugin: 'wayfinder-maps', key: 'isPaneOpen' } as const, false)
const view = atom({ plugin: 'wayfinder-maps', key: 'view' } as const, { mapId: null, selected: null, filter: 'all' } as WfView)
const detail = atom({ plugin: 'wayfinder-maps', key: 'detail' } as const, null as WfDetail)

const MAP_STATUS_LABEL: Record<WfMap['status'], { text: string; color: string }> = {
  open: { text: 'open', color: '#8b5cf6' },
  active: { text: 'in progress', color: '#3b82d6' },
  done: { text: 'done', color: '#2f9e6a' },
  graduated: { text: 'graduated → spec', color: '#2f9e6a' },
}

const prompts = {
  map: '/mattpocock-skills:wayfinder {map}',
  mapTicket: '/mattpocock-skills:wayfinder {map} {ticket}',
  specTicket: '/mattpocock-skills:implement {ticket}',
}
let lastGithubAt = 0
let githubMaps: WfMap[] = []
let githubError: string | undefined
let isRefreshing = false
/** A refresh asked for while one runs: runs after it; true when it should fetch GitHub. */
let queued: boolean | null = null

// Button actions by key, so a focus move (desktop) can run the same action a press does.
const handlers = new Map<string, () => void>()
const gate = new ClickGate()
let drawnOn: string | undefined

function bind(key: string, fn: () => unknown): () => void {
  const handler = () => void fn()
  handlers.set(key, handler)
  return handler
}

const bar = (done: number, total: number, width = 16) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

const fileUrl = (path: string) => 'file:///' + encodeURI(path.replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23')

const relative = (root: string, path: string) => {
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  const p = path.replace(/\\/g, '/')
  return p.startsWith(r + '/') ? p.slice(r.length + 1) : p
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, k: string) => values[k] ?? whole)

function visible(tickets: WfTicket[], filter: WfFilter): WfTicket[] {
  if (filter === 'frontier') return tickets.filter(t => t.isFrontier)
  if (filter === 'unresolved') return tickets.filter(t => t.status !== 'done' && t.status !== 'dropped')
  return tickets
}

function ioFor($: EngineInterface): Io {
  return {
    list: path => $.fs.list(path),
    read: async path => String(await $.fs.read(path)),
    run: (argv, cwd) => $.process.run(argv, { cwd, timeoutMs: 30_000 }),
  }
}

/**
 * Rescans the project. A quiet refresh (the background polls) draws nothing
 * while it runs, and nothing at all when the maps did not change.
 */
async function refresh($: EngineInterface, github: boolean, isQuiet: boolean) {
  if (isRefreshing) {
    queued = (queued ?? false) || github
    return
  }
  isRefreshing = true
  if (!isQuiet) await update($, isLoading, () => true)
  try {
    const io = ioFor($)
    const root = await $.session.root()
    const errors: string[] = []
    const mdPromise = loadMarkdownMaps(io, root).catch(error => {
      errors.push(`Markdown: ${String(error)}`)
      return [] as WfMap[]
    })
    if (github || lastGithubAt === 0) {
      lastGithubAt = await $.clock.now()
      const repo = await githubRepo(io, root)
      if (repo) {
        const r = await loadGithubMaps(io, root, repo).catch(error => ({ maps: [] as WfMap[], error: String(error) }))
        githubMaps = r.maps
        githubError = r.error
      } else {
        githubMaps = []
        githubError = undefined
      }
    }
    if (githubError) errors.push(githubError)
    const isFinished = (m: WfMap) => Number(m.status === 'done' || m.status === 'graduated')
    const all = [...githubMaps, ...(await mdPromise)].sort(
      (a, b) =>
        Number(a.kind === 'spec') - Number(b.kind === 'spec') || isFinished(a) - isFinished(b) || a.title.localeCompare(b.title),
    )
    const next: WfData = { root, maps: all, loadedAt: await $.clock.now(), errors }
    const prev = await read($, data)
    const isSame = prev !== null && JSON.stringify({ ...prev, loadedAt: 0 }) === JSON.stringify({ ...next, loadedAt: 0 })
    if (!isSame) await update($, data, () => next)
  } finally {
    isRefreshing = false
    if (!isQuiet) await update($, isLoading, () => false)
  }
  if (queued !== null) {
    const fetchGithub = queued
    queued = null
    await refresh($, fetchGithub, true)
  }
}

async function openDrawer($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE })
  await update($, isPaneOpen, () => true)
  void refresh($, true, false)
}

async function pollIfOpen($: EngineInterface, github: boolean) {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) await refresh($, github, true)
}

/** Opens a ticket's details, or closes them when it is the open one. Body first, so it draws once. */
async function select($: EngineInterface, map: WfMap, ticket: WfTicket) {
  const current = await read($, view)
  if (current.selected === ticket.id) {
    await update($, view, v => ({ ...v, selected: null }))
    return
  }
  const io = ioFor($)
  const root = (await read($, data))?.root ?? (await $.session.root())
  let body: string
  if (map.source === 'github' && ticket.url) body = await githubIssueBody(io, root, ticket.url)
  else body = ticket.path ? await readText(io, ticket.path) : ''
  body = body.replace(/^\uFEFF?# .*\r?\n/, '').trim()
  if (body.length > 9000) body = body.slice(0, 9000) + '\n\n_…truncated; open the file for the rest._'
  await update($, detail, () => ({ id: ticket.id, body: body || '_Empty ticket._' }))
  await update($, view, v => ({ ...v, selected: ticket.id }))
}

async function work($: EngineInterface, map: WfMap, ticket: WfTicket | null) {
  const root = (await read($, data))?.root ?? ''
  const mapRef = map.source === 'github' ? (map.url ?? map.ref) : map.ref
  const ticketRef = ticket ? (ticket.path ? relative(root, ticket.path) : (ticket.url ?? ticket.ref)) : ''
  const template = !ticket ? prompts.map : map.kind === 'spec' ? prompts.specTicket : prompts.mapTicket
  const text = fill(template, { map: mapRef, ticket: ticketRef, title: ticket?.title ?? map.title }).trim()
  // A slash command (a skill) runs as one; anything else is sent as a prompt.
  const slash = text.match(/^\/(\S+)\s*([\s\S]*)$/)
  if (slash) await $.command.run({ command: slash[1]!, args: slash[2] ?? '' })
  else await $.prompt.submit({ text, asUser: true })
  $.ui.toast(`Started: ${text}`)
}

export const register: Register = (on, options) => {
  if (typeof options.mapPrompt === 'string') prompts.map = options.mapPrompt
  if (typeof options.mapTicketPrompt === 'string') prompts.mapTicket = options.mapTicketPrompt
  if (typeof options.specTicketPrompt === 'string') prompts.specTicket = options.specTicketPrompt

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'wayfinder-maps',
      description: 'Open the Wayfinder drawer: every map and spec in this project, their tickets and dependencies',
    })
    $.clock.every(POLL_MS, () => void pollIfOpen($, false))
    // A first scan in the background, so the band can offer the drawer in a wayfinder project.
    $.clock.after(500, () => void refresh($, false, true))
    return next(e)
  })

  on('command.run', { command: 'wayfinder-maps' }, async $ => {
    await openDrawer($)
    return { text: 'Wayfinder drawer opened.' }
  })

  // Desktop: the click that brings the focus onto a button is the press (see ClickGate).
  on('ui.focus', async ($, e, next) => {
    const result = await next(e)
    const isOurs = (e.requestId === PANE || e.component === 'AbovePrompt') && (!e.plugin || e.plugin === 'wayfinder-maps')
    if (!isOurs || 'deny' in result) return result
    const handler = e.element ? handlers.get(e.element) : undefined
    const now = await $.clock.now()
    const isPerson = e.origin.kind === 'person'
    if (gate.focus({ key: e.element, isPerson, isDesktop: drawnOn === 'desktop', now }) && handler) handler()
    return result
  })

  on('ui.press', async ($, e, next) => {
    if (!handlers.has(e.element)) return next(e)
    if (!gate.press(e.element, await $.clock.now())) return { element: e.element }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, isPaneOpen, () => false)
    return result
  })

  // The band above the prompt: shown only where the project has maps, and only while the drawer is closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const d = await read($, data)
    const open = await read($, isPaneOpen)
    if (e.props.hasSurvey || open || !d || d.maps.length === 0) return next(e)
    drawnOn = e.surface
    const { Box, Text, Button } = $.ui.resolve(e)
    const live = d.maps.filter(m => m.status !== 'done' && m.status !== 'graduated')
    const all = live.flatMap(m => m.tickets)
    const frontier = all.filter(t => t.isFrontier).length
    const waiting = all.filter(t => t.status === 'waiting').length
    const maps = d.maps.filter(m => m.kind === 'map').length
    const specs = d.maps.length - maps
    const summary = [
      maps ? `${maps} map${maps === 1 ? '' : 's'}` : '',
      specs ? `${specs} spec${specs === 1 ? '' : 's'}` : '',
      frontier ? `${frontier} ready to take` : '',
      waiting ? `${waiting} waiting on you` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={STATUS_STYLE.open.fill}>⚑</Text>
        <Text dimColor>{summary}</Text>
        <Button key="open-drawer" label="Open map drawer" plain onPress={bind('open-drawer', () => openDrawer($))} />
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      void pollIfOpen($, now - lastGithubAt > GITHUB_EVERY_MS)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    drawnOn = e.surface
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Link } = table
    const Svg = 'Svg' in table ? table.Svg : null
    const d = await read($, data)
    const loading = await read($, isLoading)
    const v = await read($, view)
    const columns = e.props.bodyColumns ?? 60

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>🧭 Wayfinder</Text>
        <Box flexDirection="row" gap={1}>
          {loading && <Text dimColor>refreshing…</Text>}
          <Button key="refresh" label="Refresh" hotkey="r" plain onPress={bind('refresh', () => refresh($, true, false))} />
        </Box>
      </Box>
    )

    if (!d) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text dimColor>{loading ? 'Looking for maps…' : 'Press Refresh to scan this project.'}</Text>
        </Box>
      )
    }

    const map = v.mapId ? d.maps.find(m => m.id === v.mapId) : undefined

    // ── List of maps ────────────────────────────────────────────────
    if (!map) {
      const maps = d.maps.filter(m => m.kind === 'map')
      const specs = d.maps.filter(m => m.kind === 'spec')
      const row = (m: WfMap) => {
        const c = counts(m.tickets)
        const st = MAP_STATUS_LABEL[m.status]
        return (
          <Box key={`row:${m.id}`} flexDirection="column" marginBottom={1}>
            <Button
              key={`open:${m.id}`}
              label={m.title}
              plain
              onPress={bind(`open:${m.id}`, () => update($, view, x => ({ ...x, mapId: m.id, selected: null })))}
            />
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text color={st.color}>● {st.text}</Text>
              <Text dimColor>{m.source === 'github' ? `GitHub ${m.ref}` : m.dir}</Text>
            </Box>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text color="#2f9e6a">{bar(c.done, c.total)}</Text>
              <Text dimColor>
                {c.done}/{c.total} done
                {c.frontier ? ` · ${c.frontier} frontier` : ''}
                {c.claimed ? ` · ${c.claimed} claimed` : ''}
                {c.waiting ? ` · ${c.waiting} waiting` : ''}
                {c.blocked ? ` · ${c.blocked} blocked` : ''}
              </Text>
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {d.maps.length === 0 && (
            <Text dimColor>
              No wayfinder maps here. Maps are folders with a map.md beside issues/ or tickets/, or GitHub issues labelled
              wayfinder:map.
            </Text>
          )}
          {maps.length > 0 && <Text bold>Maps · {maps.length}</Text>}
          {maps.map(row)}
          {specs.length > 0 && <Text bold>Specs · {specs.length}</Text>}
          {specs.map(row)}
          {d.errors.map(err => (
            <Text color="#d08a1e">{err}</Text>
          ))}
        </Box>
      )
    }

    // ── One map ─────────────────────────────────────────────────────
    const c = counts(map.tickets)
    const st = MAP_STATUS_LABEL[map.status]
    const shown = visible(map.tickets, v.filter)
    const det = await read($, detail)
    const byNum = new Map(map.tickets.map(t => [t.num, t]))
    const graph = Svg && shown.length > 0 ? graphSvg(shown, Math.max(320, columns * 8)) : null
    const rows = treeRows(shown)
    const nextUp = map.tickets.find(t => t.isFrontier)

    const filterButton = (f: WfFilter, label: string) => (
      <Button
        key={`filter:${f}`}
        label={label}
        variant={v.filter === f ? 'primary' : 'secondary'}
        onPress={bind(`filter:${f}`, () => update($, view, x => ({ ...x, filter: f })))}
      />
    )

    const details = (t: WfTicket) => {
      const blockers = t.blockedBy.map(n => byNum.get(n)).filter((x): x is WfTicket => !!x)
      const ts = STATUS_STYLE[t.status]
      const meta = [ts.label, t.rawStatus && t.rawStatus.toLowerCase() !== ts.label ? `(${t.rawStatus})` : '', t.type, t.assignee]
        .filter(Boolean)
        .join(' · ')
      return (
        <Box key={`det:${t.id}`} flexDirection="column" borderStyle="round" borderColor={ts.fill} paddingX={1} marginLeft={2} marginBottom={1}>
          <Text color={ts.fill}>
            {ts.glyph} {meta}
          </Text>
          {blockers.length > 0 && (
            <Text dimColor wrap="wrap">
              Blocked by: {blockers.map(b => `${STATUS_STYLE[b.status].glyph} ${b.ref} ${b.title}`).join(' · ')}
            </Text>
          )}
          <Markdown text={det?.id === t.id ? det.body : '_Loading…_'} />
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {t.status !== 'done' && t.status !== 'dropped' && (
              <Button key={`work:${t.id}`} label="Work this ticket" variant="primary" onPress={bind(`work:${t.id}`, () => work($, map, t))} />
            )}
            {t.url ? (
              <Link href={t.url} label="Open issue ↗" />
            ) : t.path ? (
              <Markdown text={`[Open file ↗](${fileUrl(t.path)})`} />
            ) : (
              ''
            )}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Button key="back" label="← All maps" plain hotkey="b" onPress={bind('back', () => update($, view, x => ({ ...x, mapId: null, selected: null })))} />
        <Box flexDirection="column">
          <Text bold wrap="wrap">
            {map.title}
          </Text>
          <Text color={st.color}>
            ● {st.text} · {map.kind} · {map.source === 'github' ? `GitHub ${map.ref}` : map.dir}
          </Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color="#2f9e6a">{bar(c.done, c.total, 20)}</Text>
            <Text dimColor>
              {c.done}/{c.total} done · {c.frontier} frontier · {c.claimed} claimed · {c.waiting} waiting · {c.blocked} blocked
            </Text>
          </Box>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {map.url ? <Link href={map.url} label="Open map ↗" /> : map.path ? <Markdown text={`[Open ${map.kind} ↗](${fileUrl(map.path)})`} /> : ''}
          {map.kind === 'map' && map.status !== 'done' && map.status !== 'graduated' && (
            <Button key="work-map" label={nextUp ? `Work next: ${nextUp.ref}` : 'Work the map'} onPress={bind('work-map', () => work($, map, null))} />
          )}
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {filterButton('all', `All ${c.total}`)}
          {filterButton('unresolved', `Unresolved ${c.total - c.done}`)}
          {filterButton('frontier', `Frontier ${c.frontier}`)}
        </Box>
        {graph && !graph.isTooBig && Svg ? (
          <Svg source={graph.svg} alt={`Dependency graph of ${shown.length} tickets`} width={graph.width} isInteractive />
        ) : (
          ''
        )}
        {graph?.isTooBig && <Text dimColor>Too many tickets to draw the graph. Filter to Unresolved or Frontier to see it.</Text>}
        {shown.length === 0 && <Text dimColor>No tickets match this filter.</Text>}
        <Box flexDirection="column">
          {rows.map(({ ticket: t, depth, isRepeat, extraParents }, i) => {
            const ts = STATUS_STYLE[t.status]
            const isSelected = v.selected === t.id && !isRepeat
            return (
              <Box key={`r:${i}`} flexDirection="column">
                <Box flexDirection="row" marginLeft={depth * 2}>
                  <Text color={ts.fill}>
                    {depth > 0 ? '└ ' : ''}
                    {ts.glyph}{' '}
                  </Text>
                  {isRepeat ? (
                    <Text dimColor>
                      {t.ref} {t.title} ↑
                    </Text>
                  ) : (
                    <Button
                      key={`t:${t.id}`}
                      label={`${t.ref} ${t.title}`}
                      plain
                      dimColor={t.status === 'done'}
                      onPress={bind(`t:${t.id}`, () => select($, map, t))}
                    />
                  )}
                  {!isRepeat && t.type && <Text dimColor> · {t.type}</Text>}
                  {!isRepeat && extraParents.length > 0 && <Text dimColor> · also after {extraParents.join(', ')}</Text>}
                </Box>
                {isSelected && details(t)}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
