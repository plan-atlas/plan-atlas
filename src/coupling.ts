import { t, type Lang } from './messages.ts';
import { crosses, declarations, filePart, namespaceOf, ownRef, tree, type Declaration } from './semantics.ts';
import type { DepType, Finding, PlanFile } from './types.ts';

interface Keyed extends Declaration {
  /** §G7: judged in the version the declaration belongs to. */
  crosses: boolean;
}

const pairKey = (d: { node: string; target: string }) => `${d.node}\u0000${d.target}`;

/**
 * RULES.md §V10 departs from §G3.1: a declaration is identified across versions by its key
 * (source node, target, type), so two entries with the same key count once. Each version is
 * judged on its own file; targets are resolved per §G7.4.
 */
function keyed(plan: PlanFile): Map<string, Keyed> {
  const tr = tree(plan.nodes);
  const ns = namespaceOf(plan);
  const out = new Map<string, Keyed>();
  for (const raw of declarations(plan.nodes)) {
    const d = { ...raw, target: ownRef(raw.target, ns, (id) => tr.byId.has(id)) };
    const key = `${pairKey(d)}\u0000${d.type}`;
    if (!out.has(key)) out.set(key, { ...d, crosses: crosses(d, tr, () => ns) === true });
  }
  return out;
}

/** The pair's only type in a version, or undefined when it has none or both. */
function onlyType(ds: Map<string, Keyed>, pair: string): DepType | undefined {
  const types = (['hard', 'order'] as const).filter((x) => ds.has(`${pair}\u0000${x}`));
  return types.length === 1 ? types[0] : undefined;
}

/**
 * §V10 change coupling. Structure checks cannot tell whether a dependency that vanished or
 * changed type still matches the plan text. So: when a crossing dependency is added, removed or
 * retyped, the plan file it cites must change in the same change set.
 * `changedFiles` are repo-relative paths, e.g. from `git diff --name-only base...head`.
 */
export function checkCoupling(before: PlanFile, after: PlanFile, changedFiles: string[], lang: Lang = 'en'): Finding[] {
  const changed = new Set(changedFiles.map((p) => p.replace(/^\.\//, '')));
  const a = keyed(before), b = keyed(after);
  const f: Finding[] = [];
  const need = (what: string, d: Keyed, source: string | undefined) => {
    if (!source) {
      f.push({ level: 'ERROR', code: 'V10', message: t(lang, 'couplingNoSource', what, d.target, d.node), nodes: [d.node] });
    } else if (!changed.has(filePart(source))) {
      f.push({ level: 'ERROR', code: 'V10', message: t(lang, 'couplingUnchanged', what, d.target, d.node, filePart(source)), nodes: [d.node] });
    }
  };
  // V10c: the old version has exactly one type for the pair, the new version exactly the other
  const retyped = new Map<string, [Keyed, Keyed]>();
  for (const d of b.values()) {
    const pair = pairKey(d);
    const was = onlyType(a, pair), now = onlyType(b, pair);
    if (was && now && was !== now) retyped.set(pair, [a.get(`${pair}\u0000${was}`)!, b.get(`${pair}\u0000${now}`)!]);
  }
  // V10b, V10a: keys only in one version, on pairs that were not retyped
  for (const [k, d] of a) if (!b.has(k) && !retyped.has(pairKey(d)) && d.crosses) need(t(lang, 'removedDep'), d, d.source);
  for (const [k, d] of b) if (!a.has(k) && !retyped.has(pairKey(d)) && d.crosses) need(t(lang, 'addedDep'), d, d.source);
  // V10c: the new source when it crosses in the new version; the old one only when it crosses solely there
  for (const [old, cur] of retyped.values()) {
    if (cur.crosses || old.crosses) need(t(lang, 'retypedDep', old.type, cur.type), cur, cur.crosses ? cur.source : old.source);
  }
  return f;
}
