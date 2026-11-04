/**
 * The general part of docs/RULES.md (§G): every concept the rules use, defined once.
 * Model building, validation, merging, coupling, workspaces and status suggestions call
 * these functions and never re-derive the concepts themselves.
 */
import type { DepType, Selector } from './types.ts';

// §G1 Node, item, group

/** The least a node needs for the tree: raw nodes of `status` and typed plan nodes both fit. */
export interface TreeNode { id: string; parent: string | null }

export interface Tree<N extends TreeNode = TreeNode> {
  byId: Map<string, N>;
  children: Map<string, string[]>;
  roots: string[];
  /** Nodes that no node names as `parent`, in plan order. */
  items: string[];
  /** Nodes that some node names as `parent`, in plan order. */
  groups: string[];
  isGroup: (id: string) => boolean;
  /** From the root down to the node itself; stops at a parent loop or an unknown parent. */
  path: (id: string) => string[];
  /** §G1.3: g is x or an ancestor of x. */
  under: (x: string, g: string) => boolean;
  /** §G1.3: the items under g. */
  leaves: (g: string) => string[];
}

/** §G1: groups are derived from `parent`, never declared. Safe on raw plans with parent loops. */
export function tree<N extends TreeNode>(nodes: N[]): Tree<N> {
  const byId = new Map<string, N>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (typeof n.parent !== 'string') continue;
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent)!.push(n.id);
  }
  const isGroup = (id: string) => children.has(id);
  const ids = [...byId.keys()];
  const paths = new Map<string, string[]>();
  const path = (id: string): string[] => {
    const cached = paths.get(id);
    if (cached) return cached;
    const chain = [id];
    const seen = new Set(chain);
    for (let p = byId.get(id)?.parent; typeof p === 'string' && byId.has(p) && !seen.has(p); p = byId.get(p)!.parent) {
      chain.unshift(p);
      seen.add(p);
    }
    paths.set(id, chain);
    return chain;
  };
  const items = ids.filter((id) => !isGroup(id));
  const leavesOf = new Map<string, string[]>();
  const leaves = (g: string): string[] => {
    if (!leavesOf.has(g)) leavesOf.set(g, items.filter((i) => path(i).includes(g)));
    return leavesOf.get(g)!;
  };
  return {
    byId, children, isGroup, path, items, leaves,
    roots: ids.filter((id) => byId.get(id)!.parent === null),
    groups: ids.filter(isGroup),
    under: (x, g) => path(x).includes(g),
  };
}

/** §G1.3: one node lies under the other, including a node and itself. */
export const nested = (t: Pick<Tree, 'under'>, a: string, b: string): boolean => t.under(a, b) || t.under(b, a);

// §G2 Plan file, namespace, merged id

/** §G2.2: `namespace`, else the id of the single root, else `plan`. */
export function namespaceOf(plan: { namespace?: string; nodes: TreeNode[] }): string {
  if (plan.namespace) return plan.namespace;
  const roots = plan.nodes.filter((n) => n.parent === null);
  return roots.length === 1 ? roots[0].id : 'plan';
}

/** §G2.4: `<ns>:<id>`, except a root whose id equals its namespace; unchanged when not qualifying. */
export const mergedId = (ns: string, id: string, isRoot: boolean, qualify: boolean): string =>
  qualify && !(isRoot && id === ns) ? `${ns}:${id}` : id;

/** §G2.3: the namespace part of a qualified reference, or undefined for an id of the same file. */
export const refNamespace = (ref: string): string | undefined => ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : undefined;

/** §G7.4: inside its own file, `<own ns>:<id>` is the node `<id>` when that node exists. */
export function ownRef(ref: string, ns: string, has: (id: string) => boolean): string {
  const local = ref.startsWith(`${ns}:`) ? ref.slice(ns.length + 1) : undefined;
  return local !== undefined && has(local) ? local : ref;
}

// §G3 Declaration, resolution; §G10.5 known, excused

/** §G3.1: one `dependsOn` entry on `node`: the node waits for `target`. */
export interface Declaration {
  node: string;
  target: string;
  type: DepType;
  source?: string;
  quote?: string;
}

export function declarations(nodes: { id: string; dependsOn?: { id: string; type: DepType; source?: string; quote?: string }[] }[]): Declaration[] {
  return nodes.flatMap((n) => (n.dependsOn ?? []).map((d) => ({ node: n.id, target: d.id, type: d.type, source: d.source, quote: d.quote })));
}

/**
 * Where references resolve. `nsOf` gives a resolved node's namespace. `listed` is set when a
 * workspace is used; `excused` holds each plan's `externalRefs` as written (after merging).
 */
export interface Scope {
  loaded: string[];
  has: (id: string) => boolean;
  nsOf: (id: string) => string;
  listed?: string[];
  excused?: Map<string, Set<string>>;
  /** The namespace of the plan that states each claim, in the merged plan's order. */
  claimNs?: string[];
}

export type RefState = 'resolved' | 'missing' | 'unloaded';

/** §G3.4 */
export function refState(ref: string, s: Pick<Scope, 'has' | 'loaded'>): RefState {
  if (s.has(ref)) return 'resolved';
  const ns = refNamespace(ref);
  return ns === undefined || s.loaded.includes(ns) ? 'missing' : 'unloaded';
}

/** §G3.4, §G10.5: unloaded, and with a workspace not listed either. */
export const unknownRef = (ref: string, s: Pick<Scope, 'has' | 'loaded' | 'listed'>): boolean =>
  s.listed !== undefined && refState(ref, s) === 'unloaded' && !s.listed.includes(refNamespace(ref)!);

/** §G10.5: the id appears exactly in the referring plan's `externalRefs`. */
export const excusedRef = (ref: string, referrer: string, s: Pick<Scope, 'excused'>): boolean =>
  s.excused?.get(referrer)?.has(ref) ?? false;

// §G4 Dependency type

/** §G4.3: `type` is σ or stronger. */
export const atLeast = (type: DepType, sigma: DepType): boolean => sigma === 'order' || type === 'hard';

// §G5 Binding of a declaration

/** An expanded edge (§G3.3): `from` must come first, `to` waits. */
export interface BoundEdge {
  from: string;
  to: string;
  type: DepType;
  /** false when `from` is an unloaded or missing reference (§G5, last row). */
  resolved: boolean;
  decl: Declaration;
}

/** Strongly connected components (Tarjan), in reverse topological order. */
export function stronglyConnected(nodes: Iterable<string>, succ: (n: string) => Iterable<string>): string[][] {
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>(), out: string[][] = [];
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    onStack.add(v);
    for (const w of succ(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const c: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      c.push(w);
    } while (w !== v);
    out.push(c.reverse());
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return out;
}

export interface Binder {
  /** §G5.1: the items i waits on inside g, at strength σ. */
  innerWaits: (g: string, sigma: DepType) => Map<string, Set<string>>;
  /** §G5.2: the components of g's items. */
  components: (g: string, sigma: DepType) => string[][];
  /** §G5.3 */
  finalItems: (g: string, sigma: DepType) => string[];
  firstItems: (g: string, sigma: DepType) => string[];
  /** §G5 case table: the expanded edges one declaration binds. */
  bind: (d: Declaration) => BoundEdge[];
}

export function binder(t: Tree, decls: Declaration[]): Binder {
  const memo = new Map<string, { waits: Map<string, Set<string>>; components: string[][]; first: string[]; final: string[] }>();
  const of = (g: string, sigma: DepType) => {
    const key = `${sigma}\u0000${g}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const inside = t.leaves(g);
    const waits = new Map<string, Set<string>>(inside.map((i) => [i, new Set<string>()]));
    // §G5.1, [decision]: only declarations whose source node and target both lie inside g
    for (const d of decls) {
      if (!atLeast(d.type, sigma) || d.node === g || !t.under(d.node, g) || !t.byId.has(d.target) || !t.under(d.target, g)) continue;
      if (nested(t, d.node, d.target)) continue;
      const targets = t.leaves(d.target);
      for (const i of t.leaves(d.node)) for (const j of targets) waits.get(i)!.add(j);
    }
    // §G5.2-3: a component is final when no other component waits on it, first when it waits on none
    const components = stronglyConnected(inside, (i) => waits.get(i)!);
    const compOf = new Map<string, number>();
    components.forEach((c, k) => c.forEach((i) => compOf.set(i, k)));
    const waitsOnOther = new Set<number>(), waitedOn = new Set<number>();
    for (const [i, js] of waits) for (const j of js) {
      if (compOf.get(i) === compOf.get(j)) continue;
      waitsOnOther.add(compOf.get(i)!);
      waitedOn.add(compOf.get(j)!);
    }
    const order = new Map(inside.map((i, k) => [i, k]));
    const pick = (keep: (k: number) => boolean) => components.flatMap((c, k) => keep(k) ? c : []).sort((a, b) => order.get(a)! - order.get(b)!);
    const r = { waits, components, final: pick((k) => !waitedOn.has(k)), first: pick((k) => !waitsOnOther.has(k)) };
    memo.set(key, r);
    return r;
  };
  const sources = (n: string, sigma: DepType) => t.isGroup(n) ? of(n, sigma).first : [n];
  const bind = (d: Declaration): BoundEdge[] => {
    const resolved = t.byId.has(d.target);
    if (resolved && nested(t, d.node, d.target)) return [];
    const froms = !resolved ? [d.target] : t.isGroup(d.target) ? of(d.target, d.type).final : [d.target];
    const tos = sources(d.node, d.type);
    return froms.flatMap((from) => tos.map((to) => ({ from, to, type: d.type, resolved, decl: d })));
  };
  return {
    innerWaits: (g, s) => of(g, s).waits,
    components: (g, s) => of(g, s).components,
    finalItems: (g, s) => t.isGroup(g) ? of(g, s).final : [g],
    firstItems: (g, s) => t.isGroup(g) ? of(g, s).first : [g],
    bind,
  };
}

// §G6 Status

export type Status = 'done' | 'open';
export type ItemState = 'done' | 'ready' | 'blocked';

/** §G6.1, §G6.3: an item's status as written; a group's derived from every item under it. */
export function derivedStatus(t: Tree, itemStatus: (item: string) => Status): (id: string) => Status {
  return (id) => t.isGroup(id) ? (t.leaves(id).every((i) => itemStatus(i) === 'done') ? 'done' : 'open') : itemStatus(id);
}

/** §G6.2: blocked by a hard edge from an unresolved or unfinished item; order edges never block. */
export function itemState(item: string, status: (id: string) => Status, into: BoundEdge[]): ItemState {
  if (status(item) === 'done') return 'done';
  return into.some((e) => e.type === 'hard' && (!e.resolved || status(e.from) !== 'done')) ? 'blocked' : 'ready';
}

// §G7 Crossing

/**
 * §G7.1-3: whether a declaration crosses a group or file boundary. `undefined` when its target
 * is missing in its own file and crossing cannot be judged. Targets are already resolved per §G7.4.
 */
export function crosses(d: Pick<Declaration, 'node' | 'target'>, t: Pick<Tree, 'byId'>, nsOf: (id: string) => string): boolean | undefined {
  const own = nsOf(d.node);
  const target = t.byId.get(d.target);
  if (target) return target.parent !== t.byId.get(d.node)!.parent || nsOf(d.target) !== own;
  const ns = refNamespace(d.target);
  return ns !== undefined && ns !== own ? true : undefined;
}

// §G8 Statement, citation

/** §G8.2: a declaration with both `source` and `quote`. */
export const cited = (d: { source?: string; quote?: string }): boolean => !!d.source && !!d.quote;

/** §G8.2: the text before the first whitespace, without a leading `./`. */
export const filePart = (source: string): string => source.trim().split(/\s/)[0].replace(/^\.\//, '');

/** §G8.2: a `source` matches a listed file s. */
export const sourceMatches = (source: string, s: string): boolean => filePart(source) === s || source.startsWith(s);

// §G9 Claim and agreement

/** Reachability over resolved expanded edges at a strength (§G9.3); also used by cycles and overlaps. */
export interface Reach {
  succ: (n: string, sigma: DepType) => string[];
  /** A shortest path from `from` to `to` at strength σ, both included, or null. */
  path: (from: string, to: string, sigma: DepType) => string[] | null;
  reaches: (from: string, to: string, sigma: DepType) => boolean;
}

export function reach(edges: BoundEdge[]): Reach {
  const succs = { hard: new Map<string, string[]>(), order: new Map<string, string[]>() };
  for (const e of edges) {
    if (!e.resolved) continue;
    for (const sigma of ['hard', 'order'] as const) {
      if (!atLeast(e.type, sigma)) continue;
      const next = succs[sigma].get(e.from) ?? [];
      if (!next.includes(e.to)) succs[sigma].set(e.from, [...next, e.to]);
    }
  }
  const succ = (n: string, sigma: DepType) => succs[sigma].get(n) ?? [];
  const path = (from: string, to: string, sigma: DepType): string[] | null => {
    const prev = new Map<string, string>([[from, from]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i];
      if (x === to) {
        const p = [x];
        while (p[0] !== from) p.unshift(prev.get(p[0])!);
        return p;
      }
      for (const y of succ(x, sigma)) if (!prev.has(y)) { prev.set(y, x); queue.push(y); }
    }
    return null;
  };
  return { succ, path, reaches: (from, to, sigma) => path(from, to, sigma) !== null };
}

/** §G9.1: a claim without `type` is hard. */
export const claimType = (c: { type?: DepType }): DepType => c.type ?? 'hard';

/** §G9.2: exactly the edges a declaration of type τ on T with target F would bind (§G5); none when nested. */
export function claimedPairs(b: Binder, from: string, to: string, tau: DepType): [string, string][] {
  return b.bind({ node: to, target: from, type: tau }).map((e): [string, string] => [e.from, e.to]);
}

export type Agreement = 'agreed' | 'otherType' | 'unstated';

/** §G9.4-6, on resolved endpoints. */
export function agreement(b: Binder, r: Reach, c: { from: string; to: string; type?: DepType }): Agreement {
  const tau = claimType(c);
  const pairs = claimedPairs(b, c.from, c.to, tau);
  if (pairs.every(([f, x]) => r.reaches(f, x, tau))) return 'agreed';
  if (tau === 'hard' && pairs.every(([f, x]) => r.reaches(f, x, 'order'))) return 'otherType';
  return 'unstated';
}

// §G11 Page, representative, overlap

export const ROOT_PAGE = '@root';

/** §G11.1: a virtual top page when there are several roots or the only root is an item. */
export const hasVirtualRoot = (t: Pick<Tree, 'roots' | 'isGroup'>): boolean => t.roots.length !== 1 || !t.isGroup(t.roots[0]);

/**
 * §G11.2: the page node that stands for item x on the page of g (null: the virtual top page).
 * `inside` is false for a stub; then `node` is what the stub `@node` stands for.
 */
export function representative(t: Pick<Tree, 'byId' | 'path'>, x: string, g: string | null): { node: string; inside: boolean } {
  if (!t.byId.has(x)) return { node: x, inside: false };
  const p = t.path(x);
  if (g === null) return { node: p[0], inside: true };
  const gi = p.indexOf(g);
  if (gi >= 0) return { node: p[gi + 1] ?? x, inside: true };
  const gp = t.path(g);
  let k = 0;
  while (k < p.length && k < gp.length && p[k] === gp[k]) k++;
  return { node: p[k], inside: false };
}

/** §G11.4: a selector matches on `kind` and on the id without its namespace prefix. */
export function selectorMatches(id: string, n: { kind?: string }, s: Selector): boolean {
  if (s.kind !== undefined && n.kind !== s.kind) return false;
  if (s.idPrefix !== undefined && !(id.split(':').pop() ?? id).startsWith(s.idPrefix)) return false;
  return true;
}

/** §G11.4: two open items overlap when neither reaches the other over edges of either type. */
export const independent = (r: Reach, a: string, b: string): boolean => !r.reaches(a, b, 'order') && !r.reaches(b, a, 'order');

// §S Status suggestions

/** §S [decision]: an id counts for commit matching with two characters or more, not all digits. */
export const idCounts = (id: string): boolean => id.length >= 2 && !/^\d+$/.test(id);
