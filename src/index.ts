import type { Lang } from './messages.ts';
import { readInput } from './files.ts';
import { derive, type Derived } from './derive.ts';
import { mergePlans, namespaceOf } from './merge.ts';
import { buildModel, type Model } from './model.ts';
import { parsePlan } from './parse.ts';
import type { Finding, PlanFile } from './types.ts';
import { validate } from './validate.ts';
import { readWorkspace, workspacePlan, type WorkspaceOptions, type WorkspaceRead } from './workspace.ts';

export { checkCoupling } from './coupling.ts';
export { derive, type Derived } from './derive.ts';
export { suggestFromGithub } from './githubstatus.ts';
export { suggestStatus, type Suggestion } from './gitstatus.ts';
export { t, type Lang } from './messages.ts';
export { parseLink, type Link } from './links.ts';
export { mergePlans, namespaceOf } from './merge.ts';
export { buildModel, ROOT_PAGE, topPage, type Model } from './model.ts';
export { parsePlan } from './parse.ts';
export { drawio } from './render/drawio.ts';
export { renderHtml } from './render/html.ts';
export { markdown } from './render/markdown.ts';
export { pageMermaid } from './render/mermaid.ts';
export { viewModel } from './render/viewmodel.ts';
export type * from './types.ts';
export { validate } from './validate.ts';
export { parseWorkspace, readWorkspace, suggestWorkspace, workspaceQuery } from './workspace.ts';
export type { Workspace, WorkspaceEntry, WorkspaceOptions, WorkspacePlan } from './workspace.ts';

export interface Loaded {
  model: Model | null;
  plan: PlanFile | null;
  findings: Finding[];
  /** The plan file of each loaded namespace, when the inputs were files (for annotations). */
  files?: Map<string, string>;
}

/**
 * Parse one or more plan objects, merge them if several, build and validate. With `paths`,
 * V0 findings of each input name its file, and `files` maps each namespace to its file.
 */
export function load(inputs: unknown[], claimed?: Derived, lang: Lang = 'en', paths?: string[]): Loaded {
  const findings: Finding[] = [];
  const plans: PlanFile[] = [];
  const files = new Map<string, string>();
  inputs.forEach((input, i) => {
    const r = parsePlan(input, lang);
    findings.push(...r.findings.map((f) => paths ? { ...f, file: paths[i] } : f));
    if (r.plan) plans.push(r.plan);
    if (r.plan && paths) files.set(namespaceOf(r.plan), paths[i]);
  });
  if (plans.length !== inputs.length) return { model: null, plan: null, findings, ...(paths ? { files } : {}) };
  return { ...loadPlans(plans, findings, claimed, lang), ...(paths ? { files } : {}) };
}

function loadPlans(plans: PlanFile[], findings: Finding[], claimed: Derived | undefined, lang: Lang, opts: { workspaceNamespaces?: string[]; qualify?: boolean } = {}): Loaded {
  const merged = mergePlans(plans, lang, opts);
  findings.push(...merged.findings);
  // §G8.5: a V0 error stops the run
  if (findings.some((f) => f.level === 'ERROR' && f.code === 'V0')) return { model: null, plan: null, findings };
  const plan = merged.plan;
  const model = buildModel(plan, lang, merged.scope);
  findings.push(...validate(model, claimed, lang));
  return { model, plan, findings };
}

/** §V0.1-3: unreadable, invalid or confined input files are V0 findings, and stop the run (§G8.5). */
export function loadFiles(paths: string[], claimedPath?: string, lang: Lang = 'en', confine?: string): Loaded {
  const all = [...paths, ...(claimedPath ? [claimedPath] : [])];
  const read = all.map((p) => readInput(p, confine, lang));
  const findings = read.flatMap((r, i) => 'finding' in r ? [{ ...r.finding, file: all[i] }] : []);
  if (findings.length) return { model: null, plan: null, findings, files: new Map() };
  const values = read.map((r) => (r as { value: unknown }).value);
  return load(values.slice(0, paths.length), claimedPath ? values[paths.length] as Derived : undefined, lang, paths);
}

export function loadWorkspace(file: string, paths: string[] = [], opts: WorkspaceOptions & { claimed?: Derived } = {}): Loaded & WorkspaceRead {
  const read = readWorkspace(file, paths, opts);
  if (!read.workspace || read.findings.some((f) => f.level === 'ERROR')) return { ...read, model: null, plan: null };
  return { ...read, ...loadPlans(read.entries.map(workspacePlan), read.findings, opts.claimed, opts.lang ?? 'en', {
    workspaceNamespaces: read.workspace.plans.map((e) => e.namespace), qualify: true,
  }) };
}

export const summary = (m: Model) => derive(m);
