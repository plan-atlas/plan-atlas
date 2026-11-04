import { t, type Lang } from './messages.ts';
import { LINK_PATTERN } from './links.ts';
import type { Dep, Finding, PlanFile, PlanNode } from './types.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Check the shape of a plan file. Returns the plan when it is usable, plus structural
 * findings (code V0). A plan with any ERROR here is not built further.
 */
export function parsePlan(input: unknown, lang: Lang = 'en'): { plan: PlanFile | null; findings: Finding[] } {
  const f: Finding[] = [];
  const err = (message: string, nodes?: string[]) => f.push({ level: 'ERROR', code: 'V0', message, nodes });
  if (!isObj(input)) return { plan: null, findings: [{ level: 'ERROR', code: 'V0', message: t(lang, 'jsonObject') }] };
  if (input.version !== 1) err(t(lang, 'version', String(input.version)));
  if (!Array.isArray(input.nodes)) {
    err(t(lang, 'nodesArray'));
    return { plan: null, findings: f };
  }
  const areas = isObj(input.areas) ? (input.areas as Record<string, string>) : {};
  const ids = new Set<string>();
  const nodes: PlanNode[] = [];
  for (const [i, raw] of (input.nodes as unknown[]).entries()) {
    if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.title)) {
      err(t(lang, 'nodeFields', i));
      continue;
    }
    const id = raw.id;
    if (ids.has(id)) err(t(lang, 'duplicateId', id), [id]);
    if (id.includes(':')) err(t(lang, 'idColon', id), [id]);
    ids.add(id);
    // §V0.10: only an explicit null makes a root; an omitted parent is an error, not a root
    if (raw.parent !== null && !isStr(raw.parent)) err(t(lang, 'parentType', id), [id]);
    if (raw.status !== undefined && raw.status !== 'done' && raw.status !== 'open') err(t(lang, 'statusType', id), [id]);
    const deps: Dep[] = [];
    if (raw.dependsOn !== undefined) {
      if (!Array.isArray(raw.dependsOn)) err(t(lang, 'depsArray', id), [id]);
      else for (const d of raw.dependsOn as unknown[]) {
        if (!isObj(d) || !isStr(d.id) || (d.type !== 'hard' && d.type !== 'order')) {
          err(t(lang, 'depFields', id), [id]);
          continue;
        }
        for (const field of ['source', 'quote'] as const) if (d[field] !== undefined && typeof d[field] !== 'string') err(t(lang, 'fieldType', id, `dependsOn.${field}`), [id]);
        deps.push({ id: d.id, type: d.type, source: isStr(d.source) ? d.source : undefined, quote: isStr(d.quote) ? d.quote : undefined });
      }
    }
    // §V0.25: a field of the wrong type is an error, never silently dropped
    for (const field of ['source', 'evidence', 'kind', 'tag'] as const) if (raw[field] !== undefined && typeof raw[field] !== 'string') err(t(lang, 'fieldType', id, field), [id]);
    for (const field of ['sources', 'touches'] as const) {
      const v = raw[field];
      if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) err(t(lang, 'fieldType', id, field), [id]);
    }
    for (const a of Array.isArray(raw.touches) ? (raw.touches as unknown[]) : []) {
      if (!isStr(a) || !(a in areas)) err(t(lang, 'unknownArea', id, String(a)), [id]);
    }
    if (raw.tag !== undefined && raw.kind !== 'release') err(t(lang, 'tagOnItem', id), [id]);
    const links: string[] = [];
    if (raw.links !== undefined) {
      if (!Array.isArray(raw.links)) err(t(lang, 'linksArray', id), [id]);
      else for (const l of raw.links as unknown[]) {
        if (isStr(l) && LINK_PATTERN.test(l)) links.push(l);
        else err(t(lang, 'badLink', id, JSON.stringify(l)), [id]);
      }
    }
    nodes.push({
      id,
      title: raw.title,
      parent: isStr(raw.parent) ? raw.parent : null,
      sources: Array.isArray(raw.sources) ? (raw.sources as unknown[]).filter(isStr) : undefined,
      status: raw.status as PlanNode['status'],
      evidence: isStr(raw.evidence) ? raw.evidence : undefined,
      inferred: raw.inferred === true,
      kind: isStr(raw.kind) ? raw.kind : undefined,
      tag: raw.kind === 'release' && isStr(raw.tag) ? raw.tag : undefined,
      touches: Array.isArray(raw.touches) ? (raw.touches as unknown[]).filter(isStr) : [],
      source: isStr(raw.source) ? raw.source : undefined,
      dependsOn: deps,
      ...(raw.links !== undefined ? { links } : {}),
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasChildren = new Set(nodes.map((n) => n.parent).filter((p): p is string => p !== null));
  const loops = new Set<string>();
  for (const n of nodes) {
    if (n.parent !== null && !byId.has(n.parent)) err(t(lang, 'unknownParent', n.id, n.parent), [n.id]);
    // §V0.12: parent chain must terminate; one finding per loop, not per node that reaches it
    const chain: string[] = [];
    let cur: PlanNode | undefined = n;
    while (cur && cur.parent !== null && !chain.includes(cur.id)) {
      chain.push(cur.id);
      cur = byId.get(cur.parent);
    }
    if (cur && chain.includes(cur.id)) {
      const loop = chain.slice(chain.indexOf(cur.id));
      const key = [...loop].sort().join('|');
      if (!loops.has(key)) {
        loops.add(key);
        err(t(lang, 'parentCycle', loop.join(' → ')), loop);
      }
    }
    if (n.kind === 'release' && hasChildren.has(n.id)) {
      err(t(lang, 'releaseChildren', n.id), [n.id]);
    }
    if (hasChildren.has(n.id)) {
      if (n.status !== undefined) {
        err(t(lang, 'groupStatus', n.id), [n.id]);
      }
    } else if (n.status === undefined) {
      err(t(lang, 'itemStatus', n.id), [n.id]);
    }
    for (const d of n.dependsOn ?? []) {
      if (!d.id.includes(':') && !byId.has(d.id)) err(t(lang, 'unknownDep', n.id, d.id), [n.id]);
    }
  }
  if (nodes.filter((n) => n.parent === null).length === 0 && nodes.length > 0) err(t(lang, 'noRoot'));

  // The plan-level lists feed merging and overlap rules, which trust their shape.
  if (input.namespace !== undefined && !(isStr(input.namespace) && /^[A-Za-z0-9._-]+$/.test(input.namespace))) err(t(lang, 'planNamespace'));
  const optStr = (v: unknown) => v === undefined || typeof v === 'string';
  const selector = (v: unknown) => isObj(v) && optStr(v.kind) && optStr(v.idPrefix);
  const list = (name: string, value: unknown, ok: (x: Record<string, unknown>) => boolean, message: 'claimFields' | 'externalRefFields' | 'overlapFields') => {
    if (value === undefined) return;
    if (!Array.isArray(value)) err(t(lang, 'listArray', name));
    else value.forEach((x: unknown, i) => { if (!isObj(x) || !ok(x)) err(t(lang, message, i)); });
  };
  list('claims', input.claims, (c) => isStr(c.from) && isStr(c.to) && (c.type === undefined || c.type === 'hard' || c.type === 'order') &&
    optStr(c.source) && optStr(c.quote), 'claimFields');
  list('externalRefs', input.externalRefs, (r) => isStr(r.id) && optStr(r.meaning), 'externalRefFields');
  if (isObj(input.rules)) {
    list('rules.overlaps', input.rules.overlaps, (r) => isStr(r.id) && selector(r.a) && selector(r.b) && optStr(r.message), 'overlapFields');
  }

  // §V0.29
  const rules = isObj(input.rules) ? (input.rules as PlanFile['rules']) : undefined;
  const max = rules?.maxPageNodes;
  if (max !== undefined && !(Number.isInteger(max) && max >= 3)) err(t(lang, 'maxPageNodes', JSON.stringify(max)));
  const hasError = f.some((x) => x.level === 'ERROR');
  const plan: PlanFile = {
    version: 1,
    title: isStr(input.title) ? input.title : undefined,
    namespace: isStr(input.namespace) ? input.namespace : undefined,
    areas,
    nodes,
    rules: { ...(max !== undefined ? { maxPageNodes: max } : {}), overlaps: Array.isArray(rules?.overlaps) ? rules!.overlaps : [] },
    claims: Array.isArray(input.claims) ? (input.claims as PlanFile['claims']) : [],
    externalRefs: Array.isArray(input.externalRefs) ? (input.externalRefs as PlanFile['externalRefs']) : [],
  };
  return { plan: hasError ? null : plan, findings: f };
}
