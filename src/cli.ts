#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { annotation, findingFile } from './annotations.ts';
import { parseArgs } from 'node:util';
import { t, type Lang } from './messages.ts';
import { checkCoupling } from './coupling.ts';
import { confineFiles, readInput, readJson, readText } from './files.ts';
import { derive, drawio, loadFiles, loadWorkspace, markdown, parsePlan, renderHtml, suggestFromGithub, suggestStatus, namespaceOf, suggestWorkspace, type Suggestion, type WorkspacePlan } from './index.ts';
import type { Finding } from './types.ts';
import type { Derived } from './derive.ts';

function print(findings: Finding[], lang: Lang, log = console.log) {
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  for (const f of [...findings].sort((a, b) => order[a.level] - order[b.level])) log(`${f.level.padEnd(5)} ${f.code.padEnd(4)} ${f.message}`);
  const n = (l: string) => findings.filter((f) => f.level === l).length;
  log(t(lang, 'findingCounts', n('ERROR'), n('WARN'), n('INFO')));
}

const workspaceOptions = { workspace: { type: 'string' }, 'head-ref': { type: 'string' }, 'allow-missing': { type: 'boolean' } } as const;

function printRefs(entries: WorkspacePlan[], lang: Lang, log = console.log) {
  for (const e of entries) if (e.ref && e.sha) log(t(lang, 'workspaceReadAt', e.entry!.namespace, e.entry!.github!, e.ref, e.sha));
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
  const language = (value?: string): Lang => {
    const lang = value ?? process.env.PLAN_ATLAS_LANG ?? 'en';
    if (lang !== 'en' && lang !== 'zh-TW') throw new Error(t('en', 'badLang', lang));
    return lang;
  };
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
    if ((values.workspace && (values.git !== undefined || values.github !== undefined || values.ref !== undefined)) ||
        (!values.workspace && (values['head-ref'] !== undefined || values['allow-missing']))) {
      console.error(t(lang, 'workspaceArgs'));
      return 2;
    }
    if (values.workspace) {
      const opts = { lang, headRef: values['head-ref'], allowMissing: values['allow-missing'], confine: process.env.PLAN_ATLAS_CONFINE };
      const loaded = loadWorkspace(values.workspace, positionals, opts);
      const log = values.json ? console.error : console.log;
      printRefs(loaded.entries, lang, log);
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
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { ...workspaceOptions, lang: { type: 'string' }, out: { type: 'string', default: 'atlas' }, against: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, changed: { type: 'string' }, annotations: { type: 'string' } },
  });
  const lang = language(values.lang);
  const confine = process.env.PLAN_ATLAS_CONFINE;
  // --annotations <file>: GitHub annotations of ERROR and WARN findings, for the Action to print
  const annotate = (fs: Finding[], files: Map<string, string>, fallback: string) => {
    if (values.annotations === undefined) return;
    writeFileSync(values.annotations, fs.flatMap((x) => annotation(x, findingFile(x, files, fallback)) ?? []).map((l) => `${l}\n`).join(''));
  };
  if ((!values.workspace && (values['head-ref'] !== undefined || values['allow-missing'])) || (cmd === 'coupling' && values.workspace)) {
    console.error(t(lang, 'workspaceArgs'));
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
      claimed: against ? against.value as Derived : undefined,
    })
    : undefined;
  const loaded = workspaceLoaded ?? loadFiles(positionals, values.against, lang, confine);
  if (workspaceLoaded) printRefs(workspaceLoaded.entries, lang);
  const { model, findings } = loaded;
  if (cmd === 'build' && model) {
    mkdirSync(values.out!, { recursive: true });
    writeFileSync(join(values.out!, 'atlas.json'), JSON.stringify(derive(model), null, 2) + '\n');
    writeFileSync(join(values.out!, 'atlas.md'), markdown(model, findings, lang));
    writeFileSync(join(values.out!, 'atlas.drawio'), drawio(model, lang));
    writeFileSync(join(values.out!, 'atlas.html'), renderHtml(model, findings, undefined, lang));
    console.log(t(lang, 'wrote', values.out!, model.pages.size, model.items.length));
  }
  const files = loaded.files ?? new Map((workspaceLoaded?.entries ?? []).flatMap((e) =>
    e.file ? [[e.entry?.namespace ?? namespaceOf(e.plan), relative(process.cwd(), e.file).split(sep).join('/')] as [string, string]] : []));
  annotate(findings, files, positionals[0] ?? values.workspace!);
  print(findings, lang);
  return findings.some((f) => f.level === 'ERROR') ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
}
