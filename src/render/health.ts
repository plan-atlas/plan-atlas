import type { Suggestion } from '../gitstatus.ts';
import { REPO_PATTERN } from '../links.ts';
import { t, type Lang } from '../messages.ts';
import type { Finding } from '../types.ts';
import type { WorkspaceRead } from '../workspace.ts';

export interface HealthEntry {
  namespace: string;
  ref?: string;
  sha?: string;
  findings: Finding[];
  suggestions: Suggestion[];
  statusError?: string;
}

export interface HealthRepository {
  /** The workspace `github` value, or `path` for a path entry. */
  label: string;
  entries: HealthEntry[];
}

export interface HealthInput {
  /** ISO-8601 time the caller observed. This function does not read the clock. */
  generatedAt: string;
  /** The `--workspace` value as given. */
  workspace: string;
  source?: WorkspaceRead['source'];
  /** Findings that belong to no workspace entry. */
  general: Finding[];
  repositories: HealthRepository[];
}

interface Line {
  text: string;
  /** Set on each line of one ERROR, WARN or suggestion, so a cut can count what it dropped. */
  item?: number;
  /** Length of a fence delimiter this renderer emitted. Content is never marked. */
  fence?: number;
  /** The full report's own Last run line. The issue header carries it instead. */
  lastRun?: true;
}

const MARKER = '<!-- plan-atlas:health -->';

/**
 * Plan text can hold `@name` and HTML. The only Markdown outside fences is fixed text,
 * headings and a `github` label (it matches the repository pattern). A fence is longer
 * than any backtick run in its block, so the block stays literal.
 */
export function healthReport(input: HealthInput, lang: Lang, limit = 60000): { full: string; issue: string } {
  const ids = { n: 0 };
  const lines: Line[] = [];
  const add = (...text: string[]) => { for (const line of text) lines.push({ text: line }); };
  const errors = countLevel(input, 'ERROR');
  const warnings = countLevel(input, 'WARN');
  const suggestions = input.repositories.reduce((n, repo) => n + repo.entries.reduce((m, entry) => m + entry.suggestions.length, 0), 0);

  add(`# ${t(lang, 'healthTitle')}`, '');
  lines.push({ text: t(lang, 'healthLastRun', input.generatedAt), lastRun: true });
  add('', t(lang, 'healthWorkspaceFile'), '');
  pushFence(lines, [
    ...splitLines(input.workspace),
    ...(input.source ? [...splitLines(input.source.ref), ...splitLines(input.source.sha)] : []),
  ]);
  add('', t(lang, 'healthCounts', errors, warnings, suggestions), '');
  add(`## ${t(lang, 'healthWorkspace')}`, '');
  pushFindings(lines, input.general, lang, ids);
  for (const repo of input.repositories) {
    add('');
    pushRepository(lines, repo, lang, ids);
  }
  while (lines.length > 0 && lines[lines.length - 1].text === '') lines.pop();

  const full = lines.map((line) => line.text).join('\n') + '\n';
  return { full, issue: cutIssue(lines.filter((line) => line.lastRun !== true), input.generatedAt, lang, limit) };
}

function countLevel(input: HealthInput, level: 'ERROR' | 'WARN'): number {
  const inGeneral = input.general.filter((f) => f.level === level).length;
  return inGeneral + input.repositories.reduce((n, repo) => n + repo.entries.reduce((m, entry) => m + entry.findings.filter((f) => f.level === level).length, 0), 0);
}

function splitLines(text: string): Line[] {
  return text.split('\n').map((line) => ({ text: line }));
}

function itemLines(text: string, ids: { n: number }): Line[] {
  const item = ids.n++;
  return text.split('\n').map((line) => ({ text: line, item }));
}

function findingText(f: Finding): string {
  return `${f.level} ${f.code}\n${f.message}`;
}

function suggestionText(s: Suggestion): string {
  return `${s.suggest}\n${s.id}\n${s.title}\n${s.evidence}`;
}

/** One fenced `text` block. The fence is at least three backticks and longer than any run inside. */
function pushFence(out: Line[], body: Line[]) {
  const content = body.map((line) => line.text).join('\n');
  let longest = 0;
  for (const run of content.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = Math.max(3, longest + 1);
  const tick = '`'.repeat(fence);
  out.push({ text: `${tick}text`, fence });
  out.push(...body);
  out.push({ text: tick, fence });
}

function pushFindings(out: Line[], findings: Finding[], lang: Lang, ids: { n: number }) {
  const shown = [...findings.filter((f) => f.level === 'ERROR'), ...findings.filter((f) => f.level === 'WARN')];
  if (shown.length === 0) {
    out.push({ text: t(lang, 'healthNone') });
    return;
  }
  pushFence(out, shown.flatMap((f) => itemLines(findingText(f), ids)));
}

function pushRepository(out: Line[], repo: HealthRepository, lang: Lang, ids: { n: number }) {
  const safe = REPO_PATTERN.test(repo.label);
  out.push({ text: `## ${safe ? repo.label : t(lang, 'healthPath')}` }, { text: '' });
  const errors = repo.entries.flatMap((entry) => entry.findings.filter((f) => f.level === 'ERROR'));
  const warnings = repo.entries.flatMap((entry) => entry.findings.filter((f) => f.level === 'WARN'));
  const suggestions = repo.entries.flatMap((entry) => entry.suggestions);
  const failed = repo.entries.some((entry) => entry.statusError !== undefined);
  // A path is not a github label, so it stays inside a fence; the heading is fixed text.
  // Every entry is listed, including a repository with nothing to report.
  const body: Line[] = safe ? [] : splitLines(repo.label);
  for (const entry of repo.entries) {
    body.push({ text: entry.namespace });
    if (entry.ref !== undefined) body.push({ text: entry.ref });
    if (entry.sha !== undefined) body.push({ text: entry.sha });
    if (entry.statusError !== undefined) body.push(...splitLines(t(lang, 'healthStatusError', entry.statusError)));
  }
  for (const finding of [...errors, ...warnings]) body.push(...itemLines(findingText(finding), ids));
  for (const suggestion of suggestions) body.push(...itemLines(suggestionText(suggestion), ids));
  pushFence(out, body);
  if (errors.length === 0 && warnings.length === 0 && suggestions.length === 0 && !failed) {
    out.push({ text: '' }, { text: t(lang, 'healthNone') });
  }
}

/** Same stack as a forward scan of fence lines: push an opening fence, pop a matching close. */
function noteFence(stack: number[], line: Line) {
  if (line.fence === undefined) return;
  if (line.text.endsWith('text')) stack.push(line.fence);
  else if (stack.length > 0 && stack[stack.length - 1] === line.fence) stack.pop();
}

/** A cut that drops findings names how many; a cut of other lines only says where the rest is. */
function cutClosing(dropped: number, lang: Lang): string {
  return dropped === 0 ? t(lang, 'healthContinues') : t(lang, 'healthMore', dropped);
}

/**
 * Cut at whole lines. Lengths are computed from a prefix of each line plus its newline,
 * walking forward once. A limit below the two header lines plus the closing line cannot
 * satisfy both the format and the limit; the format is kept in that case.
 */
function cutIssue(body: Line[], generatedAt: string, lang: Lang, limit: number): string {
  const header: Line[] = [{ text: MARKER }, { text: t(lang, 'healthLastRun', generatedAt) }];
  const headerLen = header.reduce((n, line) => n + line.text.length + 1, 0);
  const ends = new Map<number, number>();
  let intactLen = headerLen;
  for (let i = 0; i < body.length; i++) {
    intactLen += body[i].text.length + 1;
    if (body[i].item !== undefined) ends.set(body[i].item!, i);
  }
  const intact = () => [...header, ...body].map((line) => line.text).join('\n') + '\n';
  if (intactLen <= limit) return intact();

  const total = ends.size;
  const clean = (keep: number) => {
    if (keep === 0) return true;
    const item = body[keep - 1].item;
    return item === undefined || ends.get(item) === keep - 1;
  };
  const stack: number[] = [];
  let prefix = 0;
  let included = 0;
  let best = 0;
  let bestOpen = 0;
  let bestIncluded = 0;
  const consider = (keep: number) => {
    if (!clean(keep)) return;
    const open = stack.length > 0 ? stack[stack.length - 1] : 0;
    const dropped = total - included;
    const len = headerLen + prefix + (open > 0 ? open + 1 : 0) + cutClosing(dropped, lang).length + 1;
    if (len <= limit) {
      best = keep;
      bestOpen = open;
      bestIncluded = included;
    }
  };
  consider(0);
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    prefix += line.text.length + 1;
    noteFence(stack, line);
    if (line.item !== undefined && ends.get(line.item) === i) included++;
    consider(i + 1);
  }

  const lines = [...header, ...body.slice(0, best)];
  if (bestOpen > 0) lines.push({ text: '`'.repeat(bestOpen) });
  lines.push({ text: cutClosing(total - bestIncluded, lang) });
  return lines.map((line) => line.text).join('\n') + '\n';
}
