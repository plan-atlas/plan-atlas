import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { confineFiles, parseJson } from '../src/files.ts';
import { loadFiles, readWorkspace } from '../src/index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'src/cli.ts');
const privateText = '[core]\nsecret = abc';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(root, '.plan-atlas-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = join(dir, 'workspace');
  mkdirSync(base);
  const save = (file: string, content: string) => {
    const path = join(dir, file);
    writeFileSync(path, content);
    return path;
  };
  const valid = save('workspace/plan.json', '{"version":1,"nodes":[]}');
  const bad = save('workspace/bad.json', privateText);
  return { dir, base, save, valid, bad };
}

function run(args: string[], confined?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PLAN_ATLAS_LANG: 'en' };
  delete env.PLAN_ATLAS_CONFINE;
  if (confined !== undefined) env.PLAN_ATLAS_CONFINE = confined;
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env });
  if (r.error) throw r.error;
  return r;
}

function symlink(t: TestContext, target: string, link: string, type: 'file' | 'dir' = 'file'): boolean {
  try { symlinkSync(target, link, type); return true; }
  catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(code ?? '')) throw err;
    t.skip(`Cannot create symlinks on this platform (${code}); Windows may require Developer Mode or privilege`);
    return false;
  }
}

test('file syntax errors give only the filename and location in both languages', (t) => {
  const { bad } = fixture(t);
  for (const lang of ['en', 'zh-TW'] as const) {
    // §V0.2: an input file that is not valid JSON is a V0 finding
    const r = loadFiles([bad], undefined, lang);
    assert.equal(r.model, null);
    assert.deepEqual(r.findings.map((f) => [f.level, f.code]), [['ERROR', 'V0']]);
    const message = r.findings[0].message;
    assert.ok(message.includes(bad));
    assert.doesNotMatch(message, /core|secret|abc/);
    assert.match(message, lang === 'en' ? /line 1, column 2/ : /第 1 行，第 2 欄/);
  }
  for (const [content, line, column] of [
    ['{\n  "x": 1,\n}', 3, 1], ['{\n  "x":', 2, 7], ['{\n  "x": nope}', 2, 9],
    ['[\r\n  true false]', 2, 8], ['[\r  true false]', 2, 8],
    ['[null, "unterminated', 1, 21], ['[1e', 1, 4], ['position 999', 1, 1],
  ] as const) {
    assert.throws(() => parseJson(content, 'bad.json', 'en'), new RegExp(`line ${line}, column ${column}$`));
  }
});

test('read errors expose only the filename and filesystem error code', (t) => {
  const { dir } = fixture(t);
  const missing = join(dir, 'missing.json');
  // §V0.1: an input file that cannot be read is a V0 finding
  assert.deepEqual(loadFiles([missing]).findings, [{ level: 'ERROR', code: 'V0', message: `Cannot read ${missing}: ENOENT`, file: missing }]);
  assert.deepEqual(loadFiles([missing], undefined, 'zh-TW').findings.map((f) => f.message), [`無法讀取 ${missing}：ENOENT`]);
});

test('workspace files, positional replacements, local entries and remote blobs keep file bytes private', (t) => {
  const { save, bad } = fixture(t);
  const empty = save('empty.workspace.json', '{"version":1,"plans":[]}');
  const local = save('local.workspace.json', JSON.stringify({ version: 1, plans: [
    { namespace: 'sdk', path: 'workspace', file: 'bad.json' },
  ] }));
  const remote = save('remote.workspace.json', JSON.stringify({ version: 1, plans: [
    { namespace: 'sdk', github: 'org/sdk', file: 'plan.json' },
  ] }));
  for (const lang of ['en', 'zh-TW'] as const) {
    const results = [
      readWorkspace(bad, [], { lang }), readWorkspace(empty, [bad], { lang }),
      readWorkspace(local, [], { lang }), readWorkspace(remote, [], { lang, run: () => ({ data: {
        p0: { defaultBranchRef: { name: 'main' }, base: { text: privateText }, baseCommit: { oid: 'sha' } },
      } }) }),
    ];
    for (const result of results) {
      assert.equal(result.findings.length, 1);
      const message = result.findings[0].message;
      assert.doesNotMatch(message, /core|secret|abc/);
      assert.match(message, lang === 'en' ? /line 1, column 2/ : /第 1 行，第 2 欄/);
      assert.match(message, /\.json/);
    }
  }
});

test('CLI plan, workspace, status, coupling and against reads never print JSON excerpts', (t) => {
  const { save, bad, valid } = fixture(t);
  const workspace = save('empty.workspace.json', '{"version":1,"plans":[]}');
  const changed = save('changed.txt', '');
  const cases = [
    ['check', bad], ['build', bad], ['check', valid, '--against', bad],
    ['check', '--workspace', bad], ['check', '--workspace', workspace, bad],
    ['check', '--workspace', workspace, '--against', bad],
    ['status', '--git', '.', bad], ['status', '--github', 'org/sdk', bad],
    ['coupling', '--before', bad, '--after', valid, '--changed', changed],
    ['coupling', '--before', valid, '--after', bad, '--changed', changed],
  ];
  for (const lang of ['en', 'zh-TW']) for (const args of cases) {
    const r = run([...args, '--lang', lang]);
    // §V0.1-3: commands that report findings report the file; status --git/--github exits 2
    assert.equal(r.status, args[0] === 'status' ? 2 : 1, r.stderr);
    const output = r.stdout + r.stderr;
    assert.doesNotMatch(output, /core|secret|abc/);
    assert.ok(output.includes(bad.replace(/\\/g, '/')) || output.includes(bad));
    assert.match(output, lang === 'en' ? /line 1, column 2/ : /第 1 行，第 2 欄/);
  }
});

test('confinement accepts regular in-root files and rejects escapes, sibling prefixes and directories', (t) => {
  const { dir, base, valid, save } = fixture(t);
  const outside = save('outside.json', privateText);
  mkdirSync(join(dir, 'workspace-other'));
  const sibling = save('workspace-other/plan.json', privateText);
  assert.doesNotThrow(() => confineFiles([valid], base, 'en'));
  assert.equal(run(['check', valid], base).status, 0);
  assert.equal(run(['check', valid]).status, 0);
  for (const file of [outside, sibling, base]) {
    assert.throws(() => confineFiles([file], base, 'en'), /must be a regular file/);
    // §V0.3: a confined input is a V0 finding
    const r = run(['check', file], base);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /ERROR V0 .*must be a regular file/);
    assert.doesNotMatch(r.stdout + r.stderr, /core|secret|abc/);
  }
  // A pre-existing outside file is still readable without the opt-in environment.
  assert.match(run(['check', outside]).stdout, /ERROR V0 .*Invalid JSON/);
});

test('confinement covers every CLI input option before reading it', (t) => {
  const { base, valid, save } = fixture(t);
  const outside = save('outside.json', privateText);
  for (const args of [
    ['check', valid, '--against', outside], ['check', '--workspace', outside],
    ['status', '--git', '.', outside], ['status', '--workspace', outside],
    ['coupling', '--before', outside, '--after', valid, '--changed', '-'],
    ['coupling', '--before', valid, '--after', outside, '--changed', '-'],
    ['coupling', '--before', valid, '--after', valid, '--changed', outside],
  ]) {
    const r = run(args, base);
    assert.equal(r.status, args.includes('--git') ? 2 : 1, r.stderr);
    assert.match(r.stdout + r.stderr, /must be a regular file/);
    assert.doesNotMatch(r.stdout + r.stderr, /core|secret|abc/);
  }
});

test('confinement covers workspace path entries, and allow-missing does not lift it', (t) => {
  const { base, save } = fixture(t);
  save('outside.json', privateText);
  const workspace = save('workspace/outside.workspace.json', JSON.stringify({ version: 1, plans: [
    { namespace: 'sdk', path: '..', file: 'outside.json' },
  ] }));
  for (const args of [['check', '--workspace', workspace], ['check', '--workspace', workspace, '--allow-missing'],
    ['status', '--workspace', workspace, '--allow-missing']]) {
    const r = run(args, base);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /ERROR V0 .*must be a regular file/);
    assert.doesNotMatch(r.stdout + r.stderr, /core|secret|abc/);
  }
});

test('confinement rejects file symlinks even when their target is inside the root', (t) => {
  const { base, valid } = fixture(t);
  const link = join(base, 'link.json');
  if (!symlink(t, valid, link)) return;
  assert.throws(() => confineFiles([link], base, 'en'), /not a symlink/);
  assert.equal(run(['check', link], base).status, 1);
});

test('confinement resolves parent symlinks before checking the root boundary', (t) => {
  const { dir, base, save } = fixture(t);
  mkdirSync(join(dir, 'outside'));
  save('outside/plan.json', privateText);
  const link = join(base, 'escape');
  if (!symlink(t, join(dir, 'outside'), link, 'dir')) return;
  const r = run(['check', join(link, 'plan.json')], base);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /must be a regular file/);
  assert.doesNotMatch(r.stdout + r.stderr, /core|secret|abc/);
});
