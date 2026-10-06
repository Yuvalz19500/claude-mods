import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WfCopied, WfData, WfDetail, WfFilter, WfLayout, WfMap, WfTicket, WfView } from '../types'
import type { CardProps } from './card'
import { ClickGate } from './clicks'
import { githubIssueBody, githubRepo, loadGithubMaps } from './github'
import { STATUS_STYLE, cardLayout, cardRows, dependents, layers, treeRows } from './graph'
import { appChat, clipboardArgv, pasteKeys, terminalChat } from './launch'
import type { Launch, Platform } from './launch'
import { loadMarkdownMaps, readText } from './markdown'
import { counts } from './parse'
import type { Io } from './parse'
import { absolutizeLinks, fileUrl, stripHeaderFields, wrapLines } from './text'

const PANE = 'wayfinder'
const TITLE = 'Wayfinder'
const GITHUB_EVERY_MS = 60_000
const POLL_MS = 30_000

const data = atom({ plugin: 'wayfinder-maps', key: 'data' } as const, null)
const isLoading = atom({ plugin: 'wayfinder-maps', key: 'isLoading' } as const, false)
const isPaneOpen = atom({ plugin: 'wayfinder-maps', key: 'isPaneOpen' } as const, false)
const view = atom(
  { plugin: 'wayfinder-maps', key: 'view' } as const,
  { mapId: null, ticketId: null, filter: 'all', layout: 'steps' } as WfView,
)
const detail = atom({ plugin: 'wayfinder-maps', key: 'detail' } as const, null as WfDetail)
const started = atom({ plugin: 'wayfinder-maps', key: 'started' } as const, {} as Record<string, number>)

/** How long a ticket opened in a new chat stays out of "Work next", for its chat to claim it. */
const STARTED_MS = 15 * 60_000
/** The command a Work button last copied for the person to paste in a new chat. */
const copied = atom({ plugin: 'wayfinder-maps', key: 'copied' } as const, null as WfCopied)
/** How long the toast shows before the app moves to the new chat. */
const OPEN_AFTER_MS = 1_500

const MAP_STATUS_LABEL: Record<WfMap['status'], { text: string; color: string }> = {
  open: { text: 'open', color: STATUS_STYLE.open.fill },
  active: { text: 'in progress', color: STATUS_STYLE.claimed.fill },
  done: { text: 'done', color: STATUS_STYLE.done.fill },
  graduated: { text: 'graduated → spec', color: STATUS_STYLE.done.fill },
}

const prompts = {
  map: '/mattpocock-skills:wayfinder {map}',
  mapTicket: '/mattpocock-skills:wayfinder {map} {ticket}',
  specTicket: '/mattpocock-skills:implement {ticket}',
  /** The whole spec: the skill takes the frontier and runs a subagent per ticket, in parallel. */
  spec: '/mattpocock-skills:implement-spec {map}',
  /** One wave: the spec's frontier tickets in parallel, then stop (this plugin's own skill). */
  frontier: '/wayfinder-maps:implement-frontier {map}',
}
/** Where Work buttons work: a new chat (the default), always a terminal window, or this chat. */
let workIn: 'new-chat' | 'here' = 'new-chat'
let platform: Platform | undefined
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

const relative = (root: string, path: string) => {
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  const p = path.replace(/\\/g, '/')
  return p.startsWith(r + '/') ? p.slice(r.length + 1) : p
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, k: string) => values[k] ?? whole)

const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase()

const isClosed = (t: WfTicket) => t.status === 'done' || t.status === 'dropped'

function visible(tickets: WfTicket[], filter: WfFilter): WfTicket[] {
  if (filter === 'all') return tickets
  if (filter === 'frontier') return tickets.filter(t => t.isFrontier)
  if (filter === 'unresolved') return tickets.filter(t => !isClosed(t))
  if (filter === 'done') return tickets.filter(isClosed)
  return tickets.filter(t => t.status === filter)
}

/** What a status reads as on a card: the assignee rides along when claimed. */
const statusText = (t: WfTicket, isOpened = false) =>
  t.status === 'claimed' && t.assignee
    ? `claimed · ${t.assignee.split(/[\s(]/)[0]}`
    : isOpened && t.isFrontier
      ? 'new chat ↗'
      : STATUS_STYLE[t.status].label

/** True for a ticket a Work button opened a new chat on a moment ago: its chat has not claimed it yet. */
const isOpened = (opened: Record<string, number>, t: WfTicket, now: number) => (opened[t.id] ?? -Infinity) > now - STARTED_MS

/** The frontier tickets no new chat was opened on yet: what "Work next" and "Start all" take. */
const takeable = (map: WfMap, opened: Record<string, number>, now: number) =>
  map.tickets.filter(t => t.isFrontier && !isOpened(opened, t, now))

/** Where a Work button works, from the setting and the surface it was pressed on. */
const chatFor = (): 'app' | 'terminal' | 'here' =>
  workIn === 'here' || drawnOn === 'mobile' ? 'here' : drawnOn === 'desktop' ? 'app' : 'terminal'

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

/** Brings the drawer's window back to its top, or to one element; best effort. */
async function scrollTo($: EngineInterface, to: 'start' | { key: string }) {
  try {
    await $.ui.scroll({ to, in: PANE, block: to === 'start' ? 'start' : 'center' })
  } catch {
    // The pane may not be placed (a narrow terminal); nothing to scroll.
  }
}

/** Shows one ticket on a page of its own: its body is read first, so the page draws once. */
async function openTicket($: EngineInterface, map: WfMap, ticket: WfTicket) {
  await update($, copied, () => null)
  const io = ioFor($)
  const root = (await read($, data))?.root ?? (await $.session.root())
  let body: string
  if (map.source === 'github' && ticket.url) body = await githubIssueBody(io, root, ticket.url)
  else body = ticket.path ? await readText(io, ticket.path) : ''
  body = stripHeaderFields(body.replace(/^\uFEFF?# .*\r?\n/, '')).trim()
  let links: { href: string; path: string }[] = []
  if (ticket.path) ({ text: body, links } = absolutizeLinks(body, ticket.path))
  if (body.length > 9000) body = body.slice(0, 9000) + '\n\n_…truncated; open the file for the rest._'
  await update($, detail, () => ({ id: ticket.id, body: body || '_This ticket has no body yet._', links }))
  await update($, view, v => ({ ...v, mapId: map.id, ticketId: ticket.id }))
  await scrollTo($, 'start')
}

/** Back from a ticket's page to its map, with that ticket's card in view. */
async function backToMap($: EngineInterface) {
  const from = (await read($, view)).ticketId
  await update($, view, v => ({ ...v, ticketId: null }))
  if (from) await scrollTo($, { key: `t:${from}` })
}

async function openMap($: EngineInterface, mapId: string | null) {
  await update($, copied, () => null)
  await update($, view, v => ({ ...v, mapId, ticketId: null }))
  await scrollTo($, 'start')
}

/** The prompt a Work button sends: the configured template, filled in for the map or spec, or one ticket. */
function promptFor(root: string, map: WfMap, ticket: WfTicket | null, isWave = false) {
  const mapRef = map.source === 'github' ? (map.url ?? map.ref) : map.ref
  const ticketRef = ticket ? (ticket.path ? relative(root, ticket.path) : (ticket.url ?? ticket.ref)) : ''
  const isSpec = map.kind === 'spec'
  const template = isWave
    ? prompts.frontier
    : !ticket
      ? isSpec
        ? prompts.spec
        : prompts.map
      : isSpec
        ? prompts.specTicket
        : prompts.mapTicket
  return fill(template, { map: mapRef, ticket: ticketRef, title: ticket?.title ?? map.title }).trim()
}

async function platformOf($: EngineInterface): Promise<Platform> {
  if (platform) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') platform = 'windows'
  else {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => null)
    platform = r?.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
  }
  return platform
}

/**
 * Opens one new chat: an empty desktop-app session in the project, or a
 * terminal window on `prompt`. What was run, or null when the host could not run it.
 */
async function openChat($: EngineInterface, how: 'app' | 'terminal', prompt: string, root: string, title: string) {
  const p = await platformOf($)
  const launch: Launch = how === 'app' ? appChat(root, p) : terminalChat(prompt, root, title, p)
  const r = await $.process.run(launch.argv, { cwd: launch.cwd ?? root, timeoutMs: 15_000 }).catch(() => null)
  return r?.exitCode === 0 ? launch : null
}

/** Puts `text` on the clipboard: through the surface, else the host's own tool. True when it took. */
async function copyText($: EngineInterface, text: string): Promise<boolean> {
  const surface = drawnOn === 'desktop' || drawnOn === 'terminal' || drawnOn === 'vscode' ? drawnOn : undefined
  const viaSurface = await $.ui.copy({ text, surface }).catch(() => null)
  if (viaSurface?.isCopied) return true
  const r = await $.process.run(clipboardArgv(await platformOf($)), { stdin: text, timeoutMs: 5_000 }).catch(() => null)
  return r?.exitCode === 0
}

/** Keeps the tickets just opened in new chats out of "Work next" until their chats claim them. */
async function markOpened($: EngineInterface, ids: string[]) {
  if (ids.length === 0) return
  const now = await $.clock.now()
  await update($, started, prev => {
    const kept = Object.fromEntries(Object.entries(prev ?? {}).filter(([, at]) => at > now - STARTED_MS))
    for (const id of ids) kept[id] = now
    return kept
  })
}

/**
 * Works the map or spec, one ticket, or (`wave`) a spec's frontier tickets
 * at once: in a new chat with no context, or here (the `workIn` setting).
 */
async function work($: EngineInterface, map: WfMap, ticket: WfTicket | null, wave: WfTicket[] = []) {
  const root = (await read($, data))?.root ?? (await $.session.root())
  const text = promptFor(root, map, ticket, wave.length > 0)
  const how = chatFor()
  if (how === 'here') {
    // A slash command (a skill) runs as one; anything else is sent as a prompt.
    const slash = text.match(/^\/(\S+)\s*([\s\S]*)$/)
    if (slash) await $.command.run({ command: slash[1]!, args: slash[2] ?? '' })
    else await $.prompt.submit({ text, asUser: true })
    $.ui.toast(`Started: ${text}`)
    return
  }
  const name = ticket ? ticket.ref : wave.length > 0 ? `the frontier (${wave.map(t => t.ref).join(' ')})` : `the ${map.kind}`
  if (how === 'app') {
    // The app opens a new chat but never runs a command for it: the person pastes the copied one.
    const isCopied = await copyText($, text)
    const keys = pasteKeys(await platformOf($))
    await update($, copied, () => ({ text, isCopied, keys }))
    $.ui.toast(
      isCopied
        ? `Copied ${text}. Opening a new chat in this project: paste it (${keys}) and press Enter.`
        : `Could not copy. Opening a new chat in this project: type ${text} there.`,
      { timeoutMs: 10_000 },
    )
    // Long enough to read the toast before the app moves to the new chat.
    await $.clock.sleep(OPEN_AFTER_MS)
    if (!(await openChat($, 'app', text, root, ''))) {
      $.ui.toast(`Could not open a new chat. Open one in this project and paste ${text}.`, { timeoutMs: 10_000 })
      return
    }
    await markOpened($, ticket ? [ticket.id] : wave.map(t => t.id))
    return
  }
  const opened = await openChat($, how, text, root, `Wayfinder ${ticket?.ref ?? map.kind}`)
  if (!opened) {
    $.ui.toast(`Could not open a new chat. Its prompt: ${text}`, { timeoutMs: 10_000 })
    return
  }
  await markOpened($, ticket ? [ticket.id] : wave.map(t => t.id))
  $.ui.toast(opened.startsAtOnce ? `New chat working on ${name}` : `New chat on ${name}: press Enter there to start`)
}


// ── Drawing ──────────────────────────────────────────────────────────
// Native elements only: the surface's own type, colors and theme. The one
// color the drawer adds is each status's, on its glyph and its card's edge.

type Els = ReturnType<EngineInterface['ui']['resolve']>

/**
 * The mod's mark: a trail blaze, the painted bar a hiker follows, before the
 * name. One text cell, so the terminal and the desktop draw it alike.
 */
function mark(el: Els) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={STATUS_STYLE.open.fill}>▍</Text>
      <Text bold>Wayfinder</Text>
    </Box>
  )
}

function header($: EngineInterface, el: Els, loading: boolean) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" justifyContent="space-between">
      {mark(el)}
      <Box flexDirection="row" gap={1}>
        {loading && <Text dimColor>refreshing…</Text>}
        <Button key="refresh" label="Refresh" hotkey="r" plain onPress={bind('refresh', () => refresh($, true, false))} />
      </Box>
    </Box>
  )
}

function mapList($: EngineInterface, el: Els, d: WfData) {
  const { Box, Text, Button } = el
  const maps = d.maps.filter(m => m.kind === 'map')
  const specs = d.maps.filter(m => m.kind === 'spec')
  const row = (m: WfMap) => {
    const c = counts(m.tickets)
    const st = MAP_STATUS_LABEL[m.status]
    return (
      <Box key={`row:${m.id}`} flexDirection="column" marginBottom={1}>
        <Button key={`open:${m.id}`} label={m.title} plain onPress={bind(`open:${m.id}`, () => openMap($, m.id))} />
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color={st.color}>● {st.text}</Text>
          <Text dimColor>{m.source === 'github' ? `GitHub ${m.ref}` : m.dir}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color={STATUS_STYLE.done.fill}>{bar(c.done, c.total)}</Text>
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
      {d.maps.length === 0 && (
        <Text dimColor>
          No wayfinder maps here. A map is a folder with a map.md beside issues/ or tickets/, or a GitHub issue labelled
          wayfinder:map.
        </Text>
      )}
      {maps.length > 0 && <Text bold>Maps · {maps.length}</Text>}
      {maps.map(row)}
      {specs.length > 0 && <Text bold>Specs · {specs.length}</Text>}
      {specs.map(row)}
      {d.errors.map(err => (
        <Text color={STATUS_STYLE.waiting.fill}>{err}</Text>
      ))}
    </Box>
  )
}

/**
 * One ticket as a card, its status's color on the edge. Where the surface
 * runs surface modules (terminal, desktop) the card is a `Client`, so the
 * whole card is one click target (see card.tsx); elsewhere its title lines
 * are the buttons.
 */
function ticketCard(
  $: EngineInterface,
  el: Els,
  map: WfMap,
  t: WfTicket,
  width: number,
  byNum: Map<number, WfTicket>,
  isNewChat: boolean,
) {
  const { Box, Text, Button } = el
  const st = STATUS_STYLE[t.status]
  const closed = isClosed(t)
  const status = statusText(t, isNewChat)
  const after = t.blockedBy.map(n => byNum.get(n)).filter((x): x is WfTicket => !!x)
  const afterText = after.length > 0 ? `after ${after.map(b => `${b.ref} ${STATUS_STYLE[b.status].glyph}`).join('  ')}` : ''
  if ('Client' in el) {
    const { Client } = el
    const props: CardProps = {
      id: t.id,
      ref: t.ref,
      type: (t.type ?? '').toUpperCase(),
      lines: wrapLines(t.title, width - 4, 3),
      status,
      color: st.fill,
      glyph: st.glyph,
      after: afterText,
      isClosed: closed,
      width,
    }
    // An explicit height: left to the module, the pane measures before it draws and cuts the last card.
    return <Client key={`card:${t.id}`} module="./card.tsx" props={props} width={width} height={cardRows(props)} />
  }
  const open = bind(`t:${t.id}`, () => openTicket($, map, t))
  // A Button draws on one line, so the title is wrapped here, a button per line.
  const lines = wrapLines(t.title, width - 4, 3)
  return (
    <Box
      key={`card:${t.id}`}
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={st.fill}
      borderDimColor={closed}
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Text color={st.fill}>{st.glyph}</Text>
          <Text bold dimColor={closed}>
            {t.ref}
          </Text>
          {t.type && <Text dimColor>{t.type.toUpperCase()}</Text>}
        </Box>
        <Text color={closed ? undefined : st.fill} dimColor={closed}>
          {status}
        </Text>
      </Box>
      {lines.map((line, i) => (
        <Button key={i === 0 ? `t:${t.id}` : `t:${t.id}#${i + 1}`} label={line} plain dimColor={closed} onPress={i === 0 ? open : bind(`t:${t.id}#${i + 1}`, () => openTicket($, map, t))} />
      ))}
      {afterText && <Text dimColor>{afterText}</Text>}
    </Box>
  )
}

/** Steps, top to bottom: a ticket sits one step below the last of its blockers; cards flow across each step. */
function stepsView($: EngineInterface, el: Els, map: WfMap, shown: WfTicket[], columns: number, newChat: Set<string>) {
  const { Box, Text } = el
  const byNum = new Map(map.tickets.map(t => [t.num, t]))
  const layerOf = layers(shown)
  const steps = new Map<number, WfTicket[]>()
  for (const t of shown) {
    const l = layerOf.get(t.num) ?? 0
    steps.set(l, [...(steps.get(l) ?? []), t])
  }
  const { cardWidth, gap } = cardLayout(columns)
  return (
    <Box flexDirection="column" gap={1}>
      {[...steps.keys()]
        .sort((a, b) => a - b)
        .map((l, i) => {
          const tickets = steps.get(l)!
          const done = tickets.filter(isClosed).length
          return (
            <Box key={`step:${l}`} flexDirection="column" gap={1}>
              <Box flexDirection="row" gap={1}>
                <Text bold dimColor>
                  STEP {i + 1}
                </Text>
                <Text dimColor>· {done === tickets.length ? 'all done' : `${done} of ${tickets.length} done`}</Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" columnGap={gap} rowGap={1}>
                {tickets.map(t => ticketCard($, el, map, t, cardWidth, byNum, newChat.has(t.id)))}
              </Box>
            </Box>
          )
        })}
    </Box>
  )
}

/** The same tickets as an indented tree: each under the first ticket that blocks it. */
function treeView($: EngineInterface, el: Els, map: WfMap, shown: WfTicket[]) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {treeRows(shown).map(({ ticket: t, depth, isRepeat, extraParents }, i) => {
        const st = STATUS_STYLE[t.status]
        return (
          <Box key={`r:${i}`} flexDirection="row" marginLeft={depth * 2}>
            <Text color={st.fill}>
              {depth > 0 ? '└ ' : ''}
              {st.glyph}{' '}
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
                dimColor={isClosed(t)}
                onPress={bind(`t:${t.id}`, () => openTicket($, map, t))}
              />
            )}
            {!isRepeat && t.type && <Text dimColor> · {t.type}</Text>}
            {!isRepeat && extraParents.length > 0 && <Text dimColor> · also after {extraParents.join(', ')}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

/** The status chips: each one both counts its tickets and shows only them. */
const CHIPS: { filter: WfFilter; label: string }[] = [
  { filter: 'all', label: 'All' },
  { filter: 'unresolved', label: 'To do' },
  { filter: 'frontier', label: `${STATUS_STYLE.open.glyph} Frontier` },
  { filter: 'claimed', label: `${STATUS_STYLE.claimed.glyph} Claimed` },
  { filter: 'waiting', label: `${STATUS_STYLE.waiting.glyph} Waiting on you` },
  { filter: 'blocked', label: `${STATUS_STYLE.blocked.glyph} Blocked` },
  { filter: 'done', label: `${STATUS_STYLE.done.glyph} Done` },
]

type Launches = { opened: Record<string, number>; now: number; copied: WfCopied }

/** What the last Work button copied, for the person coming back from the new chat. */
function pasteNote(el: Els, c: WfCopied) {
  const { Text } = el
  if (!c) return ''
  return (
    <Text dimColor wrap="wrap">
      {c.isCopied
        ? `✓ Copied ${c.text} · paste it in the new chat (${c.keys}) and press Enter`
        : `Could not copy · type ${c.text} in the new chat`}
    </Text>
  )
}

function mapView($: EngineInterface, el: Els, map: WfMap, v: WfView, columns: number, launches: Launches) {
  const { Box, Text, Button, Markdown, Link } = el
  const c = counts(map.tickets)
  const st = MAP_STATUS_LABEL[map.status]
  const filter: WfFilter = CHIPS.some(x => x.filter === v.filter) ? v.filter : 'all'
  const shown = visible(map.tickets, filter)
  const ready = takeable(map, launches.opened, launches.now)
  const nextUp = ready[0]
  const newChat = new Set(map.tickets.filter(t => isOpened(launches.opened, t, launches.now)).map(t => t.id))
  const isLive = map.status !== 'done' && map.status !== 'graduated'
  // ↗ where the work opens in another chat, → where it runs in this one.
  const arrow = chatFor() === 'here' ? '→' : '↗'
  const countOf: Record<WfFilter, number> = {
    all: c.total,
    unresolved: c.total - c.done,
    frontier: c.frontier,
    claimed: c.claimed,
    waiting: c.waiting,
    blocked: c.blocked,
    done: c.done,
  }
  const layoutButton = (layout: WfLayout, label: string) => (
    <Button
      key={`layout:${layout}`}
      label={label}
      variant={(v.layout ?? 'steps') === layout ? 'primary' : 'secondary'}
      onPress={bind(`layout:${layout}`, () => update($, view, x => ({ ...x, layout })))}
    />
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Button key="back" label="← All maps" plain hotkey="b" onPress={bind('back', () => openMap($, null))} />
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Text dimColor>View</Text>
          {layoutButton('steps', 'Steps')}
          {layoutButton('tree', 'Tree')}
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text bold wrap="wrap">
          {map.title}
        </Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color={st.color}>● {st.text}</Text>
          <Text dimColor>· {map.kind} · {map.source === 'github' ? `GitHub ${map.ref}` : map.dir} ·</Text>
          {map.url ? <Link href={map.url} label="Open map ↗" /> : map.path ? <Markdown text={`[Open ${map.kind} ↗](${fileUrl(map.path)})`} /> : ''}
        </Box>
      </Box>
      <Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="center">
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Text color={STATUS_STYLE.done.fill}>{bar(c.done, c.total, 20)}</Text>
          <Text>
            {c.done} of {c.total} done
          </Text>
        </Box>
        {isLive && map.kind === 'map' && (
          <Button
            key="work-next"
            label={nextUp ? `Work next: ${nextUp.ref} ${arrow}` : `Work the map ${arrow}`}
            variant="primary"
            onPress={bind('work-next', () => work($, map, nextUp ?? null))}
          />
        )}
        {/* A spec is implemented in waves (its frontier, then stop) or whole; each runs a subagent per ticket. */}
        {isLive && map.kind === 'spec' && ready.length > 0 && (
          <Button
            key="work-frontier"
            label={`Implement frontier · ${ready.length} ${arrow}`}
            variant="primary"
            onPress={bind('work-frontier', () => work($, map, null, ready))}
          />
        )}
        {isLive && map.kind === 'spec' && c.done < c.total && (
          <Button key="work-spec" label={`Implement spec ${arrow}`} variant="secondary" onPress={bind('work-spec', () => work($, map, null))} />
        )}
      </Box>
      {pasteNote(el, launches.copied)}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {CHIPS.filter(x => x.filter === 'all' || x.filter === 'unresolved' || x.filter === 'frontier' || countOf[x.filter] > 0).map(x => (
          <Button
            key={`filter:${x.filter}`}
            label={`${x.label} ${countOf[x.filter]}`}
            variant={filter === x.filter ? 'primary' : 'secondary'}
            onPress={bind(`filter:${x.filter}`, () => update($, view, y => ({ ...y, filter: x.filter })))}
          />
        ))}
      </Box>
      {shown.length === 0 && (
        <Text dimColor>
          {filter === 'frontier' ? 'Nothing is ready to take: every open ticket is blocked or claimed.' : 'No tickets match this filter.'}
        </Text>
      )}
      {shown.length > 0 && (v.layout === 'tree' ? treeView($, el, map, shown) : stepsView($, el, map, shown, columns, newChat))}
    </Box>
  )
}

/** A ticket on a page of its own: what it waits on, what waits on it, its body and actions. */
function ticketPage($: EngineInterface, el: Els, map: WfMap, t: WfTicket, det: WfDetail, launches: Launches) {
  const { Box, Text, Button, Markdown, Link } = el
  const st = STATUS_STYLE[t.status]
  const isNewChat = isOpened(launches.opened, t, launches.now)
  const byNum = new Map(map.tickets.map(x => [x.num, x]))
  const after = t.blockedBy.map(n => byNum.get(n)).filter((x): x is WfTicket => !!x)
  const unblocks = dependents(map.tickets, t.num)
  const link = (x: WfTicket, prefix: string) => (
    <Box key={`${prefix}:${x.id}`} flexDirection="row" gap={1}>
      <Text color={STATUS_STYLE[x.status].fill}>{STATUS_STYLE[x.status].glyph}</Text>
      <Button
        key={`${prefix}:${x.id}`}
        label={`${x.ref} ${x.title}`}
        plain
        dimColor={isClosed(x)}
        onPress={bind(`${prefix}:${x.id}`, () => openTicket($, map, x))}
      />
      <Text dimColor>{statusText(x)}</Text>
    </Box>
  )
  // A link in the body to another ticket of this map opens it here (where the surface hands link clicks over).
  const byPath = new Map(map.tickets.filter(x => x.path).map(x => [norm(x.path!), x]))
  const ticketLinks = (det?.id === t.id ? (det.links ?? []) : []).filter(l => byPath.has(norm(l.path)))
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="back-map" label="← Back to map" plain hotkey="b" onPress={bind('back-map', () => backToMap($))} />
      <Text dimColor wrap="truncate-end">
        {map.title}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={st.fill} paddingX={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color={st.fill}>{st.glyph}</Text>
          <Text bold>{t.ref}</Text>
          {t.type && <Text dimColor>{t.type.toUpperCase()}</Text>}
          <Text color={st.fill}>{statusText(t, isNewChat)}</Text>
          {t.rawStatus && !['open', 'closed', st.label].includes(t.rawStatus.toLowerCase()) && <Text dimColor>({t.rawStatus})</Text>}
        </Box>
        <Text bold wrap="wrap">
          {t.title}
        </Text>
      </Box>
      <Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="center">
        {!isClosed(t) && (
          <Button
            key={`work:${t.id}`}
            label={`Work this ticket ${chatFor() === 'here' ? '→' : '↗'}`}
            variant="primary"
            onPress={bind(`work:${t.id}`, () => work($, map, t))}
          />
        )}
        {t.url ? <Link href={t.url} label="Open issue ↗" /> : t.path ? <Markdown text={`[Open file ↗](${fileUrl(t.path)})`} /> : ''}
      </Box>
      {pasteNote(el, launches.copied)}
      {after.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor bold>
            WAITS ON
          </Text>
          {after.map(x => link(x, 'dep'))}
        </Box>
      )}
      {unblocks.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor bold>
            UNBLOCKS
          </Text>
          {unblocks.map(x => link(x, 'next'))}
        </Box>
      )}
      {ticketLinks.length > 0 ? (
        <Markdown
          key="body"
          text={det!.body}
          pressableLinks={ticketLinks.map(l => l.href)}
          onLinkPress={link => {
            const target = ticketLinks.find(l => l.href === link.href)
            const x = target ? byPath.get(norm(target.path)) : undefined
            if (x) void openTicket($, map, x)
          }}
        />
      ) : (
        <Markdown text={det?.id === t.id ? det.body : '_Loading…_'} />
      )}
    </Box>
  )
}

export const register: Register = (on, options) => {
  if (options.workIn === 'new-chat' || options.workIn === 'here') workIn = options.workIn
  if (typeof options.mapPrompt === 'string') prompts.map = options.mapPrompt
  if (typeof options.mapTicketPrompt === 'string') prompts.mapTicket = options.mapTicketPrompt
  if (typeof options.specTicketPrompt === 'string') prompts.specTicket = options.specTicketPrompt
  if (typeof options.specPrompt === 'string') prompts.spec = options.specPrompt
  if (typeof options.frontierPrompt === 'string') prompts.frontier = options.frontierPrompt

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'wayfinder-maps',
      description: 'Open the Wayfinder drawer: every map and spec in this project, their tickets and dependencies',
    })
    $.clock.every(POLL_MS, () => void pollIfOpen($, false))
    // A first scan in the background, so the band can offer the drawer in a wayfinder project.
    $.clock.after(500, () => void refresh($, false, true).then(() => platformOf($)))
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
  }).catch(($, e, next) => next(e))

  on('ui.press', async ($, e, next) => {
    if (!handlers.has(e.element)) return next(e)
    if (!gate.press(e.element, await $.clock.now())) return { element: e.element }
    return next(e)
  })

  // A ticket card (card.tsx) posts `{ open: id }` when clicked anywhere.
  on('ui.message', async ($, e, next) => {
    const open = (e.data as { open?: unknown } | null)?.open
    if (e.requestId !== PANE || typeof open !== 'string') return next(e)
    const d = await read($, data)
    const v = await read($, view)
    const map = d?.maps.find(m => m.id === v.mapId)
    const ticket = map?.tickets.find(t => t.id === open)
    if (map && ticket) await openTicket($, map, ticket)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, isPaneOpen, () => false)
    return result
  }).catch(($, e, next) => next(e))

  // The band above the prompt: shown only where the project has maps, and only while the drawer is closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const d = await read($, data)
    const open = await read($, isPaneOpen)
    if (e.props.hasSurvey || open || !d || d.maps.length === 0) return next(e)
    drawnOn = e.surface
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
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
        {mark(el)}
        <Text dimColor>·</Text>
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
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const d = await read($, data)
    const loading = await read($, isLoading)
    const v = await read($, view)
    const columns = Math.max(20, (e.props.bodyColumns ?? 60) - 2)
    const top = header($, el, loading)

    if (!d) {
      return (
        <Box flexDirection="column" gap={1}>
          {top}
          <Text dimColor>{loading ? 'Looking for maps…' : 'Press Refresh to scan this project.'}</Text>
        </Box>
      )
    }
    const map = v.mapId ? d.maps.find(m => m.id === v.mapId) : undefined
    const ticket = map && v.ticketId ? map.tickets.find(t => t.id === v.ticketId) : undefined
    // `started` may predate a hot reload that added it.
    const launches: Launches = { opened: (await read($, started)) ?? {}, now: await $.clock.now(), copied: (await read($, copied)) ?? null }
    const body = !map
      ? mapList($, el, d)
      : ticket
        ? ticketPage($, el, map, ticket, await read($, detail), launches)
        : mapView($, el, map, v, columns, launches)
    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {top}
        {body}
      </Box>
    )
  })
}
