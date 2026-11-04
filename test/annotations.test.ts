import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { annotation, escapeData, escapeProperty } from '../src/annotations.ts';
import { G, I, P } from './rules-helpers.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function dir(t: TestContext) {
  const d = mkdtempSync(join(tmpdir(), 'plan-atlas-annotations-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const save = (file: string, content: unknown) => writeFileSync(join(d, file), typeof content === 'string' ? content : JSON.stringify(content));
  const cmd = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--annotations', 'out.txt'], { cwd: d, encoding: 'utf8', env: { ...process.env, PLAN_ATLAS_LANG: 'en' } });
    return { status: r.status, lines: readFileSync(join(d, 'out.txt'), 'utf8').split('\n').filter(Boolean) };
  };
  return { save, cmd };
}

test('GitHub escaping: %, CR and LF in data; also : and , in properties', () => {
  assert.equal(escapeData('50% a\r\nb: c, d'), '50%25 a%0D%0Ab: c, d');
  assert.equal(escapeProperty('dir/a:b,c%.json'), 'dir/a%3Ab%2Cc%25.json');
});

test('one annotation per ERROR and WARN, none for INFO', () => {
  assert.equal(annotation({ level: 'ERROR', code: 'V8', message: 'm' }, 'p.json'), '::error file=p.json,title=plan-atlas V8::m');
  assert.equal(annotation({ level: 'WARN', code: 'V9', message: 'm' }, 'p.json'), '::warning file=p.json,title=plan-atlas V9::m');
  assert.equal(annotation({ level: 'INFO', code: 'V7', message: 'm' }, 'p.json'), null);
});

test('check --annotations puts each finding on the plan file whose namespace holds the statement', (t) => {
  const { save, cmd } = dir(t);
  save('api.json', P([G('api', null), I('A1', 'api', undefined, { inferred: true })], { namespace: 'api' }));
  save('web.json', P([G('web', null), I('W1', 'web', [{ id: 'api:A1', type: 'hard' }]), I('W2', 'web', undefined, { kind: 'release', status: 'done' })], { namespace: 'web' }));
  const r = cmd('check', 'api.json', 'web.json');
  assert.equal(r.status, 1);
  assert.deepEqual(r.lines, [
    '::error file=web.json,title=plan-atlas V8::Cross-group dependency api:A1 → web:W1 needs a source and quote',
    '::warning file=web.json,title=plan-atlas V12::release web:W2 is marked done without a tag; git cannot confirm it',
  ]);
});

test('check --annotations puts a V0 finding on the file that caused it, and escapes file names and messages', (t) => {
  const { save, cmd } = dir(t);
  save('good.json', P([G('R', null), I('a', 'R')]));
  save('p,1.json', '{');
  assert.deepEqual(cmd('check', 'good.json', 'p,1.json').lines, ['::error file=p%2C1.json,title=plan-atlas V0::Invalid JSON in p,1.json: line 1, column 2']);
  save('p,1.json', P([G('R', null, undefined, { title: 'two\nlines', sources: ['x.md'] }), I('x%y', 'R', undefined, { source: 'y.md §1' })]));
  assert.deepEqual(cmd('check', 'p,1.json').lines, ['::error file=p%2C1.json,title=plan-atlas V3::x%25y: source y.md §1 is not in the plan files declared by "two%0Alines"']);
});

test('coupling --annotations puts its findings on the --after file', (t) => {
  const { save, cmd } = dir(t);
  const plan = (deps: { id: string; type: 'hard' }[]) => P([G('R', null), G('S', 'R'), I('a', 'S'), G('T', 'R'), I('b', 'T', deps)]);
  save('before.json', plan([{ id: 'a', type: 'hard' }]));
  save('after.json', plan([]));
  save('changed.txt', 'after.json\n');
  assert.deepEqual(cmd('coupling', '--before', 'before.json', '--after', 'after.json', '--changed', 'changed.txt').lines,
    ['::error file=after.json,title=plan-atlas V10::Removed cross-group dependency: a → b, but it has no source to check against the plan']);
});
