import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlan } from '../src/parse.ts';
import { parseWorkspace } from '../src/workspace.ts';
import { load } from '../src/index.ts';
import { example, node } from './helpers.ts';

const messages = (input: unknown) => parsePlan(input).findings.map((f) => f.message).join('\n');

test('workspace V0 validates version, entries, locations, refs and one entry per file', () => {
  const entry = { namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' };
  const invalid = [null, [], { version: 2, plans: [] }, { version: 1 },
    ...[null, { ...entry, namespace: 'bad:ns' }, { ...entry, namespace: '' }, { ...entry, file: '' },
      { ...entry, file: '*.json' }, { ...entry, file: '../sdk.json' }, { ...entry, file: 'C:\\sdk.json' },
      { ...entry, file: '.' }, { ...entry, path: '.' }, { ...entry, github: undefined }, { ...entry, github: 'sdk' },
      { ...entry, github: undefined, path: '' }, { ...entry, ref: '' }, { ...entry, ref: 1 }].map((e) => ({ version: 1, plans: [e] })),
    { version: 1, plans: [entry, entry] },
    { version: 1, plans: [entry, { ...entry, namespace: 'another' }] },
  ];
  for (const input of invalid) {
    for (const lang of ['en', 'zh-TW'] as const) {
      const parsed = parseWorkspace(input, lang);
      assert.equal(parsed.workspace, null, JSON.stringify(input));
      assert.ok(parsed.findings.every((f) => f.code === 'V0' && f.level === 'ERROR'));
      if (lang === 'zh-TW') assert.match(parsed.findings[0].message, /[\u4e00-\u9fff]/);
    }
  }
  const parsed = parseWorkspace({ version: 1, plans: [entry, { namespace: 'api', path: '..\\api', file: 'plans\\api.json', ref: 'topic/api' }] });
  assert.deepEqual(parsed.findings, []);
  assert.deepEqual(parsed.workspace!.plans[1], { namespace: 'api', path: '../api', file: 'plans/api.json', ref: 'topic/api' });
});

test('workspace path must be relative to the workspace file; .. stays allowed', () => {
  for (const path of ['\\\\server\\sdk', '//server/sdk', '/srv/sdk', 'C:\\sdk', 'c:/sdk', 'C:sdk', './C:/sdk', '.\\C:\\sdk', 'x/../C:/sdk']) {
    const parsed = parseWorkspace({ version: 1, plans: [{ namespace: 'sdk', path, file: 'plan.json' }] });
    assert.equal(parsed.workspace, null, path);
    assert.deepEqual(parsed.findings.map((f) => [f.level, f.code]), [['ERROR', 'V0']], path);
  }
  for (const path of ['../sdk', '..\\..\\sdk', 'sdk', '.']) {
    assert.deepEqual(parseWorkspace({ version: 1, plans: [{ namespace: 'sdk', path, file: 'plan.json' }] }).findings, [], path);
  }
});

test('malformed namespace, claims, externalRefs and overlap rules are V0, not a crash', () => {
  const malformed: Record<string, unknown>[] = [
    { namespace: 'a:b' }, { namespace: '' }, { namespace: 5 },
    { claims: 'R2' }, { claims: [null] }, { claims: [{ from: 1, to: 'C2' }] }, { claims: [{ from: 'R2' }] },
    { claims: [{ from: 'R2', to: 'C2', type: 'soft' }] }, { claims: [{ from: 'R2', to: 'C2', source: 3 }] },
    { externalRefs: {} }, { externalRefs: [null] }, { externalRefs: [{}] }, { externalRefs: [{ id: 'x:Y', meaning: 1 }] },
    { rules: { overlaps: {} } }, { rules: { overlaps: [null] } }, { rules: { overlaps: [{ id: 'o' }] } },
    { rules: { overlaps: [{ id: 'o', a: {}, b: { kind: 1 } }] } }, { rules: { overlaps: [{ a: {}, b: {} }] } },
  ];
  for (const extra of malformed) {
    const input = { ...example('bookshop'), ...extra };
    const r = parsePlan(input);
    assert.equal(r.plan, null, JSON.stringify(extra));
    assert.ok(r.findings.length && r.findings.every((f) => f.code === 'V0' && f.level === 'ERROR'), JSON.stringify(extra));
    assert.doesNotThrow(() => load([input]), JSON.stringify(extra));
    assert.match(parsePlan(input, 'zh-TW').findings[0].message, /[\u4e00-\u9fff]/);
  }
});

test('the examples parse without findings', () => {
  for (const name of ['bookshop', 'warehouse'] as const) {
    const r = parsePlan(example(name));
    assert.ok(r.plan, name);
    assert.deepEqual(r.findings, []);
  }
});

test('rejects files that are not plans', () => {
  assert.equal(parsePlan(null).plan, null);
  assert.equal(parsePlan({ version: 2, nodes: [] }).plan, null);
  assert.equal(parsePlan({ version: 1 }).plan, null);
});

test('duplicate ids and colons in ids are errors', () => {
  const p = example('bookshop');
  p.nodes.push({ ...node(p, 'C2') });
  assert.match(messages(p), /Duplicate id: C2/);
  const q = example('bookshop');
  node(q, 'C2').id = 'x:C2';
  assert.match(messages(q), /cannot contain a colon/);
});

test('groups derive status; items must carry one', () => {
  const p = example('bookshop');
  node(p, 'checkout').status = 'done';
  assert.match(messages(p), /checkout has children and is a group/);
  const q = example('bookshop');
  delete node(q, 'C2').status;
  assert.match(messages(q), /C2 is an item and needs status/);
});

test('references must resolve: parents, areas, dependencies', () => {
  const p = example('bookshop');
  node(p, 'C2').parent = 'nowhere';
  node(p, 'C3').touches = ['mobile'];
  node(p, 'R2').dependsOn = [{ id: 'R9', type: 'hard' }];
  const m = messages(p);
  assert.match(m, /C2: parent nowhere does not exist/);
  assert.match(m, /C3 touches unknown area mobile/);
  assert.match(m, /R2 depends on missing node R9/);
});

test('external references are left for the merge step', () => {
  const p = example('bookshop');
  node(p, 'C2').dependsOn!.push({ id: 'payments:P1', type: 'hard', source: 'x.md', quote: 'q' });
  assert.ok(parsePlan(p).plan);
});

test('a dependency needs a known type', () => {
  const p = example('bookshop');
  (node(p, 'C2').dependsOn as unknown[]).push({ id: 'C1', type: 'soon' });
  assert.match(messages(p), /dependsOn entry needs id and type/);
});

test('a parent cycle is reported, not looped on', () => {
  const p = example('bookshop');
  node(p, 'refactor').parent = 'R1';
  node(p, 'R1').parent = 'refactor';
  assert.match(messages(p), /Parent cycle/);
});

test('a tag on a node that is not a release is V0', () => {
  const p = example('bookshop');
  node(p, 'C2').tag = 'v2.1.0';
  const r = parsePlan(p);
  assert.equal(r.plan, null);
  assert.deepEqual(r.findings.map((f) => f.code), ['V0']);
  assert.match(r.findings[0].message, /C2 is not a release and cannot have a tag/);
});

test('a release with children is V0', () => {
  const p = example('bookshop');
  node(p, 'checkout').kind = 'release';
  const r = parsePlan(p);
  assert.equal(r.plan, null);
  assert.deepEqual(r.findings.map((f) => f.code), ['V0']);
  assert.match(r.findings[0].message, /checkout is a release and cannot have children/);
});

test('links on items and groups are kept as written', () => {
  const p = example('bookshop');
  const links = ['#123', 'acme/shop-web#7', 'branch:124-budget-exit-codes', 'branch:feat/checkout.v2'];
  node(p, 'C2').links = links;
  node(p, 'checkout').links = ['#9'];
  const r = parsePlan(p);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.plan!.nodes.find((n) => n.id === 'C2')!.links, links);
  assert.deepEqual(r.plan!.nodes.find((n) => n.id === 'checkout')!.links, ['#9']);
});

test('a malformed link is V0', () => {
  for (const bad of ['123', '#0', '#12a', 'acme#3', 'https://github.com/acme/shop/issues/3', 'branch:', 'branch:has space', 'branch:a..b~1', 'pr:4', '']) {
    const p = example('bookshop');
    node(p, 'C2').links = [bad];
    const r = parsePlan(p);
    assert.equal(r.plan, null, bad);
    assert.deepEqual(r.findings.map((f) => f.code), ['V0'], bad);
    assert.match(r.findings[0].message, /C2 has an invalid link/, bad);
  }
  const p = example('bookshop');
  (node(p, 'C2') as unknown as Record<string, unknown>).links = '#3';
  assert.match(messages(p), /C2: links must be an array/);
});
