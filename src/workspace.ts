import { dirname, posix, relative, resolve } from 'node:path';
import { ConfinedFileError, confineFiles, parseJson, readInput, readText } from './files.ts';
import { gh, suggestFromGithub } from './githubstatus.ts';
import { record, suggestStatus, type Suggestion } from './gitstatus.ts';
import { REPO_PATTERN } from './links.ts';
import { mergedId, namespaceOf } from './semantics.ts';
import { t, type Lang } from './messages.ts';
import { parsePlan } from './parse.ts';
import type { Finding, PlanFile } from './types.ts';

export type WorkspaceEntry = { namespace: string; file: string; ref?: string } &
  ({ github: string; path?: never } | { path: string; github?: never });

export interface Workspace { version: 1; plans: WorkspaceEntry[] }
export interface WorkspaceOptions {
  run?: (query: string) => unknown;
  lang?: Lang;
  headRef?: string;
  allowMissing?: boolean;
  /** CI identity, injectable so tests need no runner environment. */
  repository?: string;
  repositoryRoot?: string;
  /** PLAN_ATLAS_CONFINE: path entries must be regular files below this directory. */
  confine?: string;
}
export interface WorkspacePlan {
  entry: WorkspaceEntry | null;
  plan: PlanFile;
  /** Local replacement or path entry, as an absolute, slash-normalized path. */
  file?: string;
  ref?: string;
  sha?: string;
}
export interface WorkspaceRead {
  workspace: Workspace | null;
  entries: WorkspacePlan[];
  findings: Finding[];
}

const slashes = (s: string) => s.replace(/\\/g, '/');
const directory = (s: string) => posix.normalize(slashes(s));
/** A leading slash (which covers UNC shares) or a drive letter. */
const absolute = (s: string) => posix.isAbsolute(s) || /^[A-Za-z]:/.test(s);
const text = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

/** Workspace shape errors use V0, just like plan shape errors. */
export function parseWorkspace(input: unknown, lang: Lang = 'en'): { workspace: Workspace | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const err = (message: string) => findings.push({ level: 'ERROR', code: 'V0', message });
  if (!record(input)) return { workspace: null, findings: [{ level: 'ERROR', code: 'V0', message: t(lang, 'workspaceObject') }] };
  if (input.version !== 1) err(t(lang, 'version', String(input.version)));
  if (!Array.isArray(input.plans)) return { workspace: null, findings: [...findings, { level: 'ERROR', code: 'V0', message: t(lang, 'workspacePlans') }] };
  const plans: WorkspaceEntry[] = [];
  const namespaces = new Set<string>(), files = new Set<string>();
  for (const [i, raw] of input.plans.entries()) {
    if (!record(raw) || !text(raw.namespace) || !/^[A-Za-z0-9._-]+$/.test(raw.namespace) || !text(raw.file)) {
      err(t(lang, 'workspaceFields', i));
      continue;
    }
    const file = posix.normalize(slashes(raw.file));
    if (file === '.' || file.startsWith('../') || absolute(file) || /[*?\[\]]/.test(file)) err(t(lang, 'workspaceFile', i));
    if ((raw.github === undefined) === (raw.path === undefined) ||
        (raw.github !== undefined && (!text(raw.github) || !REPO_PATTERN.test(raw.github))) ||
        (raw.path !== undefined && !text(raw.path))) {
      err(t(lang, 'workspaceLocation', i));
      continue;
    }
    // `../sibling` is the documented layout; an absolute or UNC path ties the workspace to one machine.
    // Checked before and after normalizing: `./C:/sdk` normalizes to `C:/sdk`.
    if (raw.path !== undefined && (absolute(slashes(raw.path)) || absolute(directory(raw.path)))) err(t(lang, 'workspacePath', i));
    if (raw.ref !== undefined && !text(raw.ref)) err(t(lang, 'workspaceRef', i));
    if (namespaces.has(raw.namespace)) err(t(lang, 'duplicateNamespace', raw.namespace));
    namespaces.add(raw.namespace);
    const location = raw.github !== undefined ? `github:${raw.github}` : `path:${directory(String(raw.path))}`;
    const key = `${location}:${file}`;
    if (files.has(key)) err(t(lang, 'workspaceDuplicateFile', file));
    files.add(key);
    const base = { namespace: raw.namespace, file, ...(text(raw.ref) ? { ref: raw.ref } : {}) };
    plans.push(text(raw.github) ? { ...base, github: raw.github } : { ...base, path: directory(String(raw.path)) });
  }
  return { workspace: findings.length ? null : { version: 1, plans }, findings };
}

/** Fetch both possible refs in one round trip; choose by branch existence, not file existence. */
export function workspaceQuery(entries: WorkspaceEntry[], headRef?: string): string {
  const str = JSON.stringify;
  const commit = '... on Commit { oid } ... on Tag { target { ... on Commit { oid } } }';
  return `query { ${entries.map((e, i) => {
    const [owner, name] = e.github!.split('/');
    const ref = e.ref ?? 'HEAD';
    const head = headRef === undefined ? '' : `headRef: ref(qualifiedName: ${str(`refs/heads/${headRef}`)}) { name target { ... on Commit { oid } } } head: object(expression: ${str(`refs/heads/${headRef}:${e.file}`)}) { ... on Blob { text } }`;
    return `p${i}: repository(owner: ${str(owner)}, name: ${str(name)}) { defaultBranchRef { name } base: object(expression: ${str(`${ref}:${e.file}`)}) { ... on Blob { text } } baseCommit: object(expression: ${str(ref)}) { ${commit} } ${head} }`;
  }).join(' ')} }`;
}

/** Parse local files first, replace covered entries, then fetch only the remaining GitHub files. */
export function readWorkspace(file: string, paths: string[] = [], opts: WorkspaceOptions = {}): WorkspaceRead {
  const lang = opts.lang ?? 'en';
  const findings: Finding[] = [], entries: WorkspacePlan[] = [];
  const unreadable = (label: string, err: unknown, optional: boolean) => findings.push({
    level: optional && opts.allowMissing ? 'WARN' : 'ERROR', code: 'V0',
    message: t(lang, 'workspaceRead', label, err instanceof Error ? err.message : String(err)),
  });
  const locals: { file: string; plan: PlanFile }[] = [];
  // §V0.1-3: files given on the command line report their own reading problems, not as entries
  for (const path of paths) {
    const read = readInput(path, opts.confine, lang);
    if ('finding' in read) {
      findings.push(read.finding);
      continue;
    }
    const parsed = parsePlan(read.value, lang);
    findings.push(...parsed.findings);
    if (parsed.plan) locals.push({ file: slashes(resolve(path)), plan: parsed.plan });
  }
  let workspace: Workspace | null = null;
  const read = readInput(file, opts.confine, lang);
  if ('finding' in read) findings.push(read.finding);
  else {
    const parsed = parseWorkspace(read.value, lang);
    findings.push(...parsed.findings);
    workspace = parsed.workspace;
  }
  if (!workspace || findings.some((f) => f.level === 'ERROR')) return { workspace, entries, findings };
  const accept = (entry: WorkspaceEntry, plan: PlanFile, info: Omit<WorkspacePlan, 'entry' | 'plan'> = {}) => {
    if (plan.namespace !== entry.namespace) {
      findings.push({ level: 'ERROR', code: 'V0', message: t(lang, 'workspaceNamespace', entry.namespace, plan.namespace ?? t(lang, 'none'), entry.file) });
      return;
    }
    // Keep the raw plan for per-repository status; qualify links only when merging.
    entries.push({ entry, plan, ...info });
  };
  const parse = (entry: WorkspaceEntry, content: string, info: Omit<WorkspacePlan, 'entry' | 'plan'>) => {
    const label = info.file ?? `${entry.github}:${entry.file}`;
    let json: unknown;
    // The file was read: invalid JSON is an invalid plan, which --allow-missing never downgrades.
    try { json = parseJson(content, label, lang); }
    catch (err) { return unreadable(`${entry.namespace} (${label})`, err, false); }
    const parsed = parsePlan(json, lang);
    findings.push(...parsed.findings);
    if (parsed.plan) accept(entry, parsed.plan, info);
  };
  const used = new Set<typeof locals[number]>();
  const remote: WorkspaceEntry[] = [];
  const repository = opts.repository ?? process.env.GITHUB_REPOSITORY;
  const repositoryRoot = opts.repositoryRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const ownEntries = repository ? workspace.plans.filter((e) => e.github === repository) : [];
  for (const raw of workspace.plans) {
    const entry: WorkspaceEntry = raw.path === undefined ? raw : { ...raw, path: slashes(resolve(dirname(resolve(file)), raw.path)) };
    const free = locals.filter((p) => !used.has(p));
    // In CI the repository's own plan may be renamed; bind a lone positional plan to it only when
    // no other entry claims that plan's namespace, so the rename is reported, not misattributed.
    const lone = entry.github === repository && ownEntries.length === 1 && locals.length === 1 && free.includes(locals[0]) &&
      !workspace.plans.some((e) => e.namespace === locals[0].plan.namespace); // §G10.1: the written field only
    const local = free.find((p) => repository !== undefined && entry.github === repository && slashes(relative(repositoryRoot, p.file)) === entry.file) ??
      // §G10.1-2: by the file's written namespace field; a file without it matches no entry
      free.find((p) => p.plan.namespace === entry.namespace) ??
      (lone ? locals[0] : undefined);
    if (local) {
      used.add(local);
      accept(entry, local.plan, { file: local.file });
    } else if (entry.path !== undefined) {
      const path = slashes(resolve(dirname(resolve(file)), entry.path, entry.file));
      let content: string;
      try {
        confineFiles([path], opts.confine, lang);
        content = readText(path, lang);
      } catch (err) {
        // A file that is missing can be allowed; one outside the confinement root cannot.
        unreadable(`${entry.namespace} (${path})`, err, !(err instanceof ConfinedFileError));
        continue;
      }
      parse(entry, content, { file: path });
    } else remote.push(entry);
  }
  for (const local of locals) if (!used.has(local)) entries.push({ entry: null, ...local });
  if (remote.length) {
    let response: unknown;
    try { response = (opts.run ?? ((q: string) => gh(q, lang)))(workspaceQuery(remote, opts.headRef)); }
    catch (err) {
      for (const entry of remote) unreadable(entry.namespace, err, true);
      return { workspace, entries, findings };
    }
    const data = record(response) && record(response.data) ? response.data : {};
    const errors = record(response) && Array.isArray(response.errors) ? response.errors.map((e) => record(e) ? String(e.message) : String(e)).join(t(lang, 'clauseSep')) : '';
    remote.forEach((entry, i) => {
      try {
        const repo = data[`p${i}`];
        const head = record(repo) && record(repo.headRef);
        const blob = record(repo) ? repo[head ? 'head' : 'base'] : null;
        const rawCommit = record(repo) ? (head && record(repo.headRef) ? repo.headRef.target : repo.baseCommit) : null;
        const commit = record(rawCommit) && record(rawCommit.target) ? rawCommit.target : rawCommit;
        const ref = head ? opts.headRef : entry.ref ?? (record(repo) && record(repo.defaultBranchRef) && text(repo.defaultBranchRef.name) ? repo.defaultBranchRef.name : undefined);
        if (!record(blob) || typeof blob.text !== 'string' || !record(commit) || !text(commit.oid) || !ref) throw new Error(t(lang, 'workspaceBlob', errors));
        parse(entry, blob.text, { ref, sha: commit.oid });
      } catch (err) { unreadable(`${entry.namespace} (${entry.github}:${entry.file})`, err, true); }
    });
  }
  return { workspace, entries, findings };
}

export function workspacePlan(input: WorkspacePlan): PlanFile {
  const repo = input.entry?.github;
  return repo ? { ...input.plan, nodes: input.plan.nodes.map((n) => ({ ...n, links: n.links?.map((l) => l.startsWith('#') ? `${repo}${l}` : l) })) } : input.plan;
}

/** RULES.md §S departs from §G2.4: status uses each plan's own ids and links, then qualifies report ids. */
export function suggestWorkspace(entries: WorkspacePlan[], opts: WorkspaceOptions = {}): Suggestion[] {
  return entries.flatMap(({ entry, plan, file }) => {
    const suggestions = entry?.github
      ? suggestFromGithub(plan, entry.github, { run: opts.run, lang: opts.lang })
      : suggestStatus(plan, entry?.path ?? dirname(file!), { ref: entry?.ref, lang: opts.lang });
    const ns = namespaceOf(plan);
    const roots = new Set(plan.nodes.filter((n) => n.parent === null).map((n) => n.id));
    return suggestions.map((s) => ({ ...s, id: mergedId(ns, s.id, roots.has(s.id), true) }));
  });
}
