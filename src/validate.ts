import { t, type Lang } from './messages.ts';
import { derive, type Derived } from './derive.ts';
import { pageTitle, ROOT_PAGE, type ItemEdge, type Model } from './model.ts';
import {
  agreement, claimType, cited, crosses, excusedRef, nested, refNamespace, refState, representative, sourceMatches,
  stronglyConnected, unknownRef, type Declaration,
} from './semantics.ts';
import type { Finding } from './types.ts';

/** One loop through a strongly connected set: from its first node back to itself. */
function loopThrough(comp: string[], succ: (n: string) => string[]): string[] {
  const inside = new Set(comp);
  const start = comp[0];
  const prev = new Map<string, string>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const y of succ(queue[i])) {
      if (!inside.has(y)) continue;
      if (y === start) {
        const p = [start];
        for (let x = queue[i]; x !== start; x = prev.get(x)!) p.unshift(x);
        return [start, ...p];
      }
      if (!prev.has(y)) { prev.set(y, queue[i]); queue.push(y); }
    }
  }
  return [start, start];
}

/** The rules of docs/RULES.md §V3, §V5–§V9, §V11, §V12; §V1/§V2/§V4 when a committed summary is given. */
export function validate(m: Model, claimed?: Derived, lang: Lang = 'en'): Finding[] {
  const f: Finding[] = [];
  const title = (id: string) => m.byId.get(id)?.title ?? id;
  const sep = t(lang, 'listSep');
  const resolvedOnly = (ids: string[]) => ids.filter((x) => m.byId.has(x));
  const bound = new Map<Declaration, ItemEdge[]>(m.declarations.map((d) => [d, []]));
  for (const e of m.edges) bound.get(e.decl)!.push(e);
  const isNested = (d: Declaration) => m.byId.has(d.target) && nested(m, d.node, d.target);
  // the plan file that holds each statement, for annotations
  const ns = (id: string) => m.scope.nsOf(id);
  const pageNs = (p: { id: string }) => p.id === ROOT_PAGE ? undefined : ns(p.id);

  // §V3 provenance, §V7 inferred status: concurrent, two statements of one item
  for (const i of m.items) {
    const n = m.byId.get(i)!;
    if (!n.source) f.push({ level: 'ERROR', code: 'V3', message: t(lang, 'noSource', i), nodes: [i], namespace: ns(i) });
    else {
      const owner = [...m.path(i)].reverse().slice(1).find((g) => (m.byId.get(g)!.sources?.length ?? 0) > 0);
      if (owner && !m.byId.get(owner)!.sources!.some((s) => sourceMatches(n.source!, s))) {
        f.push({ level: 'ERROR', code: 'V3', message: t(lang, 'wrongSource', i, n.source, title(owner)), nodes: [i, owner], namespace: ns(i) });
      }
    }
    if (n.inferred) f.push({ level: 'INFO', code: 'V7', message: t(lang, 'inferredStatus', i, n.evidence), nodes: [i], namespace: ns(i) });
  }

  // §V8 references and citations, per declaration
  for (const d of m.declarations) {
    const state = refState(d.target, m.scope);
    const missing = state === 'missing' && refNamespace(d.target) !== undefined; // V8a1
    const unknown = unknownRef(d.target, m.scope) && !excusedRef(d.target, m.scope.nsOf(d.node), m.scope); // V8a2
    const nodes = resolvedOnly([d.node]);
    if (missing) f.push({ level: 'ERROR', code: 'V8', message: t(lang, 'missingExternalItem', d.node, d.target, refNamespace(d.target)!), nodes, namespace: ns(d.node) });
    if (unknown) f.push({ level: 'ERROR', code: 'V8', message: t(lang, 'unknownNamespace', d.node, d.target, refNamespace(d.target)!), nodes, namespace: ns(d.node) });
    else if (state === 'unloaded') f.push({ level: 'INFO', code: 'V8', message: t(lang, 'externalUnloaded', d.node, d.target), nodes, namespace: ns(d.node) });
    // V8b, displaced by V8a1, V8a2 and V6b
    if (!missing && !unknown && !isNested(d) && crosses(d, m, m.scope.nsOf) === true && !cited(d)) {
      f.push({ level: 'ERROR', code: 'V8', message: t(lang, 'depCitation', d.target, d.node), nodes: resolvedOnly([d.target, d.node]), namespace: ns(d.node) });
    }
  }

  // §V5 page size
  const max = m.plan.rules?.maxPageNodes ?? 15;
  for (const p of m.pages.values()) {
    if (p.nodes.length > max) f.push({ level: 'WARN', code: 'V5', message: t(lang, 'pageSize', pageTitle(m, p, lang), p.nodes.length, max), nodes: [p.id], namespace: pageNs(p) });
  }

  // §V6a hard loop: one per strongly connected component of resolved hard edges
  const hardSucc = (n: string) => m.reach.succ(n, 'hard');
  for (const c of stronglyConnected(m.items, hardSucc).filter((c) => c.length > 1)) {
    const loop = loopThrough([...c].sort((a, b) => m.items.indexOf(a) - m.items.indexOf(b)), hardSucc);
    f.push({ level: 'ERROR', code: 'V6', message: t(lang, 'hardCycle', loop.join(' → ')), nodes: loop, namespace: ns(loop[0]) });
  }
  // §V6b nested declaration: binds nothing
  for (const d of m.declarations) {
    if (isNested(d)) f.push({ level: d.type === 'hard' ? 'ERROR' : 'WARN', code: 'V6', message: t(lang, 'nestedDep', d.node, d.target), nodes: [d.node, d.target], namespace: ns(d.node) });
  }
  // §V6c contradicted order: per declaration; an edge with a hard edge beside it is displaced
  const hardPairs = new Set(m.edges.filter((e) => e.resolved && e.type === 'hard').map((e) => `${e.from}\u0000${e.to}`));
  for (const d of m.declarations) {
    if (d.type !== 'order') continue;
    for (const e of bound.get(d)!) {
      if (!e.resolved || hardPairs.has(`${e.from}\u0000${e.to}`)) continue;
      const back = m.reach.path(e.to, e.from, 'order');
      if (!back) continue;
      f.push({ level: 'WARN', code: 'V6', message: t(lang, 'orderCycle', title(d.target), title(d.node), [e.from, ...back].join(' → ')), nodes: [d.target, d.node], namespace: ns(d.node) });
      break;
    }
  }
  // §V6d grouping artifact: displaced when one item component covers every page edge inside it
  const allSucc = (n: string) => m.reach.succ(n, 'order');
  const itemComponents = stronglyConnected(m.items, allSucc).filter((c) => c.length > 1).map((c) => {
    const inside = new Set(c);
    return m.edges.filter((e) => e.resolved && inside.has(e.from) && inside.has(e.to));
  });
  for (const p of m.pages.values()) {
    const g = p.id === ROOT_PAGE ? null : p.id;
    // RULES.md §V6d departs from §G11.3: only the page's own nodes, stubs left out
    const own = p.nodes.filter((n) => n.type !== 'stub').map((n) => n.id);
    const ownSet = new Set(own);
    const deps = p.edges.filter((e) => e.kind !== 'overlap' && ownSet.has(e.from) && ownSet.has(e.to));
    const succ = (x: string) => deps.filter((e) => e.from === x).map((e) => e.to);
    const rep = (x: string) => {
      const r = representative(m, x, g);
      return r.inside ? r.node : `@${r.node}`;
    };
    const covers = itemComponents.map((edges) => new Set(edges.map((e) => `${e.type}|${rep(e.from)}|${rep(e.to)}`)));
    for (const c of stronglyConnected(own, succ).filter((c) => c.length > 1)) {
      const inside = new Set(c);
      const keys = deps.filter((e) => inside.has(e.from) && inside.has(e.to)).map((e) => `${e.kind}|${e.from}|${e.to}`);
      if (covers.some((s) => keys.every((k) => s.has(k)))) continue;
      const loop = loopThrough([...c].sort((a, b) => own.indexOf(a) - own.indexOf(b)), succ);
      f.push({ level: 'WARN', code: 'V6', message: t(lang, 'groupCycle', pageTitle(m, p, lang), loop.map(title).join(' → ')), nodes: loop, namespace: pageNs(p) });
    }
  }

  // §V8a3 and §V9 claims, per claim
  (m.plan.claims ?? []).forEach((c, k) => {
    const ends = [...new Set([c.from, c.to])];
    const referrer = m.scope.claimNs?.[k] ?? m.namespaces[0];
    const nodes = resolvedOnly([c.from, c.to]);
    const unknown = ends.filter((x) => unknownRef(x, m.scope) && !excusedRef(x, referrer, m.scope));
    const missing = ends.filter((x) => refState(x, m.scope) === 'missing');
    const unloaded = ends.filter((x) => refState(x, m.scope) === 'unloaded');
    if (unknown.length) f.push({ level: 'ERROR', code: 'V8', message: t(lang, 'claimUnknownNamespace', c.from, c.to, unknown.join(sep)), nodes, namespace: referrer });
    if (missing.length) {
      if (!unknown.length) f.push({ level: 'ERROR', code: 'V9', message: t(lang, 'claimMissingNode', c.from, c.to, missing.join(sep)), nodes, namespace: referrer });
      return;
    }
    if (unloaded.length) {
      if (!unloaded.every((x) => unknown.includes(x))) f.push({ level: 'INFO', code: 'V9', message: t(lang, 'claimUnloaded', c.from, c.to), nodes, namespace: referrer });
      return;
    }
    const a = agreement(m.binder, m.reach, c);
    if (a === 'unstated') f.push({ level: 'WARN', code: 'V9', message: t(lang, 'claimMissing', c.from, c.to, c.source ?? t(lang, 'unspecifiedSource')), nodes: [c.from, c.to], namespace: referrer });
    else if (a === 'otherType') f.push({ level: 'WARN', code: 'V9', message: t(lang, 'claimType', c.from, c.to, 'hard', 'order'), nodes: [c.from, c.to], namespace: referrer });
  });

  // §V11a stale status: one warning per waiting node, however many declarations and edges
  const stale = new Map<string, { done: Set<string>; pre: Map<string, Set<string>> }>();
  for (const d of m.declarations) {
    if (d.type !== 'hard') continue;
    for (const e of bound.get(d)!) {
      if (!e.resolved || m.status(e.to) !== 'done' || m.status(e.from) !== 'open') continue;
      if (!stale.has(d.node)) stale.set(d.node, { done: new Set(), pre: new Map() });
      const v = stale.get(d.node)!;
      v.done.add(e.to);
      if (!v.pre.has(d.target)) v.pre.set(d.target, new Set());
      v.pre.get(d.target)!.add(e.from);
    }
  }
  const openItems = (from: Set<string>) => `${[...from].slice(0, 4).join(sep)}${from.size > 4 ? '…' : ''}`;
  for (const [b, v] of stale) {
    const done = m.isGroup(b) ? t(lang, 'doneItems', b, v.done.size) : t(lang, 'doneItem', b);
    const pre = [...v.pre];
    let open: string;
    if (pre.length === 1) {
      const [a, from] = pre[0];
      open = m.isGroup(a) ? t(lang, 'openGroupPre', a, from.size, openItems(from)) : t(lang, 'openPre', a);
    } else {
      const each = pre.map(([a, from]) => (m.isGroup(a) ? t(lang, 'groupPre', a, from.size, openItems(from)) : a));
      open = t(lang, 'openPrereqs', each.slice(0, 4).join(sep), each.length > 4 ? t(lang, 'morePre', each.length) : '');
    }
    f.push({ level: 'WARN', code: 'V11', message: t(lang, 'staleStatus', done, open), nodes: [b, ...pre.map(([a]) => a)], namespace: ns(b) });
  }
  // §V11b passed gate: by derived status when F is a group (§G6.3)
  for (const [k, c] of (m.plan.claims ?? []).entries()) {
    const referrer = m.scope.claimNs?.[k] ?? m.namespaces[0];
    if (claimType(c) !== 'hard' || !m.byId.has(c.from) || m.status(c.from) !== 'open' || !m.byId.has(c.to)) continue;
    const targets = m.leaves(c.to);
    const done = targets.filter((x) => m.status(x) === 'done');
    if (done.length) f.push({ level: 'WARN', code: 'V11', message: t(lang, 'passedGate', c.from, c.to, done.length, targets.length), nodes: [c.from, c.to], namespace: referrer });
  }

  // §V12 a finished release must name its git tag, or the status cannot be checked
  for (const i of m.items) {
    const n = m.byId.get(i)!;
    if (n.kind === 'release' && n.status === 'done' && !n.tag) {
      f.push({ level: 'WARN', code: 'V12', message: t(lang, 'releaseNoTag', i), nodes: [i], namespace: ns(i) });
    }
  }

  if (claimed) f.push(...compareDerived(m, claimed, lang));
  return f;
}

/** §V1/§V2/§V4: the committed summary must equal the one derived from the items. */
export function compareDerived(m: Model, claimed: Derived, lang: Lang = 'en'): Finding[] {
  const f: Finding[] = [];
  const want = derive(m);
  for (const [g, s] of Object.entries(want.groups)) {
    const c = claimed.groups?.[g];
    if (!c) f.push({ level: 'ERROR', code: 'V2', message: t(lang, 'summaryMissingGroup', g), nodes: [g] });
    else if (c.status !== s.status || JSON.stringify(c.counts) !== JSON.stringify(s.counts)) {
      f.push({ level: 'ERROR', code: 'V2', message: t(lang, 'summaryStatus', g, c.status, JSON.stringify(c.counts), s.status, JSON.stringify(s.counts)), nodes: [g] });
    }
  }
  for (const g of Object.keys(claimed.groups ?? {})) if (!want.groups[g]) f.push({ level: 'ERROR', code: 'V2', message: t(lang, 'summaryUnknownGroup', g) });
  for (const [pid, p] of Object.entries(want.pages)) {
    const c = claimed.pages?.[pid];
    // V4.1 displaces V4.3 and V1.2 / V4.5 on that page
    if (!c) {
      f.push({ level: 'ERROR', code: 'V4', message: t(lang, 'summaryMissingPage', pid) });
      continue;
    }
    if (JSON.stringify(c.nodes) !== JSON.stringify(p.nodes)) {
      f.push({ level: 'ERROR', code: 'V4', message: t(lang, 'summaryNodes', pid, (c.nodes ?? []).join(', '), p.nodes.join(', ')) });
    }
    // §G11.3: an overlap edge is an unordered pair; a dependency edge is ordered
    const key = (e: { from: string; to: string; kind: string }) => {
      const [a, b] = e.kind === 'overlap' ? [e.from, e.to].sort() : [e.from, e.to];
      return `${e.kind}:${a}→${b}`;
    };
    const code = (kind: string) => kind === 'overlap' ? 'V4' : 'V1';
    const w = new Map(p.edges.map((e) => [key(e), e]));
    const cc = new Map((c.edges ?? []).map((e) => [key(e), e]));
    for (const [k, e] of cc) {
      if (!w.has(k)) f.push({ level: 'ERROR', code: code(e.kind), message: t(lang, 'summaryExtraEdge', pid, k) });
      else if (w.get(k)!.count !== e.count) f.push({ level: 'ERROR', code: code(e.kind), message: t(lang, 'summaryCount', pid, k, e.count, w.get(k)!.count) });
    }
    for (const k of w.keys()) {
      if (!cc.has(k)) f.push({ level: 'ERROR', code: code(w.get(k)!.kind), message: t(lang, 'summaryMissingEdge', pid, k) });
    }
  }
  // V4.2
  for (const pid of Object.keys(claimed.pages ?? {})) if (!want.pages[pid]) f.push({ level: 'ERROR', code: 'V4', message: t(lang, 'summaryUnknownPage', pid) });
  return f;
}
