import type { Io } from '../hooks/parse'

/** A small project on a fake disk: one wayfinder map, one spec, and noise to skip. */
export const FILES: Record<string, string> = {
  'R/.scratch/design/map.md': '# Design: from plan to approved design\n\nLabel: wayfinder:map\n\n## Destination\n\nAn approved design.',
  'R/.scratch/design/issues/01-look.md': '# Look of the tools\n\nType: research\nStatus: resolved\n\n## Question\n\nWhat do tools look like?\n\n## Answer\n\nDark and dense.',
  'R/.scratch/design/issues/02-direction.md': '# Visual direction\n\nType: prototype\nStatus: open\nBlocked by: 01\n\n## Question\n\nWhich direction?',
  'R/.scratch/design/issues/03-shell.md': '# App shell\n\nType: grilling\nStatus: open\nBlocked by: 02\n\n## Question\n\nWhat shell?',
  'R/.scratch/design/issues/04-name.md': '# Product name\n\nType: grilling\nStatus: claimed\nAssignee: Yuval\n\n## Question\n\nName?',
  'R/.scratch/design/issues/05-brief.brief.md': '# a design brief, not a ticket',
  'R/.scratch/build/spec.md': '# Build release 0.1\n\nThe spec.',
  'R/.scratch/build/issues/01-scaffold.md': '# 01 — Scaffold\n\n**Status:** done\n\n- [ ] check',
  'R/.scratch/build/issues/02-store.md': '# 02 — Store\n\n**Blocked by:**\n\n- 01 — Scaffold\n\n**Status:** ready-for-agent',
  'R/docs/readme.md': '# not a map',
  'R/node_modules/pkg/issues/01-x.md': '# must be skipped\nStatus: open',
}

/** Every directory implied by FILES, with its entries. */
export function dirs(): Record<string, { name: string; kind: string }[]> {
  const out: Record<string, Map<string, string>> = {}
  for (const path of Object.keys(FILES)) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      out[dir] ??= new Map()
      out[dir]!.set(parts[i]!, i === parts.length - 1 ? 'file' : 'dir')
    }
  }
  return Object.fromEntries(Object.entries(out).map(([d, m]) => [d, [...m].map(([name, kind]) => ({ name, kind }))]))
}

export function fakeIo(run: Io['run'] = async () => ({ exitCode: 1, stdout: '', stderr: 'gh: not a repo' })): Io {
  const d = dirs()
  return {
    list: async path => d[path] ?? [],
    read: async path => {
      if (!(path in FILES)) throw new Error(`ENOENT ${path}`)
      return FILES[path]!
    },
    run,
  }
}

/** What `gh api graphql` answers for a repo with one map, three sub-issues and native blocking. */
export const GH_MAPS = {
  data: {
    repository: {
      issues: {
        nodes: [
          {
            number: 1,
            title: 'Pick a database',
            state: 'OPEN',
            url: 'https://github.com/o/r/issues/1',
            body: '## Destination',
            subIssues: {
              nodes: [
                { number: 2, title: 'Expected load', state: 'CLOSED', stateReason: 'COMPLETED', url: 'https://github.com/o/r/issues/2', body: '', assignees: { nodes: [] }, labels: { nodes: [{ name: 'wayfinder:research' }] }, blockedBy: { nodes: [] } },
                { number: 3, title: 'Hosted or not', state: 'OPEN', url: 'https://github.com/o/r/issues/3', body: '', assignees: { nodes: [{ login: 'yuval' }] }, labels: { nodes: [{ name: 'wayfinder:grilling' }] }, blockedBy: { nodes: [] } },
                { number: 4, title: 'Pick the engine', state: 'OPEN', url: 'https://github.com/o/r/issues/4', body: '', assignees: { nodes: [] }, labels: { nodes: [{ name: 'wayfinder:grilling' }] }, blockedBy: { nodes: [{ number: 2 }, { number: 3 }] } },
                { number: 5, title: 'Dropped idea', state: 'CLOSED', stateReason: 'NOT_PLANNED', url: 'https://github.com/o/r/issues/5', body: '', assignees: { nodes: [] }, labels: { nodes: [] }, blockedBy: { nodes: [] } },
              ],
            },
          },
          {
            number: 9,
            title: 'Old map without sub-issues',
            state: 'CLOSED',
            url: 'https://github.com/o/r/issues/9',
            body: '## Tickets\n\n- [x] #10\n- [ ] #11',
            subIssues: { nodes: [] },
          },
        ],
      },
    },
  },
}

export const GH_BY_NUMBER = {
  data: {
    repository: {
      i10: { number: 10, title: 'First', state: 'CLOSED', url: 'https://github.com/o/r/issues/10', body: '', assignees: { nodes: [] }, labels: { nodes: [] }, blockedBy: { nodes: [] } },
      i11: { number: 11, title: 'Second', state: 'OPEN', url: 'https://github.com/o/r/issues/11', body: 'Blocked by: #10\n\n## Question', assignees: { nodes: [] }, labels: { nodes: [] }, blockedBy: { nodes: [] } },
    },
  },
}

/** A fake `gh`: repo view, the maps query, the by-number query and issue view. */
export const fakeGh: Io['run'] = async argv => {
  const args = argv.join(' ')
  if (args.startsWith('gh repo view')) return { exitCode: 0, stdout: 'o/r\n', stderr: '' }
  if (args.includes('wayfinder:map')) return { exitCode: 0, stdout: JSON.stringify(GH_MAPS), stderr: '' }
  if (args.includes('i10: issue')) return { exitCode: 0, stdout: JSON.stringify(GH_BY_NUMBER), stderr: '' }
  if (args.startsWith('gh issue view')) return { exitCode: 0, stdout: JSON.stringify({ body: 'Issue body', comments: [{ author: 'yuval', body: 'Answer: 50/s' }] }), stderr: '' }
  return { exitCode: 1, stdout: '', stderr: `unexpected: ${args}` }
}
