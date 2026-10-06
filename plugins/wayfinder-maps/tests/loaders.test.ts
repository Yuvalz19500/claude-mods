import { describe, expect, test } from 'claude-code/testing'

import { githubIssueBody, githubRepo, loadGithubMaps } from '../hooks/github'
import { loadMarkdownMaps } from '../hooks/markdown'
import { fakeGh, fakeIo } from './fixtures'

describe('loadMarkdownMaps', () => {
  test('finds the map and the spec, and skips node_modules and plain docs', async () => {
    const maps = await loadMarkdownMaps(fakeIo(), 'R')
    expect(maps.map(m => [m.kind, m.dir, m.title]).sort()).toEqual([
      ['map', '.scratch/design', 'Design: from plan to approved design'],
      ['spec', '.scratch/build', 'Build release 0.1'],
    ])
  })

  test('reads a map’s tickets with their states, skipping design briefs', async () => {
    const map = (await loadMarkdownMaps(fakeIo(), 'R')).find(m => m.kind === 'map')!
    expect(map.ref).toBe('.scratch/design/map.md')
    expect(map.status).toBe('active')
    expect(map.tickets.map(t => [t.ref, t.status, t.isFrontier])).toEqual([
      ['01', 'done', false],
      ['02', 'open', true],
      ['03', 'blocked', false],
      ['04', 'claimed', false],
    ])
    expect(map.tickets[3]!.assignee).toBe('Yuval')
    expect(map.tickets[1]!.path).toBe('R/.scratch/design/issues/02-direction.md')
  })

  test('reads a spec’s bold fields and listed blockers', async () => {
    const spec = (await loadMarkdownMaps(fakeIo(), 'R')).find(m => m.kind === 'spec')!
    expect(spec.tickets.map(t => [t.title, t.status, t.blockedBy])).toEqual([
      ['Scaffold', 'done', []],
      ['Store', 'open', [1]],
    ])
  })

  test('an empty project has no maps', async () => {
    const io = { list: async () => [], read: async () => '', run: fakeGh }
    expect(await loadMarkdownMaps(io, 'R')).toEqual([])
  })
})

describe('GitHub', () => {
  test('finds the repo, or none without a remote', async () => {
    expect(await githubRepo(fakeIo(fakeGh), 'R')).toBe('o/r')
    expect(await githubRepo(fakeIo(), 'R')).toBeNull()
  })

  test('reads maps, sub-issues, labels, assignees and native blocking', async () => {
    const { maps, error } = await loadGithubMaps(fakeIo(fakeGh), 'R', 'o/r')
    expect(error).toBeUndefined()
    const map = maps.find(m => m.ref === '#1')!
    expect(map.source).toBe('github')
    expect(map.status).toBe('active')
    expect(map.tickets.map(t => [t.ref, t.status, t.type, t.assignee, t.blockedBy])).toEqual([
      ['#2', 'done', 'research', undefined, []],
      ['#3', 'claimed', 'grilling', 'yuval', []],
      ['#4', 'blocked', 'grilling', undefined, [2, 3]],
      ['#5', 'dropped', undefined, undefined, []],
    ])
  })

  test('falls back to the task list and Blocked by lines without sub-issues', async () => {
    const { maps } = await loadGithubMaps(fakeIo(fakeGh), 'R', 'o/r')
    const old = maps.find(m => m.ref === '#9')!
    expect(old.status).toBe('done')
    expect(old.tickets.map(t => [t.ref, t.status, t.blockedBy])).toEqual([
      ['#10', 'done', []],
      ['#11', 'open', [10]],
    ])
  })

  test('reports a failed query instead of throwing', async () => {
    const io = fakeIo(async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' }))
    const { maps, error } = await loadGithubMaps(io, 'R', 'o/r')
    expect(maps).toEqual([])
    expect(error).toContain('Bad credentials')
  })

  test('reads an issue body with its comments', async () => {
    const body = await githubIssueBody(fakeIo(fakeGh), 'R', 'https://github.com/o/r/issues/2')
    expect(body).toContain('Issue body')
    expect(body).toContain('**yuval:**')
    expect(body).toContain('Answer: 50/s')
  })
})
