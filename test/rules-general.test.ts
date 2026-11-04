/**
 * Tests derived from docs/RULES.md §G, the general part: one per concept, per case-table row of
 * §G5 and per [decision]. Each name starts with the section it checks.
 */
import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';
import {
  agreement, atLeast, claimedPairs, crosses, excusedRef, filePart, hasVirtualRoot, idCounts, mergedId, namespaceOf, nested, ownRef,
  refState, representative, sourceMatches, tree, unknownRef,
} from '../src/semantics.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { mergePlans } from '../src/merge.ts';
import { readWorkspace } from '../src/workspace.ts';
import { ROOT_PAGE } from '../src/model.ts';
import type { PlanFile } from '../src/types.ts';
import { dep, G, I, ids, messageId, model, only, P, run } from './rules-helpers.ts';

const pairs = (m: ReturnType<typeof model>, filter: (e: ReturnType<typeof model>['edges'][number]) => boolean = () => true) =>
  m.edges.filter(filter).map((e) => [e.from, e.to, e.type, e.resolved]);

describe('§G1 node, item, group', () => {
  test('§G1.1 a node is a group exactly when some node names it as parent', () => {
    const t = tree([G('R', null), I('a', 'R'), I('b', null)]);
    assert.deepEqual([t.isGroup('R'), t.isGroup('a'), t.isGroup('b')], [true, false, false]);
    assert.deepEqual(t.items, ['a', 'b']);
  });
  test('§G1.3 under, leaves and nested include a node itself', () => {
    const t = tree([G('R', null), G('S', 'R'), I('a', 'S'), I('b', 'R')]);
    assert.ok(t.under('a', 'a') && t.under('a', 'S') && t.under('a', 'R') && !t.under('b', 'S'));
    assert.deepEqual(t.leaves('R'), ['a', 'b']);
    assert.ok(nested(t, 'a', 'a') && nested(t, 'S', 'a') && nested(t, 'a', 'R') && !nested(t, 'a', 'b'));
  });
  test('§G1 a parent loop does not hang the tree of a raw plan', () => {
    const t = tree([{ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' }]);
    assert.ok(t.path('x').length <= 2);
  });
});

describe('§G2 plan file, namespace, merged id', () => {
  test('§G2.2 namespace, else the single root, else plan', () => {
    assert.equal(namespaceOf(P([G('r', null)], { namespace: 'ns' })), 'ns');
    assert.equal(namespaceOf(P([G('r', null), I('a', 'r')])), 'r');
    assert.equal(namespaceOf(P([I('a', null), I('b', null)])), 'plan');
  });
  test('§G2.4 a root whose id equals its namespace keeps it; one file alone keeps its ids', () => {
    assert.equal(mergedId('ns', 'ns', true, true), 'ns');
    assert.equal(mergedId('ns', 'a', false, true), 'ns:a');
    assert.equal(mergedId('ns', 'a', false, false), 'a');
  });
  test('§G2.3-4 a non-root node whose id equals the namespace is qualified, and <ns>:<ns> names it', () => {
    const a = P([G('top', null), I('api', 'top')], { namespace: 'api' });
    const b = P([G('b', null), I('B1', 'b', [dep('api:api')])], { namespace: 'b' });
    const m = model(a, b);
    assert.ok(m.byId.has('api:api') && !m.byId.has('api'));
    assert.deepEqual(pairs(m), [['api:api', 'b:B1', 'hard', true]]);
  });
  test('§G2.4 one file alone resolves its own <ns>:<id> references to its unqualified ids', () => {
    const m = model(P([G('r', null), I('a', 'r'), I('b', 'r', [dep('r:a', 'hard', false)])]));
    assert.deepEqual(pairs(m), [['a', 'b', 'hard', true]]);
  });
  test('§G2.4 with qualified ids, source, sources and area keys get the prefix <ns>/', () => {
    const p = P([G('r', null, undefined, { sources: ['./plan.md'] }), I('a', 'r', undefined, { source: './plan.md §1', touches: ['x'] })], { namespace: 'r', areas: { x: 'X' } });
    const merged = mergePlans([p, P([I('z', null)], { namespace: 'z' })]).plan;
    const a = merged.nodes.find((n) => n.id === 'r:a')!;
    assert.deepEqual([a.source, a.touches, merged.nodes[0].sources, Object.keys(merged.areas!)], ['r/plan.md §1', ['r/x'], ['r/plan.md'], ['r/x']]);
  });
});

describe('§G10.1-2 workspace match', () => {
  test('§G10.1-2 a positional file matches an entry by its written namespace field, not by its root id', (t) => {
    const d = mkdtempSync(join(tmpdir(), 'plan-atlas-g10-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    const save = (file: string, content: unknown) => {
      mkdirSync(dirname(join(d, file)), { recursive: true });
      writeFileSync(join(d, file), JSON.stringify(content));
      return join(d, file);
    };
    const entryFile = save('sdk/plan.json', P([G('sdk', null), I('a', 'sdk')], { namespace: 'sdk' }));
    const ws = save('hub/ws.json', { version: 1, plans: [{ namespace: 'sdk', path: '../sdk', file: 'plan.json' }] });
    const bare = save('bare.json', P([G('sdk', null), I('b', 'sdk')]));
    const r = readWorkspace(ws, [bare]);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.entries.map((e) => [e.entry?.namespace ?? null, e.file!.replaceAll(sep, '/')]),
      [['sdk', entryFile.replaceAll(sep, '/')], [null, bare.replaceAll(sep, '/')]]);
    const named = save('named.json', P([G('sdk', null), I('b', 'sdk')], { namespace: 'sdk' }));
    assert.deepEqual(readWorkspace(ws, [named]).entries.map((e) => e.file!.replaceAll(sep, '/')), [named.replaceAll(sep, '/')]);
  });
  const ci = (t: TestContext, local: PlanFile) => {
    const d = mkdtempSync(join(tmpdir(), 'plan-atlas-g10-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    writeFileSync(join(d, 'ws.json'), JSON.stringify({ version: 1, plans: [
      { namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' }, { namespace: 'api', github: 'org/api', file: 'plans/api.json' },
    ] }));
    writeFileSync(join(d, 'copy.json'), JSON.stringify(local));
    const fetched: string[] = [];
    const r = readWorkspace(join(d, 'ws.json'), [join(d, 'copy.json')], { repository: 'org/sdk', repositoryRoot: d, run: (q) => {
      const data: Record<string, unknown> = {};
      [...q.matchAll(/(p\d+): repository\(owner: "org", name: "(\w+)"\)/g)].forEach(([, alias, ns]) => {
        fetched.push(ns);
        data[alias] = { defaultBranchRef: { name: 'main' }, base: { text: JSON.stringify(P([G(ns, null), I('x', ns)], { namespace: ns })) }, baseCommit: { oid: 'sha' } };
      });
      return { data };
    } });
    return { findings: r.findings.map((f) => messageId(f)), fetched, bound: r.entries.filter((e) => e.file).map((e) => e.entry?.namespace ?? null) };
  };
  test('§G10.2 in CI, a lone renamed plan without a namespace field binds to the repository\'s entry and reports V0.34', (t) => {
    // its root id is api, another entry's namespace; only the written field counts (§G10.1)
    const r = ci(t, P([G('api', null), I('a', 'api')]));
    assert.deepEqual(r.findings, ['workspaceNamespace']);
    assert.deepEqual(r.fetched, ['api']);
  });
  test('§G10.2 in CI, a lone plan whose written namespace belongs to a later entry is not taken by the repository\'s entry', (t) => {
    const r = ci(t, P([G('top', null), I('a', 'top')], { namespace: 'api' }));
    assert.deepEqual(r.findings, []);
    assert.deepEqual([r.fetched, r.bound], [['sdk'], ['api']]);
  });
  test('§G10.2 with a self set, self entries are read from the current directory and positional files are not matched', (t) => {
    const d = mkdtempSync(join(tmpdir(), 'plan-atlas-g10-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    mkdirSync(join(d, 'plans'));
    const local = P([G('sdk', null), I('a', 'sdk')], { namespace: 'sdk' });
    writeFileSync(join(d, 'plans/sdk.json'), JSON.stringify(P([G('sdk', null), I('b', 'sdk')], { namespace: 'sdk' })));
    writeFileSync(join(d, 'ws.json'), JSON.stringify({ version: 1, plans: [
      { namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' },
    ] }));
    writeFileSync(join(d, 'copy.json'), JSON.stringify(local));
    const r = readWorkspace(join(d, 'ws.json'), [join(d, 'copy.json')], { cwd: d, self: ['sdk'], repository: 'org/sdk', run: () => { throw new Error('fetched'); } });
    assert.deepEqual(r.findings, []);
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].self, true);
    assert.equal(r.entries[0].plan.nodes[1].id, 'b');
  });
});

describe('§G3 resolution, §G10.5 known and excused', () => {
  const scope = { has: (id: string) => id === 'a' || id === 'api:A1', loaded: ['web', 'api', 'empty'], listed: ['web', 'api', 'empty', 'sdk'] };
  test('§G3.4 resolved, missing (loaded or unqualified), unloaded', () => {
    assert.equal(refState('a', scope), 'resolved');
    assert.equal(refState('api:A9', scope), 'missing');
    assert.equal(refState('empty:X', scope), 'missing');
    assert.equal(refState('zz', scope), 'missing');
    assert.equal(refState('sdk:S1', scope), 'unloaded');
  });
  test('§G3.4 unknown: unloaded and, with a workspace, not listed', () => {
    assert.equal(unknownRef('sdk:S1', scope), false);
    assert.equal(unknownRef('typo:S1', scope), true);
    assert.equal(unknownRef('typo:S1', { ...scope, listed: undefined }), false);
  });
  test('§G10.5 excused: exactly in the referring plan\'s externalRefs', () => {
    const excused = new Map([['web', new Set(['typo:S1'])]]);
    assert.equal(excusedRef('typo:S1', 'web', { excused }), true);
    assert.equal(excusedRef('typo:S1', 'api', { excused }), false);
    assert.equal(excusedRef('typo:S2', 'web', { excused }), false);
  });
});

describe('§G4 dependency type', () => {
  test('§G4.3 σ or stronger: both types for order, hard only for hard', () => {
    assert.deepEqual([atLeast('hard', 'order'), atLeast('order', 'order'), atLeast('hard', 'hard'), atLeast('order', 'hard')], [true, true, true, false]);
  });
});

describe('§G5 binding of a declaration', () => {
  test('§G5 case item n, item t: (t, n)', () => {
    assert.deepEqual(pairs(model(P([G('R', null), I('a', 'R'), I('b', 'R', [dep('a')])]))), [['a', 'b', 'hard', true]]);
  });
  test('§G5 case item n, group t: (f, n) for each final item of t', () => {
    const m = model(P([G('R', null), G('T', 'R'), I('t1', 'T'), I('t2', 'T', [dep('t1')]), I('n', 'R', [dep('T')])]));
    assert.deepEqual(pairs(m, (e) => e.to === 'n'), [['t2', 'n', 'hard', true]]);
  });
  test('§G5 case group n, item t: (t, s) for each first item of n', () => {
    const m = model(P([G('R', null), G('N', 'R', [dep('x')]), I('n1', 'N'), I('n2', 'N', [dep('n1')]), I('x', 'R')]));
    assert.deepEqual(pairs(m, (e) => e.from === 'x'), [['x', 'n1', 'hard', true]]);
  });
  test('§G5 case group n, group t: final items of t to first items of n', () => {
    const m = model(P([G('R', null), G('T', 'R'), I('t1', 'T'), I('t2', 'T', [dep('t1')]), G('N', 'R', [dep('T')]), I('n1', 'N'), I('n2', 'N', [dep('n1')])]));
    assert.deepEqual(pairs(m, (e) => e.decl.node === 'N'), [['t2', 'n1', 'hard', true]]);
  });
  test('§G5 case sub-group S under G: binds on S and is an inner wait of every group above S', () => {
    const m = model(P([G('R', null), G('Gr', 'R'), G('S1', 'Gr'), I('s1', 'S1'), G('S2', 'Gr', [dep('S1')]), I('s2', 'S2')]));
    assert.deepEqual(pairs(m), [['s1', 's2', 'hard', true]]);
    assert.deepEqual([m.binder.firstItems('Gr', 'hard'), m.binder.finalItems('Gr', 'hard')], [['s1'], ['s2']]);
    assert.deepEqual([m.binder.firstItems('R', 'hard'), m.binder.finalItems('R', 'hard')], [['s1'], ['s2']]);
  });
  test('§G5 case cross-file: as above on merged ids; a group never spans files', () => {
    const api = P([G('api', null), I('A1', 'api'), I('A2', 'api', [dep('A1')])], { namespace: 'api' });
    const web = P([G('web', null, [dep('api:api')]), I('W1', 'web'), I('W2', 'web', [dep('W1')])], { namespace: 'web' });
    assert.deepEqual(pairs(model(api, web), (e) => e.decl.node === 'web'), [['api:A2', 'web:W1', 'hard', true]]);
  });
  test('§G5 case n and t nested: no edges', () => {
    const m = model(P([G('R', null), G('Gr', 'R'), I('a', 'Gr', [dep('Gr')]), I('b', 'R')]));
    assert.deepEqual(m.edges, []);
  });
  test('§G5 case t unloaded or missing: (t, s) for each s the source side binds, unresolved, never done', () => {
    const m = model(P([G('R', null), G('N', 'R', [dep('other:X')]), I('n1', 'N'), I('n2', 'N')]));
    assert.deepEqual(pairs(m), [['other:X', 'n1', 'hard', false], ['other:X', 'n2', 'hard', false]]);
    assert.deepEqual([m.state.get('n1'), m.state.get('n2')], ['blocked', 'blocked']);
  });
  test('§G5.1 [decision] paths through nodes outside g do not order the items of g', () => {
    // a → x → b leaves the group: inside Gr, a and b are independent
    const m = model(P([G('R', null), G('Gr', 'R'), I('a', 'Gr'), I('b', 'Gr', [dep('x')]), I('x', 'R', [dep('a')])]));
    assert.deepEqual([m.binder.firstItems('Gr', 'hard'), m.binder.finalItems('Gr', 'hard')], [['a', 'b'], ['a', 'b']]);
  });
  test('§G5.2-3 a loop is one component: G = {a, b, c}, a and b ordering each other, c independent', () => {
    const m = model(P([G('R', null), G('Gr', 'R'), I('a', 'Gr', [dep('b', 'order')]), I('b', 'Gr', [dep('a', 'order')]), I('c', 'Gr')]));
    assert.deepEqual(m.binder.finalItems('Gr', 'order'), ['a', 'b', 'c']);
    assert.deepEqual(m.binder.components('Gr', 'order').map((c) => [...c].sort()).sort(), [['a', 'b'], ['c']]);
  });
  test('§G5.2-3 a loop is not pruned from the final items: no false groupCycle when a dependency on the group closes a real loop', () => {
    const f = run([P([G('R', null), G('Gr', 'R'), I('a', 'Gr', [dep('b', 'order'), dep('X')]), I('b', 'Gr', [dep('a', 'order')]), I('c', 'Gr'),
      I('X', 'R', [dep('Gr', 'order')])])]).findings;
    // a ↔ b contradict each other, and X after the group contradicts a's hard wait on X: no grouping artifact
    assert.deepEqual(only(f, 'V6'), ['WARN V6 orderCycle', 'WARN V6 orderCycle', 'WARN V6 orderCycle']);
  });
  test('§G5.3 a loop followed by another component is first, not final', () => {
    const m = model(P([G('R', null), G('Gr', 'R'), I('a', 'Gr', [dep('b', 'order')]), I('b', 'Gr', [dep('a', 'order')]), I('c', 'Gr', [dep('b', 'order')])]));
    assert.deepEqual([m.binder.firstItems('Gr', 'order'), m.binder.finalItems('Gr', 'order')], [['a', 'b'], ['c']]);
  });
  test('§G5.3 a pruned loop never brings back items that follow it', () => {
    // a ↔ b and c after b; nothing outside: the final items are c alone, not every item
    const m = model(P([G('R', null), G('Gr', 'R'), I('a', 'Gr', [dep('b', 'order')]), I('b', 'Gr', [dep('a', 'order')]), I('c', 'Gr', [dep('a', 'order')])]));
    assert.deepEqual(m.binder.finalItems('Gr', 'order'), ['c']);
  });
  test('§G5.4 [decision] a hard binding counts only hard declarations inside g; an order binding counts both', () => {
    const m = model(P([G('R', null), G('Gr', 'R'), I('g1', 'Gr'), I('g2', 'Gr', [dep('g1', 'order')])]));
    assert.deepEqual([m.binder.finalItems('Gr', 'hard'), m.binder.finalItems('Gr', 'order')], [['g1', 'g2'], ['g2']]);
    const h = model(P([G('R', null), G('Gr', 'R'), I('g1', 'Gr'), I('g2', 'Gr', [dep('g1', 'hard')])]));
    assert.deepEqual([h.binder.finalItems('Gr', 'hard'), h.binder.finalItems('Gr', 'order')], [['g2'], ['g2']]);
  });
  test('§G5.5 lemma: every item is final or reaches a final item, and is first or is reached from one', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 25; round++) {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
      const nodes = [G('R', null), G('Gr', 'R'), G('S', 'Gr')];
      for (const [k, id] of ids.entries()) {
        const deps = ids.filter((x) => x !== id && rand() < 0.3).map((x) => dep(x, rand() < 0.5 ? 'hard' : 'order', false));
        nodes.push(I(id, k < 3 ? 'S' : 'Gr', deps));
      }
      const m = model(P(nodes));
      for (const g of ['Gr', 'S']) for (const sigma of ['hard', 'order'] as const) {
        const waits = m.binder.innerWaits(g, sigma);
        const reach = (from: string, goal: Set<string>, dir: 'down' | 'up') => {
          const seen = new Set([from]), queue = [from];
          for (let i = 0; i < queue.length; i++) {
            if (goal.has(queue[i])) return true;
            const next = dir === 'down' ? [...waits.get(queue[i])!] : [...waits].filter(([, js]) => js.has(queue[i])).map(([x]) => x);
            for (const y of next) if (!seen.has(y)) { seen.add(y); queue.push(y); }
          }
          return false;
        };
        const final = new Set(m.binder.finalItems(g, sigma)), first = new Set(m.binder.firstItems(g, sigma));
        // i waits on j: j comes first. Final items are waited on by nobody, so walk "up" to them.
        for (const i of m.leaves(g)) {
          assert.ok(reach(i, final, 'up'), `round ${round}: ${i} reaches no final item of ${g} (${sigma})`);
          assert.ok(reach(i, first, 'down'), `round ${round}: ${i} is reached from no first item of ${g} (${sigma})`);
        }
      }
    }
  });
});

describe('§G6 status', () => {
  test('§G6.1 a group is done exactly when every item under it is done', () => {
    const m = model(P([G('R', null), G('Gr', 'R'), I('a', 'Gr', undefined, { status: 'done' }), I('b', 'Gr', undefined, { status: 'done' }), I('c', 'R')]));
    assert.deepEqual([m.status('Gr'), m.status('R')], ['done', 'open']);
  });
  test('§G6.2 blocked by a hard edge from an open item; order edges never block', () => {
    const m = model(P([G('R', null), I('a', 'R'), I('b', 'R', [dep('a')]), I('c', 'R', [dep('a', 'order')]), I('d', 'R', [dep('e')]), I('e', 'R', undefined, { status: 'done' })]));
    assert.deepEqual(['b', 'c', 'd', 'e'].map((x) => m.state.get(x)), ['blocked', 'ready', 'ready', 'done']);
  });
  test('§G6.3 [decision] a rule asking for a group\'s status uses its derived status (§V11b)', () => {
    const api = P([G('api', null), G('AG', 'api'), I('A1', 'AG')], { namespace: 'api', claims: [{ from: 'AG', to: 'web:W1' }] });
    const web = P([G('web', null), I('W1', 'web', [dep('api:AG')], { status: 'done' })], { namespace: 'web' });
    assert.deepEqual(only(run([api, web]).findings, 'V11'), ['WARN V11 staleStatus', 'WARN V11 passedGate']);
  });
});

describe('§G7 crossing', () => {
  const m = model(P([G('R', null), G('S', 'R'), I('a', 'S'), I('b', 'S'), I('c', 'R'), I('top', null)]));
  const ns = () => 'plan';
  test('§G7.1 siblings never cross, including two roots of one file', () => {
    assert.equal(crosses({ node: 'b', target: 'a' }, m, ns), false);
    assert.equal(crosses({ node: 'top', target: 'R' }, m, ns), false);
    assert.equal(crosses({ node: 'c', target: 'a' }, m, ns), true);
  });
  test('§G7.2 a target in another namespace crosses, resolved or not', () => {
    assert.equal(crosses({ node: 'b', target: 'other:X' }, m, ns), true);
    const two = model(P([G('api', null), I('A1', 'api')], { namespace: 'api' }), P([G('web', null, [dep('api:api')]), I('W1', 'web')], { namespace: 'web' }));
    assert.equal(crosses({ node: 'web', target: 'api' }, two, two.scope.nsOf), true);
  });
  test('§G7.3 a missing target in the declaration\'s own file cannot be judged', () => {
    assert.equal(crosses({ node: 'b', target: 'plan:gone' }, m, ns), undefined);
  });
  test('§G7.4 [decision] <own ns>:<id> inside its own file is the node <id>, for crossing too', () => {
    assert.equal(ownRef('R:a', 'R', (x) => x === 'a'), 'a');
    assert.equal(ownRef('R:gone', 'R', (x) => x === 'a'), 'R:gone');
    const r = run([P([G('R', null), I('a', 'R'), I('b', 'R', [dep('R:a', 'hard', false)])])]);
    assert.deepEqual(only(r.findings, 'V8'), []);
  });
});

describe('§G8 citation, file part, precondition', () => {
  test('§G8.2 the file part is the text before the first whitespace, without a leading ./', () => {
    assert.deepEqual([filePart('./docs/a.md §2'), filePart('docs/a.md'), filePart('docs/a.md\t§1')], ['docs/a.md', 'docs/a.md', 'docs/a.md']);
  });
  test('§G8.2 a source matches a listed file by its file part or by prefix', () => {
    assert.ok(sourceMatches('./docs/a.md §2', 'docs/a.md'));
    assert.ok(sourceMatches('docs/plans/a.md §2', 'docs/plans/'));
    assert.ok(!sourceMatches('docs/b.md §2', 'docs/a.md'));
  });
  test('§G8.5 a V0 error stops the run before merging: no V8 after duplicateNamespace', () => {
    const a = P([G('x', null), I('a', 'x', [dep('gone:Y', 'hard', false)])], { namespace: 'x' });
    const r = run([a, structuredClone(a)]);
    assert.deepEqual(ids(r.findings), ['ERROR V0 duplicateNamespace']);
  });
});

describe('§G9 claim and agreement', () => {
  const api = (claim: Record<string, unknown>) => P([G('api', null), I('A1', 'api'), I('A2', 'api')], { namespace: 'api', claims: [{ from: 'A1', to: 'web:W', ...claim } as never] });
  const web = (nodes: ReturnType<typeof I>[]) => P([G('web', null), G('W', 'web'), ...nodes], { namespace: 'web' });
  test('§G9.1 [decision] a claim without type is hard', () => {
    const r = run([api({}), web([I('W1', 'W', [dep('api:A1', 'order')])])]);
    assert.deepEqual(only(r.findings, 'V9'), ['WARN V9 claimType']);
  });
  test('§G9.2 claimed pairs: final items of F by first items of T', () => {
    const m = model(api({}), web([I('W1', 'W'), I('W2', 'W', [dep('W1')])]));
    assert.deepEqual(claimedPairs(m.binder, 'api:A1', 'web:W', 'hard'), [['api:A1', 'web:W1']]);
    assert.equal(agreement(m.binder, m.reach, { from: 'api:A1', to: 'web:W' }), 'unstated');
  });
  test('§G9.2 claimed pairs are exactly the edges the declaration would bind: nested endpoints have none', () => {
    const p = P([G('R', null), G('Gr', 'R'), I('a', 'Gr'), I('b', 'Gr', [dep('a', 'order')])], { claims: [{ from: 'Gr', to: 'Gr', type: 'order' }] });
    const m = model(p);
    assert.deepEqual(claimedPairs(m.binder, 'Gr', 'Gr', 'order'), []);
    assert.deepEqual(only(run([p]).findings, 'V9'), []);
  });
  test('§G9.4 agreed when every claimed pair is reached at strength τ, through any path', () => {
    const r = run([api({ type: 'hard' }), web([I('Wx', 'web', [dep('api:A1')]), I('W1', 'W', [dep('Wx')]), I('W2', 'W', [dep('W1')])])]);
    assert.deepEqual(only(r.findings, 'V9'), []);
  });
  test('§G9.7 [decision] a hard claim met by hard on one first item and order on another is stated with another type', () => {
    const r = run([api({ type: 'hard' }), web([I('W1', 'W', [dep('api:A1', 'hard')]), I('W2', 'W', [dep('api:A1', 'order')])])]);
    assert.deepEqual(only(r.findings, 'V9'), ['WARN V9 claimType']);
  });
  test('§G9.7 [decision] a declaration on one child of T does not agree with a claim on T that has other first items', () => {
    const r = run([api({ type: 'hard' }), web([I('W1', 'W', [dep('api:A1')]), I('W2', 'W')])]);
    assert.deepEqual(only(r.findings, 'V9'), ['WARN V9 claimMissing']);
  });
  test('§G9.7 [decision] a declaration at any level of either plan counts when it makes T wait', () => {
    const r = run([api({ type: 'hard' }), P([G('web', null, [dep('api:api')]), G('W', 'web'), I('W1', 'W')], { namespace: 'web' })]);
    assert.deepEqual(only(r.findings, 'V9'), []);
  });
  test('§G9.8 [decision] a hard declaration agrees with an order claim', () => {
    const r = run([api({ type: 'order' }), web([I('W1', 'W', [dep('api:A1', 'hard')])])]);
    assert.deepEqual(only(r.findings, 'V9'), []);
  });
});

describe('§G11 page, representative, overlap', () => {
  test('§G11.1 a virtual top page when there are several roots or the only root is an item', () => {
    assert.equal(hasVirtualRoot(tree([G('R', null), I('a', 'R')])), false);
    assert.equal(hasVirtualRoot(tree([I('a', null)])), true);
    assert.equal(hasVirtualRoot(tree([G('R', null), I('a', 'R'), I('b', null)])), true);
  });
  test('§G11.2 representatives: the child under g, a stub below the common ancestor, the stub of an unresolved item, the root on top', () => {
    const t = tree([G('R', null), G('A', 'R'), G('A1', 'A'), I('x', 'A1'), G('B', 'R'), I('y', 'B')]);
    assert.deepEqual(representative(t, 'x', 'A'), { node: 'A1', inside: true });
    assert.deepEqual(representative(t, 'x', 'B'), { node: 'A', inside: false });
    assert.deepEqual(representative(t, 'other:Z', 'B'), { node: 'other:Z', inside: false });
    assert.deepEqual(representative(t, 'x', null), { node: 'R', inside: true });
  });
  test('§G11.3 page edges map to representatives, drop same-representative edges and count item pairs', () => {
    const m = model(P([G('R', null), G('A', 'R'), I('a1', 'A'), I('a2', 'A', [dep('a1')]), G('B', 'R', [dep('A')]), I('b1', 'B'), I('b2', 'B')]));
    assert.deepEqual(m.pages.get('R')!.edges.map((e) => [e.from, e.to, e.kind, e.items.length]), [['A', 'B', 'hard', 2]]);
    assert.deepEqual(m.pages.get('B')!.nodes.map((n) => n.id), ['b1', 'b2', '@A']);
    assert.ok(!m.pages.has(ROOT_PAGE));
  });
  test('§G11.4 open items overlap in a shared area only when neither reaches the other', () => {
    const nodes = [G('R', null), I('a', 'R', undefined, { kind: 'move', touches: ['x'] }), I('b', 'R', undefined, { touches: ['x', 'y'] }), I('c', 'R', [dep('a', 'order')], { touches: ['x'] })];
    const m = model(P(nodes, { areas: { x: 'X', y: 'Y' }, rules: { overlaps: [{ id: 'r', a: { kind: 'move' }, b: {} }] } }));
    assert.deepEqual(m.overlaps.map((o) => [o.a, o.b, o.area]), [['a', 'b', 'x']]);
  });
});

describe('§S [decision]', () => {
  test('§S [decision] an id counts for commit matching with at least two characters, not all digits', () => {
    assert.deepEqual(['A', '12', 'A1', 'W2b'].map(idCounts), [false, false, true, true]);
  });
});
