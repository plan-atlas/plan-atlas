#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { annotation, findingFile } from './annotations.ts';
import { parseArgs } from 'node:util';
import { t, type Lang } from './messages.ts';
import { checkCoupling } from './coupling.ts';
import { confineFiles, readInput, readJson, readText } from './files.ts';
import { derive, drawio, healthReport, loadFiles, loadWorkspace, markdown, parsePlan, renderHtml, suggestFromGithub, suggestStatus, namespaceOf, suggestWorkspace, type HealthInput, type Model, type Suggestion, type WorkspaceOptions, type WorkspacePlan } from './index.ts';
import type { Finding } from './types.ts';
import type { Derived } from './derive.ts';

function print(findings: Finding[], lang: Lang, log = console.log) {
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  for (const f of [...findings].sort((a, b) => order[a.level] - order[b.level])) log(`${f.level.padEnd(5)} ${f.code.padEnd(4)} ${f.message}`);
  const n = (l: string) => findings.filter((f) => f.level === l).length;
  log(t(lang, 'findingCounts', n('ERROR'), n('WARN'), n('INFO')));
}

const workspaceOptions = {
  workspace: { type: 'string' }, 'head-ref': { type: 'string' }, 'allow-missing': { type: 'boolean' },
  self: { type: 'string', multiple: true }, 'self-repo': { type: 'string' }, 'self-files': { type: 'string' },
} as const;

function printRefs(loaded: { source?: { github: string; path: string; ref: string; sha: string }; entries: WorkspacePlan[] }, lang: Lang, log = console.log) {
  if (loaded.source) log(t(lang, 'workspaceSourceReadAt', loaded.source.github, loaded.source.path, loaded.source.ref, loaded.source.sha));
  for (const e of loaded.entries) if (e.ref && e.sha && e.entry?.github) log(t(lang, 'workspaceReadAt', e.entry.namespace, e.entry.github, e.ref, e.sha));
}

/** One relative path per self file. Absent unless the workspace was read and is valid; empty when none were. */
function writeSelfFiles(loaded: { workspace: unknown; entries: WorkspacePlan[] }, file: string | undefined) {
  if (file === undefined || loaded.workspace === null) return;
  const lines = loaded.entries.flatMap((e) => e.self && e.file ? [relative(process.cwd(), e.file).split(sep).join('/')] : []);
  writeFileSync(file, lines.length === 0 ? '' : `${lines.join('\n')}\n`);
}

function language(value?: string): Lang {
  const lang = value ?? process.env.PLAN_ATLAS_LANG ?? 'en';
  if (lang !== 'en' && lang !== 'zh-TW') throw new Error(t('en', 'badLang', lang));
  return lang;
}

/** The four map files `build` writes. Health uses the same function, so the bytes stay identical. */
function writeAtlas(out: string, model: Model, findings: Finding[], lang: Lang) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'atlas.json'), JSON.stringify(derive(model), null, 2) + '\n');
  writeFileSync(join(out, 'atlas.md'), markdown(model, findings, lang));
  writeFileSync(join(out, 'atlas.drawio'), drawio(model, lang));
  writeFileSync(join(out, 'atlas.html'), renderHtml(model, findings, undefined, lang));
  console.log(t(lang, 'wrote', out, model.pages.size, model.items.length));
}

/** A finding with `namespace` goes to that entry; anything else stays in the general section. */
function healthFromLoaded(loaded: ReturnType<typeof loadWorkspace>, workspace: string, opts: WorkspaceOptions, noStatus: boolean): HealthInput {
  const plans = loaded.workspace?.plans ?? [];
  const byNamespace = new Map(loaded.entries.flatMap((entry) => entry.entry ? [[entry.entry.namespace, entry] as const] : []));
  const repositories: HealthInput['repositories'] = [];
  const seen = new Map<string, HealthInput['repositories'][number]>();
  for (const plan of plans) {
    const label = plan.github ?? plan.path;
    if (label === undefined) continue;
    const key = plan.github !== undefined ? `github:${plan.github}` : `path:${label}`;
    let repo = seen.get(key);
    if (!repo) {
      repo = { label, entries: [] };
      seen.set(key, repo);
      repositories.push(repo);
    }
    const read = byNamespace.get(plan.namespace);
    let suggestions: Suggestion[] = [];
    let statusError: string | undefined;
    if (!noStatus && read) {
      try { suggestions = suggestWorkspace([read], opts); }
      catch (err) { statusError = err instanceof Error ? err.message : String(err); }
    }
    repo.entries.push({
      namespace: plan.namespace,
      ...(read?.ref !== undefined ? { ref: read.ref } : {}),
      ...(read?.sha !== undefined ? { sha: read.sha } : {}),
      findings: loaded.findings.filter((f) => f.namespace === plan.namespace),
      suggestions,
      ...(statusError !== undefined ? { statusError } : {}),
    });
  }
  const namespaces = new Set(repositories.flatMap((repo) => repo.entries.map((entry) => entry.namespace)));
  return {
    generatedAt: new Date().toISOString(),
    workspace,
    ...(loaded.source ? { source: loaded.source } : {}),
    general: loaded.findings.filter((f) => f.namespace === undefined || !namespaces.has(f.namespace)),
    repositories,
  };
}

function runHealth(rest: string[]): number {
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      lang: { type: 'string' }, workspace: { type: 'string' }, out: { type: 'string', default: 'atlas' },
      'no-status': { type: 'boolean' }, 'head-ref': { type: 'string' }, 'allow-missing': { type: 'boolean' },
      self: { type: 'string', multiple: true }, 'self-repo': { type: 'string' }, 'self-files': { type: 'string' },
      against: { type: 'string' }, annotations: { type: 'string' },
    },
  });
  const lang = language(values.lang);
  if (positionals.length > 0 || values.workspace === undefined || values.self !== undefined || values['self-repo'] !== undefined ||
      values['self-files'] !== undefined || values.against !== undefined || values.annotations !== undefined) {
    console.error(t(lang, 'healthArgs'));
    return 2;
  }
  const opts = { lang, headRef: values['head-ref'], allowMissing: values['allow-missing'], confine: process.env.PLAN_ATLAS_CONFINE };
  const loaded = loadWorkspace(values.workspace, [], opts);
  printRefs(loaded, lang);
  if (loaded.model) writeAtlas(values.out!, loaded.model, loaded.findings, lang);
  else mkdirSync(values.out!, { recursive: true });
  const report = healthReport(healthFromLoaded(loaded, values.workspace, opts, values['no-status'] === true), lang);
  writeFileSync(join(values.out!, 'health.md'), report.full);
  writeFileSync(join(values.out!, 'health-issue.md'), report.issue);
  print(loaded.findings, lang);
  console.log(t(lang, 'wroteHealth', values.out!));
  return 0;
}

function printStatus(suggestions: Suggestion[], lang: Lang) {
  const labels = { done: 'DONE?', check: 'CHECK', 'missing-tag': 'MISSING-TAG', 'missing-link': 'MISSING-LINK', mention: 'MENTION' };
  // strongest first; plan order within each kind
  const rank = { done: 0, check: 1, 'missing-tag': 2, 'missing-link': 2, mention: 3 };
  const labelWidth = suggestions.reduce((w, s) => Math.max(w, labels[s.suggest].length), 5);
  const idWidth = suggestions.reduce((w, s) => Math.max(w, s.id.length), 0);
  for (const s of [...suggestions].sort((a, b) => rank[a.suggest] - rank[b.suggest])) {
    const detail = s.suggest === 'done' ? s.evidence : t(lang, 'statusDetail', s.status, s.evidence);
    const subject = (s.suggest === 'check' || s.suggest === 'mention') && s.commits.length ? ` ${JSON.stringify(s.commits[0].subject)}` : '';
    console.log(`${labels[s.suggest].padEnd(labelWidth)}  ${s.id.padEnd(idWidth)}  ${detail}${subject}`);
  }
  console.log(t(lang, 'suggestionCount', suggestions.length));
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(t(language(), 'help'));
    return 0;
  }
  if (cmd === 'status') {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true,
      options: { ...workspaceOptions, lang: { type: 'string' }, git: { type: 'string' }, github: { type: 'string' }, ref: { type: 'string' }, json: { type: 'boolean' } },
    });
    const lang = language(values.lang);
    // status --git/--github prints suggestions, not findings (§S): an input it cannot read stops it (exit 2)
    if (!values.workspace) confineFiles(positionals, process.env.PLAN_ATLAS_CONFINE, lang);
    const selfFlags = values['head-ref'] !== undefined || values['allow-missing'] !== undefined || values.self !== undefined || values['self-repo'] !== undefined || values['self-files'] !== undefined;
    if ((values.workspace && (values.git !== undefined || values.github !== undefined || values.ref !== undefined)) ||
        (!values.workspace && selfFlags)) {
      console.error(t(lang, 'workspaceArgs'));
      return 2;
    }
    if ((values.self !== undefined || values['self-repo'] !== undefined) && positionals.length) {
      console.error(t(lang, 'selfArgs'));
      return 2;
    }
    if (values.workspace) {
      const opts = { lang, headRef: values['head-ref'], allowMissing: values['allow-missing'], confine: process.env.PLAN_ATLAS_CONFINE, self: values.self, selfRepo: values['self-repo'] };
      const loaded = loadWorkspace(values.workspace, positionals, opts);
      writeSelfFiles(loaded, values['self-files']);
      const log = values.json ? console.error : console.log;
      printRefs(loaded, lang, log);
      print(loaded.findings, lang, log);
      const suggestions = loaded.model ? suggestWorkspace(loaded.entries, opts) : [];
      if (values.json) console.log(JSON.stringify(suggestions, null, 2));
      else printStatus(suggestions, lang);
      return loaded.findings.some((f) => f.level === 'ERROR') ? 1 : 0;
    }
    if (!values.git === !values.github || positionals.length !== 1) {
      console.error(t(lang, 'statusArgs'));
      return 2;
    }
    if (values.github && values.ref !== undefined) {
      console.error(t(lang, 'refGitOnly'));
      return 2;
    }
    const plan = readJson(positionals[0], lang);
    const suggestions = values.github ? suggestFromGithub(plan, values.github, { lang }) : suggestStatus(plan, values.git!, { ref: values.ref, lang });
    if (values.json) console.log(JSON.stringify(suggestions, null, 2));
    else printStatus(suggestions, lang);
    return 0;
  }
  if (cmd === 'health') return runHealth(rest);
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { ...workspaceOptions, lang: { type: 'string' }, out: { type: 'string', default: 'atlas' }, against: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, changed: { type: 'string' }, annotations: { type: 'string' } },
  });
  const lang = language(values.lang);
  const confine = process.env.PLAN_ATLAS_CONFINE;
  // --annotations <file>: GitHub annotations of ERROR and WARN findings, for the Action to print
  const annotate = (fs: Finding[], files: Map<string, string>, fallback?: string) => {
    if (values.annotations === undefined) return;
    writeFileSync(values.annotations, fs.flatMap((x) => {
      const file = findingFile(x, files, fallback);
      const line = file === undefined ? null : annotation(x, file);
      return line === null ? [] : [line];
    }).map((l) => `${l}\n`).join(''));
  };
  const selfFlags = values['head-ref'] !== undefined || values['allow-missing'] !== undefined || values.self !== undefined || values['self-repo'] !== undefined || values['self-files'] !== undefined;
  if ((!values.workspace && selfFlags) || (cmd === 'coupling' && values.workspace)) {
    console.error(t(lang, 'workspaceArgs'));
    return 2;
  }
  if ((values.self !== undefined || values['self-repo'] !== undefined) && positionals.length) {
    console.error(t(lang, 'selfArgs'));
    return 2;
  }
  if (cmd === 'coupling') {
    if (!values.before || !values.after || !values.changed) {
      console.error(t(lang, 'couplingArgs'));
      return 2;
    }
    // §V0: unreadable or invalid inputs are findings, and stop the run (§G8.5)
    const inputs = [readInput(values.before, confine, lang), readInput(values.after, confine, lang),
      values.changed === '-' ? { value: readText(0, lang) } : readInput(values.changed, confine, lang, false)];
    const paths = [values.before, values.after, values.changed];
    const unread = inputs.flatMap((r, i) => 'finding' in r ? [{ ...r.finding, file: paths[i] }] : []);
    const parsed = unread.length ? [] : inputs.slice(0, 2).map((r) => parsePlan((r as { value: unknown }).value, lang));
    const invalid = [...unread, ...parsed.flatMap((r, i) => r.findings.map((x) => ({ ...x, file: paths[i] })))];
    if (invalid.length) {
      annotate(invalid, new Map(), values.after);
      print(invalid, lang);
      return 1;
    }
    const list = String((inputs[2] as { value: unknown }).value).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const f = checkCoupling(parsed[0].plan!, parsed[1].plan!, list, lang);
    annotate(f, new Map(), values.after);
    print(f, lang);
    return f.some((x) => x.level === 'ERROR') ? 1 : 0;
  }
  if (cmd !== 'check' && cmd !== 'build') {
    console.error(t(lang, 'unknownCommand', cmd, t(lang, 'help')));
    return 2;
  }
  if (!positionals.length && !values.workspace) {
    console.error(t(lang, 'planArgs'));
    return 2;
  }
  const against = values.against && values.workspace ? readInput(values.against, confine, lang) : undefined;
  if (against && 'finding' in against) {
    annotate([{ ...against.finding, file: values.against! }], new Map(), values.against!);
    print([against.finding], lang);
    return 1;
  }
  const workspaceLoaded = values.workspace
    ? loadWorkspace(values.workspace, positionals, {
      lang, headRef: values['head-ref'], allowMissing: values['allow-missing'], confine,
      self: values.self, selfRepo: values['self-repo'],
      claimed: against ? against.value as Derived : undefined,
    })
    : undefined;
  if (workspaceLoaded) writeSelfFiles(workspaceLoaded, values['self-files']);
  const loaded = workspaceLoaded ?? loadFiles(positionals, values.against, lang, confine);
  if (workspaceLoaded) printRefs(workspaceLoaded, lang);
  const { model, findings } = loaded;
  if (cmd === 'build' && model) writeAtlas(values.out!, model, findings, lang);
  const files = loaded.files ?? new Map((workspaceLoaded?.entries ?? []).flatMap((e) =>
    e.file ? [[e.entry?.namespace ?? namespaceOf(e.plan), relative(process.cwd(), e.file).split(sep).join('/')] as [string, string]] : []));
  // A remote workspace has no file in this checkout, so a finding with no file is not annotated.
  const fallback = positionals[0] ?? (values.workspace?.startsWith('github:') ? undefined : values.workspace);
  annotate(findings, files, fallback);
  print(findings, lang);
  return findings.some((f) => f.level === 'ERROR') ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
}
