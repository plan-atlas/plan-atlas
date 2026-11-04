import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { suggestFromGithub } from '../src/index.ts';

/**
 * A stand-in for GitHub that answers the queries suggestFromGithub builds. Keys are
 * `owner/repo#N` for issues and pull requests, `owner/repo:<branch>` for branches.
 */
function fakeGithub(world: Record<string, unknown>, repos = ['rshade/finfocus', 'acme/other']) {
  const queries: string[] = [];
  const str = '"((?:[^"\\\\]|\\\\.)*)"';
  const run = (query: string) => {
    queries.push(query);
    const data: Record<string, unknown> = {};
    for (const block of query.split(/(?=r\d+: repository\()/).slice(1)) {
      const head = new RegExp(`^(r\\d+): repository\\(owner: ${str}, name: ${str}\\)`).exec(block)!;
      const repo = `${JSON.parse(`"${head[2]}"`)}/${JSON.parse(`"${head[3]}"`)}`;
      if (!repos.includes(repo)) {
        data[head[1]] = null;
        continue;
      }
      const fields: Record<string, unknown> = {};
      for (const m of block.matchAll(/(t\d+): issueOrPullRequest\(number: (\d+)\)/g)) fields[m[1]] = world[`${repo}#${m[2]}`] ?? null;
      // like GitHub, answer at most `first` pull requests (newest first), optionally merged ones only
      for (const m of block.matchAll(new RegExp(`(t\\d+m?): pullRequests\\(headRefName: ${str}([^)]*)\\)`, 'g'))) {
        const b = world[`${repo}:${JSON.parse(`"${m[2]}"`)}`] as { prs: { merged: boolean }[]; exists?: boolean } | undefined;
        const merged = /states: MERGED/.test(m[3]);
        fields[m[1]] = { nodes: (b?.prs ?? []).filter((p) => !merged || p.merged).slice(0, Number(/first: (\d+)/.exec(m[3])![1])) };
        if (!merged) fields[`${m[1]}r`] = b?.exists ? { name: 'x' } : null;
      }
      data[head[1]] = fields;
    }
    return { data };
  };
  return { run, queries };
}

const issue = (number: number, state: 'OPEN' | 'CLOSED', stateReason: string | null = state === 'CLOSED' ? 'COMPLETED' : null) =>
  ({ __typename: 'Issue', number, title: `issue ${number}`, state, stateReason });
const pr = (number: number, state: 'OPEN' | 'CLOSED' | 'MERGED', headRefName: string, mergedAt: string | null = null, closes: number[] = []) => ({
  __typename: 'PullRequest', number, title: `pr ${number}`, state, merged: state === 'MERGED', mergedAt, headRefName,
  closingIssuesReferences: { nodes: closes.map((n) => ({ number: n })) },
});

const world = {
  'rshade/finfocus#219': issue(219, 'CLOSED'),
  'rshade/finfocus#496': pr(496, 'MERGED', '124-budget-exit-codes', '2026-01-25T02:48:30Z', [219]),
  'rshade/finfocus#7': issue(7, 'OPEN'),
  'rshade/finfocus#8': issue(8, 'CLOSED', 'NOT_PLANNED'),
  'rshade/finfocus#9': pr(9, 'OPEN', 'wip'),
  'rshade/finfocus#10': pr(10, 'CLOSED', 'dropped'),
  'acme/other#3': issue(3, 'CLOSED'),
  'rshade/finfocus:124-budget-exit-codes': { prs: [pr(496, 'MERGED', '124-budget-exit-codes', '2026-01-25T02:48:30Z', [219])] },
  'rshade/finfocus:live': { prs: [], exists: true },
  'rshade/finfocus:in-review': { prs: [pr(11, 'OPEN', 'in-review')], exists: true },
};

const item = (id: string, status: 'open' | 'done', links?: string[], parent: string | null = null) =>
  ({ id, title: `${id} title`, parent, status, ...(links ? { links } : {}) });

test('an open item whose pull request merged or issue closed asks for a check', () => {
  const { run } = fakeGithub(world);
  const plan = { nodes: [item('T001', 'open', ['#496']), item('T002', 'open', ['acme/other#3']), item('T003', 'open', ['#219'])] };
  const before = structuredClone(plan);
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }), [
    { id: 'T001', title: 'T001 title', status: 'open', suggest: 'check', commits: [],
      evidence: 'PR #496 merged (2026-01-25, branch 124-budget-exit-codes, closes #219)' },
    { id: 'T002', title: 'T002 title', status: 'open', suggest: 'check', commits: [], evidence: 'issue acme/other#3 is closed (completed)' },
    { id: 'T003', title: 'T003 title', status: 'open', suggest: 'check', commits: [], evidence: 'issue #219 is closed (completed)' },
  ]);
  assert.deepEqual(plan, before);
});

test('an open group whose branch merged says how many items are still open', () => {
  const { run } = fakeGithub(world);
  const plan = { nodes: [
    { id: '124-budget-exit-codes', title: 'Budget exit codes', parent: null, links: ['branch:124-budget-exit-codes', '#219'] },
    { id: 'setup', title: 'Setup', parent: '124-budget-exit-codes' },
    item('T001', 'done', undefined, 'setup'), item('T002', 'open', undefined, 'setup'), item('T003', 'open', undefined, '124-budget-exit-codes'),
  ] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }), [{
    id: '124-budget-exit-codes', title: 'Budget exit codes', status: 'open', suggest: 'check', commits: [],
    evidence: 'PR #496 merged (2026-01-25, branch 124-budget-exit-codes, closes #219); issue #219 is closed (completed), but 2 items are still open',
  }]);
  // once every item is done, plan and GitHub agree
  for (const n of plan.nodes) if ('status' in n) n.status = 'done';
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }), []);
});

test('a done item whose issue or pull request is still open asks for a check', () => {
  const { run } = fakeGithub(world);
  const plan = { nodes: [
    item('A', 'done', ['#7']), item('B', 'done', ['#9']), item('C', 'done', ['#10']), item('D', 'done', ['branch:in-review']),
    { id: 'G', title: 'G title', parent: null, links: ['#7'] }, item('G1', 'done', undefined, 'G'),
  ] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }).map((s) => [s.id, s.status, s.suggest, s.evidence]), [
    ['A', 'done', 'check', 'issue #7 is still open'],
    ['B', 'done', 'check', 'PR #9 is not merged yet'],
    ['C', 'done', 'check', 'PR #10 closed without merging'],
    ['D', 'done', 'check', 'branch in-review: PR #11 is not merged yet'],
    ['G', 'done', 'check', 'issue #7 is still open'],
  ]);
});

test('an issue closed as not planned is a check either way', () => {
  const { run } = fakeGithub(world);
  const plan = { nodes: [item('A', 'open', ['#8']), item('B', 'done', ['#8'])] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }).map((s) => [s.id, s.suggest, s.evidence]), [
    ['A', 'check', 'issue #8 closed as not planned (work dropped?)'],
    ['B', 'check', 'issue #8 closed as not planned, but the plan marks it done'],
  ]);
});

test('a link GitHub cannot resolve is missing-link, next to any check for the same node', () => {
  const { run } = fakeGithub(world);
  const plan = { nodes: [
    item('A', 'open', ['#999', 'branch:never-pushed', 'ghost/repo#1', 'acme/other#404']),
    item('B', 'open', ['#496', '#998']),
  ] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }).map((s) => [s.id, s.suggest, s.evidence]), [
    ['A', 'missing-link', 'GitHub cannot find #999, branch:never-pushed, ghost/repo#1, acme/other#404'],
    ['B', 'check', 'PR #496 merged (2026-01-25, branch 124-budget-exit-codes, closes #219)'],
    ['B', 'missing-link', 'GitHub cannot find #998'],
  ]);
});

test('no suggestion where the plan and GitHub agree', () => {
  const { run } = fakeGithub(world);
  const plan = { nodes: [
    item('A', 'open', ['#7']), item('B', 'open', ['#9']), item('C', 'open', ['#10']), item('D', 'open', ['branch:live']),
    item('E', 'done', ['#219', '#496', 'branch:124-budget-exit-codes']), item('F', 'open', ['branch:in-review']), item('G', 'open'),
  ] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }), []);
});

test('links are deduplicated and queried at most 50 per query, with strings escaped', () => {
  const { run, queries } = fakeGithub({ ...world, 'rshade/finfocus:we"ird/名': { prs: [], exists: true } });
  const links = Array.from({ length: 120 }, (_, k) => `#${k + 1000}`);
  const plan = { nodes: [item('A', 'open', links), item('B', 'open', [...links.slice(0, 10), 'branch:we"ird/名', 'acme/other#3'])] };
  const suggestions = suggestFromGithub(plan, 'rshade/finfocus', { run });
  assert.equal(queries.length, 3);
  const counts = queries.map((q) => q.match(/t\d+: /g)!.length);
  assert.deepEqual(counts, [50, 50, 22]);
  assert.ok(queries[2].includes('headRefName: "we\\"ird/名"'), queries[2]);
  assert.ok(queries[2].includes('qualifiedName: "refs/heads/we\\"ird/名"'));
  assert.deepEqual(suggestions.map((s) => [s.id, s.suggest, s.evidence.split(', ').length]), [
    ['A', 'missing-link', 120], ['B', 'check', 1], ['B', 'missing-link', 10],
  ]);
});

test('the repository must be owner/repo, and a reply without data is an error', () => {
  const { run } = fakeGithub(world);
  for (const bad of ['finfocus', 'a/b/c', '-x/y', 'https://github.com/a/b']) {
    assert.throws(() => suggestFromGithub({ nodes: [] }, bad, { run }), /owner\/repo/, bad);
  }
  assert.throws(() => suggestFromGithub({ nodes: [item('A', 'open', ['#1'])] }, 'a/b', { run: () => ({ errors: [{ message: 'rate limited' }] }) }), /rate limited/);
  assert.deepEqual(suggestFromGithub({ nodes: [item('A', 'open')] }, 'a/b', { run: () => { throw new Error('not called'); } }), []);
});

test('CLI: status takes exactly one of --git and --github, and --ref only with --git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-atlas-github-'));
  try {
    const path = join(dir, 'plan.json');
    writeFileSync(path, JSON.stringify({ nodes: [item('A', 'open', ['#1'])] }));
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    for (const args of [['--git', dir, '--github', 'a/b', path], ['--github', 'a/b', path, '--ref', 'HEAD'], ['--github', 'not-a-repo', path], ['--github', 'a/b']]) {
      const r = spawnSync(process.execPath, [cli, 'status', ...args], { encoding: 'utf8' });
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.ok(r.stderr.trim());
      assert.equal(r.stdout, '');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Traditional Chinese GitHub evidence remains available through lang', () => {
  const { run } = fakeGithub(world);
  const suggestions = suggestFromGithub({ nodes: [item('T001', 'open', ['#496'])] }, 'rshade/finfocus', { run, lang: 'zh-TW' });
  assert.equal(suggestions[0].evidence, 'PR #496 已合併（2026-01-25，branch 124-budget-exit-codes，關閉 #219）');
});

test('a done item whose branch has no merged pull request asks for a check', () => {
  const { run } = fakeGithub({ ...world, 'rshade/finfocus:abandoned': { prs: [pr(12, 'CLOSED', 'abandoned')], exists: true } });
  const plan = { nodes: [item('A', 'done', ['branch:abandoned']), item('B', 'done', ['branch:live']), item('C', 'open', ['branch:abandoned'])] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }).map((s) => [s.id, s.suggest, s.evidence]), [
    ['A', 'check', 'branch abandoned: no pull request from it was merged'],
    ['B', 'check', 'branch live: no pull request from it was merged'],
  ]);
});

test('a branch merged long ago is found even behind ten newer pull requests', () => {
  const prs = [...Array.from({ length: 10 }, (_, i) => pr(39 - i, 'CLOSED', 'busy')), pr(20, 'MERGED', 'busy', '2026-01-02T00:00:00Z')];
  const { run } = fakeGithub({ ...world, 'rshade/finfocus:busy': { prs, exists: true } });
  const plan = { nodes: [item('A', 'done', ['branch:busy']), item('B', 'open', ['branch:busy'])] };
  assert.deepEqual(suggestFromGithub(plan, 'rshade/finfocus', { run }).map((s) => [s.id, s.suggest, s.evidence]), [
    ['B', 'check', 'PR #20 merged (2026-01-02, branch busy)'],
  ]);
});
