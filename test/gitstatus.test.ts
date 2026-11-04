import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { suggestStatus, type Suggestion } from '../src/index.ts';

function repository(t: TestContext) {
  const repo = mkdtempSync(join(tmpdir(), 'plan-atlas-gitstatus-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  let day = 20;
  const commit = (subject: string, body?: string) => {
    const date = `2026-10-${day++}T12:00:00Z`;
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : [])], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git('rev-parse', 'HEAD');
  };
  return { repo, git, commit };
}

const item = (id: string, status: 'open' | 'done' = 'open') => ({ id, title: `${id} title`, parent: null, status });
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
};

test('matches whole case-sensitive ids in bodies, with merge PRs; skips done items and groups', (t) => {
  const { repo, commit } = repository(t);
  commit('A3b M01-T11 a3 xA3 _A3 .A3 -A3 A3_ C3b xC3 _C3 .C3 -C3 C3_ Group D1 123');
  const sha = commit('Merge pull request #12 from x/y', 'Refactor step C3, and C3-orders; C3 again');
  const plan = { nodes: [
    ...['A3', 'M01-T1', 'C3', 'x', '123'].map((id) => item(id)), item('D1', 'done'),
    item('Group'), { ...item('child'), parent: 'Group' },
  ] };
  const before = structuredClone(plan);
  const suggestions = suggestStatus(plan, repo);
  assert.deepEqual(suggestions, [{
    id: 'C3', title: 'C3 title', status: 'open', suggest: 'check',
    evidence: '1 commit(s) cite it, latest #12 2026-10-21',
    commits: [{ sha, date: '2026-10-21', subject: 'Merge pull request #12 from x/y', pr: 12 }],
  }]);
  assert.deepEqual(plan, before);
});

test('escapes regex characters and keeps unique commits newest first, scoped by ref', (t) => {
  const { repo, commit } = repository(t);
  commit('T1 Ax3');
  const older = commit('step C3, T[1], A.3 (#84)', 'C3 T[1] A.3');
  const newer = commit('Merge pull request #12 from x/y (#99)', 'C3-orders');
  const plan = { nodes: ['C3', 'T[1]', 'A.3'].map((id) => item(id)) };
  const suggestions = suggestStatus(plan, repo);
  assert.equal(suggestions.length, 3);
  assert.deepEqual(suggestions[0].commits.map((c) => [c.sha, c.pr]), [[newer, 12], [older, 84]]);
  assert.equal(suggestions[0].evidence, '2 commit(s) cite it, latest #12 2026-10-22');
  for (const suggestion of suggestions.slice(1)) assert.deepEqual(suggestion.commits.map((c) => c.sha), [older]);
  const atRef = suggestStatus(plan, repo, { ref: older });
  assert.deepEqual(atRef[0].commits.map((c) => c.sha), [older]);
  assert.equal(atRef[0].evidence, '1 commit(s) cite it, latest #84 2026-10-21');
});

test('release tags suggest done or missing-tag, using raw tag fields and the tagged commit date; otherwise a release gets commit labels (§S)', (t) => {
  const { repo, git, commit } = repository(t);
  const sha = commit('initial release');
  git('tag', 'v1.0.0');
  const cited = commit('open-missing-tag release-no-tag runtime@1.0.0');
  const release = (id: string, status: 'open' | 'done', tag: string) => ({ ...item(id, status), kind: 'release', tag });
  const suggestions = suggestStatus({ nodes: [
    release('runtime@1.0.0', 'open', 'v1.0.0'), release('done-existing-tag', 'done', 'v1.0.0'),
    release('done-missing-tag', 'done', 'v9.9.9'), release('open-missing-tag', 'open', 'v9.9.9'),
    { ...item('release-no-tag'), kind: 'release' },
    release('release-group', 'open', 'v1.0.0'), { ...item('child'), parent: 'release-group' },
  ] }, repo);
  assert.deepEqual(suggestions, [
    { id: 'runtime@1.0.0', title: 'runtime@1.0.0 title', status: 'open', suggest: 'done',
      evidence: `tag v1.0.0 (2026-10-20, ${sha.slice(0, 7)})`, commits: [] },
    { id: 'done-missing-tag', title: 'done-missing-tag title', status: 'done', suggest: 'missing-tag',
      evidence: 'Cannot find tag v9.9.9', commits: [] },
    { id: 'open-missing-tag', title: 'open-missing-tag title', status: 'open', suggest: 'check',
      evidence: '1 commit(s) cite it, latest 2026-10-21', commits: [{ sha: cited, date: '2026-10-21', subject: 'open-missing-tag release-no-tag runtime@1.0.0' }] },
    { id: 'release-no-tag', title: 'release-no-tag title', status: 'open', suggest: 'check',
      evidence: '1 commit(s) cite it, latest 2026-10-21', commits: [{ sha: cited, date: '2026-10-21', subject: 'open-missing-tag release-no-tag runtime@1.0.0' }] },
  ]);
});

test('a release tag resolves the tag even when a branch has the same name', (t) => {
  const { repo, git, commit } = repository(t);
  const sha = commit('tagged');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '--no-sign', '-a', 'v1.0.0', '-m', 'release');
  commit('newer');
  git('branch', 'v1.0.0');
  const suggestions = suggestStatus({ nodes: [{ ...item('runtime@1.0.0'), kind: 'release', tag: 'v1.0.0' }] }, repo);
  assert.equal(suggestions[0].evidence, `tag v1.0.0 (2026-10-20, ${sha.slice(0, 7)})`);
});

test('CLI prints text or JSON suggestions without modifying the plan, and accepts --ref', (t) => {
  const { repo, git, commit } = repository(t);
  const sha = commit('initial');
  git('tag', 'v1.0.0');
  commit('Refactor step C3 (#84)');
  const path = join(repo, 'plan.json');
  const source = JSON.stringify({ nodes: [item('C3'), { ...item('runtime@1.0.0'), kind: 'release', tag: 'v1.0.0' }] }, null, 2) + '\n';
  writeFileSync(path, source);
  const json = run('status', '--git', repo, path, '--json');
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stderr, '');
  const suggestions: Suggestion[] = JSON.parse(json.stdout);
  assert.deepEqual(suggestions.map((s) => [s.id, s.suggest]), [['C3', 'check'], ['runtime@1.0.0', 'done']]);
  const text = run('status', '--git', repo, path);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /CHECK\s+C3\s+open; 1 commit\(s\) cite it, latest #84 2026-10-21 "Refactor step C3 \(#84\)"/);
  assert.match(text.stdout, /DONE\?\s+runtime@1\.0\.0\s+tag v1\.0\.0 \(2026-10-20, [a-f0-9]{7}\)/);
  assert.match(text.stdout, /2 suggestion\(s\)/);
  const atRef = run('status', '--git', repo, path, '--ref', sha, '--json');
  assert.equal(atRef.status, 0, atRef.stderr);
  assert.deepEqual(JSON.parse(atRef.stdout).map((s: Suggestion) => s.id), ['runtime@1.0.0']);
  assert.equal(readFileSync(path, 'utf8'), source);
  writeFileSync(path, JSON.stringify({ nodes: [item('uncited')] }));
  const empty = run('status', '--git', repo, path, '--json');
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), []);
});

test('CLI rejects bad arguments and reports git failures with exit 2', (t) => {
  const { repo, commit } = repository(t);
  commit('initial');
  const path = join(repo, 'plan.json');
  writeFileSync(path, JSON.stringify({ nodes: [item('C3')] }));
  for (const args of [
    [path], ['--git', repo], ['--git', repo, path, path], ['--git', repo, path, '--wat'],
    ['--git', repo, path, '--ref'], ['--git', repo, path, '--ref=--all'], ['--git', repo, path, '--ref='],
  ]) {
    const result = run('status', ...args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.ok(result.stderr.trim());
    assert.equal(result.stdout, '');
  }
  for (const args of [
    ['--git', join(repo, 'missing'), path], ['--git', repo, path, '--ref', 'no-such-ref'],
  ]) {
    const result = run('status', ...args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /fatal:/);
    assert.equal(result.stdout, '');
  }
  writeFileSync(path, '{');
  assert.equal(run('status', '--git', repo, path).status, 2);
});

test('id ranges expand to the plan ids they cover, with an en dash, zero padding or none', (t) => {
  const { repo, commit } = repository(t);
  const a = commit('Steps A4-A6 done');
  const c = commit('finish C4–C6');
  const tt = commit('tasks T054-T056; also B08-B10');
  commit('years Y1-Y200 and backwards D5-D3');
  const plan = { nodes: [
    ...['A3', 'A4', 'A5', 'A6', 'A7', 'C5', 'T055', 'T56', 'B9', 'B09', 'B10', 'Y50', 'D4'].map((id) => item(id)),
  ] };
  const got = Object.fromEntries(suggestStatus(plan, repo).map((s) => [s.id, s.commits.map((x) => x.sha)]));
  assert.deepEqual(got, {
    A4: [a], A5: [a], A6: [a], C5: [c], T055: [tt], T56: [tt], B9: [tt], B09: [tt], B10: [tt],
  });
});

test('links match #N in messages and branch names in merge commit subjects', (t) => {
  const { repo, commit } = repository(t);
  const fix = commit('Fix login redirect (#42)', 'closes #7');
  const other = commit('unrelated #420 and acme/other#42 and x#42');
  const gh = commit('Merge pull request #96 from someone/feat-x', 'Feat x');
  const local = commit("Merge branch 'feat-y' into main");
  commit("Merge branch 'feat-y-2'", 'feat-y');
  const plan = { nodes: [
    { ...item('login'), links: ['#42'] }, { ...item('issue'), links: ['acme/other#42'] },
    { ...item('x'), links: ['branch:feat-x'] }, { ...item('y'), links: ['branch:feat-y', '#7'] },
    { ...item('closed', 'done'), links: ['#42'] },
  ] };
  assert.deepEqual(suggestStatus(plan, repo).map((s) => [s.id, s.commits.map((c) => c.sha)]), [
    ['login', [fix]],
    ['issue', [other]],
    ['x', [gh]],
    ['y', [local, fix]],
  ]);
});

test('an open group takes part through its links and says how many items are open', (t) => {
  const { repo, commit } = repository(t);
  commit('feature 124 work, mentions feature');
  const merge = commit('Merge pull request #496 from rshade/124-budget-exit-codes');
  const plan = { nodes: [
    { id: 'feature', title: 'Budget exit codes', parent: null, links: ['branch:124-budget-exit-codes'] },
    { ...item('T001', 'done'), parent: 'feature' }, { ...item('T002'), parent: 'feature' }, { ...item('T003'), parent: 'feature' },
    { id: 'shipped', title: 'Shipped', parent: null, links: ['branch:124-budget-exit-codes'] },
    { ...item('S1', 'done'), parent: 'shipped' },
  ] };
  assert.deepEqual(suggestStatus(plan, repo), [{
    id: 'feature', title: 'Budget exit codes', status: 'open', suggest: 'check',
    evidence: '1 commit(s) cite it, latest #496 2026-10-21, but 2 items are still open',
    commits: [{ sha: merge, date: '2026-10-21', subject: 'Merge pull request #496 from rshade/124-budget-exit-codes', pr: 496 }],
  }]);
});

test('an id only mid-sentence is a mention; subject, PR title and line starts are checks', (t) => {
  const { repo, commit } = repository(t);
  commit('feat: add the parser (step W1)', 'Two follow-ups, which W2-W4 handle.');
  commit('feat(lint): stricter rules', 'Plan steps A4-A6.\n\n- A5: a review checklist.');
  commit('Merge pull request #57 from me/feat/search', 'Search page (M02-T14)');
  const plan = { nodes: ['W1', 'W3', 'A4', 'A5', 'M02-T14'].map((id) => item(id)) };
  assert.deepEqual(suggestStatus(plan, repo).map((s) => [s.id, s.suggest]), [
    ['W1', 'check'], ['W3', 'mention'], ['A4', 'mention'], ['A5', 'check'], ['M02-T14', 'check'],
  ]);
});

test('a commit that changes only plan documents is planning, not evidence', (t) => {
  const { repo, git, commit } = repository(t);
  const save = (path: string, text: string, msg: string) => {
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), text);
    git('add', path);
    return commit(msg);
  };
  save('docs/plans/refactor.md', '# plan', 'docs(plan): C1 first, then C2');
  const work = save('src/a.ts', 'x', 'feat: C2 (step C2)');
  const plan = { nodes: [
    { id: 'refactor', title: 'Refactor', parent: null, sources: ['docs/plans/refactor.md'] },
    { ...item('C1'), parent: 'refactor', source: 'docs/plans/refactor.md §6' }, { ...item('C2'), parent: 'refactor', source: 'docs/plans/refactor.md §6' },
  ] };
  assert.deepEqual(suggestStatus(plan, repo).map((s) => [s.id, s.commits.map((c) => c.sha)]), [['C2', [work]]]);
});

test('Traditional Chinese git evidence and CLI suggestion counts remain available', (t) => {
  const { repo, commit } = repository(t);
  commit('C3 work');
  const plan = { nodes: [item('C3')] };
  assert.equal(suggestStatus(plan, repo, { lang: 'zh-TW' })[0].evidence, '1 個 commit 引用，最近 2026-10-20');
  const path = join(repo, 'plan.json');
  writeFileSync(path, JSON.stringify(plan));
  const zh = run('status', '--git', repo, path, '--lang', 'zh-TW');
  assert.equal(zh.status, 0, zh.stderr);
  assert.match(zh.stdout, /CHECK\s+C3\s+open；1 個 commit 引用，最近 2026-10-20/);
  assert.match(zh.stdout, /1 個建議\s*$/);
  const en = run('status', '--git', repo, path, '--lang', 'en');
  assert.equal(en.status, 0, en.stderr);
  assert.match(en.stdout, /1 suggestion\(s\)\s*$/);
  assert.doesNotMatch(en.stdout, /[\u4e00-\u9fff]/);
});

test('a check reports the commits that cite the item, not a newer mid-sentence mention', (t) => {
  const { repo, commit } = repository(t);
  const cite = commit('A5: review checklist (#40)');
  commit('docs: notes', 'This prepares what A5 builds on.');
  const [s] = suggestStatus({ nodes: [item('A5')] }, repo);
  assert.equal(s.suggest, 'check');
  assert.equal(s.evidence, '1 commit(s) cite it, latest #40 2026-10-20');
  assert.deepEqual(s.commits.map((c) => c.sha), [cite]);
});
