import { t, type Lang } from '../messages.ts';
import type { Model, Page } from '../model.ts';
import { edgeLabel, localId } from './viewmodel.ts';

const mid = (x: string) => 'n_' + x.replace(/[^A-Za-z0-9_]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
const text = (s: string) => s.replace(/"/g, '#quot;').replace(/[<>]/g, '');
const short = (s: string, n = 28) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

/** One Mermaid flowchart per page. Renders natively on GitHub. */
export function pageMermaid(m: Model, p: Page, lang: Lang = 'en'): string {
  const L = ['flowchart LR'];
  for (const n of p.nodes) {
    if (n.type === 'stub') {
      const t = n.external ? localId(n.ref) : m.byId.get(n.ref)!.title;
      L.push(`  ${mid(n.id)}(["↗ ${text(short(t))}"])`);
    } else if (n.type === 'group') {
      const s = m.stats.get(n.ref)!;
      const c = s.counts;
      L.push(`  ${mid(n.id)}["<b>${text(short(m.byId.get(n.ref)!.title))}</b><br/><small>${t(lang, 'groupCounts', c.done, c.ready, c.blocked)}${s.innerOverlaps ? `<br/>⚠ ${t(lang, 'innerOverlaps', s.innerOverlaps)}` : ''}</small>"]`);
    } else {
      const it = m.byId.get(n.ref)!;
      const lid = localId(n.ref);
      const title = it.title.startsWith(lid + ' ') ? it.title.slice(lid.length + 1) : it.title;
      const label = `"<b>${text(lid)}</b> ${text(short(title))}${it.inferred ? `<br/><small>${t(lang, 'inferred')}</small>` : ''}"`;
      L.push(`  ${mid(n.id)}${it.kind === 'release' ? `{{${label}}}` : `[${label}]`}`);
    }
  }
  p.edges.forEach((e) => {
    const lbl = edgeLabel(e.kind, e.items.length, e.kind === 'overlap' ? [...new Set(e.items.map((x) => x[2].split('/').pop()!))] : undefined, lang);
    if (e.kind === 'overlap') L.push(`  ${mid(e.from)} -. ⚠ ${text(lbl)} .- ${mid(e.to)}`);
    else if (e.kind === 'order') L.push(`  ${mid(e.from)} -. ${t(lang, 'order')}${lbl ? ' ' + lbl : ''} .-> ${mid(e.to)}`);
    else L.push(lbl ? `  ${mid(e.from)} -- ${lbl} --> ${mid(e.to)}` : `  ${mid(e.from)} --> ${mid(e.to)}`);
  });
  L.push(
    '  classDef done fill:#eeeeee,stroke:#9e9e9e,color:#666666',
    '  classDef ready fill:#ddeed9,stroke:#4f8a46,color:#1b3a1b',
    '  classDef blocked fill:#fbe7cb,stroke:#b5741a,color:#4a3000',
    '  classDef group fill:#ffffff,stroke:#1c2a33,color:#1c2a33,stroke-width:2px',
    '  classDef stub fill:#dfe9f3,stroke:#4a77a3,color:#1a2b4a,stroke-dasharray:4 3',
    '  classDef warn stroke:#b0413e,stroke-width:3px',
  );
  const cls = (pred: (n: Page['nodes'][number]) => boolean, c: string) => {
    const ids = p.nodes.filter(pred).map((n) => mid(n.id));
    if (ids.length) L.push(`  class ${ids.join(',')} ${c}`);
  };
  cls((n) => n.type === 'group' && m.stats.get(n.ref)!.status !== 'done', 'group');
  cls((n) => n.type === 'group' && m.stats.get(n.ref)!.status === 'done', 'done');
  for (const s of ['done', 'ready', 'blocked'] as const) cls((n) => n.type === 'item' && m.state.get(n.ref) === s, s);
  cls((n) => n.type === 'stub', 'stub');
  cls((n) => n.warn, 'warn');
  p.edges.forEach((e, i) => {
    if (e.kind === 'overlap') L.push(`  linkStyle ${i} stroke:#b0413e,color:#b0413e`);
  });
  return L.join('\n');
}
