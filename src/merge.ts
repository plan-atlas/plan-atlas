import { t, type Lang } from './messages.ts';
import { mergedId, namespaceOf, refNamespace, type Scope } from './semantics.ts';
import type { Finding, PlanFile } from './types.ts';

export { namespaceOf };

/**
 * Combine several plan files into one (§G2.4). Node ids become `<namespace>:<id>` (a root whose
 * id equals its namespace keeps it), so cross-file references written as `<namespace>:<id>`
 * resolve. A single plan keeps its ids unless a workspace asks for qualification. References are
 * resolved here; whether they are missing, unloaded or unknown is for validation (§V8, §V9).
 */
export function mergePlans(plans: PlanFile[], lang: Lang = 'en', opts: { workspaceNamespaces?: string[]; qualify?: boolean } = {}): { plan: PlanFile; findings: Finding[]; scope: Partial<Scope> } {
  const out: PlanFile = { version: 1, title: plans.map((p) => p.title ?? namespaceOf(p)).join(' + '), areas: {}, nodes: [], rules: { overlaps: [] }, claims: [], externalRefs: [] };
  const spaces = plans.map(namespaceOf);
  const nodeNs = new Map<string, string>();
  const excused = new Map<string, Set<string>>();
  const claimNs: string[] = [];
  const scope: Partial<Scope> = {
    loaded: spaces, listed: opts.workspaceNamespaces, excused, claimNs,
    nsOf: (id) => nodeNs.get(id) ?? refNamespace(id) ?? spaces[0],
  };
  // §V0.30, and §G8.5: a V0 error stops the run before merging
  const dup = spaces.find((s, i) => spaces.indexOf(s) !== i);
  if (dup) return { plan: out, findings: [{ level: 'ERROR', code: 'V0', message: t(lang, 'duplicateNamespace', dup) }], scope };
  const qualify = opts.qualify ?? plans.length > 1;
  const rids = plans.map((p, i) => {
    const roots = new Set(p.nodes.filter((n) => n.parent === null).map((n) => n.id));
    return (id: string) => mergedId(spaces[i], id, roots.has(id), qualify);
  });
  const idsByRef = new Map<string, string>();
  plans.forEach((p, i) => p.nodes.forEach((n) => idsByRef.set(`${spaces[i]}:${n.id}`, rids[i](n.id))));

  // §V5: the smallest limit any loaded file sets, else the default
  const limits = plans.map((p) => p.rules?.maxPageNodes).filter((x): x is number => x !== undefined);
  if (limits.length) out.rules!.maxPageNodes = Math.min(...limits);

  plans.forEach((p, i) => {
    const ns = spaces[i];
    const rid = rids[i];
    const local = new Set(p.nodes.map((n) => n.id));
    const ref = (id: string) => (local.has(id) ? rid(id) : idsByRef.get(id) ?? id);
    const source = (s: string) => qualify ? `${ns}/${s.replace(/^\.\//, '')}` : s;
    for (const [k, v] of Object.entries(p.areas ?? {})) out.areas![source(k)] = v;
    for (const n of p.nodes) {
      nodeNs.set(rid(n.id), ns);
      out.nodes.push({
        ...n,
        id: rid(n.id),
        parent: n.parent === null ? null : rid(n.parent),
        touches: (n.touches ?? []).map(source),
        dependsOn: (n.dependsOn ?? []).map((d) => ({ ...d, id: ref(d.id), source: d.source ? source(d.source) : undefined })),
        // keep sources relative to the repo but make them unambiguous across repos
        sources: n.sources?.map(source),
        source: n.source ? source(n.source) : undefined,
        // links stay as written: `#N` and branch names belong to the repository, not the namespace
        links: n.links,
      });
    }
    for (const r of p.rules?.overlaps ?? []) {
      if (!out.rules!.overlaps!.some((x) => x.id === r.id)) out.rules!.overlaps!.push(r);
    }
    for (const c of p.claims ?? []) {
      const end = (id: string) => id.includes(':') ? ref(id) : rid(id);
      out.claims!.push({ ...c, from: end(c.from), to: end(c.to), source: c.source ? source(c.source) : undefined });
      claimNs.push(ns);
    }
    const refs = (p.externalRefs ?? []).map((r) => ({ ...r, id: ref(r.id) }));
    excused.set(ns, new Set(refs.map((r) => r.id)));
    out.externalRefs!.push(...refs);
  });
  if (!qualify && plans.length === 1) {
    out.namespace = plans[0].namespace;
    out.title = plans[0].title;
  }
  return { plan: out, findings: [], scope };
}
