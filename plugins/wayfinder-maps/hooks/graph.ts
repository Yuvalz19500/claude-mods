import type { WfStatus, WfTicket } from '../types'

/** Trail-blaze colors: what each status is painted, in the graph and in the drawer. */
export const STATUS_STYLE: Record<WfStatus | 'frontier', { fill: string; label: string; glyph: string }> = {
  open: { fill: '#f26b1d', label: 'frontier', glyph: '⚑' },
  frontier: { fill: '#f26b1d', label: 'frontier', glyph: '⚑' },
  claimed: { fill: '#3d7be0', label: 'claimed', glyph: '●' },
  waiting: { fill: '#d9a21b', label: 'waiting on you', glyph: '⧗' },
  blocked: { fill: '#8e959c', label: 'blocked', glyph: '◌' },
  done: { fill: '#3f9a66', label: 'done', glyph: '✓' },
  dropped: { fill: '#6c7279', label: 'out of scope', glyph: '✕' },
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Splits a title into at most two lines of `max` characters. */
function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = ['']
  for (const w of words) {
    const cur = lines[lines.length - 1]
    if ((cur + ' ' + w).trim().length <= max) lines[lines.length - 1] = (cur + ' ' + w).trim()
    else if (lines.length < 2) lines.push(w)
    else {
      lines[1] = (lines[1] + ' ' + w).slice(0, max - 1) + '…'
      break
    }
  }
  return lines.map(l => (l.length > max ? l.slice(0, max - 1) + '…' : l))
}

/** Layer = longest chain of blockers above it, within the shown set. */
export function layers(tickets: WfTicket[]): Map<number, number> {
  const byNum = new Map(tickets.map(t => [t.num, t]))
  const memo = new Map<number, number>()
  const visit = (num: number, seen: Set<number>): number => {
    if (memo.has(num)) return memo.get(num)!
    if (seen.has(num)) return 0
    seen.add(num)
    const t = byNum.get(num)!
    const parents = t.blockedBy.filter(n => byNum.has(n))
    const layer = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(p => visit(p, seen)))
    seen.delete(num)
    memo.set(num, layer)
    return layer
  }
  for (const t of tickets) visit(t.num, new Set())
  return memo
}

/** The status marks, drawn once in <defs> and placed on each card with <use>; 14×14 at the card's top-right. */
const MARKS = [
  // a pennant: the trail goes here next
  `<g id="m-open"><path d="M0,13V0l9,3.5l-9,3.5" stroke="${STATUS_STYLE.open.fill}" fill="${STATUS_STYLE.open.fill}" class="pole"/></g>`,
  // an hourglass: the ball is in your court
  `<g id="m-waiting"><path d="M-1,0h10l-5,6.5l5,6.5h-10l5,-6.5z" fill="${STATUS_STYLE.waiting.fill}"/></g>`,
  // a padlock
  `<g id="m-blocked"><path d="M1,6v-2.5a3,3 0 0 1 6,0v2.5" fill="none" stroke="${STATUS_STYLE.blocked.fill}" stroke-width="1.6"/><rect x="-1" y="6" width="10" height="7.5" rx="1.5" fill="${STATUS_STYLE.blocked.fill}"/></g>`,
  `<g id="m-done"><circle cx="4" cy="6" r="7" fill="${STATUS_STYLE.done.fill}"/><path d="M.8,6.2l2.3,2.3l4.2,-4.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  `<g id="m-dropped"><path d="M0,2l8,8M8,2l-8,8" stroke="${STATUS_STYLE.dropped.fill}" stroke-width="1.8" stroke-linecap="round"/></g>`,
].join('')

/** One card's mark: a <use> of the shared symbol, or the assignee's initial in a disc when claimed. */
function statusMark(t: WfTicket, x: number, y: number): string {
  if (t.status === 'claimed') {
    const initial = esc((t.assignee ?? '•').replace(/^@/, '').charAt(0).toUpperCase())
    return `<circle cx="${x + 4}" cy="${y + 6}" r="7" fill="${STATUS_STYLE.claimed.fill}"/><text x="${x + 4}" y="${y + 9}" class="ini" text-anchor="middle">${initial}</text>`
  }
  return `<use href="#m-${t.status}" x="${x}" y="${y}"/>`
}

/** A gently wavering line across the map: the contour between two steps, at y = 0. Two variants, so neighbours differ. */
function contourPath(W: number, seed: number): string {
  let d = 'M8,0'
  for (let x = 8; x < W - 20; x += 24) {
    const a = 2 + ((seed * 7 + x) % 5) * 0.35
    d += ` q6,${-a.toFixed(1)} 12,0 t12,0`
  }
  return `<path id="contour${seed % 2}" d="${d}"/>`
}

/**
 * The dependency graph as one SVG, drawn as a trail map: tickets are waypoint
 * cards with a painted blaze in their status color, set out in steps (each
 * ticket a step below its blockers) separated by contour lines, with trails
 * from each blocker down to what it unblocks: solid while the blocker is
 * still ahead, dotted once it is walked.
 */
/** What the Svg element takes at most. */
export const SVG_LIMIT = 131_000

export function graphSvg(tickets: WfTicket[], widthPx: number): { svg: string; width: number; height: number; isTooBig: boolean } {
  const W = Math.max(300, Math.min(1100, widthPx))
  const NODE_W = 172
  const NODE_H = 60
  const GAP_X = 12
  const GAP_Y = 44
  const WRAP_GAP = 12
  const PAD = 12
  const TOP = 46
  const perRow = Math.max(1, Math.floor((W - PAD * 2 + GAP_X) / (NODE_W + GAP_X)))
  const layerOf = layers(tickets)
  const byNum = new Map(tickets.map(t => [t.num, t]))
  const byLayer = new Map<number, WfTicket[]>()
  for (const t of tickets) {
    const l = layerOf.get(t.num) ?? 0
    byLayer.set(l, [...(byLayer.get(l) ?? []), t])
  }

  const pos = new Map<number, { x: number; y: number }>()
  const contours: string[] = []
  let y = TOP
  for (const [step, l] of [...byLayer.keys()].sort((a, b) => a - b).entries()) {
    if (step > 0) {
      const cy = y - GAP_Y / 2 + 2
      contours.push(`<use href="#contour${step % 2}" y="${cy}" class="contour"/>`)
    }
    contours.push(`<text x="${PAD}" y="${y - 6}" class="step">STEP ${step + 1}</text>`)
    // Order under parents (barycenter of their x), else by number.
    const row = byLayer.get(l)!.map(t => {
      const xs = t.blockedBy.map(n => pos.get(n)?.x).filter((x): x is number => x !== undefined)
      return { t, key: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : t.num * 1e-3 }
    })
    row.sort((a, b) => a.key - b.key || a.t.num - b.t.num)
    for (let i = 0; i < row.length; i += perRow) {
      const chunk = row.slice(i, i + perRow)
      const rowWidth = chunk.length * NODE_W + (chunk.length - 1) * GAP_X
      let x = Math.max(PAD, (W - rowWidth) / 2)
      for (const { t } of chunk) {
        pos.set(t.num, { x, y })
        x += NODE_W + GAP_X
      }
      y += NODE_H + WRAP_GAP
    }
    y += GAP_Y - WRAP_GAP
  }
  const H = y - GAP_Y + PAD

  const trails: string[] = []
  for (const t of tickets) {
    const to = pos.get(t.num)!
    for (const b of t.blockedBy) {
      const from = pos.get(b)
      if (!from) continue
      const x1 = Math.round(from.x + NODE_W / 2)
      const y1 = from.y + NODE_H
      const x2 = Math.round(to.x + NODE_W / 2)
      const y2 = to.y - 4
      const dy = Math.round(Math.max(20, (y2 - y1) / 2))
      const isWalked = byNum.get(b)?.status === 'done'
      trails.push(
        `<path d="M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}" class="${isWalked ? 'trail walked' : 'trail'}" marker-end="url(#${isWalked ? 'hw' : 'h'})"/>`,
      )
    }
  }

  // Cards are positioned by translate; inside, every coordinate is the card's own.
  const card = (t: WfTicket, withTips: boolean) => {
    const { x, y: ny } = pos.get(t.num)!
    const st = STATUS_STYLE[t.status]
    const [l1, l2 = ''] = wrap(t.title, 25)
    const tip = withTips
      ? `<title>${esc(
          `${t.ref} · ${t.title}\n${st.label}${t.type ? ` · ${t.type}` : ''}${t.assignee ? ` · ${t.assignee}` : ''}${
            t.blockedBy.length ? `\nafter ${t.blockedBy.map(n => byNum.get(n)?.ref ?? n).join(', ')}` : ''
          }`,
        )}</title>`
      : ''
    const type = t.type ? `<tspan class="type" dx="7">${esc(t.type.toUpperCase())}</tspan>` : ''
    return `<g class="n ${t.status}" transform="translate(${Math.round(x)},${ny})">${tip}<use href="#card" class="card"/><use href="#blaze" fill="${st.fill}"/><text x="17" y="18"><tspan class="ref">${esc(t.ref)}</tspan>${type}</text><text x="17" y="35" class="ttl">${esc(l1)}</text>${l2 ? `<text x="17" y="49" class="ttl">${esc(l2)}</text>` : ''}${statusMark(t, NODE_W - 17, 8)}</g>`
  }

  const legend = (['open', 'claimed', 'waiting', 'blocked', 'done'] as const)
    .map((s, i) => {
      const lx = PAD + i * Math.min(100, (W - PAD * 2) / 5)
      return `<rect x="${lx}" y="${PAD}" width="3.5" height="11" rx="1.75" fill="${STATUS_STYLE[s].fill}"/><text x="${lx + 8}" y="${PAD + 9}" class="lg">${STATUS_STYLE[s].label.toUpperCase()}</text>`
    })
    .join('')

  const MONO = `ui-monospace,'Cascadia Code',Consolas,monospace`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>
svg{--card:#fff;--edge:#d9dbd2;--ink:#1d2125;--muted:#6c7279;--trail:#5f666d;--contour:#c3c8b8}
@media (prefers-color-scheme:dark){svg{--card:#262a30;--edge:#383e46;--ink:#e9ebee;--muted:#9aa1a9;--trail:#a3aab2;--contour:#47515a}}
text{font-family:ui-sans-serif,system-ui,'Segoe UI',sans-serif;fill:var(--ink)}
.ref{font-family:${MONO};font-weight:700;font-size:11.5px}
.type,.lg,.step{font-family:${MONO};font-weight:600;font-size:8.5px;letter-spacing:.09em;fill:var(--muted)}
.step{font-size:8px;letter-spacing:.16em;opacity:.85}
.ttl{font-size:11.5px}
.ini{font-weight:700;font-size:8.5px;fill:#fff}
.card{fill:var(--card);stroke:var(--edge);stroke-width:1}
.n.open .card{stroke:${STATUS_STYLE.open.fill};stroke-width:1.6}
.n.blocked .card{stroke-dasharray:4 3}
.n.done .card~*,.n.dropped .card~*{opacity:.55}
.n:hover .card~*{opacity:1}
.n:hover .card{stroke:var(--ink);stroke-width:1.6}
.pole{stroke-width:1.6;stroke-linejoin:round}
.trail{fill:none;stroke:var(--trail);stroke-width:1.5;stroke-opacity:.85}
.trail.walked{stroke-width:1.5;stroke-dasharray:.1 4.5;stroke-linecap:round;stroke-opacity:.6}
.contour{fill:none;stroke:var(--contour);stroke-width:.9}
</style>
<defs>
<marker id="h" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1.5L8,5L1,8.5" fill="none" stroke="var(--trail)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
<marker id="hw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1.5L8,5L1,8.5" fill="none" stroke="var(--trail)" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
<rect id="card" width="${NODE_W}" height="${NODE_H}" rx="6"/>
<rect id="blaze" x="6" y="9" width="3.5" height="${NODE_H - 18}" rx="1.75"/>
${MARKS}
${contourPath(W, 0)}${contourPath(W, 1)}
</defs>
${legend}
${contours.join('\n')}
${trails.join('\n')}
%CARDS%
</svg>`
  // Tooltips are the first thing to go when a big map would pass the Svg element's limit.
  const withTips = svg.replace('%CARDS%', tickets.map(t => card(t, true)).join(''))
  const out = withTips.length <= SVG_LIMIT ? withTips : svg.replace('%CARDS%', tickets.map(t => card(t, false)).join(''))
  return { svg: out, width: W, height: H, isTooBig: out.length > SVG_LIMIT }
}

/**
 * The same graph as an indented tree: each ticket under the first ticket that
 * blocks it, later mentions as a pointer back. Rows in display order.
 */
export function treeRows(tickets: WfTicket[]): { ticket: WfTicket; depth: number; isRepeat: boolean; extraParents: number[] }[] {
  const shown = new Set(tickets.map(t => t.num))
  const children = new Map<number, WfTicket[]>()
  const roots: WfTicket[] = []
  for (const t of tickets) {
    const parents = t.blockedBy.filter(n => shown.has(n))
    if (parents.length === 0) roots.push(t)
    else for (const p of parents) children.set(p, [...(children.get(p) ?? []), t])
  }
  const rows: { ticket: WfTicket; depth: number; isRepeat: boolean; extraParents: number[] }[] = []
  const placed = new Set<number>()
  const walk = (t: WfTicket, depth: number, parent: number | null) => {
    if (placed.has(t.num)) {
      rows.push({ ticket: t, depth, isRepeat: true, extraParents: [] })
      return
    }
    placed.add(t.num)
    const extraParents = t.blockedBy.filter(n => shown.has(n) && n !== parent)
    rows.push({ ticket: t, depth, isRepeat: false, extraParents })
    for (const c of children.get(t.num) ?? []) walk(c, depth + 1, t.num)
  }
  for (const r of roots) walk(r, 0, null)
  // Cycles leave tickets unplaced: show them at the top level.
  for (const t of tickets) if (!placed.has(t.num)) walk(t, 0, null)
  return rows
}
