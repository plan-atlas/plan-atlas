import type { Model } from './model.ts';

/**
 * The derived summary that gets committed next to the plan (atlas.json). Anything an agent
 * might "helpfully" edit by hand lives here, so `validate` recomputes it and diffs.
 */
export interface Derived {
  groups: Record<string, { status: 'done' | 'open'; counts: { done: number; ready: number; blocked: number } }>;
  pages: Record<string, { nodes: string[]; edges: { from: string; to: string; kind: string; count: number }[] }>;
}

export function derive(m: Model): Derived {
  const groups: Derived['groups'] = {};
  for (const [g, s] of [...m.stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    groups[g] = { status: s.status, counts: { ...s.counts } };
  }
  const pages: Derived['pages'] = {};
  for (const [id, p] of [...m.pages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    pages[id] = {
      nodes: p.nodes.map((n) => n.id).sort(),
      edges: p.edges
        .map((e) => ({ from: e.from, to: e.to, kind: e.kind, count: e.items.length }))
        .sort((a, b) => `${a.kind}${a.from}${a.to}`.localeCompare(`${b.kind}${b.from}${b.to}`)),
    };
  }
  return { groups, pages };
}
