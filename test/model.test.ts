import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from '../src/index.ts';
import { ROOT_PAGE } from '../src/model.ts';
import { layered } from '../src/layout.ts';
import type { PlanFile } from '../src/types.ts';
import { example, node } from './helpers.ts';

const model = (plans = [example('bookshop')]) => {
  const r = load(plans);
  assert.ok(r.model, r.findings.map((f) => f.message).join('\n'));
  return r.model;
};

test('item state: done, ready when hard prerequisites are done, blocked otherwise', () => {
  const m = model();
  assert.equal(m.state.get('C1'), 'done');
  assert.equal(m.state.get('C2'), 'ready');
  assert.equal(m.state.get('C3'), 'blocked');
  // order dependencies do not block
  assert.equal(m.state.get('R3'), 'ready');
});

test('group status and counts are derived from items', () => {
  const m = model();
  assert.deepEqual(m.stats.get('checkout')!.counts, { done: 1, ready: 1, blocked: 1 });
  assert.equal(m.stats.get('checkout')!.status, 'open');
  assert.equal(m.stats.get('bookshop')!.items, 8);
});

test('overlap: a move and independent work touching the same area', () => {
  const m = model();
  assert.deepEqual(m.overlaps.map((o) => [o.a, o.b, o.area]), [['R3', 'C2', 'checkout']]);
});

test('no overlap when one item already waits on the other', () => {
  const p = example('bookshop');
  node(p, 'C2').dependsOn!.push({ id: 'R3', type: 'order', source: 'docs/plans/checkout-v2.md §3', quote: 'after the checkout move' });
  assert.deepEqual(model([p]).overlaps, []);
});

test('pages: one per group; a dependency from another group appears as a stub', () => {
  const m = model();
  assert.deepEqual([...m.pages.keys()], ['bookshop', 'refactor', 'checkout', 'tooling']);
  const checkout = m.pages.get('checkout')!;
  assert.deepEqual(checkout.nodes.map((n) => n.id), ['C1', 'C2', 'C3', '@tooling', '@refactor']);
  assert.ok(checkout.edges.some((e) => e.from === '@tooling' && e.to === 'C3' && e.kind === 'hard'));
  assert.ok(checkout.edges.some((e) => e.kind === 'overlap' && e.items[0][2] === 'checkout'));
  // top page aggregates items into their groups
  const top = m.pages.get('bookshop')!;
  assert.deepEqual(top.edges.map((e) => [e.from, e.to, e.kind, e.items.length]), [['tooling', 'checkout', 'hard', 1], ['checkout', 'refactor', 'overlap', 1]]);
});

test('several files get a virtual top page and resolve cross-file references', () => {
  const m = model([example('bookshop'), example('warehouse')]);
  assert.ok(m.pages.has(ROOT_PAGE));
  assert.deepEqual(m.pages.get(ROOT_PAGE)!.nodes.map((n) => n.id), ['bookshop', 'warehouse']);
  assert.equal(m.state.get('warehouse:W2'), 'blocked');
  assert.ok(m.edges.some((e) => e.from === 'bookshop:R2' && e.to === 'warehouse:W2' && e.resolved));
});

test('an unloaded external prerequisite counts as not done', () => {
  const m = model([example('warehouse')]);
  assert.equal(m.state.get('W2'), 'blocked');
  assert.ok(m.pages.get('warehouse')!.nodes.some((n) => n.type === 'stub' && n.external));
});

test('depending on a group means depending on its final items', () => {
  const p = example('bookshop');
  node(p, 'C3').dependsOn = [{ id: 'refactor', type: 'order', source: 'docs/plans/checkout-v2.md §4', quote: 'after the whole refactor' }];
  const m = model([p]);
  assert.deepEqual(m.edges.filter((e) => e.to === 'C3').map((e) => [e.from, e.via]), [['R3', 'refactor']]);
});

test('layout places every node without overlapping boxes', () => {
  const nodes = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, w: 210, h: 92 }));
  const edges = [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n0' }, { from: 'n3', to: 'n4' }];
  const pos = layered(nodes, edges);
  assert.equal(pos.size, 14);
  const boxes = nodes.map((n) => ({ ...n, x: pos.get(n.id)![0], y: pos.get(n.id)![1] }));
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `${a.id} overlaps ${b.id}`);
  }
});

test('a dependency declared on a group applies to its first items', () => {
  const p = example('bookshop');
  (node(p, 'checkout') as { dependsOn?: unknown[] }).dependsOn = [{ id: 'R1', type: 'hard', source: 'docs/plans/checkout-v2.md §1', quote: 'start after the lint rules land' }];
  const m = model([p]);
  assert.deepEqual(m.edges.filter((e) => e.viaTo === 'checkout').map((e) => [e.from, e.to]), [['R1', 'C1']]);
  assert.ok(m.pages.get('bookshop')!.edges.some((e) => e.from === 'refactor' && e.to === 'checkout' && e.kind === 'hard'));
});

test('first and final items of a group follow dependencies declared on its sub-groups', () => {
  const item = (id: string, parent: string, dependsOn?: PlanFile['nodes'][number]['dependsOn']) =>
    ({ id, title: id, parent, status: 'open' as const, source: 'plan.md §1', ...(dependsOn ? { dependsOn } : {}) });
  const p: PlanFile = { version: 1, nodes: [
    { id: 'P', title: 'P', parent: null, sources: ['plan.md'] },
    { id: 'G', title: 'G', parent: 'P', dependsOn: [{ id: 'Y', type: 'hard' }] },
    { id: 'S1', title: 'Setup', parent: 'G' }, item('a1', 'S1'),
    { id: 'S2', title: 'Core', parent: 'G', dependsOn: [{ id: 'S1', type: 'hard' }] }, item('b1', 'S2'),
    item('X', 'P', [{ id: 'G', type: 'hard' }]), item('Y', 'P'),
  ] };
  const m = model([p]);
  assert.deepEqual(m.edges.filter((e) => e.viaTo === 'G').map((e) => [e.from, e.to]), [['Y', 'a1']]);
  assert.deepEqual(m.edges.filter((e) => e.via === 'G').map((e) => [e.from, e.to]), [['b1', 'X']]);
});
