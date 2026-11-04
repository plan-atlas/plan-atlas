/**
 * A small deterministic left-to-right layered layout. Pages are capped (V5) at about 15
 * nodes, so longest-path ranking plus a few barycenter sweeps is enough; no external
 * layout engine is needed.
 */
export interface LayoutNode { id: string; w: number; h: number }
export interface LayoutEdge { from: string; to: string }

export function layered(nodes: LayoutNode[], edges: LayoutEdge[], opts = { gapX: 70, gapY: 26, maxPerColumn: 6 }): Map<string, [number, number]> {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const es = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  const succ = new Map<string, string[]>(ids.map((i) => [i, []]));
  const pred = new Map<string, string[]>(ids.map((i) => [i, []]));
  // drop back edges so ranking terminates even if a page has a cycle (V6 reports it)
  const state = new Map<string, number>();
  const keep: LayoutEdge[] = [];
  const dfs = (n: string) => {
    state.set(n, 1);
    for (const e of es.filter((x) => x.from === n)) {
      if (state.get(e.to) === 1) continue;
      keep.push(e);
      if (!state.has(e.to)) dfs(e.to);
    }
    state.set(n, 2);
  };
  ids.forEach((i) => !state.has(i) && dfs(i));
  for (const e of keep) {
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
  }

  const rank = new Map<string, number>();
  const rankOf = (n: string): number => {
    if (!rank.has(n)) rank.set(n, Math.max(-1, ...pred.get(n)!.map(rankOf)) + 1);
    return rank.get(n)!;
  };
  ids.forEach(rankOf);
  // nodes without any edge go in their own block after the connected part
  const isolated = ids.filter((i) => succ.get(i)!.length === 0 && pred.get(i)!.length === 0);
  const connected = ids.filter((i) => !isolated.includes(i));
  const maxRank = Math.max(-1, ...connected.map((i) => rank.get(i)!));
  isolated.forEach((i) => rank.set(i, maxRank + 1));

  const layers: string[][] = [];
  for (const i of ids) (layers[rank.get(i)!] ??= []).push(i);
  const posIn = () => new Map(layers.flatMap((l) => l.map((n, k) => [n, k] as const)));
  for (let sweep = 0; sweep < 4; sweep++) {
    const pos = posIn();
    const down = sweep % 2 === 0;
    const range = down ? layers.map((_, k) => k) : layers.map((_, k) => layers.length - 1 - k);
    for (const k of range) {
      const nb = down ? pred : succ;
      const bary = (n: string) => {
        const xs = nb.get(n)!.map((x) => pos.get(x)!);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : pos.get(n)!;
      };
      layers[k] = [...layers[k]].sort((a, b) => bary(a) - bary(b) || ids.indexOf(a) - ids.indexOf(b));
    }
  }

  // split tall layers into sub-columns, then place
  const size = new Map(nodes.map((n) => [n.id, n]));
  const columns: string[][] = [];
  for (const l of layers) {
    if (!l) continue;
    for (let s = 0; s < l.length; s += opts.maxPerColumn) columns.push(l.slice(s, s + opts.maxPerColumn));
  }
  const colH = columns.map((c) => c.reduce((a, n) => a + size.get(n)!.h, 0) + (c.length - 1) * opts.gapY);
  const H = Math.max(...colH, 0);
  const out = new Map<string, [number, number]>();
  let x = 0;
  columns.forEach((c, ci) => {
    let y = (H - colH[ci]) / 2;
    const w = Math.max(...c.map((n) => size.get(n)!.w));
    for (const n of c) {
      out.set(n, [Math.round(x), Math.round(y)]);
      y += size.get(n)!.h + opts.gapY;
    }
    x += w + opts.gapX;
  });
  return out;
}
