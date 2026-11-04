import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawio, load, markdown, pageMermaid, renderHtml, viewModel } from '../src/index.ts';
import { example } from './helpers.ts';

const { model, findings } = load([example('bookshop'), example('warehouse')]);
const m = model!;

test('every page renders as a Mermaid flowchart with a node per page node', () => {
  for (const p of m.pages.values()) {
    const src = pageMermaid(m, p);
    assert.ok(src.startsWith('flowchart LR'));
    for (const n of p.nodes) assert.ok(src.includes(`n_${n.id.replace(/[^A-Za-z0-9_]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`)}`), `${p.id}: ${n.id}`);
    assert.equal(src.split('\n').filter((l) => /-->|-\.|\.-/.test(l)).length, p.edges.length, p.id);
  }
});

test('the markdown report has one diagram per page', () => {
  const md = markdown(m, findings);
  assert.equal(md.split('```mermaid').length - 1, m.pages.size);
});

test('draw.io: one diagram per page and every page link resolves', () => {
  const xml = drawio(m);
  const pages = [...xml.matchAll(/<diagram id="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(pages.length, m.pages.size);
  const links = [...xml.matchAll(/link="data:page\/id,([^"]+)"/g)].map((x) => x[1]);
  assert.ok(links.length > 0);
  for (const l of links) assert.ok(pages.includes(l), l);
  for (const e of xml.matchAll(/source="([^"]+)" target="([^"]+)"/g)) {
    assert.ok(xml.includes(`id="${e[1]}"`) && xml.includes(`id="${e[2]}"`), `dangling edge ${e[1]}→${e[2]}`);
  }
});

test('html: data is inlined once and survives a closing script tag in a title', () => {
  const p = example('bookshop');
  p.nodes.find((n) => n.id === 'C2')!.title = 'C2 Payment </script> retries';
  const r = load([p]);
  const html = renderHtml(r.model!, r.findings);
  assert.ok(!html.includes('/*PLAN_ATLAS_DATA*/'));
  const json = html.match(/<script type="application\/json" id="vm">([\s\S]*?)<\/script>/)![1];
  assert.equal(JSON.parse(json).items.C2.title, 'C2 Payment </script> retries');
});

test('a release item is a Mermaid hexagon and keeps its tag', () => {
  const p = example('bookshop');
  p.nodes.push({
    id: 'sdk@2.1.0', title: 'sdk 2.1.0', parent: 'tooling', status: 'open',
    kind: 'release', tag: 'v2.1.0', touches: [], source: 'docs/plans/tooling.md §2',
  });
  const r = load([p]);
  assert.ok(r.model, r.findings.map((f) => `${f.code} ${f.message}`).join('\n'));
  const src = pageMermaid(r.model, r.model.pages.get('tooling')!);
  assert.match(src, /\{\{"/);
  const items = viewModel(r.model, r.findings).items as Record<string, { tag: string | null }>;
  assert.equal(items['sdk@2.1.0'].tag, 'v2.1.0');
  assert.equal(items.T1.tag, null);
});

test('view model: page link keys are unique and fragment-safe', () => {
  const vm = viewModel(m, findings);
  const hashes = Object.values(vm.pages as Record<string, { hash: string }>).map((p) => p.hash);
  assert.equal(new Set(hashes).size, hashes.length);
  for (const h of hashes) assert.match(h, /^[a-z0-9-]+$/);
});

test('view model: roots and kids give the outline the hierarchy in plan order', () => {
  const vm = viewModel(m, findings);
  assert.deepEqual(vm.roots, m.roots);
  const groups = vm.groups as Record<string, { kids: string[]; children: number }>;
  const seen: string[] = [];
  const walk = (ids: string[]) => { for (const id of ids) { seen.push(id); if (groups[id]) walk(groups[id].kids); } };
  walk(vm.roots);
  // every plan node appears exactly once
  assert.deepEqual([...seen].sort(), m.plan.nodes.map((n) => n.id).sort());
  for (const [g, v] of Object.entries(groups)) {
    assert.deepEqual(v.kids, m.plan.nodes.filter((n) => n.parent === g).map((n) => n.id), g);
    assert.equal(v.children, v.kids.length, g);
  }
});

test('html: the page carries the outline and the page bar', () => {
  const html = renderHtml(m, findings);
  assert.match(html, /<nav class="outline" id="outline"/);
  assert.match(html, /id="olTree"/);
  assert.match(html, /id="pagebar"/);
});

test('html: no remote resources; only GitHub URLs supplied by plan links remain', () => {
  const p = example('bookshop');
  p.nodes.find((n) => n.id === 'C2')!.links = ['acme/shop#3'];
  const r = load([p]);
  for (const lang of ['en', 'zh-TW'] as const) {
    const html = renderHtml(r.model!, r.findings, undefined, lang);
    assert.doesNotMatch(html, /fonts\.g|<link\s+rel="stylesheet"\s+href="http/i);
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);
    assert.deepEqual(urls, ['https://github.com/acme/shop/issues/3']);
  }
  assert.doesNotMatch(renderHtml(m, findings), /https?:\/\//);
});

test('view model: links of items and groups survive a merge unprefixed, with an address only for owner/repo#N', () => {
  const a = example('bookshop'), b = example('warehouse');
  a.nodes.find((n) => n.id === 'C2')!.links = ['#12', 'acme/shop#3', 'branch:c2-retries'];
  a.nodes.find((n) => n.id === 'checkout')!.links = ['branch:checkout-v2'];
  const r = load([a, b]);
  assert.ok(r.model, r.findings.map((f) => `${f.code} ${f.message}`).join('\n'));
  assert.deepEqual(r.model.byId.get('bookshop:C2')!.links, ['#12', 'acme/shop#3', 'branch:c2-retries']);
  const vm = viewModel(r.model, r.findings);
  type L = { links: { text: string; href: string | null }[] };
  assert.deepEqual((vm.items as Record<string, L>)['bookshop:C2'].links, [
    { text: '#12', href: null },
    { text: 'acme/shop#3', href: 'https://github.com/acme/shop/issues/3' },
    { text: 'branch:c2-retries', href: null },
  ]);
  assert.deepEqual((vm.groups as Record<string, L>)['bookshop:checkout'].links, [{ text: 'branch:checkout-v2', href: null }]);
  assert.deepEqual((vm.items as Record<string, L>)['bookshop:C3'].links, []);
  assert.match(renderHtml(r.model, r.findings), /function renderLedger[\s\S]*linkChips\(g\.links\)/);
});
