
import type { WfMap, WfStatus } from '../types'
import { finishTickets, mapStatus } from './parse'
import type { Io } from './parse'
import type { ParsedTicketFile } from './parse'

type GhIssue = {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  stateReason?: string | null
  url: string
  body?: string
  assignees?: { nodes: { login: string }[] }
  labels?: { nodes: { name: string }[] }
  blockedBy?: { nodes: { number: number }[] }
  subIssues?: { totalCount?: number; nodes: GhIssue[] }
}

const CHILD = `number title state stateReason url body
  assignees(first: 3) { nodes { login } }
  labels(first: 10) { nodes { name } }
  blockedBy(first: 30) { nodes { number } }
  subIssues(first: 1) { totalCount }`

const HEAD = `number title state stateReason url body labels(first: 10) { nodes { name } } subIssues(first: 100) { nodes { ${CHILD} } }`

const MAPS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, labels: ["wayfinder:map"], states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { ${HEAD} }
    }
  }
}`

/** A graduated spec is an issue titled `Spec: …` (or labelled `wayfinder:spec`); search finds both. */
const SPECS_QUERY = `query($byTitle: String!, $byLabel: String!) {
  byTitle: search(query: $byTitle, type: ISSUE, first: 50) { nodes { ... on Issue { ${HEAD} } } }
  byLabel: search(query: $byLabel, type: ISSUE, first: 20) { nodes { ... on Issue { ${HEAD} } } }
}`
const SPEC_TITLE = /^\s*spec\s*[:·—–-]/i

async function gh(io: Io, root: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const r = await io.run(['gh', ...args], root)
    return { ok: r.exitCode === 0, out: r.stdout, err: r.stderr }
  } catch (error) {
    return { ok: false, out: '', err: String(error) }
  }
}

/** `owner/name` of the repo's GitHub remote, or null when it has none (or gh is missing). */
export async function githubRepo(io: Io, root: string): Promise<string | null> {
  const r = await gh(io, root, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  return r.ok && r.out.trim() ? r.out.trim() : null
}

/** Without native links: `- [ ] #12` task-list children on the map, `Blocked by: #3` lines on the child. */
function taskListNumbers(body: string): number[] {
  return [...body.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+.*?#(\d+)/gm)].map(m => Number(m[1]))
}
/** `Blocked by: #3 #4` near the top, or a `## Blocked by` heading (or bare `Blocked by:` line) over a `- #3` list. */
function bodyBlockers(body: string): number[] {
  const lines = body.split(/\r?\n/)
  const line = lines.slice(0, 15).find(l => /^\**blocked by\**\s*:/i.test(l))
  if (line && /#\d+/.test(line)) return [...line.matchAll(/#(\d+)/g)].map(m => Number(m[1]))
  const start = lines.findIndex(l => /^\s*(#{1,6}\s*)?\**blocked by\**\s*:?\s*\**\s*$/i.test(l))
  if (start < 0) return []
  const found: number[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(l)) break
    const item = l.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?.*?#(\d+)/)
    if (item) found.push(Number(item[1]))
    else if (l.trim() !== '') break
  }
  return found
}

async function fetchByNumber(io: Io, root: string, owner: string, name: string, numbers: number[]): Promise<GhIssue[]> {
  if (numbers.length === 0) return []
  const fields = numbers.map(n => `i${n}: issue(number: ${n}) { ${CHILD} }`).join('\n')
  const q = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`
  const r = await gh(io, root, ['api', 'graphql', '-f', `query=${q}`, '-F', `owner=${owner}`, '-F', `name=${name}`])
  if (!r.ok) return []
  const repo = JSON.parse(r.out).data?.repository ?? {}
  return Object.values(repo).filter(Boolean) as GhIssue[]
}

/**
 * Children that have sub-issues of their own are groups (GitHub caps a parent at 100 sub-issues,
 * so a big spec groups its tickets, by build step say): their sub-issues are the tickets.
 */
async function expandGroups(io: Io, root: string, owner: string, name: string, children: GhIssue[]): Promise<GhIssue[]> {
  const groups = children.filter(c => (c.subIssues?.totalCount ?? 0) > 0)
  if (groups.length === 0) return children
  const fields = groups.map(g => `g${g.number}: issue(number: ${g.number}) { subIssues(first: 100) { nodes { ${CHILD} } } }`).join('\n')
  const q = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`
  const r = await gh(io, root, ['api', 'graphql', '-f', `query=${q}`, '-F', `owner=${owner}`, '-F', `name=${name}`])
  if (!r.ok) return children
  const repo = JSON.parse(r.out).data?.repository ?? {}
  const inner = new Map(groups.map(g => [g.number, (repo[`g${g.number}`]?.subIssues?.nodes ?? []) as GhIssue[]]))
  return children.flatMap(c => inner.get(c.number) ?? [c])
}

function toTicket(issue: GhIssue): ParsedTicketFile & { closedAs?: WfStatus } {
  const labels = issue.labels?.nodes.map(l => l.name) ?? []
  const type = labels.find(l => l.startsWith('wayfinder:'))?.slice('wayfinder:'.length)
  const native = issue.blockedBy?.nodes.map(n => n.number) ?? []
  const closedAs: WfStatus | undefined =
    issue.state === 'CLOSED' ? (issue.stateReason === 'NOT_PLANNED' ? 'dropped' : 'done') : undefined
  const awaiting = labels.some(l => /awaiting|ready-for-human|needs-human/.test(l))
  return {
    id: issue.url,
    num: issue.number,
    ref: `#${issue.number}`,
    title: issue.title,
    rawStatus: closedAs ? 'closed' : awaiting ? 'awaiting' : 'open',
    closedAs,
    type: type && type !== 'map' ? type : undefined,
    assignee: issue.assignees?.nodes[0]?.login,
    blockedBy: native.length > 0 ? native : bodyBlockers(issue.body ?? ''),
    url: issue.url,
  }
}

/** The spec issues of the repo: titled `Spec: …` or labelled `wayfinder:spec`, maps left out. */
async function findSpecs(io: Io, root: string, repo: string): Promise<GhIssue[]> {
  const r = await gh(io, root, [
    'api', 'graphql',
    '-f', `query=${SPECS_QUERY}`,
    '-f', `byTitle=repo:${repo} is:issue in:title spec`,
    '-f', `byLabel=repo:${repo} is:issue label:"wayfinder:spec"`,
  ])
  if (!r.ok) return []
  const data = JSON.parse(r.out).data ?? {}
  const found = new Map<number, GhIssue>()
  for (const issue of [...(data.byTitle?.nodes ?? []), ...(data.byLabel?.nodes ?? [])] as GhIssue[]) {
    if (!issue?.number) continue
    const labels = issue.labels?.nodes.map(l => l.name) ?? []
    if (labels.includes('wayfinder:map')) continue
    if (labels.includes('wayfinder:spec') || SPEC_TITLE.test(issue.title)) found.set(issue.number, issue)
  }
  return [...found.values()]
}

/** Loads every `wayfinder:map` issue and every spec issue of the repo with their sub-issues and blocking edges. */
export async function loadGithubMaps(io: Io, root: string, repo: string): Promise<{ maps: WfMap[]; error?: string }> {
  const [owner = '', name = ''] = repo.split('/')
  const [r, specIssues] = await Promise.all([
    gh(io, root, ['api', 'graphql', '-f', `query=${MAPS_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`]),
    findSpecs(io, root, repo),
  ])
  if (!r.ok) return { maps: [], error: `GitHub: ${(r.err || r.out).trim().split('\n')[0]}` }
  const mapIssues: GhIssue[] = JSON.parse(r.out).data?.repository?.issues?.nodes ?? []
  // A spec names the map it graduated from: `Parent map: #1`.
  const graduated = new Set(
    specIssues.flatMap(s => [...(s.body ?? '').matchAll(/parent map\**\s*:\**\s*#(\d+)/gi)].map(m => Number(m[1]))),
  )

  const load = async (issue: GhIssue, kind: WfMap['kind']): Promise<WfMap> => {
    let children = issue.subIssues?.nodes ?? []
    if (children.length === 0) {
      children = await fetchByNumber(io, root, owner, name, taskListNumbers(issue.body ?? ''))
    }
    children = await expandGroups(io, root, owner, name, children)
    const tickets = finishTickets(children.map(toTicket))
    const isClosed = issue.state === 'CLOSED'
    return {
      id: `gh:${repo}#${issue.number}`,
      kind,
      source: 'github',
      title: issue.title,
      ref: `#${issue.number}`,
      url: issue.url,
      status: mapStatus(kind, tickets, isClosed ? 'closed' : undefined, kind === 'map' && graduated.has(issue.number)),
      tickets,
    }
  }
  const maps = await Promise.all([...mapIssues.map(i => load(i, 'map')), ...specIssues.map(i => load(i, 'spec'))])
  return { maps }
}

/** A ticket's full body and comments, for the details view. */
export async function githubIssueBody(io: Io, root: string, url: string): Promise<string> {
  const r = await gh(io, root, ['issue', 'view', url, '--json', 'body,comments', '-q', '{body: .body, comments: [.comments[] | {author: .author.login, body: .body}]}'])
  if (!r.ok) return `_Could not load the issue: ${r.err.trim()}_`
  const data = JSON.parse(r.out) as { body: string; comments: { author: string; body: string }[] }
  const comments = data.comments.map(c => `**${c.author}:**\n\n${c.body}`).join('\n\n---\n\n')
  return comments ? `${data.body}\n\n## Comments\n\n${comments}` : data.body
}
