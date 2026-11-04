import { t, type Lang, viewerStrings } from '../messages.ts';
import { layered } from '../layout.ts';
import { linkUrl } from '../links.ts';
import { pageTitle, topPage, type Model, type PageNode } from '../model.ts';

export { pageTitle };
import type { Finding } from '../types.ts';

export const NODE_SIZE: Record<PageNode['type'], [number, number]> = { group: [260, 120], item: [240, 110], stub: [230, 62] };

/** Short label for an id that may carry a `<namespace>:` prefix. */
export const localId = (id: string) => id.split(':').pop() ?? id;

/** Links as the panel shows them; `href` is set only where the link names its repository. */
const links = (ls: string[] | undefined) => (ls ?? []).map((text) => ({ text, href: linkUrl(text) }));

export function edgeLabel(kind: string, n: number, areas?: string[], lang: Lang = 'en'): string {
  if (kind === 'overlap') return t(lang, 'sharedArea', areas?.join(t(lang, 'listSep')) ?? '');
  return n > 1 ? t(lang, 'edgeCount', n) : '';
}

/** Everything the map page needs. The page itself derives nothing. */
export function viewModel(m: Model, findings: Finding[], lang: Lang = 'en') {
  const pages: Record<string, unknown> = {};
  const used = new Set<string>();
  const hashOf = (id: string) => {
    // the viewer's link fragment only carries ASCII letters, digits and hyphens
    const base = id.replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'page';
    let h = base, k = 2;
    while (used.has(h)) h = `${base}-${k++}`;
    used.add(h);
    return h;
  };
  for (const p of m.pages.values()) {
    const sizes = p.nodes.map((n) => ({ id: n.id, w: NODE_SIZE[n.type][0], h: NODE_SIZE[n.type][1] }));
    const pos = layered(sizes, p.edges.filter((e) => e.kind !== 'overlap'));
    pages[p.id] = {
      title: pageTitle(m, p, lang),
      hash: hashOf(p.id),
      trail: p.trail.map((t) => ({ id: t, title: m.pages.has(t) ? pageTitle(m, m.pages.get(t)!, lang) : t })),
      nodes: p.nodes.map((n) => ({ ...n, pos: pos.get(n.id) })),
      edges: p.edges.map((e) => ({
        from: e.from, to: e.to, kind: e.kind, items: e.items,
        label: edgeLabel(e.kind, e.items.length, e.kind === 'overlap' ? [...new Set(e.items.map((x) => x[2].split('/').pop()!))] : undefined, lang),
      })),
    };
  }
  const items: Record<string, unknown> = {};
  for (const i of m.items) {
    const n = m.byId.get(i)!;
    items[i] = {
      title: n.title, parent: n.parent, state: m.state.get(i), inferred: !!n.inferred, kind: n.kind ?? null,
      tag: n.tag ?? null, links: links(n.links),
      touches: n.touches ?? [], source: n.source ?? null, evidence: n.evidence ?? null,
      deps: m.edges.filter((e) => e.to === i).map((e) => ({ id: e.from, type: e.type, source: e.source ?? null, quote: e.quote ?? null, resolved: e.resolved })),
      dependents: m.edges.filter((e) => e.from === i).map((e) => ({ id: e.to, type: e.type })),
      overlaps: m.overlaps.filter((o) => o.a === i || o.b === i).map((o) => ({ id: o.a === i ? o.b : o.a, area: o.area, rule: o.rule })),
      page: n.parent,
    };
  }
  const groups: Record<string, unknown> = {};
  for (const [g, s] of m.stats) {
    const n = m.byId.get(g)!;
    const kids = m.children.get(g)!;
    groups[g] = { title: n.title, parent: n.parent, sources: n.sources ?? [], links: links(n.links), ...s, children: kids.length, kids: [...kids] };
  }
  const rules = Object.fromEntries((m.plan.rules?.overlaps ?? []).map((r) => [r.id, r.message ?? r.id]));
  // roots and kids keep plan order: the outline lists them as the plan files do
  return { lang, ui: viewerStrings(lang), sizes: NODE_SIZE, title: m.plan.title ?? 'plan-atlas', top: topPage(m), roots: [...m.roots], areas: m.plan.areas ?? {}, rules, pages, items, groups, findings };
}
