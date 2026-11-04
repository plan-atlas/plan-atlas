import { t, type Lang } from '../messages.ts';
import { layered } from '../layout.ts';
import type { Model } from '../model.ts';
import { edgeLabel, localId, NODE_SIZE, pageTitle } from './viewmodel.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FILL = { done: '#eeeeee', ready: '#d5e8d4', blocked: '#ffe6cc', stub: '#dae8fc', group: '#ffffff' };
const STROKE = { done: '#9e9e9e', ready: '#82b366', blocked: '#d79b00', stub: '#6c8ebf', group: '#1c2a33' };
const WARN = '#b85450';
const pageId = (id: string) => 'p-' + id.replace(/[^A-Za-z0-9_-]/g, '_');

/** Multi-page draw.io file: one page per group, nodes link to the page they open. */
export function drawio(m: Model, lang: Lang = 'en'): string {
  const diagrams: string[] = [];
  for (const p of m.pages.values()) {
    const pos = layered(p.nodes.map((n) => ({ id: n.id, w: NODE_SIZE[n.type][0], h: NODE_SIZE[n.type][1] })), p.edges.filter((e) => e.kind !== 'overlap'));
    const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
    const up = p.trail.length ? pageId(p.trail[p.trail.length - 1]) : null;
    if (up) cells.push(obj('back', t(lang, 'up'), 'rounded=1;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontSize=11;', [0, -60, 130, 28], `data:page/id,${up}`));
    cells.push(obj('title', `<b>${esc(pageTitle(m, p, lang))}</b>`, 'text;html=1;fontSize=14;align=left;', [up ? 145 : 0, -60, 520, 28]));
    for (const n of p.nodes) {
      const [x, y] = pos.get(n.id)!;
      const [w, h] = NODE_SIZE[n.type];
      const geo: [number, number, number, number] = [x, y, w, h];
      const id = 'n-' + n.id.replace(/[^A-Za-z0-9_@-]/g, '_');
      if (n.type === 'stub') {
        const t = n.external ? localId(n.ref) : m.byId.get(n.ref)!.title;
        cells.push(obj(id, `↗ ${esc(t)}`, `shape=hexagon;perimeter=hexagonPerimeter2;size=0.08;whiteSpace=wrap;html=1;dashed=1;fillColor=${FILL.stub};strokeColor=${STROKE.stub};fontSize=11;`, geo,
          !n.external && m.isGroup(n.ref) ? `data:page/id,${pageId(n.ref)}` : undefined));
      } else if (n.type === 'group') {
        const s = m.stats.get(n.ref)!;
        const c = s.counts;
        const label = `<b>${esc(m.byId.get(n.ref)!.title)}</b><br>${t(lang, 'groupCounts', c.done, c.ready, c.blocked)}` + (s.innerOverlaps ? `<br><font color="${WARN}">⚠ ${t(lang, 'innerOverlaps', s.innerOverlaps)}</font>` : '');
        const sc = n.warn ? `strokeColor=${WARN};strokeWidth=3;` : `strokeColor=${STROKE.group};strokeWidth=2;`;
        cells.push(obj(id, label, `rounded=1;whiteSpace=wrap;html=1;fillColor=${s.status === 'done' ? FILL.done : FILL.group};${sc}fontSize=12;`, geo, `data:page/id,${pageId(n.ref)}`,
          t(lang, 'planTooltip', (m.byId.get(n.ref)!.sources ?? []).join(t(lang, 'listSep')))));
      } else {
        const it = m.byId.get(n.ref)!;
        const st = m.state.get(n.ref)!;
        const lid = localId(n.ref);
        const title = it.title.startsWith(lid + ' ') ? it.title.slice(lid.length + 1) : it.title;
        const label = `<b>${esc(lid)}</b> ${esc(title)}<br><font style="font-size:9px">${esc((it.touches ?? []).map((a) => a.split('/').pop()).join(t(lang, 'listSep')))}</font>`;
        const sc = n.warn ? `strokeColor=${WARN};strokeWidth=3;` : `strokeColor=${STROKE[st]};`;
        // stubs are already hexagons here, so a release gets a cut corner instead
        const shape = it.kind === 'release' ? 'shape=card;size=12;' : 'rounded=1;';
        cells.push(obj(id, label, `${shape}whiteSpace=wrap;html=1;fillColor=${FILL[st]};${sc}fontSize=11;`, geo, undefined, t(lang, 'sourceTooltip', it.source ?? t(lang, 'none'))));
      }
    }
    p.edges.forEach((e, i) => {
      const s = 'n-' + e.from.replace(/[^A-Za-z0-9_@-]/g, '_'), t = 'n-' + e.to.replace(/[^A-Za-z0-9_@-]/g, '_');
      let style = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=10;';
      if (e.kind === 'order') style += 'dashed=1;endArrow=open;';
      else if (e.kind === 'overlap') style += `dashed=1;dashPattern=1 3;endArrow=none;strokeColor=${WARN};fontColor=${WARN};`;
      else style += 'endArrow=blockThin;endFill=1;';
      const lbl = edgeLabel(e.kind, e.items.length, e.kind === 'overlap' ? [...new Set(e.items.map((x) => x[2].split('/').pop()!))] : undefined, lang);
      cells.push(`<mxCell id="e${i}" value="${esc((e.kind === 'overlap' ? '⚠ ' : '') + lbl)}" style="${style}" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    });
    diagrams.push(`<diagram id="${pageId(p.id)}" name="${esc(pageTitle(m, p, lang))}"><mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" adaptiveColors="auto"><root>${cells.join('')}</root></mxGraphModel></diagram>`);
  }
  return `<mxfile host="plan-atlas" type="device">${diagrams.join('')}</mxfile>`;
}

function obj(id: string, label: string, style: string, [x, y, w, h]: number[], link?: string, tooltip?: string): string {
  const attrs = (link ? ` link="${esc(link)}"` : '') + (tooltip ? ` tooltip="${esc(tooltip)}"` : '');
  return `<UserObject id="${esc(id)}" label="${esc(label)}"${attrs}><mxCell style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell></UserObject>`;
}
