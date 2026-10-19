import { describe, expect, test } from 'claude-code/testing'

import { blockMessage, commitIntent, gitDir, isExempt, oversizedFiles } from '../hooks/tokens'
import type { GitIo, RunResult } from '../hooks/tokens'

const ROOT = '/repo'

/** A repo's index and working tree, answered as git would. */
type Repo = {
  staged: Record<string, number>
  changed?: Record<string, number>
  untracked?: Record<string, number>
  binary?: string[]
  generated?: string[]
}

const numstat = (files: Record<string, number>, binary: string[]) =>
  Object.keys(files)
    .map(p => (binary.includes(p) ? `-\t-\t${p}\0` : `10\t0\t${p}\0`))
    .join('')

function gitAnswer(repo: Repo, argv: string[], stdin = ''): RunResult {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
  const [, cmd, ...args] = argv
  const binary = repo.binary ?? []
  if (cmd === 'rev-parse') return ok(`${ROOT}\n`)
  if (cmd === 'diff') return ok(numstat(args.includes('--cached') ? repo.staged : repo.changed ?? {}, binary))
  if (cmd === 'ls-files') return ok(Object.keys(repo.untracked ?? {}).map(p => `${p}\0`).join(''))
  if (cmd === 'check-attr') {
    const paths = stdin.split('\0').filter(Boolean)
    return ok(paths.map(p => `${p}\0linguist-generated\0${repo.generated?.includes(p) ? 'set' : 'unspecified'}\0`).join(''))
  }
  if (cmd === 'cat-file') {
    const lines = stdin.split('\n').filter(Boolean)
    return ok(lines.map(l => `abc123 blob ${repo.staged[l.slice(1)]}\n`).join(''))
  }
  return { exitCode: 1, stdout: '', stderr: 'unknown' }
}

function fakeIo(repo: Repo): GitIo & { argvs: string[][] } {
  const argvs: string[][] = []
  const tree = { ...repo.changed, ...repo.untracked }
  return {
    argvs,
    run: async (argv, init) => {
      argvs.push(argv)
      return gitAnswer(repo, argv, init.stdin)
    },
    size: async path => tree[path.slice(ROOT.length + 1)],
  }
}

describe('which commands commit', () => {
  test('a plain commit, after a cd, and through git -C', () => {
    expect(commitIntent('git commit -m "fix"')).toEqual({ cwd: undefined, isAll: false, isAdding: false })
    expect(commitIntent('cd app && git add . && git commit -m "x"')).toEqual({ cwd: 'app', isAll: false, isAdding: true })
    expect(commitIntent('git -C ../other -c user.name=a commit -am "x"')).toEqual({ cwd: '../other', isAll: true, isAdding: false })
  })

  test('anything else, a dry run, or "commit" inside a message passes untouched', () => {
    expect(commitIntent('git status && git log --oneline')).toBe(null)
    expect(commitIntent('git commit --dry-run')).toBe(null)
    expect(commitIntent('echo "git commit later"')).toBe(null)
    expect(commitIntent('git commit --amend -m "keep --all words"')!.isAll).toBe(false)
  })

  test('git runs where the command cds to, against the session folder', () => {
    expect(gitDir('/s', undefined)).toBe('/s')
    expect(gitDir('/s/', 'app')).toBe('/s/app')
    expect(gitDir('C:\\s', 'D:\\x')).toBe('D:\\x')
  })
})

test('lockfiles, build output, codegen and binaries are not counted', () => {
  for (const p of ['package-lock.json', 'web/pnpm-lock.yaml', 'go.sum', 'dist/app.js', 'src/__generated__/schema.ts', 'a.min.js', 'x.pb.go', 'logo.png'])
    expect(isExempt(p)).toBe(true)
  for (const p of ['src/app.ts', 'README.md', 'build.ts', 'lib/distance.py']) expect(isExempt(p)).toBe(false)
})

describe('oversized files', () => {
  const repo: Repo = {
    staged: { 'src/big.ts': 30_000, 'src/small.ts': 400, 'package-lock.json': 900_000, 'gen/api.ts': 80_000, 'art.bin2': 99_999 },
    binary: ['art.bin2'],
    generated: ['gen/api.ts'],
    changed: { 'src/edited.ts': 24_000 },
    untracked: { 'src/new.ts': 50_000 },
  }

  test('only staged files the agent wrote are measured, from the index', async () => {
    const over = await oversizedFiles(fakeIo(repo), '/repo/src', { isAll: false, isAdding: false }, 5000)
    expect(over).toEqual([{ path: 'src/big.ts', bytes: 30_000, tokens: 7500 }])
  })

  test('commit -a adds changed tracked files; a git add in the command adds new ones too', async () => {
    const all = await oversizedFiles(fakeIo(repo), ROOT, { isAll: true, isAdding: false }, 5000)
    expect(all.map(f => f.path)).toEqual(['src/big.ts', 'src/edited.ts'])
    const adding = await oversizedFiles(fakeIo(repo), ROOT, { isAll: false, isAdding: true }, 5000)
    expect(adding.map(f => f.path)).toEqual(['src/new.ts', 'src/big.ts', 'src/edited.ts'])
  })

  test('a folder outside any repo commits nothing to check', async () => {
    const io = fakeIo(repo)
    io.run = async () => ({ exitCode: 128, stdout: '', stderr: 'not a git repository' })
    expect(await oversizedFiles(io, '/tmp', { isAll: false, isAdding: false }, 5000)).toEqual([])
  })
})

test('the refusal names each file and says how to split it', () => {
  const text = blockMessage([{ path: 'src/big.ts', bytes: 30_000, tokens: 7500 }], 5000)
  expect(text).toContain('5,000-token limit')
  expect(text).toContain('src/big.ts: ~7,500 tokens (30,000 bytes)')
  expect(text).toContain('re-exports')
  expect(text).toContain('linguist-generated')
})

describe('the guard on Claude\'s Bash calls', () => {
  /** A session whose repo stages one 30 KB file; `runs` counts the Bash calls that ran. */
  function session(on: any, staged: Record<string, number>) {
    const ran: string[] = []
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', ($: unknown, e: { argv: string[]; init?: { stdin?: string } }) => ({
      value: gitAnswer({ staged }, e.argv, e.init?.stdin),
    }))
    on('tool.call', { tool: 'Bash' }, ($: unknown, e: { command: string }) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
    })
    return ran
  }

  test('refuses a commit carrying a file over the limit', async ($: any, on: any) => {
    const ran = session(on, { 'src/big.ts': 30_000 })
    const out: any = await $.tool.call({ tool: 'Bash', command: 'git commit -m "add big"' })
    expect(String(out.deny ?? out.text)).toContain('src/big.ts')
    expect(ran).toEqual([])
  })

  test('lets small commits and other commands through', async ($: any, on: any) => {
    const ran = session(on, { 'src/small.ts': 400 })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "small"' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran).toEqual(['git commit -m "small"', 'ls'])
  })

  test('a limit of 0 turns it off', { options: { maxFileTokens: 0 } }, async ($: any, on: any) => {
    const ran = session(on, { 'src/big.ts': 30_000 })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "add big"' })
    expect(ran).toEqual(['git commit -m "add big"'])
  })
})
