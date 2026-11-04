import { t, type Lang } from './messages.ts';
import { execFileSync } from 'node:child_process';
import { rawLinks, rawNodes, rawStatus, record, type Suggestion } from './gitstatus.ts';
import { REPO_PATTERN, type Link } from './links.ts';

/** At most this many links per GraphQL query. */
export const BATCH = 50;

type Resolved =
  | { type: 'Issue'; number: number; state: string; stateReason: string | null }
  | { type: 'PullRequest'; number: number; state: string; merged: boolean; mergedAt: string | null; headRefName: string; closes: number[] }
  | { type: 'Branch'; prs: { number: number; state: string; merged: boolean; mergedAt: string | null; closes: number[] }[] };

const PR_FIELDS = 'number title state merged mergedAt closingIssuesReferences(first: 10) { nodes { number } }';
const NUMBER_FIELDS = `__typename ... on Issue { number title state stateReason } ... on PullRequest { headRefName ${PR_FIELDS} }`;

/** `gh api graphql`. gh exits 1 when part of the answer is NOT_FOUND, but still prints the data. */
export function gh(query: string, lang: Lang): unknown {
  try {
    return JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (err) {
    const out = record(err) && typeof err.stdout === 'string' ? err.stdout : '';
    try {
      const parsed: unknown = JSON.parse(out);
      if (record(parsed) && record(parsed.data)) return parsed;
    } catch {
      // not JSON: report gh's own message below
    }
    const msg = record(err) && typeof err.stderr === 'string' && err.stderr.trim() ? err.stderr.trim() : err instanceof Error ? err.message : String(err);
    throw new Error(t(lang, 'ghFailed', msg));
  }
}

const closes = (pr: Record<string, unknown>): number[] => {
  const refs = pr.closingIssuesReferences;
  return record(refs) && Array.isArray(refs.nodes) ? refs.nodes.flatMap((n) => (record(n) && typeof n.number === 'number' ? [n.number] : [])) : [];
};

function readNumber(x: unknown): Resolved | null {
  if (!record(x) || typeof x.number !== 'number') return null;
  if (x.__typename === 'Issue') return { type: 'Issue', number: x.number, state: String(x.state), stateReason: typeof x.stateReason === 'string' ? x.stateReason : null };
  if (x.__typename === 'PullRequest') {
    return { type: 'PullRequest', number: x.number, state: String(x.state), merged: x.merged === true, mergedAt: typeof x.mergedAt === 'string' ? x.mergedAt : null, headRefName: String(x.headRefName ?? ''), closes: closes(x) };
  }
  return null;
}

/**
 * A branch resolves when it still exists or any pull request came from it. `prs` holds the ten
 * newest pull requests, `merged` the newest merged one, which may be older than those ten.
 */
function readBranch(prs: unknown, merged: unknown, ref: unknown): Resolved | null {
  const nodes = (x: unknown) => record(x) && Array.isArray(x.nodes) ? x.nodes.filter(record) : [];
  const list = [...nodes(prs), ...nodes(merged)];
  if (!list.length && !record(ref)) return null;
  return {
    type: 'Branch',
    prs: list.filter((p) => typeof p.number === 'number').map((p) => ({
      number: p.number as number, state: String(p.state), merged: p.merged === true, mergedAt: typeof p.mergedAt === 'string' ? p.mergedAt : null, closes: closes(p),
    })),
  };
}

interface Target { key: string; repo: string; link: Link }

const targetOf = (link: Link, repo: string): Target => link.kind === 'number'
  ? { key: `${link.repo ?? repo}#${link.number}`, repo: link.repo ?? repo, link }
  : { key: `${repo}:branch:${link.name}`, repo, link };

/** One query for up to BATCH targets: a `repository` per repository, an alias per target. */
export function buildQuery(targets: Target[]): string {
  const str = (s: string) => JSON.stringify(s); // a JSON string is a valid GraphQL string
  const byRepo = new Map<string, string[]>();
  targets.forEach((t, j) => {
    const fields = t.link.kind === 'number'
      ? [`t${j}: issueOrPullRequest(number: ${t.link.number}) { ${NUMBER_FIELDS} }`]
      : [`t${j}: pullRequests(headRefName: ${str(t.link.name)}, first: 10, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } }`,
        `t${j}m: pullRequests(headRefName: ${str(t.link.name)}, states: MERGED, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } }`,
        `t${j}r: ref(qualifiedName: ${str(`refs/heads/${t.link.name}`)}) { name }`];
    byRepo.set(t.repo, [...(byRepo.get(t.repo) ?? []), ...fields]);
  });
  const repos = [...byRepo].map(([repo, fields], i) => {
    const [owner, name] = repo.split('/');
    return `r${i}: repository(owner: ${str(owner)}, name: ${str(name)}) { ${fields.join(' ')} }`;
  });
  return `query { ${repos.join(' ')} }`;
}

/**
 * Compare each node's `links` with GitHub and suggest a check where they disagree.
 * Suggestions only, like `status --git`; the plan is never changed.
 */
export function suggestFromGithub(plan: unknown, repo: string, opts: { run?: (query: string) => unknown; lang?: Lang } = {}): Suggestion[] {
  const lang = opts.lang ?? 'en';
  const day = (iso: string | null) => iso ? iso.slice(0, 10) : t(lang, 'unknownDate');
  if (!REPO_PATTERN.test(repo)) throw new Error(t(lang, 'badRepo', repo));
  const run = opts.run ?? ((query: string) => gh(query, lang));
  const nodes = rawNodes(plan, lang);
  const status = rawStatus(nodes);

  const targets = new Map<string, Target>();
  for (const n of nodes) for (const l of rawLinks(n)) {
    const t = targetOf(l, repo);
    if (!targets.has(t.key)) targets.set(t.key, t);
  }
  const resolved = new Map<string, Resolved | null>();
  const all = [...targets.values()];
  for (let k = 0; k < all.length; k += BATCH) {
    const batch = all.slice(k, k + BATCH);
    const res = run(buildQuery(batch));
    if (!record(res) || !record(res.data)) {
      const errors = record(res) && Array.isArray(res.errors) ? res.errors.map((e) => (record(e) ? String(e.message) : String(e))).join(t(lang, 'clauseSep')) : '';
      throw new Error(t(lang, 'ghNoData', errors));
    }
    const data = res.data;
    const repoAlias = new Map([...new Set(batch.map((t) => t.repo))].map((r, i) => [r, `r${i}`]));
    batch.forEach((t, j) => {
      const r = data[repoAlias.get(t.repo)!];
      resolved.set(t.key, !record(r) ? null : t.link.kind === 'number' ? readNumber(r[`t${j}`]) : readBranch(r[`t${j}`], r[`t${j}m`], r[`t${j}r`]));
    });
  }

  const suggestions: Suggestion[] = [];
  for (const n of nodes) {
    const own = status.get(n.id)!;
    if (!own.group && n.status !== 'open' && n.status !== 'done') continue;
    const open = own.status === 'open';
    const differ: string[] = [];
    const missing: string[] = [];
    for (const l of rawLinks(n)) {
      const r = resolved.get(targetOf(l, repo).key);
      if (!r) {
        missing.push(l.text);
        continue;
      }
      const closing = (c: number[]) => (c.length ? t(lang, 'closingIssues', c.map((x) => `#${x}`).join(t(lang, 'listSep'))) : '');
      if (r.type === 'Issue') {
        const reason = (r.stateReason ?? 'completed').toLowerCase().replace(/_/g, ' ');
        if (r.state === 'CLOSED' && r.stateReason === 'NOT_PLANNED') {
          differ.push(open ? t(lang, 'notPlannedOpen', l.text) : t(lang, 'notPlannedDone', l.text));
        } else if (r.state === 'CLOSED' && open) differ.push(t(lang, 'issueClosed', l.text, reason));
        else if (r.state === 'OPEN' && !open) differ.push(t(lang, 'issueOpen', l.text));
      } else if (r.type === 'PullRequest') {
        if (r.merged && open) differ.push(t(lang, 'prMerged', l.text, day(r.mergedAt), r.headRefName, closing(r.closes)));
        else if (!r.merged && !open) differ.push(r.state === 'OPEN' ? t(lang, 'prOpen', l.text) : t(lang, 'prClosed', l.text));
      } else if (l.kind === 'branch') {
        const merged = r.prs.find((p) => p.merged);
        const pending = r.prs.find((p) => p.state === 'OPEN');
        if (merged && open) differ.push(t(lang, 'prMerged', `#${merged.number}`, day(merged.mergedAt), l.name, closing(merged.closes)));
        else if (!merged && !open) differ.push(pending ? t(lang, 'branchPending', l.name, pending.number) : t(lang, 'branchUnmerged', l.name));
      }
    }
    const base = { id: n.id, title: n.title, status: own.status };
    if (differ.length) {
      const rest = own.group && open ? t(lang, 'groupOpen', own.open) : '';
      suggestions.push({ ...base, suggest: 'check', evidence: `${differ.join(t(lang, 'clauseSep'))}${rest}`, commits: [] });
    }
    if (missing.length) suggestions.push({ ...base, suggest: 'missing-link', evidence: t(lang, 'ghMissing', missing.join(t(lang, 'listSep'))), commits: [] });
  }
  return suggestions;
}
