import { finishTickets, mapStatus } from './parse';
const CHILD = `number title state stateReason url body
  assignees(first: 3) { nodes { login } }
  labels(first: 10) { nodes { name } }
  blockedBy(first: 30) { nodes { number } }`;
const MAPS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, labels: ["wayfinder:map"], states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { number title state stateReason url body subIssues(first: 100) { nodes { ${CHILD} } } }
    }
  }
}`;
async function gh(io, root, args) {
    try {
        const r = await io.run(['gh', ...args], root);
        return { ok: r.exitCode === 0, out: r.stdout, err: r.stderr };
    }
    catch (error) {
        return { ok: false, out: '', err: String(error) };
    }
}
/** `owner/name` of the repo's GitHub remote, or null when it has none (or gh is missing). */
export async function githubRepo(io, root) {
    const r = await gh(io, root, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    return r.ok && r.out.trim() ? r.out.trim() : null;
}
/** Without native links: `- [ ] #12` task-list children on the map, `Blocked by: #3` lines on the child. */
function taskListNumbers(body) {
    return [...body.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+.*?#(\d+)/gm)].map(m => Number(m[1]));
}
function bodyBlockers(body) {
    const line = body.split(/\r?\n/).slice(0, 15).find(l => /^\**blocked by\**\s*:/i.test(l));
    return line ? [...line.matchAll(/#(\d+)/g)].map(m => Number(m[1])) : [];
}
async function fetchByNumber(io, root, owner, name, numbers) {
    if (numbers.length === 0)
        return [];
    const fields = numbers.map(n => `i${n}: issue(number: ${n}) { ${CHILD} }`).join('\n');
    const q = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const r = await gh(io, root, ['api', 'graphql', '-f', `query=${q}`, '-F', `owner=${owner}`, '-F', `name=${name}`]);
    if (!r.ok)
        return [];
    const repo = JSON.parse(r.out).data?.repository ?? {};
    return Object.values(repo).filter(Boolean);
}
function toTicket(issue) {
    const labels = issue.labels?.nodes.map(l => l.name) ?? [];
    const type = labels.find(l => l.startsWith('wayfinder:'))?.slice('wayfinder:'.length);
    const native = issue.blockedBy?.nodes.map(n => n.number) ?? [];
    const closedAs = issue.state === 'CLOSED' ? (issue.stateReason === 'NOT_PLANNED' ? 'dropped' : 'done') : undefined;
    const awaiting = labels.some(l => /awaiting|ready-for-human|needs-human/.test(l));
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
    };
}
/** Loads every `wayfinder:map` issue of the repo with its sub-issues and blocking edges. */
export async function loadGithubMaps(io, root, repo) {
    const [owner = '', name = ''] = repo.split('/');
    const r = await gh(io, root, ['api', 'graphql', '-f', `query=${MAPS_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`]);
    if (!r.ok)
        return { maps: [], error: `GitHub: ${(r.err || r.out).trim().split('\n')[0]}` };
    const issues = JSON.parse(r.out).data?.repository?.issues?.nodes ?? [];
    const maps = await Promise.all(issues.map(async (mapIssue) => {
        let children = mapIssue.subIssues?.nodes ?? [];
        if (children.length === 0) {
            children = await fetchByNumber(io, root, owner, name, taskListNumbers(mapIssue.body ?? ''));
        }
        const tickets = finishTickets(children.map(toTicket));
        const isClosed = mapIssue.state === 'CLOSED';
        return {
            id: `gh:${repo}#${mapIssue.number}`,
            kind: 'map',
            source: 'github',
            title: mapIssue.title,
            ref: `#${mapIssue.number}`,
            url: mapIssue.url,
            status: mapStatus('map', tickets, isClosed ? 'closed' : undefined, false),
            tickets,
        };
    }));
    return { maps };
}
/** A ticket's full body and comments, for the details view. */
export async function githubIssueBody(io, root, url) {
    const r = await gh(io, root, ['issue', 'view', url, '--json', 'body,comments', '-q', '{body: .body, comments: [.comments[] | {author: .author.login, body: .body}]}']);
    if (!r.ok)
        return `_Could not load the issue: ${r.err.trim()}_`;
    const data = JSON.parse(r.out);
    const comments = data.comments.map(c => `**${c.author}:**\n\n${c.body}`).join('\n\n---\n\n');
    return comments ? `${data.body}\n\n## Comments\n\n${comments}` : data.body;
}
