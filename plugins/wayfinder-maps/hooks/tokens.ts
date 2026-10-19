/**
 * The file-size guard on Claude's commits: a `git commit` the agent runs is
 * refused while a file it would commit is over the token limit
 * (tokens = bytes / 4). Lockfiles, codegen and binaries don't count.
 * Built here so tests reach it without the engine.
 */
export const DEFAULT_TOKEN_LIMIT = 5000

export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** The host calls the check makes, as closures over `$` (see `Io` in parse.ts). */
export type GitIo = {
  run: (argv: string[], init: { cwd?: string; stdin?: string }) => Promise<RunResult>
  /** Bytes of a file on disk, by absolute path; undefined when it isn't a file. */
  size: (path: string) => Promise<number | undefined>
}

/** What a Bash command commits: the folder it runs git in, and what it stages on the way. */
export type CommitIntent = {
  /** A `cd` or `git -C` folder, as written; absent, the session's folder. */
  cwd?: string
  /** `git commit -a`: tracked files' changes are committed unstaged. */
  isAll: boolean
  /** A `git add` runs before the commit, so the working tree is what gets committed. */
  isAdding: boolean
}

export type Oversized = { path: string; bytes: number; tokens: number }

export const tokensOf = (bytes: number) => Math.ceil(bytes / 4)

const words = (segment: string) =>
  (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^(["'])(.*)\1$/, '$2'))

/** git's options before the subcommand that take a value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** The `git commit` a Bash command runs, if it runs one. */
export function commitIntent(command: string): CommitIntent | null {
  let cwd: string | undefined
  let isAdding = false
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const w = words(segment.trim())
    if (w[0] === 'cd' && w[1]) cwd = w[1]
    if (w[0] !== 'git') continue
    let i = 1
    let gitCwd = cwd
    while (i < w.length && w[i]!.startsWith('-')) {
      if (w[i] === '-C') gitCwd = w[i + 1]
      i += GIT_VALUE_OPTIONS.has(w[i]!) ? 2 : 1
    }
    if (w[i] === 'add' || w[i] === 'stage') isAdding = true
    if (w[i] !== 'commit') continue
    const flags = w.slice(i + 1)
    const isAll = flags.some(f => f === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(f))
    if (flags.includes('--dry-run')) return null
    return { cwd: gitCwd, isAll, isAdding }
  }
  return null
}

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'go.sum', 'uv.lock',
  'flake.lock', 'mix.lock', 'pubspec.lock', 'Podfile.lock', 'packages.lock.json', 'deno.lock',
])
const GENERATED_DIRS = /(^|\/)(node_modules|vendor|dist|build|out|coverage|generated|__generated__|\.next|\.nuxt)\//
const GENERATED_NAMES = /(\.min\.(js|css)|\.map|\.snap|\.lock|\.generated\.\w+|\.g\.dart|\.pb\.go|_pb2\.pyi?|\.designer\.cs)$/
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|7z|rar|woff2?|ttf|otf|eot|mp3|mp4|wav|mov|webm|exe|dll|so|dylib|jar|wasm|bin)$/i

/** Files no agent writes by hand: lockfiles, build output, codegen, binaries. */
export function isExempt(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  const name = p.slice(p.lastIndexOf('/') + 1)
  return LOCKFILES.has(name) || GENERATED_DIRS.test(p) || GENERATED_NAMES.test(name) || BINARY.test(name)
}

/** `git diff --numstat -z --no-renames`: each path, and whether git counts it as binary. */
export function numstatPaths(out: string): { path: string; isBinary: boolean }[] {
  return out
    .split('\0')
    .filter(Boolean)
    .map(rec => {
      const [added, , ...rest] = rec.split('\t')
      return { path: rest.join('\t').replace(/^\n/, ''), isBinary: added === '-' }
    })
}

/** `git cat-file --batch-check` answering `:<path>` lines: each blob's size, in order. */
export function batchSizes(out: string): (number | undefined)[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const m = /^\S+ blob (\d+)$/.exec(line)
      return m ? Number(m[1]) : undefined
    })
}

/** `git check-attr -z --stdin linguist-generated`: the paths marked generated. */
export function generatedPaths(out: string): Set<string> {
  const f = out.split('\0')
  const marked = new Set<string>()
  for (let i = 0; i + 2 < f.length; i += 3) {
    if (f[i + 2] === 'set' || f[i + 2] === 'true') marked.add(f[i]!)
  }
  return marked
}

const isAbsolute = (p: string) => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')

/** Where git runs for a commit: its `cd`/`-C` folder against the session's. */
export function gitDir(sessionCwd: string, cwd?: string): string {
  if (!cwd || cwd === '.') return sessionCwd
  if (cwd.startsWith('~')) return sessionCwd
  return isAbsolute(cwd) ? cwd : `${sessionCwd.replace(/[\\/]+$/, '')}/${cwd}`
}

/**
 * The files over the limit that this commit would carry: the staged ones,
 * and with `-a` or a `git add` in the same command the changed and new files
 * in the working tree too (an over-estimate when `git add` names only some).
 */
export async function oversizedFiles(io: GitIo, cwd: string, intent: CommitIntent, limit: number): Promise<Oversized[]> {
  const top = await io.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
  if (top.exitCode !== 0) return []
  const root = top.stdout.trim()
  const git = (args: string[], stdin?: string) => io.run(['git', ...args], { cwd: root, stdin })

  const staged = numstatPaths((await git(['diff', '--cached', '--numstat', '-z', '--no-renames', '--diff-filter=ACMR'])).stdout)
  const files = new Map<string, { isBinary: boolean; isStaged: boolean }>()
  for (const f of staged) files.set(f.path, { isBinary: f.isBinary, isStaged: true })
  if (intent.isAll || intent.isAdding) {
    const changed = numstatPaths((await git(['diff', '--numstat', '-z', '--no-renames', '--diff-filter=ACMR'])).stdout)
    for (const f of changed) files.set(f.path, { isBinary: f.isBinary, isStaged: false })
  }
  if (intent.isAdding) {
    const untracked = (await git(['ls-files', '-z', '-o', '--exclude-standard', '--full-name'])).stdout
    for (const path of untracked.split('\0').filter(Boolean)) files.set(path, { isBinary: false, isStaged: false })
  }

  const candidates = [...files].filter(([path, f]) => !f.isBinary && !isExempt(path)).map(([path]) => path)
  if (candidates.length === 0) return []
  const generated = generatedPaths(
    (await git(['check-attr', '-z', '--stdin', 'linguist-generated'], candidates.join('\0') + '\0')).stdout,
  )
  const checked = candidates.filter(p => !generated.has(p))

  const fromIndex = checked.filter(p => files.get(p)!.isStaged)
  const indexSizes = fromIndex.length
    ? batchSizes((await git(['cat-file', '--batch-check'], fromIndex.map(p => `:${p}`).join('\n') + '\n')).stdout)
    : []
  const sizes = new Map<string, number | undefined>(fromIndex.map((p, i) => [p, indexSizes[i]]))
  for (const p of checked) if (!sizes.has(p)) sizes.set(p, await io.size(`${root}/${p}`))

  return checked
    .map(path => ({ path, bytes: sizes.get(path) ?? 0 }))
    .map(f => ({ ...f, tokens: tokensOf(f.bytes) }))
    .filter(f => f.tokens > limit)
    .sort((a, b) => b.tokens - a.tokens)
}

const n = (x: number) => x.toLocaleString('en-US')

/** What the agent reads when its commit is refused: which files, and how to split them. */
export function blockMessage(over: Oversized[], limit: number): string {
  const list = over.map(f => `  ${f.path}: ~${n(f.tokens)} tokens (${n(f.bytes)} bytes)`).join('\n')
  const target = n(Math.round(limit * 0.7))
  return [
    `Commit blocked: ${over.length === 1 ? 'a file' : `${over.length} files`} over the ${n(limit)}-token limit (tokens = bytes / 4). Nothing was committed.`,
    list,
    '',
    'Split each file listed, then commit again:',
    '1. Read the file and find its seams: groups of functions, types or components that belong together and talk to the rest through a few names.',
    `2. Move each group into its own file beside the original, named for what it does (parse.ts, render.ts, types.ts), never part1/part2. Aim for under ~${target} tokens (~${n(Math.round(limit * 0.7 * 4))} bytes) per file, so it has room to grow.`,
    '3. Keep the original path working: it imports what it still needs and re-exports what other files import from it, so no caller breaks.',
    '4. Move tests along with the code they cover, splitting a large test file by the same seams.',
    '5. Run the typecheck and the tests, `git add` the new files and the shrunk original, and commit again.',
    'Do not get under the limit by minifying, deleting comments or docs, or squeezing lines together.',
    'If a file is generated (codegen, a lockfile, fixture data) rather than written, mark it in .gitattributes as `<path> linguist-generated` and it is skipped.',
  ].join('\n')
}
