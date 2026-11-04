import { t, type Lang } from './messages.ts';
import {
  binder, declarations, derivedStatus, hasVirtualRoot, independent, itemState, namespaceOf, reach, representative,
  ROOT_PAGE, selectorMatches, tree, type Binder, type BoundEdge, type Declaration, type ItemState, type Reach, type Scope,
} from './semantics.ts';
import type { DepType, PlanFile, PlanNode } from './types.ts';

export { ROOT_PAGE, type ItemState };

/** An expanded edge (§G3.3) with what the renderers show of its declaration. */
export interface ItemEdge extends BoundEdge {
  source?: string;
  quote?: string;
  /** Set when the plan named a group; `from` is one of that group's final items. */
  via?: string;
  /** Set when the dependency was declared on a group; `to` is one of its first items. */
  viaTo?: string;
}

export interface Overlap {
  rule: string;
  a: string;
  b: string;
  area: string;
}

export interface GroupStats {
  status: 'done' | 'open';
  counts: Record<ItemState, number>;
  items: number;
  /** Overlaps with both items inside this group. */
  innerOverlaps: number;
}

export type PageNodeType = 'group' | 'item' | 'stub';

export interface PageNode {
  /** Unique on the page. For stubs this is `@<ref>`. */
  id: string;
  type: PageNodeType;
  /** The plan node this stands for (or an unresolved external id for an external stub). */
  ref: string;
  external?: boolean;
  warn: boolean;
}

export interface PageEdge {
  from: string;
  to: string;
  kind: DepType | 'overlap';
  /** Item-level pairs behind this edge: [from, to] for deps, [a, b, area] for overlaps. */
  items: string[][];
}

export interface Page {
  id: string;
  /** For the virtual top page of an untitled plan, the English default; show `pageTitle()`. */
  title: string;
  /** Ancestor page ids from the top, for breadcrumbs. */
  trail: string[];
  nodes: PageNode[];
  edges: PageEdge[];
}

/** A page title in the reader's language: the virtual top page has one only when the plan does not. */
export const pageTitle = (m: Model, p: Page, lang: Lang = 'en') => p.id === ROOT_PAGE && m.plan.title === undefined ? t(lang, 'overview') : p.title;

export interface Model {
  plan: PlanFile;
  /** Loaded namespaces, including plans with no nodes, so missing claim endpoints remain errors. */
  namespaces: string[];
  /** Resolution context (§G3, §G10). */
  scope: Scope;
  byId: Map<string, PlanNode>;
  children: Map<string, string[]>;
  roots: string[];
  items: string[];
  isGroup: (id: string) => boolean;
  /** Path from a top-level node down to the node itself. */
  path: (id: string) => string[];
  under: (x: string, g: string) => boolean;
  leaves: (g: string) => string[];
  declarations: Declaration[];
  binder: Binder;
  edges: ItemEdge[];
  reach: Reach;
  /** §G6.3: an item's status, a group's derived status. */
  status: (id: string) => 'done' | 'open';
  state: Map<string, ItemState>;
  stats: Map<string, GroupStats>;
  overlaps: Overlap[];
  pages: Map<string, Page>;
}

/**
 * Build the model of one merged plan. `scope` comes from merging; a bare list of namespaces
 * (or nothing) describes a single file whose ids are unqualified.
 */
export function buildModel(plan: PlanFile, _lang: Lang = 'en', scope: string[] | Partial<Scope> = [namespaceOf(plan)]): Model {
  const tr = tree(plan.nodes);
  const given: Partial<Scope> = Array.isArray(scope) ? { loaded: scope } : scope;
  const loaded = given.loaded ?? [namespaceOf(plan)];
  const full: Scope = { loaded, has: (id) => tr.byId.has(id), nsOf: given.nsOf ?? (() => loaded[0]), listed: given.listed, excused: given.excused, claimNs: given.claimNs };
  const decls = declarations(plan.nodes);
  const b = binder(tr, decls);
  const edges: ItemEdge[] = decls.flatMap((d) => b.bind(d).map((e) => ({
    ...e, source: d.source, quote: d.quote,
    via: tr.isGroup(d.target) ? d.target : undefined, viaTo: tr.isGroup(d.node) ? d.node : undefined,
  })));
  const r = reach(edges);
  const status = derivedStatus(tr, (i) => tr.byId.get(i)!.status === 'done' ? 'done' : 'open');
  const into = new Map<string, ItemEdge[]>(tr.items.map((i) => [i, []]));
  for (const e of edges) into.get(e.to)?.push(e);
  const state = new Map(tr.items.map((i) => [i, itemState(i, status, into.get(i)!)]));

  // §G11.4 overlaps: one per (rule, unordered pair, area)
  const overlaps: Overlap[] = [];
  const seenPair = new Set<string>();
  const open = tr.items.filter((i) => status(i) === 'open');
  for (const rule of plan.rules?.overlaps ?? []) {
    for (const a of open) {
      if (!selectorMatches(a, tr.byId.get(a)!, rule.a)) continue;
      for (const x of open) {
        if (a === x || !selectorMatches(x, tr.byId.get(x)!, rule.b) || !independent(r, a, x)) continue;
        const shared = (tr.byId.get(a)!.touches ?? []).filter((area) => (tr.byId.get(x)!.touches ?? []).includes(area));
        for (const area of shared) {
          const key = [rule.id, [a, x].sort().join('|'), area].join('#');
          if (seenPair.has(key)) continue;
          seenPair.add(key);
          overlaps.push({ rule: rule.id, a, b: x, area });
        }
      }
    }
  }

  const stats = new Map<string, GroupStats>();
  for (const g of tr.groups) {
    const its = tr.leaves(g);
    const counts: Record<ItemState, number> = { done: 0, ready: 0, blocked: 0 };
    for (const i of its) counts[state.get(i)!]++;
    const innerOverlaps = overlaps.filter((o) => tr.under(o.a, g) && tr.under(o.b, g)).length;
    stats.set(g, { status: status(g), counts, items: its.length, innerOverlaps });
  }

  const model: Model = {
    plan, namespaces: loaded, scope: full, byId: tr.byId, children: tr.children, roots: tr.roots, items: tr.items, isGroup: tr.isGroup,
    path: tr.path, under: tr.under, leaves: tr.leaves, declarations: decls, binder: b, edges, reach: r, status, state, stats, overlaps, pages: new Map(),
  };
  buildPages(model);
  return model;
}

/** §G11.3: map every edge and overlap to the representatives of its ends, adding stubs. */
function buildPages(m: Model) {
  const groups = m.plan.nodes.filter((n) => m.isGroup(n.id)).map((n) => n.id);
  const virtual = hasVirtualRoot(m);
  const pageIds: (string | null)[] = [...(virtual ? [null] : []), ...groups];
  for (const g of pageIds) {
    const id = g ?? ROOT_PAGE;
    const nodes = new Map<string, PageNode>();
    const own = g === null ? m.roots : m.children.get(g)!;
    for (const c of own) nodes.set(c, { id: c, type: m.isGroup(c) ? 'group' : 'item', ref: c, warn: false });
    const edgeMap = new Map<string, PageEdge>();
    // §G11.3: dependency edges are ordered; an overlap edge is an unordered pair, stored sorted
    const put = (a: string, b: string, kind: PageEdge['kind'], pair: string[]) => {
      const [from, to] = kind === 'overlap' ? [a, b].sort() : [a, b];
      const key = [kind, from, to].join('|');
      if (!edgeMap.has(key)) edgeMap.set(key, { from, to, kind, items: [] });
      edgeMap.get(key)!.items.push(pair);
    };
    const nodeFor = (item: string) => {
      const r = representative(m, item, g);
      if (r.inside) return r.node;
      const sid = `@${r.node}`;
      if (!nodes.has(sid)) nodes.set(sid, { id: sid, type: 'stub', ref: r.node, external: !m.byId.has(r.node), warn: false });
      return sid;
    };
    const touchesPage = (item: string) => g === null || (m.byId.has(item) && m.under(item, g));
    for (const e of m.edges) {
      if (!touchesPage(e.from) && !touchesPage(e.to)) continue;
      const a = nodeFor(e.from), b = nodeFor(e.to);
      if (a !== b) put(a, b, e.type, [e.from, e.to]);
    }
    for (const o of m.overlaps) {
      if (!touchesPage(o.a) && !touchesPage(o.b)) continue;
      const a = nodeFor(o.a), b = nodeFor(o.b);
      if (a !== b) put(a, b, 'overlap', [o.a, o.b, o.area]);
      for (const x of [a, b]) {
        if (a !== b || m.isGroup(x)) {
          const pn = nodes.get(x);
          if (pn && pn.type !== 'stub') pn.warn = true;
        }
      }
    }
    // a collapsed group with overlaps inside it also needs attention
    for (const pn of nodes.values()) if (pn.type === 'group' && (m.stats.get(pn.ref)?.innerOverlaps ?? 0) > 0) pn.warn = true;
    const trail = g === null ? [] : [...(virtual ? [ROOT_PAGE] : []), ...m.path(g).slice(0, -1)];
    m.pages.set(id, { id, title: g === null ? (m.plan.title ?? t('en', 'overview')) : m.byId.get(g)!.title, trail, nodes: [...nodes.values()], edges: [...edgeMap.values()] });
  }
}

/** The page shown first: the virtual root when there are several top-level groups. */
export function topPage(m: Model): string {
  return hasVirtualRoot(m) ? ROOT_PAGE : m.roots[0];
}
