/** Text shaping for the drawer: ticket bodies made readable there, titles fitted to cards. */

const FIELD = /^\*{0,2}(type|status|assignee|blocked by|label|charted)\s*:\s*\*{0,2}/i

/**
 * Drops the tracker's header lines (`Type:`, `Status:`, `Blocked by:` and its
 * list) from above a ticket's first section: the drawer shows them already.
 */
export function stripHeaderFields(body: string): string {
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  let inSections = false
  let inBlockedList = false
  for (const line of lines) {
    if (!inSections && /^## /.test(line)) inSections = true
    if (inSections) {
      out.push(line)
      continue
    }
    if (FIELD.test(line)) {
      inBlockedList = /^\*{0,2}blocked by\s*:\s*\*{0,2}\s*$/i.test(line)
      continue
    }
    if (inBlockedList && /^\s*[-*]\s+/.test(line)) continue
    if (line.trim() !== '') inBlockedList = false
    out.push(line)
  }
  return out.join('\n').replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n')
}

/** Joins a relative link onto a folder, resolving `.` and `..`, with forward slashes. */
export function resolvePath(dir: string, rel: string): string {
  const parts = dir.replace(/\\/g, '/').split('/')
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.length > 1 && parts.pop()
    else parts.push(seg)
  }
  return parts.join('/').replace(/\/{2,}/g, '/')
}

export const fileUrl = (path: string) =>
  'file:///' + encodeURI(path.replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F')

/**
 * Makes a markdown file's relative links work outside its folder: each
 * becomes an absolute `file:` link. Returns the new text and every link it
 * rewrote, with the file it points at.
 */
export function absolutizeLinks(body: string, filePath: string): { text: string; links: { href: string; path: string }[] } {
  const dir = filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
  const links: { href: string; path: string }[] = []
  const text = body.replace(/(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (whole, open: string, target: string, close: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return whole
    const [pathPart, anchor] = target.split('#') as [string, string | undefined]
    let decoded = pathPart
    try {
      decoded = decodeURI(pathPart)
    } catch {
      // Keep it as written.
    }
    const path = resolvePath(dir, decoded)
    const href = fileUrl(path) + (anchor ? `#${anchor}` : '')
    links.push({ href, path })
    return `${open}${href}${close}`
  })
  return { text, links }
}

/**
 * Breaks a title into lines of at most `width` characters, at most `maxLines`
 * of them, the last ending in an ellipsis when the title runs on.
 */
export function wrapLines(text: string, width: number, maxLines: number): string[] {
  const w = Math.max(8, width)
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= w) {
      cur = next
      continue
    }
    if (cur) lines.push(cur)
    cur = word.length > w ? word.slice(0, w - 1) + '…' : word
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1]!
  kept[maxLines - 1] = (last.length + 2 > w ? last.slice(0, w - 2) : last) + ' …'
  return kept
}
