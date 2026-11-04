import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const posix = { skip: process.platform === 'win32' ? 'The Action supports Linux runners; Bash integration needs POSIX paths' : false };

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(root, '.plan-atlas-action-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'plan.json'), '{"version":1,"nodes":[]}');
  writeFileSync(join(dir, 'outside.json'), '[core]\nsecret = abc');
  const summary = join(dir, 'summary.md');
  const run = (extra: NodeJS.ProcessEnv = {}) => {
    writeFileSync(summary, '');
    const result = spawnSync('bash', [join(root, 'action/run.sh')], { cwd: workspace, encoding: 'utf8', env: {
      ...process.env, GITHUB_ACTION_PATH: root, GITHUB_WORKSPACE: workspace, GITHUB_STEP_SUMMARY: summary,
      PA_PLANS: '*.json', PA_AGAINST: '', PA_COUPLING: 'false', PA_STATUS: 'none', PA_FAIL_ON: 'error',
      PLAN_ATLAS_LANG: 'en', ...extra,
    } });
    if (result.error) throw result.error;
    return { ...result, summary: readFileSync(summary, 'utf8') };
  };
  return { dir, workspace, run };
}

test('Action accepts workspace files and confines the CLI against input too', posix, (t) => {
  const { run } = fixture(t);
  assert.equal(run().status, 0);
  assert.equal(run({ GITHUB_WORKSPACE: '' }).status, 0);
  const r = run({ PA_AGAINST: '../outside.json' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /must be a regular file/);
  assert.doesNotMatch(r.stdout + r.summary, /core|secret/);
});

test('Action rejects every non-regular or outside glob match with its pattern and exit 2', posix, (t) => {
  const { dir, workspace, run } = fixture(t);
  mkdirSync(join(workspace, 'directory.json'));
  mkdirSync(join(dir, 'workspace-other'));
  writeFileSync(join(dir, 'workspace-other/plan.json'), '{}');
  for (const pattern of ['*.json', '../outside.json', '../workspace-other/*.json', 'missing*.json']) {
    const r = run({ PA_PLANS: pattern });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stdout.includes(pattern));
    assert.match(r.summary, /could not run/);
    assert.doesNotMatch(r.stdout + r.summary, /core|secret/);
  }
});

test('Action rejects symlinks and resolved parent escapes', posix, (t) => {
  const { dir, workspace, run } = fixture(t);
  try { symlinkSync(join(workspace, 'plan.json'), join(workspace, 'link.json')); }
  catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(code ?? '')) throw err;
    t.skip(`Cannot create symlinks on this platform (${code}); symlink privilege is required`);
    return;
  }
  symlinkSync(dir, join(workspace, 'escape'), 'dir');
  for (const pattern of ['*.json', 'escape/outside.json']) {
    const r = run({ PA_PLANS: pattern });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stdout.includes(pattern));
  }
});

test('Action die strips CR and LF from annotations and summary messages', posix, (t) => {
  const { run } = fixture(t);
  for (const key of ['PA_FAIL_ON', 'PA_STATUS', 'PA_COUPLING', 'PA_PLANS']) {
    const r = run({ [key]: 'bad\r\n::warning::injected' });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout.trimEnd().split('\n').length, 1);
    assert.doesNotMatch(r.stdout + r.summary, /\r|\n::warning::/);
    assert.match(r.stdout, /^::error::plan-atlas:/);
    assert.equal(r.summary.trimEnd().split('\n').length, 3);
  }
});

test('Action final error is a single annotation without CR or LF in its values', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'plan.json'), 'null');
  const r = run();
  assert.equal(r.status, 1);
  assert.equal(r.stdout.split('\n').filter((line) => line.startsWith('::error::')).length, 1);
  assert.match(r.stdout, /::error::plan-atlas failed: 1 error\(s\), 0 warning\(s\) \(fail-on: error\)\n$/);
  assert.doesNotMatch(r.stdout, /\r/);
});

test('Action reads every line of a multi-line plans input', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'other.json'), 'null');
  const r = run({ PA_PLANS: 'plan.json\nother.json\n' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.summary, /Plan files: `plan.json` `other.json` /);
});

test('Action counts an unreadable --against file as one V0 error (§V0.1)', posix, (t) => {
  const { run } = fixture(t);
  const r = run({ PA_AGAINST: 'missing.json' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.summary, /ERROR V0\s+Cannot read missing\.json/);
  assert.match(r.stdout, /::error::plan-atlas failed: 1 error\(s\), 0 warning\(s\)/);
});

test('Action counts findings printed in Traditional Chinese', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'plan.json'), 'null');
  const r = run({ PLAN_ATLAS_LANG: 'zh-TW' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /個錯誤/);
  assert.match(r.stdout, /::error::plan-atlas failed: 1 error\(s\), 0 warning\(s\)/);
});

test('Action escapes file names and inputs in workflow command lines', posix, (t) => {
  const { workspace, run } = fixture(t);
  // workflow commands outside a stop-commands region, where they would take effect
  const live = (stdout: string) => {
    let stop = '';
    return stdout.split('\n').filter((line) => {
      if (stop) {
        if (line === `::${stop}::`) stop = '';
        return false;
      }
      const m = /^::stop-commands::(.+)$/.exec(line);
      if (m) stop = m[1];
      return line.startsWith('::');
    });
  };
  // annotations are ours, with file and message escaped; an injected command would start a line of its own
  const forged = (r: { stdout: string }) => live(r.stdout).filter((line) => /forged/.test(line) && !/^::(group|error)::plan-atlas/.test(line) && !/^::(error|warning) file=/.test(line));
  const against = run({ PA_AGAINST: 'x\n::error::forged%0A.json' });
  assert.deepEqual(forged(against), []);
  assert.ok(live(against.stdout).some((line) => line.includes('x%0A::error::forged%250A.json')));
  writeFileSync(join(workspace, 'x\n::error::forged.json'), '{"version":1,"nodes":[]}');
  const named = run();
  assert.deepEqual(forged(named), []);
});

test('action.yml reports by default: fail-on accepts error, warn or none, and defaults to none', () => {
  const yml = readFileSync(join(root, 'action.yml'), 'utf8');
  const input = yml.split(/\r?\n/).slice(yml.split(/\r?\n/).indexOf('  fail-on:'), yml.split(/\r?\n/).indexOf('  fail-on:') + 4);
  for (const value of [/\bnone\b/, /\berror\b/, /\bwarn\b/]) assert.match(input[1], value);
  assert.equal(input[3], '    default: none');
});

test('Action with fail-on none reports ERRORs as annotations and passes the job', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'plan.json'), 'null');
  const r = run({ PA_FAIL_ON: 'none' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^::error file=plan\.json,title=plan-atlas V0::File is not a JSON object$/m);
  assert.doesNotMatch(r.stdout, /^::error::plan-atlas/m);
  assert.match(r.summary, /^## plan-atlas reported: 1 error\(s\)/m);
});

test('Action with fail-on error still fails on an ERROR, and fail-on warn on a WARN', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'plan.json'), 'null');
  assert.equal(run({ PA_FAIL_ON: 'error' }).status, 1);
  writeFileSync(join(workspace, 'plan.json'), JSON.stringify({ version: 1, nodes: [
    { id: 'R', title: 'R', parent: null }, { id: 'r1', title: 'r1', parent: 'R', status: 'done', kind: 'release', source: 'plan.md §1' },
  ] }));
  const warn = run({ PA_FAIL_ON: 'warn' });
  assert.equal(warn.status, 1);
  assert.match(warn.stdout, /^::warning file=plan\.json,title=plan-atlas V12::release r1 is marked done without a tag/m);
  assert.equal(run({ PA_FAIL_ON: 'error' }).status, 0);
});

test('Action fails when the tool could not run (exit code 2), even with fail-on none', posix, (t) => {
  const { run } = fixture(t);
  const r = run({ PA_FAIL_ON: 'none', PA_PLANS: 'missing*.json' });
  assert.equal(r.status, 2);
});

test('Action annotations escape the file property and the message', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'p,1.json'), JSON.stringify({ version: 1, nodes: [
    { id: 'R', title: `two${String.fromCharCode(10)}lines`, parent: null, sources: ['x.md'] }, { id: 'x%y', title: 'x', parent: 'R', status: 'open', source: 'y.md §1' },
  ] }));
  const r = run({ PA_FAIL_ON: 'none', PA_PLANS: 'p,1.json' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^::error file=p%2C1\.json,title=plan-atlas V3::x%25y: source y\.md §1 is not in the plan files declared by "two%0Alines"$/m);
});
