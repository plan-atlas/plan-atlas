/**
 * Tests derived from docs/RULES.md §V and §S, the specific part. For each rule: one case with
 * every element met, and one per element negated (no finding); for each competition clause one
 * case where both rules would fire, asserting that only the displacing one reports; and a test
 * for each express departure from §G. Each name starts with the section it checks.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { checkCoupling } from '../src/coupling.ts';
import { derive, type Derived } from '../src/derive.ts';
import { suggestFromGithub } from '../src/githubstatus.ts';
import { suggestStatus } from '../src/gitstatus.ts';
import { loadFiles } from '../src/index.ts';
import { mergePlans } from '../src/merge.ts';
import { parsePlan } from '../src/parse.ts';
import type { PlanFile } from '../src/types.ts';
import { parseWorkspace, readWorkspace, suggestWorkspace } from '../src/workspace.ts';
import { example } from './helpers.ts';
import { cite, dep, G, I, ids, messageId, only, P, run } from './rules-helpers.ts';

const base = () => P([G('R', null), I('a', 'R')]);
const v0 = (input: unknown) => parsePlan(input).findings.map((f) => `${f.level} ${f.code} ${messageId(f)}`);
const with_ = (patch: (p: PlanFile & Record<string, unknown>) => void) => {
  const p = base() as PlanFile & Record<string, unknown>;
  patch(p);
  return p;
};
const node0 = (p: PlanFile) => p.nodes[1] as unknown as Record<string, unknown>;

function dir(t: TestContext) {
  const d = mkdtempSync(join(tmpdir(), 'plan-atlas-rules-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const save = (file: string, content: unknown) => {
    const path = join(d, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  };
  return { d, save };
}

describe('§V0 shape', () => {
  // [sub-rule, input that meets the condition, the same input corrected, message id]
  const rows: [string, () => unknown, () => unknown, string][] = [
    ['V0.4', () => null, base, 'jsonObject'],
    ['V0.5', () => with_((p) => { (p as Record<string, unknown>).version = 2; }), base, 'version'],
    ['V0.6', () => with_((p) => { (p as Record<string, unknown>).nodes = 'x'; }), base, 'nodesArray'],
    ['V0.7', () => with_((p) => { delete node0(p).title; }), base, 'nodeFields'],
    ['V0.8', () => with_((p) => { p.nodes.push(I('a', 'R')); }), base, 'duplicateId'],
    ['V0.9', () => with_((p) => { p.nodes.push(I('x:y', 'R')); }), base, 'idColon'],
    ['V0.10', () => with_((p) => { node0(p).parent = 5; }), base, 'parentType'],
    ['V0.11', () => with_((p) => { node0(p).parent = 'nowhere'; }), base, 'unknownParent'],
    ['V0.13', () => P([G('x', 'y'), G('y', 'x'), I('z', 'x')]), base, 'noRoot'],
    ['V0.14', () => with_((p) => { node0(p).status = 'started'; }), base, 'statusType'],
    ['V0.15', () => with_((p) => { (p.nodes[0] as unknown as Record<string, unknown>).status = 'open'; }), base, 'groupStatus'],
    ['V0.16', () => with_((p) => { delete node0(p).status; }), base, 'itemStatus'],
    ['V0.17', () => with_((p) => { p.nodes[0].kind = 'release'; }), base, 'releaseChildren'],
    ['V0.18', () => with_((p) => { node0(p).tag = 'v1'; }), () => with_((p) => { node0(p).tag = 'v1'; node0(p).kind = 'release'; }), 'tagOnItem'],
    ['V0.19', () => with_((p) => { node0(p).dependsOn = {}; }), base, 'depsArray'],
    ['V0.20', () => with_((p) => { node0(p).dependsOn = [{ id: 'R', type: 'soft' }]; }), base, 'depFields'],
    ['V0.21', () => with_((p) => { p.nodes.push(I('b', 'R', [dep('gone')])); }), () => with_((p) => { p.nodes.push(I('b', 'R', [dep('a')])); }), 'unknownDep'],
    ['V0.22', () => with_((p) => { node0(p).touches = ['x']; }), () => with_((p) => { node0(p).touches = ['x']; p.areas = { x: 'X' }; }), 'unknownArea'],
    ['V0.23', () => with_((p) => { node0(p).links = '#1'; }), () => with_((p) => { node0(p).links = ['#1']; }), 'linksArray'],
    ['V0.24', () => with_((p) => { node0(p).links = ['#0']; }), () => with_((p) => { node0(p).links = ['#1']; }), 'badLink'],
    ['V0.25', () => with_((p) => { node0(p).source = 3; }), base, 'fieldType'],
    ['V0.25', () => with_((p) => { (p.nodes[0] as unknown as Record<string, unknown>).sources = 'plan.md'; }), base, 'fieldType'],
    ['V0.25', () => with_((p) => { node0(p).dependsOn = [{ id: 'R:R', type: 'hard', quote: 4 }]; }), base, 'fieldType'],
    ['V0.26', () => with_((p) => { p.namespace = 'a:b'; }), () => with_((p) => { p.namespace = 'a.b'; }), 'planNamespace'],
    ['V0.27', () => with_((p) => { p.claims = {} as never; }), () => with_((p) => { p.claims = []; }), 'listArray'],
    ['V0.28', () => with_((p) => { p.claims = [{ from: 'a' } as never]; }), () => with_((p) => { p.claims = [{ from: 'a', to: 'x:Y' }]; }), 'claimFields'],
    ['V0.28', () => with_((p) => { p.externalRefs = [{} as never]; }), () => with_((p) => { p.externalRefs = [{ id: 'x:Y' }]; }), 'externalRefFields'],
    ['V0.28', () => with_((p) => { p.rules = { overlaps: [{ id: 'o' } as never] }; }), () => with_((p) => { p.rules = { overlaps: [{ id: 'o', a: {}, b: {} }] }; }), 'overlapFields'],
    ['V0.29', () => with_((p) => { p.rules = { maxPageNodes: 2 }; }), () => with_((p) => { p.rules = { maxPageNodes: 3 }; }), 'maxPageNodes'],
    ['V0.29', () => with_((p) => { p.rules = { maxPageNodes: 3.5 }; }), () => with_((p) => { p.rules = { maxPageNodes: 4 }; }), 'maxPageNodes'],
  ];
  for (const [rule, bad, good, id] of rows) {
    test(`§${rule} met: ${id}`, () => assert.ok(v0(bad()).includes(`ERROR V0 ${id}`), v0(bad()).join('\n')));
    test(`§${rule} negated (condition not met): no ${id}`, () => assert.ok(!v0(good()).some((x) => x.endsWith(` ${id}`)), v0(good()).join('\n')));
  }
  test('§V0.12 met: one finding per parent loop, not per node that reaches it', () => {
    const p = P([G('R', null), G('x', 'y'), G('y', 'x'), I('z', 'x'), I('w', 'z'), I('a', 'R')]);
    assert.deepEqual(v0(p).filter((x) => x.endsWith('parentCycle')), ['ERROR V0 parentCycle']);
  });
  test('§V0.10 met: an omitted parent is not a root; only an explicit null is', () => {
    assert.deepEqual(v0({ version: 1, nodes: [{ id: 'a', title: 'A', status: 'open' }] }), ['ERROR V0 parentType']);
    assert.deepEqual(v0({ version: 1, nodes: [{ id: 'a', title: 'A', status: 'open', parent: null }] }), []);
  });
  test('§V0.13 negated: a file with no nodes has no root and no finding (§G2.2)', () => {
    assert.deepEqual(v0({ version: 1, nodes: [] }), []);
  });
  test('§V0.12 negated: a parent chain that ends has no finding', () => {
    assert.deepEqual(v0(P([G('R', null), G('x', 'R'), I('z', 'x')])), []);
  });
  test('§V0.30 met: two loaded files share a namespace', () => {
    assert.deepEqual(ids(mergePlans([base(), base()]).findings), ['ERROR V0 duplicateNamespace']);
  });
  test('§V0.30 negated: distinct namespaces', () => {
    assert.deepEqual(mergePlans([base(), P([G('S', null), I('b', 'S')])]).findings, []);
  });
  test('§V0.31 met: a workspace that is not an object, or without a plans array', () => {
    assert.deepEqual(ids(parseWorkspace([]).findings), ['ERROR V0 workspaceObject']);
    assert.deepEqual(ids(parseWorkspace({ version: 1 }).findings), ['ERROR V0 workspacePlans']);
    assert.deepEqual(parseWorkspace({ version: 1, plans: [] }).findings, []);
  });
  test('§V0.5 met on a workspace file: version ≠ 1', () => {
    assert.deepEqual(ids(parseWorkspace({ version: 2, plans: [] }).findings), ['ERROR V0 version']);
  });
  const entry = { namespace: 'sdk', github: 'org/sdk', file: 'plan.json' };
  for (const [bad, id] of [
    [{ ...entry, namespace: 'a:b' }, 'workspaceFields'], [{ ...entry, file: '../x.json' }, 'workspaceFile'],
    [{ ...entry, path: '../sdk' }, 'workspaceLocation'], [{ namespace: 'sdk', path: 'C:/sdk', file: 'plan.json' }, 'workspacePath'],
    [{ ...entry, ref: '' }, 'workspaceRef'],
  ] as const) {
    test(`§V0.32 met: ${id}`, () => assert.deepEqual(ids(parseWorkspace({ version: 1, plans: [bad] }).findings), [`ERROR V0 ${id}`]));
  }
  test('§V0.32 negated: a well-formed entry', () => assert.deepEqual(parseWorkspace({ version: 1, plans: [entry] }).findings, []));
  test('§V0.33 met: a namespace or a repository file listed twice', () => {
    assert.deepEqual(ids(parseWorkspace({ version: 1, plans: [entry, { ...entry, file: 'other.json' }] }).findings), ['ERROR V0 duplicateNamespace']);
    assert.deepEqual(ids(parseWorkspace({ version: 1, plans: [entry, { ...entry, namespace: 'two' }] }).findings), ['ERROR V0 workspaceDuplicateFile']);
  });
  test('§V0.33 negated: distinct namespaces and files', () => {
    assert.deepEqual(parseWorkspace({ version: 1, plans: [entry, { ...entry, namespace: 'two', file: 'two.json' }] }).findings, []);
  });
  test('§V0.34 met and negated: the entry\'s namespace must equal the file\'s namespace field', (t) => {
    const { save } = dir(t);
    save('sdk/plan.json', P([G('sdk', null), I('a', 'sdk')]));
    const ws = save('hub/ws.json', { version: 1, plans: [{ namespace: 'sdk', path: '../sdk', file: 'plan.json' }] });
    const mismatch = readWorkspace(ws);
    assert.deepEqual(ids(mismatch.findings), ['ERROR V0 workspaceNamespace']);
    assert.equal(mismatch.findings[0].namespace, 'sdk');
    save('sdk/plan.json', P([G('sdk', null), I('a', 'sdk')], { namespace: 'sdk' }));
    assert.deepEqual(readWorkspace(ws).findings, []);
  });
  test('§V0.35 met: an entry that cannot be read is ERROR, WARN with --allow-missing; negated: a readable entry', (t) => {
    const { save } = dir(t);
    const ws = save('hub/ws.json', { version: 1, plans: [{ namespace: 'sdk', path: '../sdk', file: 'plan.json' }] });
    const missing = readWorkspace(ws);
    assert.deepEqual(ids(missing.findings), ['ERROR V0 workspaceRead']);
    assert.equal(missing.findings[0].namespace, 'sdk');
    const allowed = readWorkspace(ws, [], { allowMissing: true });
    assert.deepEqual(ids(allowed.findings), ['WARN V0 workspaceRead']);
    assert.equal(allowed.findings[0].namespace, 'sdk');
    save('sdk/plan.json', P([G('sdk', null), I('a', 'sdk')], { namespace: 'sdk' }));
    assert.deepEqual(readWorkspace(ws).findings, []);
  });
  test('§V0.36 met: a self entry of another repository, and this repository left out; negated without a repository and when the self set matches', (t) => {
    const { d, save } = dir(t);
    const plan = (ns: string) => P([G(ns, null), I('a', ns)], { namespace: ns });
    save('plans/api.json', plan('api'));
    save('plans/sdk.json', plan('sdk'));
    const ws = save('hub/ws.json', { version: 1, plans: [
      { namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' },
      { namespace: 'api', github: 'org/api', file: 'plans/api.json' },
    ] });
    const saved = process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;
    t.after(() => { if (saved === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = saved; });
    try {
      const run = (q: string) => {
        const ns = /name: "(\w+)"/.exec(q)?.[1] ?? 'sdk';
        return { data: { p0: { defaultBranchRef: { name: 'main' }, base: { text: JSON.stringify(plan(ns)) }, baseCommit: { oid: 'abc' } } } };
      };
      const warned = readWorkspace(ws, [], { cwd: d, self: ['api'], repository: 'org/sdk', run });
      assert.deepEqual(ids(warned.findings), ['WARN V0 selfLeftOut', 'WARN V0 selfOtherRepository']);
      assert.deepEqual(warned.findings.map((f) => f.namespace), ['sdk', 'api']);
      assert.deepEqual(readWorkspace(ws, [], { cwd: d, self: ['api'], run }).findings, []);
      assert.deepEqual(readWorkspace(ws, [], { cwd: d, self: ['sdk'], repository: 'Org/SDK', run }).findings, []);
    } finally {
      if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = saved;
    }
  });
  test('§V0.1 met: an input file that cannot be read; negated: one that can', (t) => {
    const { d, save } = dir(t);
    assert.deepEqual(ids(loadFiles([join(d, 'missing.json')]).findings), ['ERROR V0 fileRead']);
    assert.deepEqual(loadFiles([save('plan.json', base())]).findings, []);
  });
  test('§V0.2 met: an input or entry file that is not valid JSON (entry: workspaceRead)', (t) => {
    const { save } = dir(t);
    assert.deepEqual(ids(loadFiles([save('bad.json', '{')]).findings), ['ERROR V0 fileJson']);
    save('sdk/plan.json', '{');
    const ws = save('hub/ws.json', { version: 1, plans: [{ namespace: 'sdk', path: '../sdk', file: 'plan.json' }] });
    assert.deepEqual(ids(readWorkspace(ws, [], { allowMissing: true }).findings), ['ERROR V0 workspaceRead']);
  });
  test('§V0.3 met: an input or entry file outside confinement (entry: workspaceRead, ERROR even with --allow-missing)', (t) => {
    const { d, save } = dir(t);
    const outside = save('outside/plan.json', P([G('sdk', null), I('a', 'sdk')], { namespace: 'sdk' }));
    mkdirSync(join(d, 'in'));
    assert.deepEqual(ids(loadFiles([outside], undefined, 'en', join(d, 'in')).findings), ['ERROR V0 fileConfined']);
    const ws = save('in/ws.json', { version: 1, plans: [{ namespace: 'sdk', path: '../outside', file: 'plan.json' }] });
    assert.deepEqual(ids(readWorkspace(ws, [], { allowMissing: true, confine: join(d, 'in') }).findings), ['ERROR V0 workspaceRead']);
  });
  test('§V0.3 negated: an input inside the confinement root', (t) => {
    const { d, save } = dir(t);
    assert.deepEqual(loadFiles([save('in/plan.json', base())], undefined, 'en', join(d, 'in')).findings, []);
  });
  test('§V0 competition: a V0 error displaces every other rule for the run (§G8.5)', () => {
    const p = with_((x) => { x.nodes.push(G('S', 'R'), I('b', 'S', [dep('a', 'hard', false)])); (x.nodes[1] as unknown as Record<string, unknown>).status = 'started'; });
    assert.deepEqual(ids(run([p]).findings), ['ERROR V0 statusType']);
  });
  test('§V0 competition: V0.4 and V0.6 stop parsing of that file; V0.5 does not', () => {
    assert.deepEqual(v0(null), ['ERROR V0 jsonObject']);
    assert.deepEqual(v0({ version: 2, nodes: 'x', claims: 'y' }), ['ERROR V0 version', 'ERROR V0 nodesArray']);
    assert.deepEqual(v0({ version: 2, nodes: [], claims: 'y' }), ['ERROR V0 version', 'ERROR V0 listArray']);
  });
});

describe('§V1, §V2, §V4 committed summary', () => {
  const plan = example('bookshop');
  const fresh = (): Derived => derive(run([plan]).model!);
  const summary = (s?: Derived) => only(run([plan], { claimed: s }).findings, 'V1', 'V2', 'V4');
  test('§V1/V2/V4 negated (1): no committed summary given', () => assert.deepEqual(summary(), []));
  test('§V1/V2/V4 negated (2): the summary equals the derived one', () => assert.deepEqual(summary(fresh()), []));
  const cases: [string, (s: Derived) => void, string][] = [
    ['V2.1', (s) => { delete s.groups.checkout; }, 'ERROR V2 summaryMissingGroup'],
    ['V2.2', (s) => { s.groups.checkout.counts.done = 9; }, 'ERROR V2 summaryStatus'],
    ['V2.3', (s) => { s.groups.ghost = { status: 'open', counts: { done: 0, ready: 0, blocked: 0 } }; }, 'ERROR V2 summaryUnknownGroup'],
    ['V4.2', (s) => { s.pages.ghost = { nodes: [], edges: [] }; }, 'ERROR V4 summaryUnknownPage'],
    ['V4.3', (s) => { s.pages.checkout.nodes.push('@ghost'); }, 'ERROR V4 summaryNodes'],
    ['V1.1', (s) => { s.pages.bookshop.edges.push({ from: 'tooling', to: 'refactor', kind: 'hard', count: 1 }); }, 'ERROR V1 summaryExtraEdge'],
    ['V4.4', (s) => { s.pages.bookshop.edges.push({ from: 'tooling', to: 'refactor', kind: 'overlap', count: 1 }); }, 'ERROR V4 summaryExtraEdge'],
    ['V1.2', (s) => { s.pages.bookshop.edges = s.pages.bookshop.edges.filter((e) => e.kind !== 'hard'); }, 'ERROR V1 summaryMissingEdge'],
    ['V4.5', (s) => { s.pages.bookshop.edges = s.pages.bookshop.edges.filter((e) => e.kind !== 'overlap'); }, 'ERROR V4 summaryMissingEdge'],
    ['V1.3', (s) => { s.pages.bookshop.edges.find((e) => e.kind === 'hard')!.count = 7; }, 'ERROR V1 summaryCount'],
    ['V4.6', (s) => { s.pages.bookshop.edges.find((e) => e.kind === 'overlap')!.count = 7; }, 'ERROR V4 summaryCount'],
    ['V4.1', (s) => { delete s.pages.checkout; }, 'ERROR V4 summaryMissingPage'],
  ];
  for (const [rule, change, want] of cases) {
    test(`§${rule} met: ${want.split(' ').pop()}`, () => {
      const s = fresh();
      change(s);
      assert.deepEqual(summary(s), [want]);
    });
  }
  test('§V4.4 / §V4.5 negated: an overlap edge is an unordered pair, so reordering the items changes nothing', () => {
    const p = (order: string[]) => P([G('R', null), ...order.map((id) => I(id, 'R', undefined, { touches: ['x'] }))],
      { areas: { x: 'X' }, rules: { overlaps: [{ id: 'o', a: {}, b: {} }] } });
    const s = derive(run([p(['a', 'b'])]).model!);
    assert.deepEqual(only(run([p(['b', 'a'])], { claimed: s }).findings, 'V1', 'V2', 'V4'), []);
  });
  test('§V4 competition: V4.1 displaces V4.3 and V1.2 / V4.5 on that page', () => {
    // the checkout page has nodes, a hard edge and an overlap edge; only its absence is reported
    const s = fresh();
    assert.ok(s.pages.checkout.edges.some((e) => e.kind === 'hard') && s.pages.checkout.edges.some((e) => e.kind === 'overlap'));
    delete s.pages.checkout;
    assert.deepEqual(summary(s), ['ERROR V4 summaryMissingPage']);
  });
});

describe('§V3 provenance', () => {
  const p = (extra: Partial<ReturnType<typeof I>> = {}, groupSources?: string[], outer?: string[]) =>
    P([G('R', null, undefined, outer ? { sources: outer } : {}), G('S', 'R', undefined, groupSources ? { sources: groupSources } : {}), I('a', 'S', undefined, extra)]);
  const v3 = (plan: PlanFile) => only(run([plan]).findings, 'V3');
  test('§V3a met: an item without source', () => assert.deepEqual(v3(p({ source: undefined })), ['ERROR V3 noSource']));
  test('§V3a negated (1): a group without source', () => assert.deepEqual(v3(p()), []));
  test('§V3a negated (2): an item with a source', () => assert.deepEqual(v3(p({ source: 'x.md §1' })), []));
  test('§V3b met: the source matches none of the nearest listed files', () => assert.deepEqual(v3(p({ source: 'b.md §1' }, ['a.md'])), ['ERROR V3 wrongSource']));
  test('§V3b negated (2): no source (precondition), only V3a', () => assert.deepEqual(v3(p({ source: undefined }, ['a.md'])), ['ERROR V3 noSource']));
  test('§V3b negated (3): no ancestor lists sources', () => assert.deepEqual(v3(p({ source: 'b.md §1' })), []));
  test('§V3b met (3): the nearest ancestor with sources decides, not an outer one', () => {
    assert.deepEqual(v3(p({ source: 'b.md §1' }, ['a.md'], ['b.md'])), ['ERROR V3 wrongSource']);
    assert.deepEqual(v3(p({ source: 'b.md §1' }, undefined, ['b.md'])), []);
  });
  test('§V3b negated (4): the source matches by file part (./ removed) or by prefix', () => {
    assert.deepEqual(v3(p({ source: './a.md §2' }, ['a.md'])), []);
    assert.deepEqual(v3(p({ source: 'docs/plans/a.md §2' }, ['docs/plans/'])), []);
  });
  test('§V3 competition: concurrent with §V7, an item without source and with an inferred status gets both', () => {
    assert.deepEqual(only(run([p({ source: undefined, inferred: true, evidence: 'seen in CI' })]).findings, 'V3', 'V7'), ['ERROR V3 noSource', 'INFO V7 inferredStatus']);
  });
});

describe('§V5 page size', () => {
  const page = (n: number, limit?: number, ns?: string) => P([G('R', null), ...Array.from({ length: n }, (_, k) => I(`x${k}`, 'R'))],
    { ...(limit ? { rules: { maxPageNodes: limit } } : {}), ...(ns ? { namespace: ns } : {}) });
  const v5 = (...plans: PlanFile[]) => only(run(plans).findings, 'V5');
  test('§V5 met: more nodes than maxPageNodes', () => assert.deepEqual(v5(page(4, 3)), ['WARN V5 pageSize']));
  test('§V5 negated (2): exactly maxPageNodes', () => assert.deepEqual(v5(page(3, 3)), []));
  test('§V5 met: stubs count', () => {
    const p = P([G('R', null), G('S', 'R'), I('a', 'S', [dep('b')]), I('c', 'S'), I('d', 'S'), I('b', 'R')], { rules: { maxPageNodes: 3 } });
    assert.deepEqual(run([p]).model!.pages.get('S')!.nodes.length, 4);
    assert.deepEqual(v5(p), ['WARN V5 pageSize']);
  });
  test('§V5 default 15; the limit is the smallest set by any loaded file, never clamped to 15', () => {
    assert.deepEqual(v5(page(16)), ['WARN V5 pageSize']);
    assert.deepEqual(v5(page(16, 20, 'a'), page(1, undefined, 'b')), []);
    assert.deepEqual(v5(page(4, 20, 'a'), page(1, 3, 'b')), ['WARN V5 pageSize']);
  });
});

describe('§V6 cycles', () => {
  const v6 = (nodes: ReturnType<typeof I>[]) => only(run([P([G('R', null), ...nodes])]).findings, 'V6');
  test('§V6a met: a strongly connected set of hard edges', () => assert.deepEqual(v6([I('a', 'R', [dep('b')]), I('b', 'R', [dep('a')])]), ['ERROR V6 hardCycle']));
  test('§V6a negated (2): a loop with an order edge is no hard component', () => {
    assert.ok(!v6([I('a', 'R', [dep('b')]), I('b', 'R', [dep('a', 'order')])]).includes('ERROR V6 hardCycle'));
  });
  test('§V6a unit: one finding per component, not per loop', () => {
    assert.deepEqual(v6([I('a', 'R', [dep('b')]), I('b', 'R', [dep('a'), dep('c')]), I('c', 'R', [dep('b')])]), ['ERROR V6 hardCycle']);
  });
  test('§V6b met: a nested declaration, ERROR when hard, WARN when order', () => {
    assert.deepEqual(v6([G('S', 'R'), I('a', 'S', [dep('S')])]), ['ERROR V6 nestedDep']);
    assert.deepEqual(v6([G('S', 'R'), I('a', 'S', [dep('R', 'order')])]), ['WARN V6 nestedDep']);
  });
  test('§V6b negated (2): an unresolved target is never nested', () => assert.deepEqual(v6([I('a', 'R', [dep('other:R')])]), []));
  test('§V6b negated (3): source node and target not nested', () => assert.deepEqual(v6([G('S', 'R'), I('a', 'S'), I('b', 'R', [dep('S')])]), []));
  test('§V6c met: an order declaration whose edge is reached back', () => {
    assert.deepEqual(v6([I('a', 'R', [dep('b')]), I('b', 'R', [dep('a', 'order')])]), ['WARN V6 orderCycle']);
  });
  test('§V6c negated (2): a hard declaration is no contradicted order', () => {
    assert.ok(!v6([I('a', 'R', [dep('b')]), I('b', 'R', [dep('a')])]).includes('WARN V6 orderCycle'));
  });
  test('§V6c negated (3): an order declaration that binds no resolved edge', () => assert.deepEqual(v6([I('a', 'R', [dep('x:Y', 'order')])]), []));
  test('§V6c negated (4): no path back', () => assert.deepEqual(v6([I('a', 'R'), I('b', 'R', [dep('a', 'order')])]), []));
  test('§V6c unit: one finding per declaration, however many edges it binds', () => {
    const r = v6([G('S', 'R'), I('s1', 'S', [dep('t')]), I('s2', 'S', [dep('t')]), I('t', 'R', [dep('S', 'order')])]);
    assert.deepEqual(r, ['WARN V6 orderCycle']);
  });
  const crossing = [G('G1', 'R'), I('x1', 'G1', [dep('y1')]), G('G2', 'R'), I('y1', 'G2'), I('y2', 'G2', [dep('x1')])];
  test('§V6d met: a page loop with no item loop behind it', () => assert.deepEqual(v6(crossing), ['WARN V6 groupCycle']));
  test('§V6d negated (2): no loop on the page', () => assert.deepEqual(v6(crossing.slice(0, 4)), []));
  test('§V6d departs from §G11.3: a loop through a stub is not reported on that page, but on the common ancestor\'s', () => {
    const f = run([P([G('T', null), G('Q', 'T'), G('A', 'Q'), I('a1', 'A'), I('a2', 'A', [dep('b1')]), G('B', 'Q'), I('b1', 'B', [dep('z')]), I('z', 'T', [dep('a1')])])]).findings;
    assert.deepEqual(only(f, 'V6'), ['WARN V6 groupCycle']);
    assert.match(f.find((x) => x.code === 'V6')!.message, /^"T" has a cycle/);
  });
  test('§V6 competition: V6b binds nothing, so it never feeds V6a, V6c or V6d', () => {
    assert.deepEqual(v6([G('S', 'R', [dep('a')]), I('a', 'S', [dep('S')]), I('b', 'S')]), ['ERROR V6 nestedDep', 'ERROR V6 nestedDep']);
  });
  test('§V6 competition: an order edge with a hard edge beside it is displaced; the loop is reported by V6a', () => {
    assert.deepEqual(v6([I('a', 'R', [dep('b'), dep('b', 'order')]), I('b', 'R', [dep('a')])]), ['ERROR V6 hardCycle']);
  });
  test('§V6 competition: V6a and V6c are concurrent on a loop of mixed types', () => {
    assert.deepEqual(v6([I('a', 'R', [dep('b'), dep('c')]), I('b', 'R', [dep('a')]), I('c', 'R', [dep('a', 'order')])]), ['ERROR V6 hardCycle', 'WARN V6 orderCycle']);
  });
  test('§V6 competition: V6a displaces V6d when one item component covers every page edge of the loop', () => {
    assert.deepEqual(v6([G('G1', 'R'), I('x1', 'G1', [dep('y1')]), G('G3', 'R'), I('y1', 'G3', [dep('x1')])]), ['ERROR V6 hardCycle']);
  });
  test('§V6 competition: V6d stays when the item component misses a page edge of the loop', () => {
    assert.deepEqual(v6([G('A', 'R'), I('a1', 'A', [dep('b1')]), I('a2', 'A'), G('B', 'R'), I('b1', 'B', [dep('a1')]), I('b2', 'B', [dep('a2', 'order')])]),
      ['ERROR V6 hardCycle', 'WARN V6 groupCycle']);
  });
  test('§V6 competition: V6b displaces §V8b on the same declaration', () => {
    assert.deepEqual(only(run([P([G('R', null), G('S', 'R'), I('a', 'S', [dep('R', 'hard', false)])])]).findings, 'V6', 'V8'), ['ERROR V6 nestedDep']);
  });
});

describe('§V7 inferred status', () => {
  test('§V7 met: an item with inferred: true', () => assert.deepEqual(only(run([P([G('R', null), I('a', 'R', undefined, { inferred: true })])]).findings, 'V7'), ['INFO V7 inferredStatus']));
  test('§V7 negated (2): not inferred', () => assert.deepEqual(only(run([base()]).findings, 'V7'), []));
});

describe('§V8 references and citations', () => {
  const api = P([G('api', null), I('A1', 'api')], { namespace: 'api' });
  const web = (deps: ReturnType<typeof dep>[], extra: Partial<PlanFile> = {}) => P([G('web', null), I('W1', 'web', deps)], { namespace: 'web', ...extra });
  const v8 = (plans: PlanFile[], workspace?: string[]) => only(run(plans, { workspace }).findings, 'V8', 'V9');
  test('§V8a1 met: a qualified target in a loaded namespace that names no node', () => assert.deepEqual(v8([api, web([dep('api:gone')])]), ['ERROR V8 missingExternalItem']));
  test('§V8a1 negated (3): the namespace is not loaded', () => assert.deepEqual(v8([web([dep('api:gone')])]), ['INFO V8 externalUnloaded']));
  test('§V8a1 negated (4): the node exists', () => assert.deepEqual(v8([api, web([dep('api:A1')])]), []));
  test('§V8a2 met: with a workspace, an unknown namespace not excused', () => assert.deepEqual(v8([api, web([dep('typo:X')])], ['api', 'web']), ['ERROR V8 unknownNamespace']));
  test('§V8a2 negated (2): no workspace', () => assert.deepEqual(v8([api, web([dep('typo:X')])]), ['INFO V8 externalUnloaded']));
  test('§V8a2 negated (3): a listed namespace that is not loaded', () => assert.deepEqual(v8([api, web([dep('sdk:X')])], ['api', 'web', 'sdk']), ['INFO V8 externalUnloaded']));
  test('§V8a2 negated (4): excused by the referring plan\'s externalRefs', () => {
    assert.deepEqual(v8([api, web([dep('typo:X')], { externalRefs: [{ id: 'typo:X' }] })], ['api', 'web']), ['INFO V8 externalUnloaded']);
  });
  const claim = (from: string, to: string, extra: Partial<PlanFile> = {}) => P([G('web', null), I('W1', 'web')], { namespace: 'web', claims: [{ from, to }], ...extra });
  test('§V8a3 met: a claim endpoint in an unknown namespace, one finding listing every such endpoint', () => {
    const f = run([api, claim('typo:X', 'other:Y')], { workspace: ['api', 'web'] }).findings.filter((x) => x.code === 'V8');
    assert.deepEqual(ids(f), ['ERROR V8 claimUnknownNamespace']);
    assert.match(f[0].message, /references typo:X, other:Y,/);
  });
  test('§V8a3 negated (2): no workspace', () => assert.deepEqual(v8([api, claim('typo:X', 'W1')]), ['INFO V9 claimUnloaded']));
  test('§V8a3 negated (4): excused', () => assert.deepEqual(v8([api, claim('typo:X', 'W1', { externalRefs: [{ id: 'typo:X' }] })], ['api', 'web']), ['INFO V9 claimUnloaded']));
  test('§V8a4 met: an unloaded target', () => assert.deepEqual(v8([web([dep('sdk:S1')])]), ['INFO V8 externalUnloaded']));
  test('§V8a4 negated (2): a resolved target', () => assert.deepEqual(v8([api, web([dep('api:A1')])]), []));
  const local = (deps: ReturnType<typeof dep>[]) => P([G('R', null), G('S', 'R'), I('a', 'S'), G('T', 'R'), I('b', 'T', deps), I('c', 'T')]);
  test('§V8b met: a crossing declaration without citation', () => assert.deepEqual(v8([local([dep('a', 'hard', false)])]), ['ERROR V8 depCitation']));
  test('§V8b negated (2): a declaration between siblings does not cross', () => assert.deepEqual(v8([local([dep('c', 'hard', false)])]), []));
  test('§V8b negated (3): a cited crossing declaration', () => assert.deepEqual(v8([local([dep('a')])]), []));
  test('§V8b met: a cross-file declaration between two roots', () => {
    assert.deepEqual(v8([api, P([G('web', null, [dep('api:api', 'hard', false)]), I('W1', 'web')], { namespace: 'web' })]), ['ERROR V8 depCitation']);
  });
  test('§V8b unit: one finding per declaration, however many edges it binds', () => {
    const p = P([G('R', null), G('S', 'R'), I('a1', 'S'), I('a2', 'S'), G('Q', 'R'), G('T', 'Q', [dep('S', 'hard', false)]), I('b1', 'T'), I('b2', 'T')]);
    assert.equal(run([p]).model!.edges.length, 4);
    assert.deepEqual(v8([p]), ['ERROR V8 depCitation']);
  });
  test('§V8 competition: V8a2 displaces V8a4', () => assert.deepEqual(v8([api, web([dep('typo:X')])], ['api', 'web']), ['ERROR V8 unknownNamespace']));
  test('§V8 competition: V8a1 displaces V8b', () => assert.deepEqual(v8([api, web([dep('api:gone', 'hard', false)])]), ['ERROR V8 missingExternalItem']));
  test('§V8 competition: V8a2 displaces V8b', () => assert.deepEqual(v8([api, web([dep('typo:X', 'hard', false)])], ['api', 'web']), ['ERROR V8 unknownNamespace']));
  test('§V8 competition: V8a4 does not displace V8b', () => assert.deepEqual(v8([web([dep('sdk:S1', 'hard', false)])]), ['INFO V8 externalUnloaded', 'ERROR V8 depCitation']));
  test('§V8 competition: §V6b displaces V8b', () => {
    assert.deepEqual(only(run([P([G('R', null), G('S', 'R'), I('a', 'S', [dep('R', 'order', false)])])]).findings, 'V8'), []);
  });
  test('§V8 competition: V8a3 displaces §V9a on the same claim', () => {
    assert.deepEqual(v8([api, claim('typo:X', 'api:gone')], ['api', 'web']), ['ERROR V8 claimUnknownNamespace']);
  });
  test('§V8 competition: V8a3 displaces §V9b when it names every unloaded endpoint', () => {
    assert.deepEqual(v8([api, claim('W1', 'typo:X')], ['api', 'web']), ['ERROR V8 claimUnknownNamespace']);
  });
  test('§V8 competition: V8a3 does not displace §V9b when another endpoint is unloaded', () => {
    assert.deepEqual(v8([api, claim('typo:X', 'sdk:Y')], ['api', 'web', 'sdk']), ['ERROR V8 claimUnknownNamespace', 'INFO V9 claimUnloaded']);
  });
});

describe('§V9 claims', () => {
  const api = (claims: PlanFile['claims'], status: 'open' | 'done' = 'open') => P([G('api', null), I('A1', 'api', undefined, { status })], { namespace: 'api', claims });
  const web = (deps: ReturnType<typeof dep>[] = [], status: 'open' | 'done' = 'open') => P([G('web', null), I('W1', 'web', deps, { status })], { namespace: 'web' });
  const v9 = (...plans: PlanFile[]) => only(run(plans).findings, 'V9', 'V11');
  test('§V9a met: a missing endpoint', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:gone' }]), web()), ['ERROR V9 claimMissingNode']));
  test('§V9a met: a loaded plan with no nodes still makes its endpoints missing', () => {
    assert.deepEqual(v9(api([{ from: 'A1', to: 'empty:X' }]), P([], { namespace: 'empty' })), ['ERROR V9 claimMissingNode']);
  });
  test('§V9a negated (2): both endpoints resolve', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }]), web([dep('api:A1')])), []));
  test('§V9b met: an unloaded endpoint', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }])), ['INFO V9 claimUnloaded']));
  test('§V9b negated (2): the other plan is loaded', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }]), web([dep('api:A1')])), []));
  test('§V9c met: the claim is unstated', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }]), web()), ['WARN V9 claimMissing']));
  test('§V9c negated (2): an unresolved endpoint (precondition)', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }])), ['INFO V9 claimUnloaded']));
  test('§V9c negated (3): the claim is agreed', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1', type: 'order' }]), web([dep('api:A1', 'order')])), []));
  test('§V9d met: a hard claim stated only by order', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1', type: 'hard' }]), web([dep('api:A1', 'order')])), ['WARN V9 claimType']));
  test('§V9d negated (3): an order claim is never stated with another type', () => assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1', type: 'order' }]), web()), ['WARN V9 claimMissing']));
  test('§V9 competition: V9a displaces V9b', () => assert.deepEqual(v9(api([{ from: 'api:gone', to: 'sdk:X' }])), ['ERROR V9 claimMissingNode']));
  test('§V9 competition: V9c is concurrent with §V11b', () => {
    assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }]), web([], 'done')), ['WARN V9 claimMissing', 'WARN V11 passedGate']);
  });
  test('§V9 competition: V9d is concurrent with §V11b', () => {
    assert.deepEqual(v9(api([{ from: 'A1', to: 'web:W1' }]), web([dep('api:A1', 'order')], 'done')), ['WARN V9 claimType', 'WARN V11 passedGate']);
  });
});

describe('§V10 change coupling', () => {
  const plan = (deps: ReturnType<typeof dep>[], moved = false) => P([G('R', null), G('S1', 'R'), I('a', 'S1'), I('a2', 'S1'),
    G('S2', 'R'), I('b', moved ? 'S1' : 'S2', deps), I('b2', 'S2')]);
  const at = (source?: string, type: 'hard' | 'order' = 'hard', id = 'a') => ({ id, type, ...(source ? { source, quote: 'q' } : {}) });
  const v10 = (before: PlanFile, after: PlanFile, changed: string[] = []) => checkCoupling(before, after, changed).map((f) => {
    const what = /^(Added|Removed|Dependency type changed)/.exec(f.message)![1];
    return `${what} ${/no source/.test(f.message) ? 'couplingNoSource' : 'couplingUnchanged'}`;
  });
  test('§V10a1 met: an added crossing declaration without source', () => assert.deepEqual(v10(plan([]), plan([at()])), ['Added couplingNoSource']));
  test('§V10a2 met: an added crossing declaration whose cited file did not change', () => assert.deepEqual(v10(plan([]), plan([at('docs/x.md §1')])), ['Added couplingUnchanged']));
  test('§V10a negated (3): an added declaration that does not cross', () => assert.deepEqual(v10(plan([]), plan([at(undefined, 'hard', 'b2')])), []));
  test('§V10a negated (4): the cited file changed (./ removed from the file part)', () => assert.deepEqual(v10(plan([]), plan([at('./docs/x.md §1')]), ['docs/x.md']), []));
  test('§V10b1 met: a removed crossing declaration without source', () => assert.deepEqual(v10(plan([at()]), plan([])), ['Removed couplingNoSource']));
  test('§V10b2 met: a removed crossing declaration whose old cited file did not change', () => assert.deepEqual(v10(plan([at('docs/x.md §1')]), plan([])), ['Removed couplingUnchanged']));
  test('§V10b negated (3): it did not cross in the old version', () => assert.deepEqual(v10(plan([at(undefined, 'hard', 'b2')]), plan([])), []));
  test('§V10b negated (4): the old cited file changed', () => assert.deepEqual(v10(plan([at('docs/x.md §1')]), plan([]), ['docs/x.md']), []));
  test('§V10c1 met: a retyped crossing pair without source', () => assert.deepEqual(v10(plan([at()]), plan([at(undefined, 'order')])), ['Dependency type changed couplingNoSource']));
  test('§V10c2 met: a retyped crossing pair whose cited file did not change', () => {
    assert.deepEqual(v10(plan([at('docs/x.md §1')]), plan([at('docs/x.md §1', 'order')])), ['Dependency type changed couplingUnchanged']);
  });
  test('§V10c negated (3): a retyped pair that crosses in neither version', () => assert.deepEqual(v10(plan([at(undefined, 'hard', 'b2')]), plan([at(undefined, 'order', 'b2')])), []));
  test('§V10c negated (4): the cited file changed', () => assert.deepEqual(v10(plan([at('docs/x.md §1')]), plan([at('docs/x.md §1', 'order')]), ['docs/x.md']), []));
  test('§V10c citation: the old source only when the pair crosses solely in the old version', () => {
    const f = checkCoupling(plan([at('docs/old.md §1')]), plan([at('docs/new.md §1', 'order')], true), ['docs/new.md']);
    assert.equal(f.length, 1);
    assert.match(f[0].message, /docs\/old\.md/);
    assert.deepEqual(checkCoupling(plan([at('docs/old.md §1')]), plan([at('docs/new.md §1', 'order')]), ['docs/new.md']), []);
  });
  test('§V10 competition: none; a retyped pair is neither an addition nor a removal, also when its source changes', () => {
    assert.deepEqual(v10(plan([at('docs/x.md §1')]), plan([at('docs/y.md §1', 'order')])), ['Dependency type changed couplingUnchanged']);
  });
  test('§V10 [decision] dropping hard beside order on one pair is a removal of the hard key', () => {
    assert.deepEqual(v10(plan([at('docs/x.md §1'), at('docs/x.md §1', 'order')]), plan([at('docs/x.md §1', 'order')])), ['Removed couplingUnchanged']);
  });
  test('§V10 departs from §G3.1: two entries with the same key count as one statement', () => {
    assert.deepEqual(v10(plan([at('docs/x.md §1'), at('docs/x.md §1')]), plan([at('docs/x.md §1')])), []);
  });
  test('§V10 crossing per §G7.4: <own ns>:<id> between siblings does not cross', () => {
    assert.deepEqual(v10(plan([]), plan([{ id: 'R:b2', type: 'hard' }])), []);
  });
});

describe('§V11 status against hard dependencies', () => {
  const v11 = (nodes: ReturnType<typeof I>[]) => only(run([P([G('R', null), ...nodes])]).findings, 'V11');
  const done = { status: 'done' as const };
  test('§V11a met: a done item whose hard prerequisite is open', () => assert.deepEqual(v11([I('a', 'R'), I('b', 'R', [dep('a')], done)]), ['WARN V11 staleStatus']));
  test('§V11a negated (2): an order dependency', () => assert.deepEqual(v11([I('a', 'R'), I('b', 'R', [dep('a', 'order')], done)]), []));
  test('§V11a negated (3): an unresolved prerequisite', () => assert.deepEqual(v11([I('b', 'R', [dep('x:Y')], done)]), []));
  test('§V11a negated (4): the waiting item is open', () => assert.deepEqual(v11([I('a', 'R'), I('b', 'R', [dep('a')])]), []));
  test('§V11a negated (5): the prerequisite is done', () => assert.deepEqual(v11([I('a', 'R', undefined, done), I('b', 'R', [dep('a')], done)]), []));
  test('§V11a unit: one finding per waiting node, covering all its declarations', () => {
    assert.deepEqual(v11([I('a', 'R'), I('c', 'R'), I('b', 'R', [dep('a'), dep('c')], done)]), ['WARN V11 staleStatus']);
  });
  const api = (claim: Partial<NonNullable<PlanFile['claims']>[number]>, a1: 'open' | 'done' = 'open') =>
    P([G('api', null), G('AG', 'api'), I('A1', 'AG', undefined, { status: a1 })], { namespace: 'api', claims: [{ from: 'A1', to: 'web:W', ...claim }] });
  const web = (w1: 'open' | 'done' = 'done') => P([G('web', null), G('W', 'web'), I('W1', 'W', undefined, { status: w1 }), I('W2', 'W')], { namespace: 'web' });
  const gate = (...plans: PlanFile[]) => only(run(plans).findings, 'V11');
  test('§V11b met: a hard claim whose F is open while T has a done item', () => {
    const f = run([api({ type: 'hard' }), web()]).findings.filter((x) => x.code === 'V11');
    assert.deepEqual(ids(f), ['WARN V11 passedGate']);
    assert.match(f[0].message, /has 1\/2 done items/);
  });
  test('§V11b met: an untyped claim is hard (§G9.1)', () => assert.deepEqual(gate(api({}), web()), ['WARN V11 passedGate']));
  test('§V11b negated (2): an order claim', () => assert.deepEqual(gate(api({ type: 'order' }), web()), []));
  test('§V11b negated (3): F unresolved', () => assert.deepEqual(gate(api({ from: 'sdk:X' }), web()), []));
  test('§V11b negated (4): F done', () => assert.deepEqual(gate(api({}, 'done'), web()), []));
  test('§V11b met (4): F a group, by derived status', () => assert.deepEqual(gate(api({ from: 'AG' }), web()), ['WARN V11 passedGate']));
  test('§V11b negated (5): T unresolved', () => assert.deepEqual(gate(api({ to: 'sdk:X' })), []));
  test('§V11b negated (6): no item under T is done', () => assert.deepEqual(gate(api({}), web('open')), []));
  test('§V11 competition: V11a and V11b are concurrent', () => {
    const w = P([G('web', null), G('W', 'web'), I('W1', 'W', [dep('api:A1')], { status: 'done' })], { namespace: 'web' });
    assert.deepEqual(gate(api({}), w), ['WARN V11 staleStatus', 'WARN V11 passedGate']);
  });
});

describe('§V12 release tag', () => {
  const v12 = (extra: Partial<ReturnType<typeof I>>) => only(run([P([G('R', null), I('r', 'R', undefined, extra)])]).findings, 'V12');
  test('§V12 met: a done release without tag', () => assert.deepEqual(v12({ kind: 'release', status: 'done' }), ['WARN V12 releaseNoTag']));
  test('§V12 negated (1): not a release', () => assert.deepEqual(v12({ status: 'done' }), []));
  test('§V12 negated (2): an open release', () => assert.deepEqual(v12({ kind: 'release' }), []));
  test('§V12 negated (3): a tag', () => assert.deepEqual(v12({ kind: 'release', status: 'done', tag: 'v1' }), []));
});

describe('§S status suggestions', () => {
  function repo(t: TestContext) {
    const { d } = dir(t);
    const git = (...args: string[]) => execFileSync('git', ['-C', d, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--quiet');
    const commit = (subject: string, file?: string, body?: string) => {
      if (file) {
        writeFileSync(join(d, file), subject);
        git('add', file);
      }
      execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : [])]);
    };
    commit('initial');
    git('tag', 'v1');
    return { d, commit };
  }
  const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, parent: null, status: 'open', source: 'plan.md §1', ...extra });
  const labels = (plan: unknown, d: string) => suggestStatus(plan, d).map((s) => `${s.id} ${s.suggest}`);
  test('§S DONE? met and negated: an open release whose tag resolves; not when done or when the tag is missing', (t) => {
    const { d } = repo(t);
    assert.deepEqual(labels({ nodes: [item('r1', { kind: 'release', tag: 'v1' }), item('r2', { kind: 'release', tag: 'v1', status: 'done' }), item('r3', { kind: 'release', tag: 'v9' })] }, d), ['r1 done']);
  });
  test('§S MISSING-TAG met and negated: a done release whose tag does not resolve; not when it resolves or the release is open', (t) => {
    const { d } = repo(t);
    assert.deepEqual(labels({ nodes: [item('r1', { kind: 'release', tag: 'v9', status: 'done' }), item('r2', { kind: 'release', tag: 'v1', status: 'done' }), item('r3', { kind: 'release', tag: 'v9' })] }, d), ['r1 missing-tag']);
  });
  test('§S CHECK (git, id) met and negated: an open item named where a commit says what it does; not done, not a short or numeric id', (t) => {
    const { d, commit } = repo(t);
    commit('A1 B2 7 X: work', 'code.txt');
    assert.deepEqual(labels({ nodes: [item('A1'), item('B2', { status: 'done' }), item('7'), item('X')] }, d), ['A1 check']);
  });
  test('§S CHECK (git, id) negated: a commit that changes only cited plan documents is planning', (t) => {
    const { d, commit } = repo(t);
    commit('A1 planned', 'plan.md');
    assert.deepEqual(labels({ nodes: [item('A1')] }, d), []);
  });
  test('§S CHECK (git, link) met and negated: an open item or group whose link a commit matches; not when done', (t) => {
    const { d, commit } = repo(t);
    commit('work (#5)', 'code.txt');
    const nodes = [{ id: 'grp', title: 'grp', parent: null, links: ['#5'] }, item('g1', { parent: 'grp' }), item('done1', { status: 'done', links: ['#5'] })];
    assert.deepEqual(labels({ nodes }, d), ['grp check']);
  });
  test('§S MENTION met and negated: an id only mid-sentence; a group is never matched by its id', (t) => {
    const { d, commit } = repo(t);
    commit('refactor', 'code.txt', 'so that A1 and grp can follow');
    const nodes = [item('A1'), { id: 'grp', title: 'grp', parent: null }, item('g1', { parent: 'grp' })];
    assert.deepEqual(labels({ nodes }, d), ['A1 mention']);
  });
  test('§S departs from §G1.1: a group whose id a commit names gets no suggestion without links', (t) => {
    const { d, commit } = repo(t);
    commit('grp: finish everything', 'code.txt');
    assert.deepEqual(labels({ nodes: [{ id: 'grp', title: 'grp', parent: null }, item('g1', { parent: 'grp' })] }, d), []);
  });
  test('§S reported ids follow §G2.4: an id equal to the namespace that is not the root is qualified', (t) => {
    const { d, commit } = repo(t);
    commit('api: land it', 'code.txt');
    const plan = { version: 1 as const, namespace: 'api', nodes: [{ id: 'top', title: 'top', parent: null }, item('api', { parent: 'top' })] };
    const out = suggestWorkspace([{ entry: { namespace: 'api', path: d, file: 'plan.json' }, plan: plan as PlanFile, file: join(d, 'plan.json') }]);
    assert.deepEqual(out.map((x) => `${x.id} ${x.suggest}`), ['api:api check']);
  });
  test('§S departs from §G2.4: in a workspace, commits are matched against the ids each plan writes; only reported ids are qualified', (t) => {
    const { d, commit } = repo(t);
    commit('A1: work', 'code.txt');
    const plan = { version: 1 as const, namespace: 'sdk', nodes: [{ id: 'sdk', title: 'sdk', parent: null }, item('A1', { parent: 'sdk' })] };
    const out = suggestWorkspace([{ entry: { namespace: 'sdk', path: d, file: 'plan.json' }, plan: plan as PlanFile, file: join(d, 'plan.json') }]);
    assert.deepEqual(out.map((x) => `${x.id} ${x.suggest}`), ['sdk:A1 check']);
  });
  test('§S competition: on a release, DONE? displaces the git CHECK and MENTION rows', (t) => {
    const { d, commit } = repo(t);
    commit('r1: ship', 'code.txt');
    assert.deepEqual(labels({ nodes: [item('r1', { kind: 'release', tag: 'v1' })] }, d), ['r1 done']);
  });
  test('§S competition: on a release without DONE? or MISSING-TAG, commit labels apply', (t) => {
    const { d, commit } = repo(t);
    commit('r1: ship', 'code.txt');
    assert.deepEqual(labels({ nodes: [item('r1', { kind: 'release' })] }, d), ['r1 check']);
  });
  test('§S competition: on one node, CHECK displaces MENTION', (t) => {
    const { d, commit } = repo(t);
    commit('refactor', 'a.txt', 'see how A1 fits');
    commit('A1: do it', 'b.txt');
    assert.deepEqual(labels({ nodes: [item('A1')] }, d), ['A1 check']);
  });
  const github = (world: Record<number, unknown>) => (query: string) => {
    const fields: Record<string, unknown> = {};
    for (const m of query.matchAll(/(t\d+): issueOrPullRequest\(number: (\d+)\)/g)) fields[m[1]] = world[Number(m[2])] ?? null;
    return { data: { r0: fields } };
  };
  const issue = (number: number, state: 'OPEN' | 'CLOSED') => ({ __typename: 'Issue', number, state, stateReason: state === 'CLOSED' ? 'COMPLETED' : null });
  const gh = (nodes: unknown[], world: Record<number, unknown>) => suggestFromGithub({ nodes }, 'o/r', { run: github(world) }).map((s) => `${s.id} ${s.suggest}`);
  test('§S CHECK (GitHub) met and negated: a link\'s state disagrees with the status; not when it agrees', () => {
    assert.deepEqual(gh([item('A', { links: ['#1'] }), item('B', { links: ['#2'] })], { 1: issue(1, 'CLOSED'), 2: issue(2, 'OPEN') }), ['A check']);
  });
  test('§S MISSING-LINK met and negated: GitHub cannot find a link; not when it can', () => {
    assert.deepEqual(gh([item('A', { links: ['#9'] }), item('B', { links: ['#2'] })], { 2: issue(2, 'OPEN') }), ['A missing-link']);
  });
  test('§S competition: GitHub CHECK and MISSING-LINK are concurrent', () => {
    assert.deepEqual(gh([item('A', { links: ['#1', '#9'] })], { 1: issue(1, 'CLOSED') }), ['A check', 'A missing-link']);
  });
});

describe('§V express departures and cite', () => {
  test('§V8b citation needs both source and quote (§G8.2)', () => {
    const p = (d: ReturnType<typeof dep>) => P([G('R', null), G('S', 'R'), I('a', 'S'), I('b', 'R', [d])]);
    assert.deepEqual(only(run([p({ id: 'a', type: 'hard', source: cite.source })]).findings, 'V8'), ['ERROR V8 depCitation']);
    assert.deepEqual(only(run([p(dep('a'))]).findings, 'V8'), []);
  });
});
