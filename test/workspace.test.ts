import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { load, loadWorkspace, readWorkspace, renderHtml, suggestWorkspace, type PlanFile } from '../src/index.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const slash = (p: string) => p.replace(/\\/g, '/');
const item = (id: string, parent: string) => ({ id, title: id, parent, status: 'open' as const, source: 'plan.md §1' });
const plan = (namespace: string): PlanFile => ({ version: 1, namespace, nodes: [
  { id: namespace, title: namespace, parent: null, sources: ['plan.md'] }, item('X1', namespace),
] });

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-atlas-workspace-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const save = (file: string, data: unknown) => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
    return path;
  };
  const workspace = (plans: unknown[]) => save('hub/plan-atlas.workspace.json', { version: 1, plans });
  return { dir, save, workspace };
}

const remote = (namespace: string, ref?: string) => ({ namespace, github: `org/${namespace}`, file: `plans/${namespace}.json`, ...(ref ? { ref } : {}) });
const blob = (p: unknown) => ({ text: JSON.stringify(p) });
const reply = (p: unknown, ref = 'main', sha = '0123456789abcdef') => ({ defaultBranchRef: { name: ref }, base: blob(p), baseCommit: { oid: sha } });
const noFetch = () => { throw new Error('unexpected fetch'); };
const runCliLang = (lang: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, PLAN_ATLAS_LANG: lang } });
  if (result.error) throw result.error;
  return result;
};
const runCli = (...args: string[]) => runCliLang('en', ...args);

test('workspace path entries resolve from the workspace directory and normalize Windows separators', (t) => {
  const { dir, save, workspace } = fixture(t);
  save('sdk/plans/sdk.json', plan('sdk'));
  const file = workspace([{ namespace: 'sdk', path: '..\\sdk', file: 'plans\\sdk.json' }]);
  const loaded = loadWorkspace(file, [], { run: noFetch });
  assert.deepEqual(loaded.findings, []);
  assert.equal(loaded.entries[0].file, slash(join(dir, 'sdk/plans/sdk.json')));
  assert.equal(loaded.entries[0].entry!.path, slash(join(dir, 'sdk')));
  assert.ok(loaded.model!.byId.has('sdk:X1'));
});

test('positional plans replace covered namespaces before fetching, including path entries', (t) => {
  const { save, workspace } = fixture(t);
  const local = save('local.json', plan('sdk'));
  const file = workspace([remote('sdk'), remote('api')]);
  const queries: string[] = [];
  const loaded = loadWorkspace(file, [local], { run: (q) => {
    queries.push(q);
    assert.doesNotMatch(q, /name: "sdk"/);
    return { data: { p0: reply(plan('api')) } };
  } });
  assert.deepEqual(loaded.findings, []);
  assert.equal(queries.length, 1);
  assert.equal(loaded.entries[0].file, slash(local));
  const allLocal = loadWorkspace(workspace([remote('sdk')]), [local], { run: noFetch });
  assert.deepEqual(allLocal.findings, []);
  assert.ok(allLocal.model);
  const pathLocal = loadWorkspace(workspace([{ namespace: 'sdk', path: '../missing', file: 'plan.json' }]), [local], { run: noFetch });
  assert.deepEqual(pathLocal.findings, []);
});

test('local files are parsed before fetching; duplicate local namespaces still fail', (t) => {
  const { save, workspace } = fixture(t);
  const file = workspace([remote('sdk')]);
  const malformed = save('bad.json', null);
  assert.equal(loadWorkspace(file, [malformed], { run: noFetch }).findings[0].level, 'ERROR');
  const a = save('a.json', plan('sdk')), b = save('b.json', plan('sdk'));
  const loaded = loadWorkspace(file, [a, b], { run: noFetch });
  assert.equal(loaded.model, null);
  assert.match(loaded.findings[0].message, /same namespace/);
});

test('in CI, a single positional plan of another workspace entry binds to that entry, not to the current repository', (t) => {
  const { dir, save, workspace } = fixture(t);
  const api = save('api.json', plan('api'));
  for (const entries of [[remote('sdk'), remote('api')], [remote('api'), remote('sdk')]]) {
    const queries: string[] = [];
    const loaded = loadWorkspace(workspace(entries), [api], { repository: 'org/sdk', repositoryRoot: dir, run: (q) => {
      queries.push(q);
      return { data: { p0: reply(plan('sdk')) } };
    } });
    assert.deepEqual(loaded.findings, []);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /name: "sdk"/);
    assert.equal(loaded.entries.find((e) => e.entry?.namespace === 'api')!.file, slash(api));
  }
});

test('allow-missing downgrades only unreadable entries, never invalid JSON', (t) => {
  const { dir, workspace } = fixture(t);
  mkdirSync(join(dir, 'sdk'));
  writeFileSync(join(dir, 'sdk/plan.json'), '{"version": 1,');
  const path = loadWorkspace(workspace([{ namespace: 'sdk', path: '../sdk', file: 'plan.json' }]), [], { allowMissing: true, run: noFetch });
  assert.deepEqual(path.findings.map((f) => [f.level, f.code]), [['ERROR', 'V0']]);
  assert.match(path.findings[0].message, /Invalid JSON/);
  const fetched = loadWorkspace(workspace([remote('sdk')]), [], { allowMissing: true, run: () => ({ data: { p0: { ...reply(plan('sdk')), base: { text: '{"version": 1,' } } } }) });
  assert.deepEqual(fetched.findings.map((f) => [f.level, f.code]), [['ERROR', 'V0']]);
  assert.match(fetched.findings[0].message, /Invalid JSON/);
});

test('with a confinement root, path entries outside it are ERROR even with allow-missing', (t) => {
  const { dir, save, workspace } = fixture(t);
  save('sdk/plans/sdk.json', plan('sdk'));
  const file = workspace([{ namespace: 'sdk', path: '../sdk', file: 'plans/sdk.json' }]);
  assert.deepEqual(loadWorkspace(file, [], { run: noFetch, confine: dir }).findings, []);
  const outside = loadWorkspace(file, [], { run: noFetch, allowMissing: true, confine: join(dir, 'hub') });
  assert.deepEqual(outside.findings.map((f) => [f.level, f.code]), [['ERROR', 'V0']]);
  assert.match(outside.findings[0].message, /must be a regular file/);
  const missing = loadWorkspace(workspace([{ namespace: 'sdk', path: '.', file: 'missing.json' }]), [], { run: noFetch, allowMissing: true, confine: join(dir, 'hub') });
  assert.deepEqual(missing.findings.map((f) => f.level), ['WARN']);
});

test('namespace mismatches stay ERROR even with allow-missing, including CI renames', (t) => {
  const { dir, save, workspace } = fixture(t);
  const wrong = plan('renamed');
  const local = save('plans/sdk.json', wrong);
  const file = workspace([remote('sdk')]);
  const ci = loadWorkspace(file, [local], { run: noFetch, allowMissing: true, repository: 'org/sdk', repositoryRoot: dir });
  assert.equal(ci.model, null);
  assert.ok(ci.findings.some((f) => f.level === 'ERROR' && /namespace sdk does not match file namespace renamed/.test(f.message)));
  const copied = save('temporary-copy.json', wrong);
  assert.equal(loadWorkspace(file, [copied], { run: noFetch, repository: 'org/sdk', repositoryRoot: dir }).findings[0].level, 'ERROR');
  for (const lang of ['en', 'zh-TW'] as const) {
    const fetched = loadWorkspace(file, [], { lang, allowMissing: true, run: () => ({ data: { p0: reply(wrong) } }) });
    assert.equal(fetched.findings[0].level, 'ERROR');
    if (lang === 'zh-TW') assert.match(fetched.findings[0].message, /工作區 namespace/);
  }
  const path = workspace([{ namespace: 'sdk', path: '..', file: 'plans/sdk.json' }]);
  assert.equal(loadWorkspace(path, [], { allowMissing: true }).findings[0].level, 'ERROR');
  const missingNs = plan('sdk');
  delete missingNs.namespace;
  assert.equal(loadWorkspace(file, [], { run: () => ({ data: { p0: reply(missingNs) } }) }).findings[0].level, 'ERROR');
});

test('one GraphQL batch reads head branches or falls back to ref/default, retaining exact SHAs', (t) => {
  const { workspace } = fixture(t);
  const entries = [remote('sdk', 'release/1'), remote('api', 'v1.0.0'), remote('web'), remote('sha', 'abc123')];
  const queries: string[] = [];
  const loaded = loadWorkspace(workspace(entries), [], { headRef: 'feature/same', run: (q) => {
    queries.push(q);
    return { data: {
      p0: { ...reply(plan('sdk')), headRef: { name: 'feature/same', target: { oid: 'head-sha' } }, head: blob(plan('sdk')) },
      p1: { ...reply(plan('api')), baseCommit: { target: { oid: 'tag-sha' } }, headRef: null },
      p2: reply(plan('web'), 'trunk', 'default-sha'),
      p3: reply(plan('sha'), 'main', 'abc123'),
    } };
  } });
  assert.deepEqual(loaded.findings, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /qualifiedName: "refs\/heads\/feature\/same"/);
  assert.match(queries[0], /object\(expression: "refs\/heads\/feature\/same:plans\/sdk.json"\)/);
  assert.match(queries[0], /object\(expression: "v1.0.0:plans\/api.json"\)/);
  assert.match(queries[0], /object\(expression: "HEAD:plans\/web.json"\)/);
  assert.match(queries[0], /object\(expression: "abc123:plans\/sha.json"\)/);
  assert.match(queries[0], /on Commit \{ oid \}/);
  assert.deepEqual(loaded.entries.map((e) => [e.ref, e.sha]), [
    ['feature/same', 'head-sha'], ['v1.0.0', 'tag-sha'], ['trunk', 'default-sha'], ['abc123', 'abc123'],
  ]);
});

test('an existing head branch without the file is unreadable, without fallback', (t) => {
  const { workspace } = fixture(t);
  const loaded = loadWorkspace(workspace([remote('sdk', 'main')]), [], { headRef: 'feature', run: () => ({ data: {
    p0: { ...reply(plan('sdk')), headRef: { name: 'feature', target: { oid: 'head-sha' } }, head: null },
  } }) });
  assert.equal(loaded.model, null);
  assert.equal(loaded.findings[0].level, 'ERROR');
});

test('unreadable entries are ERROR or WARN; partial GraphQL data still loads readable plans', (t) => {
  const { workspace } = fixture(t);
  const file = workspace([remote('sdk'), remote('api'), { namespace: 'web', path: '../missing', file: 'plan.json' }]);
  for (const allowMissing of [false, true]) {
    const loaded = loadWorkspace(file, [], { allowMissing, run: () => ({ data: { p0: reply(plan('sdk')), p1: null }, errors: [{ message: 'not found' }] }) });
    assert.equal(loaded.entries.length, 1);
    assert.deepEqual(loaded.findings.map((f) => f.level), [allowMissing ? 'WARN' : 'ERROR', allowMissing ? 'WARN' : 'ERROR']);
    assert.match(loaded.findings[1].message, /not found/);
    assert.equal(!!loaded.model, allowMissing);
  }
  for (const run of [() => { throw new Error('offline'); }, () => ({ errors: [{ message: 'denied' }] }), () => ({ data: { p0: { base: blob(plan('sdk')) } } })]) {
    const loaded = loadWorkspace(workspace([remote('sdk')]), [], { allowMissing: true, run });
    assert.equal(loaded.findings[0].level, 'WARN');
    assert.equal(loaded.entries.length, 0);
  }
  const missing = readWorkspace(file + '.missing', [], { allowMissing: true, run: noFetch });
  assert.equal(missing.findings[0].level, 'ERROR');
});

test('GitHub links are qualified in the merged model and clickable, without mutating status inputs', (t) => {
  const { workspace } = fixture(t);
  const p = plan('sdk');
  p.nodes[0].links = ['#1'];
  p.nodes[1].links = ['#2', 'other/repo#3', 'branch:work/sdk'];
  const original = structuredClone(p);
  const loaded = loadWorkspace(workspace([remote('sdk')]), [], { run: () => ({ data: { p0: reply(p) } }) });
  assert.deepEqual(loaded.model!.byId.get('sdk')!.links, ['org/sdk#1']);
  assert.deepEqual(loaded.model!.byId.get('sdk:X1')!.links, ['org/sdk#2', 'other/repo#3', 'branch:work/sdk']);
  assert.match(renderHtml(loaded.model!, loaded.findings), /https:\/\/github.com\/org\/sdk\/issues\/2/);
  assert.deepEqual(loaded.entries[0].plan.nodes[1].links, p.nodes[1].links);
  assert.deepEqual(p, original);
});

test('workspace unknown namespaces are V8 ERROR; externalRefs are scoped and unloaded registered plans stay INFO', (t) => {
  const { save, workspace } = fixture(t);
  const p = plan('sdk');
  p.nodes[1].dependsOn = [{ id: 'skd:X', type: 'hard', source: 'plan.md §1', quote: 'requires X' }];
  assert.equal(load([p]).findings.find((f) => f.code === 'V8')!.level, 'INFO');
  const file = workspace([remote('sdk')]);
  const local = save('sdk.json', p);
  const loaded = loadWorkspace(file, [local], { run: noFetch });
  assert.equal(loaded.findings.find((f) => f.code === 'V8')!.level, 'ERROR');
  p.externalRefs = [{ id: 'skd:X', meaning: 'external service' }];
  save('sdk.json', p);
  assert.equal(loadWorkspace(file, [local], { run: noFetch }).findings.find((f) => f.code === 'V8')!.level, 'INFO');
  const other = plan('api');
  other.nodes[1].dependsOn = p.nodes[1].dependsOn;
  const a = save('api.json', other);
  const scoped = loadWorkspace(workspace([remote('sdk'), remote('api')]), [local, a], { run: noFetch });
  assert.deepEqual(scoped.findings.filter((f) => f.code === 'V8').map((f) => f.level), ['INFO', 'ERROR']);
  p.nodes[1].dependsOn![0].id = 'api:X1';
  save('sdk.json', p);
  const missing = loadWorkspace(workspace([remote('sdk'), remote('api')]), [local], { allowMissing: true, run: () => ({ data: { p0: null } }) });
  assert.deepEqual(missing.findings.filter((f) => f.code === 'V8').map((f) => f.level), ['INFO']);
});

test('CLI help and argument validation include workspace options in both languages', () => {
  for (const lang of ['en', 'zh-TW']) {
    const r = runCliLang(lang, '--help');
    assert.match(r.stdout, /--workspace/);
    assert.match(r.stdout, /--head-ref/);
    assert.match(r.stdout, /--allow-missing/);
    if (lang === 'zh-TW') assert.match(r.stdout, /工作區/);
  }
  for (const args of [['check', '--head-ref', 'x'], ['build', '--allow-missing'],
    ['status', '--workspace', 'x', '--git', '.'], ['status', '--workspace', 'x', '--github', 'a/b'],
    ['status', '--workspace', 'x', '--ref', 'main'], ['coupling', '--workspace', 'x']]) {
    const r = runCli(...args);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /workspace/);
  }
});

test('workspace registry also checks claim namespaces, with explicit externalRefs exceptions', (t) => {
  const { save, workspace } = fixture(t);
  const p = plan('sdk');
  p.claims = [{ from: 'X1', to: 'typo:X' }];
  const file = workspace([remote('sdk')]);
  const local = save('sdk.json', p);
  assert.ok(loadWorkspace(file, [local], { run: noFetch }).findings.some((f) => f.code === 'V8' && f.level === 'ERROR'));
  p.externalRefs = [{ id: 'typo:X' }];
  save('sdk.json', p);
  assert.deepEqual(loadWorkspace(file, [local], { run: noFetch }).findings.map((f) => [f.code, f.level]), [['V9', 'INFO']]);
});

test('CLI unreadable path entries obey allow-missing and local replacement', (t) => {
  const { save, workspace } = fixture(t);
  const file = workspace([{ namespace: 'sdk', path: '../missing', file: 'plan.json' }]);
  const missing = runCli('check', '--workspace', file);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stdout, /ERROR V0/);
  const allowed = runCliLang('zh-TW', 'check', '--workspace', file, '--allow-missing');
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /WARN\s+V0\s+無法讀取工作區項目/);
  const local = save('sdk.json', plan('sdk'));
  assert.equal(runCli('check', '--workspace', file, local).status, 0);
});

test('three git repositories: build/status, a deleted dependency (V8), and a routing claim (V9)', (t) => {
  const { dir, save, workspace } = fixture(t);
  const sdk = plan('sdk'), api = plan('api'), web = plan('web');
  sdk.nodes[1] = { ...item('sdk@1.0.0', 'sdk'), kind: 'release', tag: 'v1.0.0' };
  api.nodes[1] = item('A1', 'api');
  api.nodes.push({ ...item('A2', 'api'), dependsOn: [{ id: 'sdk:sdk@1.0.0', type: 'hard', source: 'plan.md §1', quote: 'requires sdk 1.0.0' }] });
  web.nodes[1] = { ...item('W1', 'web'), dependsOn: [{ id: 'api:A2', type: 'hard', source: 'plan.md §1', quote: 'requires api A2' }] };
  const plans = { sdk, api, web };
  for (const [ns, p] of Object.entries(plans)) {
    save(`${ns}/plans/${ns}.json`, p);
    const git = (...args: string[]) => execFileSync('git', ['-C', join(dir, ns), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '--quiet');
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-m', ns === 'api' ? 'A2 implementation' : ns === 'web' ? 'W1 implementation' : 'initial');
    if (ns === 'sdk') git('tag', 'v1.0.0');
  }
  const file = workspace(Object.keys(plans).map((namespace) => ({ namespace, path: `../${namespace}`, file: `plans/${namespace}.json` })));
  const checked = runCli('check', '--workspace', file);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const out = join(dir, 'atlas');
  const built = runCli('build', '--workspace', file, '--out', out);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  for (const ext of ['json', 'md', 'drawio', 'html']) assert.ok(readFileSync(join(out, `atlas.${ext}`), 'utf8').length);
  const status = runCli('status', '--workspace', file, '--json');
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(JSON.parse(status.stdout).map((s: { id: string; suggest: string }) => [s.id, s.suggest]), [
    ['sdk:sdk@1.0.0', 'done'], ['api:A2', 'check'], ['web:W1', 'check'],
  ]);
  const textStatus = runCli('status', '--workspace', file);
  assert.equal(textStatus.status, 0, textStatus.stderr);
  assert.match(textStatus.stdout, /3 suggestion\(s\)/);
  // Mixed GitHub/git status preserves each plan's raw ids for evidence matching.
  const loaded = readWorkspace(file);
  loaded.entries[1].entry = remote('api');
  api.nodes[2].links = ['#5'];
  loaded.entries[1].plan = api;
  let queries = 0;
  const mixed = suggestWorkspace(loaded.entries, { run: (q) => {
    queries++;
    assert.match(q, /name: "api"/);
    return { data: { r0: { t0: { __typename: 'Issue', number: 5, state: 'CLOSED', stateReason: 'COMPLETED' } } } };
  } });
  assert.equal(queries, 1);
  assert.deepEqual(mixed.map((s) => [s.id, s.suggest]), [['sdk:sdk@1.0.0', 'done'], ['api:A2', 'check'], ['web:W1', 'check']]);
  api.nodes = api.nodes.filter((n) => n.id !== 'A2');
  save('api/plans/api.json', api);
  const deleted = runCli('check', '--workspace', file);
  assert.equal(deleted.status, 1, deleted.stdout + deleted.stderr);
  assert.match(deleted.stdout, /ERROR V8\s+web:W1 depends on api:A2/);
  api.nodes.push(item('A2', 'api'));
  api.claims = [{ from: 'A1', to: 'web:web', type: 'hard', source: 'plan.md §2', quote: 'web routes wait for A1' }];
  save('api/plans/api.json', api);
  const claim = runCli('check', '--workspace', file);
  assert.equal(claim.status, 0, claim.stdout + claim.stderr);
  assert.match(claim.stdout, /WARN\s+V9\s+Plans disagree: api:A1/);
});
