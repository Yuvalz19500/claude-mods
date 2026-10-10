const HEADER_FIELD = /^\*{0,2}(type|status|assignee|blocked by)\s*:\s*\*{0,2}\s*(.*)$/i;
/** Folds the many status words the trackers use into five buckets. */
export function normalizeStatus(raw) {
    const s = raw.trim().toLowerCase();
    if (/^(resolved|done|closed|complete|completed|shipped|merged)\b/.test(s))
        return 'done';
    if (/^(claimed|in[- ]progress|wip|doing|active)\b/.test(s))
        return 'claimed';
    if (/^(awaiting|ready-for-human|needs-human|waiting|blocked-on-human)/.test(s))
        return 'waiting';
    if (/^(out[- ]of[- ]scope|dropped|wontfix|won't fix|not[- ]planned)/.test(s))
        return 'dropped';
    return 'open';
}
/** Leading ticket numbers out of `03, 07`, `#12 #13`, `106 — Versions`. */
function numbersIn(text) {
    if (/^\s*(none|n\/a|-|—|nothing)?\s*$/i.test(text))
        return [];
    return text
        .split(/[,;]|\band\b/)
        .map(part => part.trim().match(/^#?(\d+)/))
        .filter((m) => m !== null)
        .map(m => Number(m[1]));
}
function cleanTitle(title, num) {
    return title
        .replace(/^#+\s*/, '')
        .replace(new RegExp(`^0*${num}\\s*[—–·:.\\-]\\s*`), '')
        .replace(/^map\s*[·:—-]\s*/i, '')
        .trim();
}
/** Reads one ticket file: `NN-slug.md` with `Type:` / `Status:` / `Blocked by:` lines up top. */
export function parseTicketFile(fileName, path, text) {
    const numMatch = fileName.match(/^(\d+)-.*\.md$/);
    if (!numMatch || /\.brief\.md$/.test(fileName))
        return null;
    const num = Number(numMatch[1]);
    const lines = text.split(/\r?\n/);
    let title = fileName.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
    let rawStatus = '';
    let type;
    let assignee;
    const blockedBy = [];
    let inBlockedList = false;
    for (const line of lines) {
        if (/^## /.test(line) || /^- \[[ x]\]/i.test(line))
            break;
        if (/^# /.test(line)) {
            title = cleanTitle(line, num);
            continue;
        }
        const field = line.match(HEADER_FIELD);
        if (field) {
            inBlockedList = false;
            const [, key = '', value = ''] = field;
            const name = key.toLowerCase();
            if (name === 'status')
                rawStatus = value.replace(/\*+/g, '').trim();
            else if (name === 'type')
                type = value.replace(/\*+/g, '').trim() || undefined;
            else if (name === 'assignee')
                assignee = value.replace(/\*+/g, '').trim() || undefined;
            else if (name === 'blocked by') {
                blockedBy.push(...numbersIn(value));
                inBlockedList = value.trim() === '';
            }
            continue;
        }
        if (inBlockedList) {
            const item = line.match(/^\s*[-*]\s+#?(\d+)/);
            if (item)
                blockedBy.push(Number(item[1]));
            else if (line.trim() !== '')
                inBlockedList = false;
        }
    }
    return {
        id: path,
        num,
        ref: String(numMatch[1]),
        title,
        rawStatus,
        type,
        assignee,
        blockedBy: [...new Set(blockedBy)].filter(n => n !== num),
        path,
    };
}
/** The map's or spec's own title and any `Status:` line it carries. */
export function parseHeadDoc(text) {
    let title;
    let status;
    for (const line of text.split(/\r?\n/).slice(0, 30)) {
        if (!title && /^# /.test(line))
            title = cleanTitle(line, -1);
        const field = line.match(HEADER_FIELD);
        if (field && field[1]?.toLowerCase() === 'status')
            status = (field[2] ?? '').replace(/\*+/g, '').trim();
    }
    return { title, status };
}
/** Finalises tickets: blocked when any blocker inside the map is unfinished; frontier = open, unblocked, unclaimed. */
export function finishTickets(parsed) {
    const base = new Map(parsed.map(t => [t.num, t.closedAs ?? normalizeStatus(t.rawStatus)]));
    return parsed
        .map(t => {
        let status = base.get(t.num);
        const openBlockers = t.blockedBy.filter(n => {
            const s = base.get(n);
            return s !== undefined && s !== 'done' && s !== 'dropped';
        });
        if (status === 'open' && t.assignee && !/^(none|-|—)$/i.test(t.assignee))
            status = 'claimed';
        if (status === 'open' && openBlockers.length > 0)
            status = 'blocked';
        const { closedAs: _closedAs, ...rest } = t;
        return { ...rest, status, isFrontier: status === 'open' };
    })
        .sort((a, b) => a.num - b.num);
}
export function mapStatus(kind, tickets, headStatus, hasSpec) {
    if (headStatus && normalizeStatus(headStatus) === 'done')
        return 'done';
    if (kind === 'map' && hasSpec)
        return 'graduated';
    const live = tickets.filter(t => t.status !== 'dropped');
    if (live.length > 0 && live.every(t => t.status === 'done'))
        return 'done';
    if (live.some(t => t.status === 'claimed' || t.status === 'done'))
        return 'active';
    return 'open';
}
export function counts(tickets) {
    const c = { total: 0, done: 0, claimed: 0, waiting: 0, blocked: 0, frontier: 0 };
    for (const t of tickets) {
        if (t.status === 'dropped')
            continue;
        c.total += 1;
        if (t.status === 'done')
            c.done += 1;
        else if (t.status === 'claimed')
            c.claimed += 1;
        else if (t.status === 'waiting')
            c.waiting += 1;
        else if (t.status === 'blocked')
            c.blocked += 1;
        else
            c.frontier += 1;
    }
    return c;
}
