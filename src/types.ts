/** The on-disk plan format (see schema/plan-atlas.schema.json). */

export type DepType = 'hard' | 'order';

export interface Dep {
  /** Id of a node in this file, or `<namespace>:<id>` for a node defined in another plan file. */
  id: string;
  type: DepType;
  /** Where the plan states this dependency (file + section). Required when it crosses groups. */
  source?: string;
  /** A short quote (≤ 15 words) from that place. */
  quote?: string;
}

export interface PlanNode {
  id: string;
  title: string;
  parent: string | null;
  /** Groups: plan files that items under this group may cite as their `source`. */
  sources?: string[];
  /** Items only. A node with children is a group and must not carry these. */
  status?: 'done' | 'open';
  evidence?: string;
  inferred?: boolean;
  kind?: string;
  /** Git tag of a release item, e.g. "v2.1.0". */
  tag?: string;
  touches?: string[];
  source?: string;
  dependsOn?: Dep[];
  /**
   * Items and groups: the issues, pull requests or branches that carry this node's work.
   * `#123` (an issue or pull request in the repository being checked), `owner/repo#123`,
   * or `branch:<name>`. `status --github` and `status --git` compare them with the status.
   */
  links?: string[];
}

export interface Selector {
  kind?: string;
  /** Match ids by prefix, e.g. "UX". */
  idPrefix?: string;
}

export interface OverlapRule {
  id: string;
  a: Selector;
  b: Selector;
  message?: string;
}

/** This plan asserts that `to` (usually in another file) depends on `from`. */
export interface Claim {
  from: string;
  to: string;
  type?: DepType;
  source?: string;
  quote?: string;
}

export interface PlanFile {
  version: 1;
  title?: string;
  /** Prefix that other files use to reference this file's nodes (`<namespace>:<id>`). */
  namespace?: string;
  areas?: Record<string, string>;
  nodes: PlanNode[];
  rules?: { maxPageNodes?: number; overlaps?: OverlapRule[] };
  claims?: Claim[];
  externalRefs?: { id: string; meaning?: string }[];
}

export type Level = 'ERROR' | 'WARN' | 'INFO';

export interface Finding {
  level: Level;
  code: string;
  message: string;
  /** Node ids the finding is about, for linking from the UI. */
  nodes?: string[];
  /** The namespace of the plan file that holds the statement, when there is one. */
  namespace?: string;
  /** The input file a V0 finding of reading or parsing concerns. */
  file?: string;
}
