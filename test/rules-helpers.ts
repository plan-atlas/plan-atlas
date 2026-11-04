/** Builders and finding classifiers for the tests derived from docs/RULES.md. */
import { buildModel, type Model } from '../src/model.ts';
import { mergePlans } from '../src/merge.ts';
import { parsePlan } from '../src/parse.ts';
import type { Derived } from '../src/derive.ts';
import type { Dep, DepType, Finding, PlanFile, PlanNode } from '../src/types.ts';
import { validate } from '../src/validate.ts';

export const cite = { source: 'plan.md §1', quote: 'stated in the plan' };
/** A declaration, cited unless `cited` is false. */
export const dep = (id: string, type: DepType = 'hard', cited = true): Dep => ({ id, type, ...(cited ? cite : {}) });
/** An open item with a source. */
export const I = (id: string, parent: string | null, deps?: Dep[], extra: Partial<PlanNode> = {}): PlanNode =>
  ({ id, title: id, parent, status: 'open', source: 'plan.md §1', ...(deps ? { dependsOn: deps } : {}), ...extra });
/** A node meant to be a group (it becomes one by having children). */
export const G = (id: string, parent: string | null, deps?: Dep[], extra: Partial<PlanNode> = {}): PlanNode =>
  ({ id, title: id, parent, ...(deps ? { dependsOn: deps } : {}), ...extra });
export const P = (nodes: PlanNode[], extra: Partial<PlanFile> = {}): PlanFile => ({ version: 1, nodes, ...extra });

/** Parse, merge (as a workspace when `workspace` lists namespaces), build and validate. */
export function run(plans: PlanFile[], opts: { workspace?: string[]; claimed?: Derived } = {}): { model: Model | null; findings: Finding[] } {
  const parsed = plans.map((p) => parsePlan(structuredClone(p)));
  const v0 = parsed.flatMap((r) => r.findings);
  if (v0.some((f) => f.level === 'ERROR')) return { model: null, findings: v0 };
  const merged = mergePlans(parsed.map((r) => r.plan!), 'en', opts.workspace ? { workspaceNamespaces: opts.workspace, qualify: true } : {});
  if (merged.findings.length) return { model: null, findings: merged.findings };
  const model = buildModel(merged.plan, 'en', merged.scope);
  return { model, findings: [...v0, ...validate(model, opts.claimed)] };
}
export const model = (...plans: PlanFile[]) => run(plans).model!;

/** Message ids of src/messages.ts, recognized by their English wording. */
const MESSAGES: [string, RegExp][] = [
  ['noSource', /has no source$/],
  ['wrongSource', /is not in the plan files declared by/],
  ['inferredStatus', /status is inferred/],
  ['depCitation', /^Cross-group dependency .* needs a source and quote$/],
  ['pageSize', / nodes \(limit \d+\)/],
  ['hardCycle', /^Hard dependency cycle/],
  ['nestedDep', /one contains the other/],
  ['orderCycle', /^Order ".*" contradicts a dependency/],
  ['groupCycle', /has a cycle only between groups/],
  ['missingExternalItem', /plan has no such item$/],
  ['claimUnknownNamespace', /^Claim .* whose namespace is not in the workspace or externalRefs$/],
  ['unknownNamespace', /depends on .* but namespace .* is not in the workspace or externalRefs$/],
  ['externalUnloaded', /that plan is not loaded and cannot be checked$/],
  ['claimMissingNode', /refers to missing nodes in loaded plans/],
  ['claimUnloaded', /a referenced plan is not loaded$/],
  ['claimMissing', /^Plans disagree: .* has no such dependency$/],
  ['claimType', /^Plans disagree: .* is \w+ in one plan and \w+ in the other$/],
  ['staleStatus', /the status or the plan is out of date$/],
  ['passedGate', /this gate has been passed/],
  ['releaseNoTag', /is marked done without a tag/],
  ['summaryMissingGroup', /^Summary is missing group/],
  ['summaryStatus', /: summary says .*, items give/],
  ['summaryUnknownGroup', /^Summary has unknown group/],
  ['summaryMissingPage', /^Summary is missing page/],
  ['summaryUnknownPage', /^Summary has unknown page/],
  ['summaryNodes', /summary nodes and stubs differ/],
  ['summaryExtraEdge', /with no item-level relationship behind it$/],
  ['summaryCount', /count differs: summary/],
  ['summaryMissingEdge', /\(present at item level\)$/],
  ['duplicateNamespace', /^Two files use the same namespace/],
  ['jsonObject', /^File is not a JSON object$/],
  ['version', /^Unsupported version/],
  ['nodesArray', /^Missing nodes array$/],
  ['nodeFields', /needs id and title$/],
  ['duplicateId', /^Duplicate id/],
  ['idColon', /^id cannot contain a colon/],
  ['parentType', /parent must be a string or null$/],
  ['unknownParent', /: parent .* does not exist$/],
  ['parentCycle', /^Parent cycle/],
  ['noRoot', /^No top-level node/],
  ['statusType', /status must be done or open$/],
  ['groupStatus', /has children and is a group/],
  ['itemStatus', /is an item and needs status$/],
  ['releaseChildren', /is a release and cannot have children/],
  ['tagOnItem', /is not a release and cannot have a tag$/],
  ['depsArray', /dependsOn must be an array$/],
  ['depFields', /a dependsOn entry needs id and type/],
  ['unknownDep', /depends on missing node/],
  ['unknownArea', /touches unknown area/],
  ['linksArray', /links must be an array$/],
  ['badLink', /has an invalid link/],
  ['fieldType', /has the wrong type/],
  ['planNamespace', /^namespace must be letters/],
  ['listArray', /must be an array$/],
  ['claimFields', /^claims\[\d+\] needs from and to/],
  ['externalRefFields', /^externalRefs\[\d+\] needs an id/],
  ['overlapFields', /^rules\.overlaps\[\d+\] needs an id/],
  ['maxPageNodes', /^rules\.maxPageNodes must be an integer/],
  ['workspaceRead', /^Cannot read workspace entry/],
  ['workspaceFetch', /^Cannot fetch workspace/],
  ['fileRead', /^Cannot read (?!workspace entry)/],
  ['fileJson', /^Invalid JSON in/],
  ['fileConfined', /must be a regular file, not a symlink/],
  ['workspaceObject', /^Workspace is not a JSON object$/],
  ['workspacePlans', /^Workspace needs a plans array$/],
  ['workspaceFields', /needs a namespace .* and file$/],
  ['workspaceFile', /\.file must name one repository-relative file/],
  ['workspaceLocation', /needs exactly one of github/],
  ['workspacePath', /\.path must be relative to the workspace file/],
  ['workspaceRef', /\.ref must be a nonempty string$/],
  ['workspaceDuplicateFile', /lists the same repository file more than once/],
  ['workspaceNamespace', /^Workspace namespace .* does not match file namespace/],
  ['selfOtherRepository', /^Self entry .+ is not this repository/],
  ['selfLeftOut', /^Entry .+ is part of this repository .+ but is not in the self set/],
  ['workspaceRemotePath', /uses path, which a workspace read from GitHub cannot resolve/],
];

/** The message id of a finding, by its English text. */
export function messageId(f: Finding): string {
  const hit = MESSAGES.find(([, re]) => re.test(f.message));
  return hit ? hit[0] : `?${f.message}`;
}

/** `LEVEL code messageId` for each finding, optionally only those of one code. */
export const ids = (fs: Finding[], code?: string) => fs.filter((f) => !code || f.code === code).map((f) => `${f.level} ${f.code} ${messageId(f)}`);
/** The same, without INFO, V7 and V3 noise unless asked: just the given codes. */
export const only = (fs: Finding[], ...codes: string[]) => fs.filter((f) => codes.includes(f.code)).map((f) => `${f.level} ${f.code} ${messageId(f)}`);
