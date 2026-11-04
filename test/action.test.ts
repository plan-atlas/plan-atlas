import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
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
      PA_PLANS: '*.json', PA_WORKSPACE: '', PA_SELF: '', PA_NO_SECRETS: '', PA_DEFAULT_BRANCH: '',
      PA_AGAINST: '', PA_COUPLING: 'false', PA_STATUS: 'none', PA_FAIL_ON: 'error',
      PLAN_ATLAS_LANG: 'en', ...extra,
    } });
    if (result.error) throw result.error;
    return { ...result, summary: readFileSync(summary, 'utf8') };
  };
  return { dir, workspace, run };
}

/** A gh on PATH that records its arguments and prints canned JSON. */
function installGh(dir: string, json: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'gh.log');
  const canned = join(dir, 'gh.json');
  writeFileSync(canned, json);
  const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" >> ${quote(log)}\ncat ${quote(canned)}\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { bin, log };
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

test('action.yml accepts workspace and self, and plans is optional', () => {
  const yml = readFileSync(join(root, 'action.yml'), 'utf8');
  assert.match(yml, /plans:\n    description:.*\n    required: false/);
  assert.match(yml, /workspace:\n    description:.*\n    required: false\n    default: ''/);
  assert.match(yml, /self:\n    description:.*\n    required: false\n    default: ''/);
  for (const name of ['PA_WORKSPACE', 'PA_SELF', 'PA_NO_SECRETS', 'PA_DEFAULT_BRANCH']) assert.match(yml, new RegExp(`${name}:`));
});

const sdkPlan = {
  version: 1, namespace: 'sdk',
  nodes: [
    { id: 'sdk', title: 'sdk', parent: null, sources: ['plan.md'] },
    { id: 'X1', title: 'X1', parent: 'sdk', status: 'open', source: 'plan.md §1' },
  ],
};

test('Action workspace check runs once, annotates the self file, and defaults to --self-repo', posix, (t) => {
  const { dir, workspace, run } = fixture(t);
  const { bin, log } = installGh(dir, '{}');
  writeFileSync(join(workspace, 'plan.json'), JSON.stringify({
    ...sdkPlan,
    nodes: [
      sdkPlan.nodes[0],
      { id: 'X1', title: 'X1', parent: 'sdk', status: 'open' },
    ],
  }));
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({
    version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plan.json' }],
  }));
  const r = run({
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    PA_WORKSPACE: 'ws.json', PA_PLANS: '', GITHUB_REPOSITORY: 'org/sdk',
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const groups = r.stdout.split('\n').filter((line) => line.startsWith('::group::'));
  assert.equal(groups.length, 1);
  assert.match(groups[0], /--workspace ws\.json/);
  assert.match(groups[0], /--self-repo org\/sdk/);
  assert.doesNotMatch(groups[0], /--self( |$)/);
  const annotations = r.stdout.split('\n').filter((line) => line.startsWith('::error file=') || line.startsWith('::warning file='));
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /^::error file=plan\.json,title=plan-atlas V3::/);
  assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '');
});

test('Action rejects a bad self value, plans that miss the self file, and pull_request_target', posix, (t) => {
  const { workspace, run } = fixture(t);
  const bad = run({ PA_WORKSPACE: 'ws.json', PA_SELF: 'sdk!', PA_PLANS: '' });
  assert.equal(bad.status, 2, bad.stderr);
  assert.match(bad.stdout, /self: 'sdk!' must contain only letters, digits, dots, underscores and hyphens/);
  const target = run({ PA_WORKSPACE: 'ws.json', PA_PLANS: '', GITHUB_EVENT_NAME: 'pull_request_target' });
  assert.equal(target.status, 2, target.stderr);
  assert.match(target.stdout, /pull_request_target is rejected with a workspace/);
  assert.match(target.stdout, /secrets/);
  mkdirSync(join(workspace, 'plans'));
  writeFileSync(join(workspace, 'plans/sdk.json'), JSON.stringify(sdkPlan));
  writeFileSync(join(workspace, 'other.json'), '{"version":1,"nodes":[]}');
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({
    version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' }],
  }));
  const uncovered = run({ PA_WORKSPACE: 'ws.json', PA_PLANS: 'other.json', GITHUB_REPOSITORY: 'org/sdk' });
  assert.equal(uncovered.status, 2, uncovered.stdout + uncovered.stderr);
  assert.match(uncovered.stdout, /self file 'plans\/sdk\.json' is not among the plans matches/);
  assert.match(uncovered.stdout, /::group::/);
  assert.match(uncovered.summary, /could not run/);
});

test('PA_NO_SECRETS passes --allow-missing, so an unreadable remote entry is a warning', posix, (t) => {
  const { dir, workspace, run } = fixture(t);
  const canned = JSON.stringify({ data: { p0: { defaultBranchRef: { name: 'main' } } }, errors: [{ message: 'not found' }] });
  const { bin, log } = installGh(dir, canned);
  mkdirSync(join(workspace, 'plans'));
  writeFileSync(join(workspace, 'plans/sdk.json'), JSON.stringify(sdkPlan));
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({ version: 1, plans: [
    { namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' },
    { namespace: 'api', github: 'org/api', file: 'plans/api.json' },
  ] }));
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    PA_WORKSPACE: 'ws.json', PA_PLANS: '', GITHUB_REPOSITORY: 'org/sdk',
  };
  const open = run({ ...env, PA_NO_SECRETS: 'true' });
  assert.equal(open.status, 0, open.stdout + open.stderr);
  assert.match(open.stdout, /--allow-missing/);
  assert.match(open.stdout, /WARN\s+V0/);
  assert.match(open.stdout, /^::warning file=ws\.json,title=plan-atlas V0::/m);
  assert.doesNotMatch(open.stdout, /^::error file=/m);
  assert.match(readFileSync(log, 'utf8'), /plans\/api\.json/);
  assert.doesNotMatch(readFileSync(log, 'utf8'), /plans\/sdk\.json/);
  const closed = run(env);
  assert.equal(closed.status, 1, closed.stdout + closed.stderr);
  assert.doesNotMatch(closed.stdout, /--allow-missing/);
  assert.match(closed.stdout, /^::error file=ws\.json,title=plan-atlas V0::/m);
});

test('Action falls back to plans when a github workspace cannot be read', posix, (t) => {
  const { dir, run } = fixture(t);
  const { bin } = installGh(dir, JSON.stringify({ data: { repository: null }, errors: [{ message: 'not found' }] }));
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    PA_WORKSPACE: 'github:org/sdk:plans/workspace.json',
    PA_NO_SECRETS: 'true', PA_PLANS: 'plan.json', GITHUB_REPOSITORY: 'org/sdk',
  };
  const r = run(env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const groups = r.stdout.split('\n').filter((line) => line.startsWith('::group::'));
  assert.equal(groups.length, 2);
  assert.match(groups[0], /--allow-missing/);
  assert.match(groups[0], /github:org\/sdk:plans\/workspace\.json/);
  assert.match(groups[1], /check plan\.json/);
  assert.match(r.summary, /No workspace was loaded \(see the findings above\); the plans files are checked on their own\./);
  const ungated = run({ ...env, PA_NO_SECRETS: '' });
  assert.match(ungated.summary, /No workspace was loaded \(see the findings above\); the plans files are checked on their own\./);
  assert.match(ungated.stdout, /check plan\.json/);
  assert.match(r.stdout, /WARN\s+V0/);
  assert.doesNotMatch(r.stdout, /^::(?:error|warning) file=/m);
  const none = run({ ...env, PA_PLANS: '' });
  assert.equal(none.status, 0, none.stdout + none.stderr);
  assert.equal(none.stdout.split('\n').filter((line) => line.startsWith('::group::')).length, 1);
  assert.match(none.summary, /No plan file of this repository was read\./);
});

test('Action notes a workspace file changed in the pull request', posix, (t) => {
  const { workspace, run } = fixture(t);
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--quiet');
  writeFileSync(join(workspace, 'plan.json'), JSON.stringify(sdkPlan));
  const ws = { version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plan.json', ref: 'main' }] };
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify(ws));
  const commit = (...args: string[]) => git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args);
  commit('add', 'plan.json', 'ws.json');
  commit('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  ws.plans[0].ref = 'feature';
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify(ws));
  commit('add', 'ws.json');
  commit('commit', '-m', 'edit workspace');
  const r = run({
    PA_WORKSPACE: 'ws.json', PA_PLANS: '', GITHUB_REPOSITORY: 'org/sdk',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'feature',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.summary, /The workspace file changed in this pull request; entries were read from this version\./);
  assert.match(r.stdout, /--head-ref feature/);
  assert.equal(r.stdout.split('\n').filter((line) => line.startsWith('::group::')).length, 1);
});

test('Action passes --head-ref on push to a branch other than the default', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'plan.json'), JSON.stringify(sdkPlan));
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({
    version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plan.json' }],
  }));
  const env = {
    PA_WORKSPACE: 'ws.json', PA_PLANS: '', GITHUB_REPOSITORY: 'org/sdk',
    PA_DEFAULT_BRANCH: 'main', GITHUB_EVENT_NAME: 'push',
  };
  const branch = run({ ...env, GITHUB_REF: 'refs/heads/feature', GITHUB_REF_NAME: 'feature' });
  assert.equal(branch.status, 0, branch.stdout + branch.stderr);
  assert.match(branch.stdout, /::group::.*--head-ref feature/);
  const onDefault = run({ ...env, GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' });
  assert.equal(onDefault.status, 0, onDefault.stdout + onDefault.stderr);
  assert.doesNotMatch(onDefault.stdout, /--head-ref/);
  const tag = run({ ...env, GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_REF_NAME: 'v1.0.0' });
  assert.equal(tag.status, 0, tag.stdout + tag.stderr);
  assert.doesNotMatch(tag.stdout, /--head-ref/);
});

function gitRepo(workspace: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--quiet');
  const commit = (...args: string[]) => git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args);
  return { git, commit };
}

test('Action coupling and status run over the self file', posix, (t) => {
  const { workspace, run } = fixture(t);
  const { git, commit } = gitRepo(workspace);
  writeFileSync(join(workspace, 'plan.json'), JSON.stringify(sdkPlan));
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({
    version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plan.json' }],
  }));
  commit('add', 'plan.json', 'ws.json');
  commit('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const r = run({
    PA_WORKSPACE: 'ws.json', PA_PLANS: '', PA_COUPLING: 'true', PA_STATUS: 'git',
    GITHUB_REPOSITORY: 'org/sdk',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'feature',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const couplingAt = r.summary.indexOf('### coupling against `origin/main`');
  const statusAt = r.summary.indexOf('### status --git');
  assert.ok(couplingAt >= 0 && statusAt > couplingAt, r.summary);
  assert.match(r.summary.slice(couplingAt, statusAt), /`plan\.json`/);
  assert.match(r.summary.slice(statusAt), /`plan\.json`/);
});

test('Action reads two self namespaces from the checkout', posix, (t) => {
  const { dir, workspace, run } = fixture(t);
  const { bin, log } = installGh(dir, '{}');
  const planFor = (ns: string) => JSON.stringify({
    version: 1, namespace: ns,
    nodes: [
      { id: ns, title: ns, parent: null, sources: ['plan.md'] },
      { id: 'X1', title: 'X1', parent: ns, status: 'open', source: 'plan.md §1' },
    ],
  });
  mkdirSync(join(workspace, 'plans'));
  writeFileSync(join(workspace, 'plans/sdk.json'), planFor('sdk'));
  writeFileSync(join(workspace, 'plans/web.json'), planFor('web'));
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({ version: 1, plans: [
    { namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' },
    { namespace: 'web', github: 'org/sdk', file: 'plans/web.json' },
  ] }));
  const r = run({
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    PA_WORKSPACE: 'ws.json', PA_SELF: 'sdk web', PA_PLANS: '', GITHUB_REPOSITORY: 'org/sdk',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const groups = r.stdout.split('\n').filter((line) => line.startsWith('::group::'));
  assert.equal(groups.length, 1);
  assert.match(groups[0], /--self sdk/);
  assert.match(groups[0], /--self web/);
  assert.doesNotMatch(groups[0], /--self-repo/);
  assert.match(r.summary, /`plans\/sdk\.json`/);
  assert.match(r.summary, /`plans\/web\.json`/);
  assert.equal(existsSync(log), false);
});

test('Action reports an unreadable self file and skips coupling and status', posix, (t) => {
  const { workspace, run } = fixture(t);
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({
    version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plans/sdk.json' }],
  }));
  const r = run({
    PA_WORKSPACE: 'ws.json', PA_SELF: 'sdk', PA_PLANS: 'plan.json', PA_COUPLING: 'true', PA_STATUS: 'git',
    GITHUB_REPOSITORY: 'org/sdk',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'feature',
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /ERROR\s+V0/);
  assert.match(r.stdout, /Cannot read workspace entry/);
  assert.equal(r.stdout.split('\n').filter((line) => line.startsWith('::group::')).length, 1);
  assert.doesNotMatch(r.summary, /### coupling/);
  assert.doesNotMatch(r.summary, /### status/);
  assert.doesNotMatch(r.summary, /No workspace was loaded/);
  assert.doesNotMatch(r.summary, /No plan file of this repository was read/);
});

test('Action with plans covering the self file runs coupling and status on that file', posix, (t) => {
  const { workspace, run } = fixture(t);
  const { git, commit } = gitRepo(workspace);
  writeFileSync(join(workspace, 'plan.json'), JSON.stringify(sdkPlan));
  writeFileSync(join(workspace, 'extra.json'), '{"version":1,"nodes":[]}');
  writeFileSync(join(workspace, 'ws.json'), JSON.stringify({
    version: 1, plans: [{ namespace: 'sdk', github: 'org/sdk', file: 'plan.json' }],
  }));
  commit('add', 'plan.json', 'extra.json', 'ws.json');
  commit('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const r = run({
    PA_WORKSPACE: 'ws.json', PA_PLANS: 'plan.json extra.json', PA_COUPLING: 'true', PA_STATUS: 'git',
    GITHUB_REPOSITORY: 'org/sdk',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'feature',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const couplingAt = r.summary.indexOf('### coupling against `origin/main`');
  const statusAt = r.summary.indexOf('### status --git');
  assert.ok(couplingAt >= 0 && statusAt > couplingAt, r.summary);
  assert.match(r.summary.slice(couplingAt, statusAt), /`plan\.json`/);
  assert.doesNotMatch(r.summary.slice(couplingAt, statusAt), /extra\.json/);
  assert.match(r.summary.slice(statusAt), /`plan\.json`/);
  assert.doesNotMatch(r.summary.slice(statusAt), /extra\.json/);
});

test('Action rejects self without a workspace, and does not glob-expand self', posix, (t) => {
  const { run } = fixture(t);
  const bare = run({ PA_SELF: 'sdk', PA_WORKSPACE: '', PA_PLANS: 'plan.json' });
  assert.equal(bare.status, 2, bare.stdout + bare.stderr);
  assert.match(bare.stdout, /self needs workspace/);
  const star = run({ PA_SELF: '*', PA_WORKSPACE: 'ws.json', PA_PLANS: '' });
  assert.equal(star.status, 2, star.stdout + star.stderr);
  assert.match(star.stdout, /self: '\*'/);
});
