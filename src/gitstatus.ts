import { t, type Lang } from './messages.ts';
import { execFileSync } from 'node:child_process';
import { parseLink, type Link } from './links.ts';
import { derivedStatus, filePart, idCounts, tree } from './semantics.ts';

export interface Suggestion {
  id: string;
  title: string;
  status: 'done' | 'open';
  /** `mention`: the id appears only mid-sentence in commits, the weakest signal. */
  suggest: 'done' | 'check' | 'missing-tag' | 'missing-link' | 'mention';
  evidence: string;
  /** Commits behind a git suggestion, newest first. Empty for tags and for GitHub suggestions. */
  commits: { sha: string; date: string; subject: string; pr?: number }[];
}

export const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type RawNode = Record<string, unknown> & { id: string; title: string };

/** The raw nodes of a plan, checked just enough to read; the plan file itself is never changed. */
export function rawNodes(plan: unknown, lang: Lang = 'en'): RawNode[] {
  if (!record(plan) || !Array.isArray(plan.nodes)) throw new Error(t(lang, 'planNodes'));
  return plan.nodes.map((n: unknown) => {
    if (!record(n) || typeof n.id !== 'string' || typeof n.title !== 'string') throw new Error(t(lang, 'rawNodeFields'));
    return n as RawNode;
  });
}

/** The plan documents a plan cites (`sources` of groups, the file part of `source`). */
export function planFiles(nodes: RawNode[]): string[] {
  const files = new Set<string>();
  for (const n of nodes) {
    for (const s of Array.isArray(n.sources) ? n.sources : []) if (typeof s === 'string' && s) files.add(s);
    if (typeof n.source === 'string' && n.source) files.add(filePart(n.source));
  }
  return [...files];
}

export interface RawStatus {
  status: 'done' | 'open';
  group: boolean;
  /** Groups: open items anywhere under it. */
  open: number;
}

/**
 * Status of every node: an item's own, a group's derived as the model does it
 * (done only when every item under it is done).
 */
export function rawStatus(nodes: RawNode[]): Map<string, RawStatus> {
  const tr = tree(nodes.map((n) => ({ id: n.id, parent: typeof n.parent === 'string' ? n.parent : null, status: n.status })));
  const status = derivedStatus(tr, (i) => tr.byId.get(i)!.status === 'done' ? 'done' : 'open');
  return new Map(nodes.map((n) => [n.id, {
    status: status(n.id), group: tr.isGroup(n.id),
    open: tr.isGroup(n.id) ? tr.leaves(n.id).filter((i) => status(i) === 'open').length : 0,
  }]));
}

/** The node's links that parse; malformed ones are for `plan-atlas check` to report. */
export const rawLinks = (n: RawNode): Link[] =>
  (Array.isArray(n.links) ? n.links : []).flatMap((l) => {
    const link = typeof l === 'string' ? parseLink(l) : null;
    return link ? [link] : [];
  });

const MAX_RANGE = 100;

/**
 * Ids a message names through ranges such as "A4-A6", "C4–C6" or "T054-T056": every id with
 * the same prefix and a number in the range that exists in the plan, written with the same
 * zero padding or none. A range over more than 100 numbers is not expanded.
 */
export function rangeIds(message: string, ids: Set<string>): Set<string> {
  const out = new Set<string>();
  const re = /(?<![A-Za-z0-9_.-])([A-Za-z](?:[A-Za-z0-9_-]*[A-Za-z_-])?)(\d+)[-–]\1(\d+)(?![A-Za-z0-9_])/g;
  for (const [, prefix, a, b] of message.matchAll(re)) {
    const from = Number(a), to = Number(b);
    if (to <= from || to - from + 1 > MAX_RANGE) continue;
    for (let k = from; k <= to; k++) {
      for (const id of [`${prefix}${k}`, `${prefix}${String(k).padStart(a.length, '0')}`]) if (ids.has(id)) out.add(id);
    }
  }
  return out;
}

interface LogEntry {
  commit: Suggestion['commits'][number];
  subject: string;
  message: string;
  /** Plan ids the message names through a range. */
  ranged: Set<string>;
  /**
   * Where a commit says what it does: the subject, a merge's pull request title, and the
   * first word of each body line ("- A5: …"). An id only mid-sentence ("which W2-W5
   * remove") is a mention of other work, not evidence.
   */
  lead: string;
  leadRanged: Set<string>;
}

/** `#N` in any message; a branch when a merge commit names it (GitHub's or git's own subject). */
function linkTest(l: Link): (c: LogEntry) => boolean {
  if (l.kind === 'number') {
    const re = l.repo
      ? new RegExp(`(?<![A-Za-z0-9_.-])${escapeRe(l.repo)}#${l.number}(?!\\d)`)
      : new RegExp(`(?<![A-Za-z0-9_./#-])#${l.number}(?!\\d)`);
    return (c) => re.test(c.message);
  }
  const name = escapeRe(l.name);
  const re = new RegExp(`^(?:Merge pull request #\\d+ from [^/\\s]+/${name}|Merge branch '${name}'(?: .*)?)$`);
  return (c) => re.test(c.subject);
}

/** Read git evidence without changing the plan or declaring cited steps done. */
export function suggestStatus(plan: unknown, repo: string, opts: { ref?: string; lang?: Lang } = {}): Suggestion[] {
  const lang = opts.lang ?? 'en';
  const nodes = rawNodes(plan, lang);
  const ref = opts.ref ?? 'HEAD';
  if (!ref || ref.startsWith('-')) throw new Error(t(lang, 'badRef'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  }).trim();
  const ids = new Set(nodes.map((n) => n.id));
  // A commit that changes only plan documents is planning the work, not doing it: plan
  // commits name later steps ("W2–W7 follow"), so they are not evidence. Merge commits list
  // no files and stay.
  const docs = planFiles(nodes);
  const isDoc = (f: string) => docs.some((d) => f === d || f.startsWith(d.endsWith('/') ? d : `${d}/`));
  const planning = new Set(git('log', ref, '--format=%x1e%H', '--name-only').split('\x1e').flatMap((s) => {
    const [sha, ...files] = s.trim().split(/\r?\n/).filter(Boolean);
    return sha && files.length && files.every(isDoc) ? [sha] : [];
  }));
  const seen = new Set<string>();
  const log = git('log', ref, '--format=%H%x1f%cs%x1f%s%x1f%b%x1e').split('\x1e').filter((s) => s.trim()).flatMap((s): LogEntry[] => {
    const [sha, date, subject, ...body] = s.trim().split('\x1f');
    if (seen.has(sha) || planning.has(sha)) return [];
    seen.add(sha);
    const pr = subject.match(/Merge pull request #(\d+)/) ?? subject.match(/\(#(\d+)\)$/);
    const commit: Suggestion['commits'][number] = { sha, date, subject, ...(pr ? { pr: Number(pr[1]) } : {}) };
    const message = `${subject}\n${body.join('\x1f')}`;
    const lines = body.join('\x1f').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lead = [subject, ...(/^Merge (pull request|branch) /.test(subject) && lines.length ? [lines[0]] : []),
      ...lines.map((l) => l.replace(/^(?:[-*+]|\d+[.)])\s+/, '').split(/\s/)[0].replace(/[:,;.]+$/, ''))].join('\n');
    return [{ commit, subject, message, ranged: rangeIds(message, ids), lead, leadRanged: rangeIds(lead, ids) }];
  });
  const status = rawStatus(nodes);
  const suggestions: Suggestion[] = [];
  for (const node of nodes) {
    const { id, title, kind, tag } = node;
    const own = status.get(id)!;
    if (!own.group && node.status !== 'open' && node.status !== 'done') continue;
    // RULES.md §S departs from §G1.1: a group takes part only through its links, never its id
    const pattern = !own.group && idCounts(id)
      ? new RegExp(`(?<![A-Za-z0-9_.-])${escapeRe(id)}(?![A-Za-z0-9_])`)
      : null;
    const linkTests = rawLinks(node).map(linkTest);
    const cited = pattern || linkTests.length
      ? log.filter((c) => (pattern !== null && (pattern.test(c.message) || c.ranged.has(id))) || linkTests.some((t) => t(c)))
      : [];
    // links are explicit; an id counts as evidence only where a commit says what it does
    const evidence = cited.filter((c) => linkTests.some((t) => t(c)) || (pattern !== null && (pattern.test(c.lead) || c.leadRanged.has(id))));
    const strong = evidence.length > 0;
    // a check reports only the citing commits: a newer mention must not stand in for them
    const commits = (strong ? evidence : cited).map((c) => c.commit);
    const item = { id, title, status: own.status, commits };
    // §S: on a release, DONE? and MISSING-TAG displace the commit labels
    if (kind === 'release' && !own.group && typeof tag === 'string' && tag) {
      const tagRef = `refs/tags/${tag}`;
      let sha = '';
      try {
        sha = git('rev-parse', '-q', '--verify', `${tagRef}^{commit}`);
      } catch (err) {
        // Missing tags are suggestions; a failure to spawn git still propagates.
        if (!record(err) || typeof err.status !== 'number') throw err;
      }
      if (sha && own.status === 'open') {
        const date = git('log', '-1', '--format=%cs', tagRef);
        suggestions.push({ ...item, commits: [], suggest: 'done', evidence: t(lang, 'tagFound', tag, date, sha.slice(0, 7)) });
        continue;
      }
      if (!sha && own.status === 'done') {
        suggestions.push({ ...item, commits: [], suggest: 'missing-tag', evidence: t(lang, 'tagMissing', tag) });
        continue;
      }
    }
    if (own.status === 'open' && commits.length) {
      const latest = commits[0];
      const pr = latest.pr === undefined ? '' : `#${latest.pr} `;
      const rest = own.group ? t(lang, 'groupOpen', own.open) : '';
      suggestions.push(strong
        ? { ...item, suggest: 'check', evidence: t(lang, 'commitCheck', commits.length, pr + latest.date, rest) }
        : { ...item, suggest: 'mention', evidence: t(lang, 'commitMention', commits.length, pr + latest.date) });
    }
  }
  return suggestions;
}
