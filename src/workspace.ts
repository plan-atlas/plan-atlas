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
  /** Entry namespaces read from the current directory. Union with `selfRepo`. */
  self?: string[];
  /** Select every entry whose `github` equals this, compared without case. */
  selfRepo?: string;
  /** Directory self entries are read from. Defaults to `process.cwd()`. */
  cwd?: string;
}
export interface WorkspacePlan {
  entry: WorkspaceEntry | null;
  plan: PlanFile;
  /** Local replacement, path entry or self file, as an absolute, slash-normalized path. */
  file?: string;
  ref?: string;
  sha?: string;
  /** Read from the current directory; never fetched (§G10.2). */
  self?: true;
}
export interface WorkspaceRead {
  workspace: Workspace | null;
  entries: WorkspacePlan[];
  findings: Finding[];
  /** Set when the workspace file itself was fetched from GitHub. */
  source?: { github: string; path: string; ref: string; sha: string };
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

/** A commit oid, including a tag that points at a commit. */
const COMMIT_OID = '... on Commit { oid } ... on Tag { target { ... on Commit { oid } } }';

/** Fetch both possible refs in one round trip; choose by branch existence, not file existence. */
export function workspaceQuery(entries: WorkspaceEntry[], headRef?: string): string {
  const str = JSON.stringify;
  return `query { ${entries.map((e, i) => {
    const [owner, name] = e.github!.split('/');
    const ref = e.ref ?? 'HEAD';
    const head = headRef === undefined ? '' : `headRef: ref(qualifiedName: ${str(`refs/heads/${headRef}`)}) { name target { ... on Commit { oid } } } head: object(expression: ${str(`refs/heads/${headRef}:${e.file}`)}) { ... on Blob { text } }`;
    return `p${i}: repository(owner: ${str(owner)}, name: ${str(name)}) { defaultBranchRef { name } base: object(expression: ${str(`${ref}:${e.file}`)}) { ... on Blob { text } } baseCommit: object(expression: ${str(ref)}) { ${COMMIT_OID} } ${head} }`;
  }).join(' ')} }`;
}

/** `github:<owner>/<repo>:<path>[@<ref>]`. The ref is the text after the last `@`. */
function parseRemoteWorkspace(value: string, lang: Lang): { github: string; path: string; ref?: string } {
  const body = value.slice('github:'.length);
  const at = body.lastIndexOf('@');
  const ref = at === -1 ? undefined : body.slice(at + 1);
  const location = at === -1 ? body : body.slice(0, at);
  const colon = location.indexOf(':');
  const github = colon === -1 ? '' : location.slice(0, colon);
  const path = colon === -1 ? '' : location.slice(colon + 1);
  const normalized = posix.normalize(slashes(path));
  const relativeFile = text(path) && !slashes(path).split('/').includes('..') && normalized !== '.' &&
    !normalized.startsWith('../') && !absolute(normalized) && !/[*?\[\]]/.test(normalized);
  if ((ref !== undefined && (ref === '' || ref.startsWith('-'))) || !REPO_PATTERN.test(github) || !relativeFile) {
    throw new Error(t(lang, 'workspaceRemoteForm', value));
  }
  return { github, path, ...(ref !== undefined ? { ref } : {}) };
}

function workspaceFileQuery(spec: { github: string; path: string; ref?: string }): string {
  const str = JSON.stringify;
  const [owner, name] = spec.github.split('/');
  const expression = spec.ref ?? 'HEAD';
  return `query { repository(owner: ${str(owner)}, name: ${str(name)}) { defaultBranchRef { name } blob: object(expression: ${str(`${expression}:${spec.path}`)}) { ... on Blob { text } } commit: object(expression: ${str(expression)}) { ${COMMIT_OID} } } }`;
}

/** Parse local files first, replace covered entries, then fetch only the remaining GitHub files. */
export function readWorkspace(file: string, paths: string[] = [], opts: WorkspaceOptions = {}): WorkspaceRead {
  const lang = opts.lang ?? 'en';
  const cwd = opts.cwd ?? process.cwd();
  const findings: Finding[] = [], entries: WorkspacePlan[] = [];
  let workspace: Workspace | null = null;
  let source: WorkspaceRead['source'];
  const finish = (): WorkspaceRead => ({ workspace, entries, findings, ...(source ? { source } : {}) });
  const unreadable = (label: string, err: unknown, optional: boolean, findingFile?: string) => findings.push({
    level: optional && opts.allowMissing ? 'WARN' : 'ERROR', code: 'V0',
    message: t(lang, 'workspaceRead', label, err instanceof Error ? err.message : String(err)),
    ...(findingFile ? { file: findingFile } : {}),
  });
  const shown = (abs: string) => slashes(relative(cwd, abs));
  const graphqlErrors = (response: unknown) => record(response) && Array.isArray(response.errors)
    ? response.errors.map((e) => record(e) ? String(e.message) : String(e)).join(t(lang, 'clauseSep')) : '';
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
  if (file.startsWith('github:')) {
    const spec = parseRemoteWorkspace(file, lang);
    const fetched = (reason: string) => findings.push({
      level: opts.allowMissing ? 'WARN' : 'ERROR', code: 'V0',
      message: t(lang, 'workspaceFetch', file, reason),
    });
    let response: unknown;
    try { response = (opts.run ?? ((q: string) => gh(q, lang)))(workspaceFileQuery(spec)); }
    catch (err) {
      fetched(err instanceof Error ? err.message : String(err));
      return finish();
    }
    const data = record(response) && record(response.data) ? response.data : {};
    const repo = record(data) ? data.repository : undefined;
    const blob = record(repo) ? repo.blob : null;
    const rawCommit = record(repo) ? repo.commit : null;
    const commit = record(rawCommit) && record(rawCommit.target) ? rawCommit.target : rawCommit;
    const ref = spec.ref ?? (record(repo) && record(repo.defaultBranchRef) && text(repo.defaultBranchRef.name) ? repo.defaultBranchRef.name : undefined);
    if (!record(blob) || typeof blob.text !== 'string' || !record(commit) || !text(commit.oid) || !ref) {
      fetched(t(lang, 'workspaceBlob', graphqlErrors(response)));
      return finish();
    }
    source = { github: spec.github, path: spec.path, ref, sha: commit.oid };
    let json: unknown;
    // The file was fetched: invalid JSON is V0.2, which --allow-missing never downgrades.
    try { json = parseJson(blob.text, `github:${spec.github}:${spec.path}`, lang); }
    catch (err) {
      findings.push({ level: 'ERROR', code: 'V0', message: err instanceof Error ? err.message : String(err) });
      return finish();
    }
    const parsed = parseWorkspace(json, lang);
    findings.push(...parsed.findings);
    workspace = parsed.workspace;
  } else {
    const read = readInput(file, opts.confine, lang);
    if ('finding' in read) findings.push(read.finding);
    else {
      const parsed = parseWorkspace(read.value, lang);
      findings.push(...parsed.findings);
      workspace = parsed.workspace;
    }
  }
  if (!workspace || findings.some((f) => f.level === 'ERROR')) return finish();
  const accept = (entry: WorkspaceEntry, plan: PlanFile, info: Omit<WorkspacePlan, 'entry' | 'plan'> = {}) => {
    if (plan.namespace !== entry.namespace) {
      findings.push({
        level: 'ERROR', code: 'V0', message: t(lang, 'workspaceNamespace', entry.namespace, plan.namespace ?? t(lang, 'none'), entry.file),
        ...(info.self && info.file ? { file: shown(info.file) } : {}),
      });
      return;
    }
    // Keep the raw plan for per-repository status; qualify links only when merging.
    entries.push({ entry, plan, ...info });
  };
  const parse = (entry: WorkspaceEntry, content: string, info: Omit<WorkspacePlan, 'entry' | 'plan'>) => {
    const label = info.file ?? `${entry.github}:${entry.file}`;
    const selfFile = info.self && info.file ? shown(info.file) : undefined;
    let json: unknown;
    // The file was read: invalid JSON is an invalid plan, which --allow-missing never downgrades.
    try { json = parseJson(content, label, lang); }
    catch (err) { return unreadable(`${entry.namespace} (${label})`, err, false, selfFile); }
    const parsed = parsePlan(json, lang);
    findings.push(...parsed.findings.map((f) => selfFile && f.file === undefined ? { ...f, file: selfFile } : f));
    if (parsed.plan) accept(entry, parsed.plan, info);
  };
  const selfNames = opts.self ?? [];
  const wantsSelf = selfNames.length > 0 || opts.selfRepo !== undefined;
  const selfEntries = new Set<WorkspaceEntry>();
  if (wantsSelf) {
    // A wrong self set is an argument error (exit 2), and only once the workspace parsed.
    for (const name of selfNames) {
      if (!workspace.plans.some((e) => e.namespace === name)) throw new Error(t(lang, 'selfUnknown', name));
    }
    const repoWanted = opts.selfRepo?.toLowerCase();
    if (opts.selfRepo !== undefined && !workspace.plans.some((e) => e.github !== undefined && e.github.toLowerCase() === repoWanted)) {
      throw new Error(t(lang, 'selfRepoNone', opts.selfRepo));
    }
    for (const entry of workspace.plans) {
      if (selfNames.includes(entry.namespace) || (repoWanted !== undefined && entry.github !== undefined && entry.github.toLowerCase() === repoWanted)) selfEntries.add(entry);
    }
    // §V0.36: WARN only, so a transferred repository keeps running (§G8.5 stops on ERROR).
    const repository = opts.repository ?? process.env.GITHUB_REPOSITORY;
    if (repository) {
      for (const entry of workspace.plans) {
        if (entry.github === undefined) continue;
        const own = entry.github.toLowerCase() === repository.toLowerCase();
        if (selfEntries.has(entry) && !own) findings.push({ level: 'WARN', code: 'V0', message: t(lang, 'selfOtherRepository', entry.namespace, entry.github, repository) });
        if (own && !selfEntries.has(entry)) findings.push({ level: 'WARN', code: 'V0', message: t(lang, 'selfLeftOut', entry.namespace, entry.github, repository) });
      }
    }
  }
  // A fetched workspace cannot resolve path entries; a self entry is read from cwd instead (§V0.32).
  if (source) {
    for (const entry of workspace.plans) {
      if (entry.path !== undefined && !selfEntries.has(entry)) findings.push({ level: 'ERROR', code: 'V0', message: t(lang, 'workspaceRemotePath', entry.namespace) });
    }
    if (findings.some((f) => f.level === 'ERROR')) {
      // An invalid workspace was not loaded: --self-files stays unwritten, as for other V0.32 rows.
      workspace = null;
      return finish();
    }
  }
  const readSelf = (raw: WorkspaceEntry) => {
    const path = slashes(resolve(cwd, raw.file));
    let content: string;
    try {
      confineFiles([path], opts.confine, lang);
      content = readText(path, lang);
    } catch (err) {
      // --allow-missing is for entries read from elsewhere; a self file is an input.
      unreadable(`${raw.namespace} (${path})`, err, false, shown(path));
      return;
    }
    // A self entry's repository is this checkout. Keep ref; a path that points elsewhere is not it.
    const entry: WorkspaceEntry = raw.path !== undefined ? { ...raw, path: slashes(cwd) } : raw;
    parse(entry, content, { file: path, self: true });
  };
  const used = new Set<typeof locals[number]>();
  const remote: WorkspaceEntry[] = [];
  const repository = opts.repository ?? process.env.GITHUB_REPOSITORY;
  const repositoryRoot = opts.repositoryRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const ownEntries = repository ? workspace.plans.filter((e) => e.github === repository) : [];
  for (const raw of workspace.plans) {
    if (selfEntries.has(raw)) {
      readSelf(raw);
      continue;
    }
    const entry: WorkspaceEntry = raw.path === undefined ? raw : { ...raw, path: slashes(resolve(dirname(resolve(file)), raw.path)) };
    if (!wantsSelf) {
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
        continue;
      }
    }
    if (entry.path !== undefined) {
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
  if (!wantsSelf) for (const local of locals) if (!used.has(local)) entries.push({ entry: null, ...local });
  if (remote.length) {
    let response: unknown;
    try { response = (opts.run ?? ((q: string) => gh(q, lang)))(workspaceQuery(remote, opts.headRef)); }
    catch (err) {
      for (const entry of remote) unreadable(entry.namespace, err, true);
      return finish();
    }
    const data = record(response) && record(response.data) ? response.data : {};
    const errors = graphqlErrors(response);
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
  return finish();
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
