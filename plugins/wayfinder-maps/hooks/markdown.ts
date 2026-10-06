
import type { WfMap } from '../types'
import { finishTickets, mapStatus, parseHeadDoc, parseTicketFile } from './parse'
import type { Io } from './parse'
import type { ParsedTicketFile } from './parse'

/** Folders never worth descending into when looking for maps. */
const SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'target', 'vendor',
  '.next', '.turbo', '.cache', '.venv', 'venv', '__pycache__', 'worktrees', '.pnpm-store',
  'src', 'assets', 'designs', 'research', 'spikes',
])
const TICKET_DIRS = ['issues', 'tickets']
const MAX_DEPTH = 4

const join = (a: string, b: string) => (a.endsWith('/') || a.endsWith('\\') ? a + b : `${a}/${b}`)

async function list(io: Io, path: string) {
  try {
    return await io.list(path)
  } catch {
    return []
  }
}

async function readText(io: Io, path: string): Promise<string> {
  try {
    return await io.read(path)
  } catch {
    return ''
  }
}

/** Every folder holding a `map.md` / `spec.md` beside an `issues/` or `tickets/` folder, to MAX_DEPTH. */
async function findEffortDirs(io: Io, root: string): Promise<{ dir: string; rel: string; names: Set<string> }[]> {
  const found: { dir: string; rel: string; names: Set<string> }[] = []
  let frontier: { dir: string; rel: string }[] = [{ dir: root, rel: '' }]
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
    const next: { dir: string; rel: string }[] = []
    await Promise.all(
      frontier.map(async ({ dir, rel }) => {
        const entries = await list(io, dir)
        const names = new Set(entries.map(e => e.name))
        const ticketDir = TICKET_DIRS.find(d => entries.some(e => e.name === d && e.kind === 'dir'))
        if (ticketDir && rel !== '') found.push({ dir, rel, names })
        for (const e of entries) {
          if (e.kind !== 'dir' || SKIP.has(e.name) || TICKET_DIRS.includes(e.name)) continue
          if (e.name.startsWith('.') && !['.scratch', '.wayfinder', '.planning'].includes(e.name)) continue
          next.push({ dir: join(dir, e.name), rel: rel ? `${rel}/${e.name}` : e.name })
        }
      }),
    )
    frontier = next
  }
  return found
}

/** Loads every markdown map and spec under the project root. */
export async function loadMarkdownMaps(io: Io, root: string): Promise<WfMap[]> {
  const dirs = await findEffortDirs(io, root)
  const maps = await Promise.all(
    dirs.map(async ({ dir, rel, names }): Promise<WfMap | null> => {
      const ticketDirName = TICKET_DIRS.find(d => names.has(d))!
      const ticketDir = join(dir, ticketDirName)
      const files = (await list(io, ticketDir)).filter(e => e.kind === 'file' && /^\d+-.*\.md$/.test(e.name))
      const parsed = (
        await Promise.all(
          files.map(async f => {
            const path = join(ticketDir, f.name)
            return parseTicketFile(f.name, path, await readText(io, path))
          }),
        )
      ).filter((t): t is ParsedTicketFile => t !== null)

      const hasMap = names.has('map.md')
      const hasSpec = names.has('spec.md')
      // A plain issues folder only counts when its files look like tracker tickets.
      if (!hasMap && !hasSpec && !parsed.some(t => t.rawStatus !== '')) return null
      if (parsed.length === 0 && !hasMap) return null

      const kind: WfMap['kind'] = hasMap ? 'map' : 'spec'
      const headPath = join(dir, hasMap ? 'map.md' : hasSpec ? 'spec.md' : '')
      const head = hasMap || hasSpec ? parseHeadDoc(await readText(io, headPath)) : {}
      const tickets = finishTickets(parsed)
      const folder = rel.split('/').pop() ?? rel
      return {
        id: `md:${rel}`,
        kind,
        source: 'md',
        title: head.title ?? folder,
        ref: hasMap || hasSpec ? `${rel}/${hasMap ? 'map.md' : 'spec.md'}` : rel,
        dir: rel,
        path: hasMap || hasSpec ? headPath : dir,
        status: mapStatus(kind, tickets, head.status, hasSpec),
        tickets,
      }
    }),
  )
  return maps.filter((m): m is WfMap => m !== null)
}

export { readText }
