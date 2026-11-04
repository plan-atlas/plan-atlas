/**
 * Mistakes an agent can make while maintaining a layered plan, and which rule catches each.
 * Every case starts from the clean example and its committed summary (atlas.json).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkCoupling } from '../src/coupling.ts';
import { derive, type Derived } from '../src/derive.ts';
import { load } from '../src/index.ts';
import type { PlanFile } from '../src/types.ts';
import { codes, example, node } from './helpers.ts';

const clean = example('bookshop');
const committed: Derived = derive(load([clean]).model!);
const copy = <T>(x: T): T => structuredClone(x);
const findings = (plan: PlanFile, summary?: Derived) => load([plan], summary).findings.filter((f) => f.level !== 'INFO');

test('the clean example and its own summary agree', () => {
  assert.deepEqual(findings(copy(clean), copy(committed)), []);
});

describe('edits to the summary alone', () => {
  test('F1 an aggregated edge with nothing behind it (V1)', () => {
    const s = copy(committed);
    s.pages.bookshop.edges.push({ from: 'tooling', to: 'refactor', kind: 'hard', count: 1 });
    assert.deepEqual(codes(findings(copy(clean), s)), ['V1']);
  });
  test('F2 a group marked done while items are open (V2)', () => {
    const s = copy(committed);
    s.groups.checkout.status = 'done';
    assert.deepEqual(codes(findings(copy(clean), s)), ['V2']);
  });
  test('F6 an overlap dropped from the summary (V4)', () => {
    const s = copy(committed);
    s.pages.bookshop.edges = s.pages.bookshop.edges.filter((e) => e.kind !== 'overlap');
    assert.deepEqual(codes(findings(copy(clean), s)), ['V4']);
  });
});

describe('edits to the plan, summary regenerated', () => {
  test('F4 an item moved to a group whose plan does not define it (V3)', () => {
    const p = copy(clean);
    node(p, 'C2').parent = 'tooling';
    assert.ok(codes(findings(p)).includes('V3'));
  });
  test('F7 a reasonable edge that makes a cycle only between groups (V6 warning)', () => {
    const p = copy(clean);
    node(p, 'T1').dependsOn = [{ id: 'C1', type: 'hard', source: 'docs/plans/tooling.md §1', quote: 'diff against the v2 cart pages' }];
    const f = load([p]).findings.filter((x) => x.code === 'V6');
    assert.equal(f.length, 1);
    assert.equal(f[0].level, 'WARN');
  });
  test('F8 a new item with no source (V3)', () => {
    const p = copy(clean);
    p.nodes.push({ id: 'C4', title: 'C4 Gift cards', parent: 'checkout', status: 'open', touches: [] });
    assert.deepEqual(codes(findings(p)), ['V3']);
  });
  test('F9 a page that grew past the limit (V5 warning)', () => {
    const p = copy(clean);
    for (let i = 0; i < 13; i++) p.nodes.push({ id: `T${10 + i}`, title: `T${10 + i} chore`, parent: 'tooling', status: 'open', touches: [], source: 'docs/plans/tooling.md §3' });
    assert.deepEqual(codes(findings(p), 'WARN'), ['V5']);
  });
  test('a cross-group dependency without a quote (V8)', () => {
    const p = copy(clean);
    delete node(p, 'C3').dependsOn![1].quote;
    assert.deepEqual(codes(findings(p)), ['V8']);
  });
});

describe('semantic edits: consistent at every level, so only change coupling sees them', () => {
  test('F3 a cross-group dependency deleted, plan text untouched (V10)', () => {
    const p = copy(clean);
    node(p, 'C3').dependsOn = node(p, 'C3').dependsOn!.filter((d) => d.id !== 'T1');
    assert.deepEqual(findings(p), [], 'structure alone cannot tell');
    assert.deepEqual(codes(checkCoupling(clean, p, ['plan.json'])), ['V10']);
  });
  test('F5 an order dependency silently upgraded to hard (V10)', () => {
    const before = copy(clean);
    before.nodes.find((n) => n.id === 'C3')!.dependsOn![1].type = 'order';
    const after = copy(clean); // T1 → C3 is hard here
    assert.deepEqual(findings(after), []);
    assert.deepEqual(codes(checkCoupling(before, after, ['plan.json'])), ['V10']);
  });
  test('the same edits pass when the cited plan file changed in the same change set', () => {
    const p = copy(clean);
    node(p, 'C3').dependsOn = node(p, 'C3').dependsOn!.filter((d) => d.id !== 'T1');
    assert.deepEqual(checkCoupling(clean, p, ['plan.json', 'docs/plans/checkout-v2.md']), []);
  });
  test('known limit: coupling checks that the file changed, not what the change says', () => {
    // An agent that edits both the plan text and the data consistently but wrongly is
    // indistinguishable from a real decision. That one needs a human review.
    const p = copy(clean);
    node(p, 'C3').dependsOn = node(p, 'C3').dependsOn!.filter((d) => d.id !== 'T1');
    assert.equal(checkCoupling(clean, p, ['docs/plans/checkout-v2.md']).length, 0);
  });
});

describe('stale status', () => {
  test('V11 an item marked done while its hard prerequisites are open: one warning for the item', () => {
    const p = copy(clean);
    node(p, 'C3').status = 'done';
    const f = findings(p);
    assert.deepEqual(codes(f), ['V11']);
    assert.equal(f[0].message, 'C3 is done, but its prerequisites are not done: C2, T1; the status or the plan is out of date');
    assert.deepEqual(f[0].nodes, ['C3', 'C2', 'T1']);
  });
  test('V11 a claimed gate that the other plan already passed', () => {
    const w = example('warehouse');
    node(w, 'W2').status = 'done';
    const f = load([copy(clean), w]).findings.filter((x) => x.code === 'V11');
    assert.equal(f.length, 2); // the dependency itself, and the claim from bookshop
  });
});

describe('sequencing versus dependencies', () => {
  test('V6 a stated order that contradicts a dependency is one warning, not an error', () => {
    const p = copy(clean);
    // the plan says R3 comes after R2, but now R2 also needs R3's checkout move
    node(p, 'R2').dependsOn!.push({ id: 'R3', type: 'hard' });
    const f = load([p]).findings.filter((x) => x.code === 'V6');
    assert.deepEqual(f.map((x) => x.level), ['WARN']);
  });
  test('V6 a loop of hard dependencies is an error', () => {
    const p = copy(clean);
    node(p, 'C1').dependsOn = [{ id: 'C2', type: 'hard' }];
    assert.ok(load([p]).findings.some((x) => x.code === 'V6' && x.level === 'ERROR'));
  });
  test('V11 one warning per waiting group, however many items it covers', () => {
    const p = copy(clean);
    (node(p, 'checkout') as { dependsOn?: unknown[] }).dependsOn = [{ id: 'T1', type: 'hard', source: 'docs/plans/checkout-v2.md §1', quote: 'after visual diffs' }];
    node(p, 'C3').dependsOn = [{ id: 'C2', type: 'hard' }];
    node(p, 'C2').status = 'done';
    node(p, 'C2').dependsOn = [];
    node(p, 'C3').status = 'done';
    const f = load([p]).findings.filter((x) => x.code === 'V11');
    assert.equal(f.length, 1, f.map((x) => x.message).join('\n'));
    assert.equal(f[0].message, 'checkout has 2 done items, but its prerequisite T1 is not; the status or the plan is out of date');
  });
  test('V11 a group waiting on two groups lists each with its open items', () => {
    const p = copy(clean);
    (node(p, 'checkout') as { dependsOn?: unknown[] }).dependsOn = [
      { id: 'tooling', type: 'hard', source: 'docs/plans/checkout-v2.md §1', quote: 'after the tooling work' },
      { id: 'refactor', type: 'hard', source: 'docs/plans/checkout-v2.md §1', quote: 'after the context refactor' },
    ];
    node(p, 'C2').dependsOn = [];
    node(p, 'C3').dependsOn = [{ id: 'C2', type: 'hard' }];
    for (const id of ['C2', 'C3']) node(p, id).status = 'done';
    const f = load([p]).findings.filter((x) => x.code === 'V11');
    assert.equal(f.length, 1, f.map((x) => x.message).join('\n'));
    // R3 follows R2 only by `order`, so a hard dependency on refactor waits for both
    assert.match(f[0].message, /^checkout has 2 done items, but its prerequisites are not done: tooling \(1 open item: T1\), refactor \(2 open items: R2, R3\);/);
    assert.deepEqual(f[0].nodes, ['checkout', 'tooling', 'refactor']);
  });
});

describe('releases', () => {
  test('V12 a release marked done without a tag', () => {
    const p = copy(clean);
    p.nodes.push({
      id: 'sdk@2.1.0', title: 'sdk 2.1.0', parent: 'tooling', status: 'done',
      kind: 'release', touches: [], source: 'docs/plans/tooling.md §2',
    });
    const f = findings(p);
    assert.deepEqual(codes(f), ['V12']);
    assert.equal(f[0].message, 'release sdk@2.1.0 is marked done without a tag; git cannot confirm it');
  });
  test('V11 a consumer marked done while the release it needs is open', () => {
    const p = copy(clean);
    p.nodes.push({
      id: 'sdk@2.1.0', title: 'sdk 2.1.0', parent: 'checkout', status: 'open',
      kind: 'release', tag: 'v2.1.0', touches: [], source: 'docs/plans/checkout-v2.md §2',
    });
    node(p, 'C1').dependsOn = [{ id: 'sdk@2.1.0', type: 'hard' }];
    const f = findings(p);
    assert.deepEqual(codes(f), ['V11']);
    assert.match(f[0].message, /C1 is done, but its prerequisite sdk@2.1.0 is not/);
  });
  test('V11 a release marked done with eight open prerequisites is one warning, not eight', () => {
    const p = copy(clean);
    const pre = Array.from({ length: 8 }, (_, i) => `T${10 + i}`);
    for (const id of pre) p.nodes.push({ id, title: `${id} release step`, parent: 'tooling', status: 'open', touches: [], source: 'docs/plans/tooling.md §3' });
    p.nodes.push({
      id: 'sdk@2.1.0', title: 'sdk 2.1.0', parent: 'tooling', status: 'done',
      kind: 'release', tag: 'v2.1.0', touches: [], source: 'docs/plans/tooling.md §3',
      dependsOn: pre.map((id) => ({ id, type: 'hard' as const })),
    });
    const f = findings(p);
    assert.deepEqual(codes(f), ['V11']);
    assert.equal(f[0].message, 'sdk@2.1.0 is done, but its prerequisites are not done: T10, T11, T12, T13, … (8 total); the status or the plan is out of date');
    assert.deepEqual(f[0].nodes, ['sdk@2.1.0', ...pre]);
  });
});

describe('across plan files', () => {
  test('V9 missing claim endpoints in loaded namespaces are errors, including empty plans', () => {
    for (const endpoint of ['from', 'to'] as const) {
      const p = copy(clean);
      p.claims = [{ from: 'R2', to: 'warehouse:W2', [endpoint]: 'warehouse:deleted' }];
      const f = load([p, example('warehouse')]).findings.filter((f) => f.code === 'V9');
      assert.equal(f.length, 1);
      assert.equal(f[0].level, 'ERROR');
      assert.match(f[0].message, /missing nodes in loaded plans: warehouse:deleted/);
    }
    const f = load([copy(clean), { version: 1, namespace: 'warehouse', nodes: [] }]).findings;
    assert.ok(f.some((f) => f.code === 'V9' && f.level === 'ERROR'));
  });
  test('V9 an unloaded namespace at either claim endpoint stays INFO', () => {
    const p = copy(clean);
    p.claims = [{ from: 'other:X', to: 'C2' }, { from: 'R2', to: 'other:Y' }];
    assert.deepEqual(load([p]).findings.filter((f) => f.code === 'V9').map((f) => f.level), ['INFO', 'INFO']);
  });
  test('a single plan resolves its qualified references and reports missing references', () => {
    const p = copy(clean);
    node(p, 'C2').dependsOn = [{ id: 'bookshop:C1', type: 'hard' }];
    let r = load([p]);
    assert.ok(r.model!.edges.some((e) => e.from === 'C1' && e.to === 'C2' && e.resolved));
    node(p, 'C2').dependsOn = [{ id: 'bookshop:deleted', type: 'hard', source: 'x.md', quote: 'wait' }];
    r = load([p]);
    assert.ok(r.findings.some((f) => f.code === 'V8' && f.level === 'ERROR'));
    node(p, 'C2').dependsOn![0].id = 'unloaded:X';
    assert.ok(load([p]).findings.some((f) => f.code === 'V8' && f.level === 'INFO'));
  });
  test('ns:ns resolves to the namespace root, in dependencies and claims', () => {
    const w = example('warehouse');
    node(w, 'W2').dependsOn![1].id = 'bookshop:bookshop';
    const p = copy(clean);
    p.claims = [{ from: 'R2', to: 'warehouse:warehouse' }];
    const r = load([p, w]);
    assert.ok(r.model!.edges.some((e) => e.via === 'bookshop' && e.to === 'warehouse:W2' && e.resolved));
    assert.equal(r.findings.some((f) => f.code === 'V8'), false);
    // §G9.4: W1 is a first item of warehouse and nothing leads from R2 to it, so the claim is unstated
    assert.deepEqual(r.findings.filter((f) => f.code === 'V9').map((f) => [f.level, f.message]),
      [['WARN', "Plans disagree: bookshop:R2's plan says warehouse must wait for it (no source given), but warehouse's plan has no such dependency"]]);
  });
  test('V9 one plan claims a dependency the other plan does not have', () => {
    const w = example('warehouse');
    node(w, 'W2').dependsOn = node(w, 'W2').dependsOn!.filter((d) => d.id !== 'bookshop:R2');
    const f = load([copy(clean), w]).findings;
    assert.ok(f.some((x) => x.code === 'V9' && x.level === 'WARN'));
  });
  test('V8 a reference to a missing item in a loaded plan', () => {
    const w = example('warehouse');
    node(w, 'W2').dependsOn![1].id = 'bookshop:R9';
    assert.ok(load([copy(clean), w]).findings.some((x) => x.code === 'V8' && x.level === 'ERROR'));
  });
});

describe('dependencies declared on groups, and cycles', () => {
  type Deps = PlanFile['nodes'][number]['dependsOn'];
  const cite = { source: 'plan.md §1', quote: 'stated in the plan' };
  const item = (id: string, parent: string, dependsOn?: Deps) => ({ id, title: id, parent, status: 'open' as const, source: 'plan.md §1', ...(dependsOn ? { dependsOn } : {}) });
  const group = (id: string, parent: string | null, dependsOn?: Deps) => ({ id, title: id, parent, ...(parent === null ? { sources: ['plan.md'] } : {}), ...(dependsOn ? { dependsOn } : {}) });

  test('V8 one finding per declared dependency, not per item pair it expands to', () => {
    const p: PlanFile = { version: 1, nodes: [
      group('P', null), group('Q', 'P'), group('G1', 'P'), item('a1', 'G1'), item('a2', 'G1'),
      group('G2', 'Q', [{ id: 'G1', type: 'hard' }]), item('b1', 'G2'), item('b2', 'G2'),
    ] };
    const v8 = load([p]).findings.filter((f) => f.code === 'V8');
    assert.equal(v8.length, 1);
    assert.match(v8[0].message, /G1 → G2/);
  });
  test('V8 a missing item in the plan\'s own namespace is reported once', () => {
    const p = copy(clean);
    node(p, 'C2').dependsOn = [{ id: 'bookshop:deleted', type: 'hard' }];
    assert.deepEqual(load([p]).findings.filter((f) => f.code === 'V8').map((f) => f.level), ['ERROR']);
  });
  test('V6 a hard loop is an error even when an order edge into it is visited first', () => {
    const p: PlanFile = { version: 1, nodes: [
      group('P', null), item('A', 'P', [{ id: 'D', type: 'hard' }]),
      item('D', 'P', [{ id: 'A', type: 'order' }, { id: 'B', type: 'hard' }]), item('B', 'P', [{ id: 'A', type: 'hard' }]),
    ] };
    const f = load([p]).findings.filter((x) => x.code === 'V6');
    assert.deepEqual(f.map((x) => x.level), ['ERROR', 'WARN']);
    assert.match(f[1].message, /Order "D after A"/);
  });
  test('V6 a cycle only between groups is reported even when another page has an item cycle', () => {
    const p: PlanFile = { version: 1, nodes: [
      group('P', null),
      group('G1', 'P'), item('x1', 'G1', [{ id: 'y1', type: 'hard', ...cite }]),
      group('G3', 'P'), item('y1', 'G3', [{ id: 'x1', type: 'hard', ...cite }]),
      group('G2', 'P'), group('H1', 'G2'), item('h1', 'H1'), item('h1b', 'H1', [{ id: 'h2', type: 'hard', ...cite }, { id: 'h2', type: 'order', ...cite }]),
      group('H2', 'G2'), item('h2', 'H2', [{ id: 'h1', type: 'hard', ...cite }]),
    ] };
    const f = load([p]).findings.filter((x) => x.code === 'V6');
    assert.deepEqual(f.map((x) => [x.level, x.nodes]), [['ERROR', ['x1', 'y1', 'x1']], ['WARN', ['H1', 'H2', 'H1']]]);
  });
  test('V6 a node that depends on a group containing it, or on a node inside it, can never finish', () => {
    for (const [on, dep, type, level] of [['G', 'P', 'hard', 'ERROR'], ['A', 'P', 'hard', 'ERROR'], ['G', 'A', 'hard', 'ERROR'], ['G', 'P', 'order', 'WARN']] as const) {
      const p: PlanFile = { version: 1, nodes: [group('P', null), group('G', 'P'), item('A', 'G'), item('B', 'P')]
        .map((n) => n.id === on ? { ...n, dependsOn: [{ id: dep, type, ...cite }] } : n) };
      const f = load([p]).findings.filter((x) => x.code === 'V6');
      assert.deepEqual(f.map((x) => [x.level, x.nodes]), [[level, [on, dep]]], `${on} → ${dep} (${type})`);
    }
  });
  test('V8 an uncited declaration is reported even after a cited one with the same endpoints', () => {
    const p: PlanFile = { version: 1, nodes: [
      group('P', null), group('G1', 'P'), item('a1', 'G1'),
      group('G2', 'P'), item('b1', 'G2', [{ id: 'a1', type: 'hard', ...cite }, { id: 'a1', type: 'hard' }]),
    ] };
    assert.deepEqual(load([p]).findings.filter((x) => x.code === 'V8').map((x) => x.level), ['ERROR']);
  });
  test('V9 a type mismatch is reported only when no matching declaration agrees with the claim', () => {
    const api: PlanFile = { version: 1, namespace: 'api', nodes: [group('api', null), item('A1', 'api')], claims: [{ from: 'A1', to: 'web:W1', type: 'hard', ...cite }] };
    const web: PlanFile = { version: 1, namespace: 'web', nodes: [
      group('web', null), group('W', 'web', [{ id: 'api:A1', type: 'order', ...cite }]), item('W1', 'W', [{ id: 'api:A1', type: 'hard', ...cite }]),
    ] };
    assert.deepEqual(load([api, web]).findings.filter((x) => x.code === 'V9'), []);
    const orderOnly = { ...web, nodes: web.nodes.map((n) => n.id === 'W1' ? { ...n, dependsOn: [] } : n) };
    assert.match(load([api, orderOnly]).findings.find((x) => x.code === 'V9')!.message, /is hard in one plan and order in the other/);
  });
  test('V9 a claim is matched by a dependency declared on the claimed group, an enclosing group or inside the claimed source', () => {
    const api: PlanFile = { version: 1, namespace: 'api', nodes: [group('api', null), group('AG', 'api'), item('A1', 'AG')] };
    const web = (on: string, dep: string): PlanFile => ({ version: 1, namespace: 'web', nodes: [
      group('web', null), group('W', 'web'), group('WS', 'W'), item('W1', 'WS'),
    ].map((n) => n.id === on ? { ...n, dependsOn: [{ id: dep, type: 'hard' as const, ...cite }] } : n) });
    for (const [from, to, on, dep] of [
      ['A1', 'web:W', 'W', 'api:A1'], ['A1', 'web:W', 'WS', 'api:A1'], ['A1', 'web:W1', 'W', 'api:A1'], ['AG', 'web:W1', 'W1', 'api:A1'],
    ]) {
      const claiming = { ...copy(api), claims: [{ from, to, type: 'hard' as const, ...cite }] };
      const f = load([claiming, web(on, dep)]).findings.filter((x) => x.code === 'V9');
      assert.deepEqual(f, [], `${from} → ${to}, declared on ${on}`);
    }
    const broader = { ...copy(api), claims: [{ from: 'A1', to: 'web:W1', ...cite }] };
    assert.deepEqual(load([broader, web('web', 'api:AG')]).findings.filter((x) => x.code === 'V9').map((x) => x.level), []);
    const other = { ...copy(api), nodes: [...api.nodes, item('A2', 'api')], claims: [{ from: 'A2', to: 'web:W', ...cite }] };
    assert.deepEqual(load([other, web('W', 'api:A1')]).findings.filter((x) => x.code === 'V9').map((x) => x.level), ['WARN']);
  });
  test('V9 a claim from a group is not met by a dependency on only one of its independent items', () => {
    const api: PlanFile = { version: 1, namespace: 'api', nodes: [group('api', null), group('AG', 'api'), item('A1', 'AG'), item('A2', 'AG')],
      claims: [{ from: 'AG', to: 'web:W1', type: 'hard', ...cite }] };
    const web = (deps: string[]): PlanFile => ({ version: 1, namespace: 'web', nodes: [
      group('web', null), item('W1', 'web', deps.map((id) => ({ id, type: 'hard' as const, ...cite }))),
    ] });
    const v9 = (deps: string[]) => load([api, web(deps)]).findings.filter((x) => x.code === 'V9').map((x) => x.level);
    assert.deepEqual(v9(['api:A1']), ['WARN']);
    assert.deepEqual(v9(['api:A1', 'api:A2']), []);
    assert.deepEqual(v9(['api:AG']), []);
    assert.deepEqual(v9(['api:api']), []);
  });
  test('V8 an uncited dependency between the root groups of two plan files', () => {
    const api: PlanFile = { version: 1, namespace: 'api', nodes: [group('api', null), item('A1', 'api')] };
    const web: PlanFile = { version: 1, namespace: 'web', nodes: [group('web', null, [{ id: 'api:api', type: 'hard' }]), item('W1', 'web')] };
    assert.deepEqual(load([api, web]).findings.filter((x) => x.code === 'V8').map((x) => x.level), ['ERROR']);
    const two: PlanFile = { version: 1, nodes: [group('G1', null), item('a1', 'G1'), group('G2', null, [{ id: 'G1', type: 'hard' }]), item('b1', 'G2')] };
    assert.deepEqual(load([two]).findings.filter((x) => x.code === 'V8'), []);
  });
  test('a hard dependency on or by a group covers items that an order edge inside it puts later or earlier', () => {
    const p: PlanFile = { version: 1, nodes: [
      group('P', null),
      group('G', 'P'), { ...item('g1', 'G') }, { ...item('g2', 'G', [{ id: 'g1', type: 'order' }]), status: 'done' as const },
      item('X', 'P', [{ id: 'G', type: 'hard' }]),
      item('Y', 'P'), group('H', 'P', [{ id: 'Y', type: 'hard' }]), item('h1', 'H'), item('h2', 'H', [{ id: 'h1', type: 'order' }]),
    ] };
    const m = load([p]).model!;
    assert.equal(m.state.get('X'), 'blocked');
    assert.equal(m.state.get('h2'), 'blocked');
  });
  test('V6 a hard loop between a group and an item survives a mixed loop inside the group', () => {
    const p: PlanFile = { version: 1, nodes: [
      group('P', null),
      group('G', 'P', [{ id: 'X', type: 'hard' }]),
      group('S1', 'G', [{ id: 'S2', type: 'order' }]), item('s1', 'S1'),
      group('S2', 'G', [{ id: 'S1', type: 'hard' }]), item('s2', 'S2'),
      item('X', 'P', [{ id: 'G', type: 'hard' }]),
    ] };
    assert.ok(load([p]).findings.some((x) => x.code === 'V6' && x.level === 'ERROR'));
  });
});
