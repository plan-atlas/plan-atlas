import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { healthReport, type HealthInput } from '../src/render/health.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const cjk = /[\u3000-\u9fff\uff00-\uffef]/;
const runCliLang = (lang: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, PLAN_ATLAS_LANG: lang } });
  if (result.error) throw result.error;
  return result;
};
const runCli = (...args: string[]) => runCliLang('en', ...args);

function outsideFences(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const open = /^(`{3,})text$/.exec(line);
    const close = /^(`{3,})$/.exec(line);
    if (fence === null && open) { fence = open[1]; continue; }
    if (fence !== null && close && close[1] === fence) { fence = null; continue; }
    if (fence === null) out.push(line);
  }
  return out.join('\n');
}

function fencedBodies(text: string): string[] {
  const bodies: string[] = [];
  let fence: string | null = null;
  let body: string[] = [];
  for (const line of text.split('\n')) {
    const open = /^(`{3,})text$/.exec(line);
    const close = /^(`{3,})$/.exec(line);
    if (fence === null && open) { fence = open[1]; body = []; continue; }
    if (fence !== null && close && close[1] === fence) { bodies.push(body.join('\n')); fence = null; continue; }
    if (fence !== null) body.push(line);
  }
  return bodies;
}

function fenceCounts(text: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const line of text.split('\n')) {
    const match = /^(`{3,})(?:text)?$/.exec(line);
    if (match) counts.set(match[1].length, (counts.get(match[1].length) ?? 0) + 1);
  }
  return counts;
}

const suggest = (id: string, kind: 'mention' | 'done' | 'check', evidence: string) =>
  ({ id, title: `${id} title`, status: 'open' as const, suggest: kind, evidence, commits: [] });

function sample(): HealthInput {
  return {
    generatedAt: '2026-11-04T00:00:00.000Z',
    workspace: 'github:org/hub:plan-atlas.workspace.json@main',
    source: { github: 'org/hub', path: 'plan-atlas.workspace.json', ref: 'resolved-ref', sha: 'resolved-sha' },
    general: [
      { level: 'INFO', code: 'V9', message: 'general-info' },
      { level: 'WARN', code: 'V0', message: 'general-warn' },
      { level: 'ERROR', code: 'V0', message: 'general-error' },
    ],
    repositories: [
      {
        label: 'org/sdk',
        entries: [{
          namespace: 'sdk',
          findings: [{ level: 'INFO', code: 'V7', message: 'sdk-info-only', namespace: 'sdk' }],
          suggestions: [],
        }],
      },
      {
        label: 'org/api',
        entries: [
          {
            namespace: 'api', ref: 'release/1', sha: 'abc123sha',
            findings: [
              { level: 'WARN', code: 'V5', message: 'api-warn', namespace: 'api' },
              { level: 'INFO', code: 'V7', message: 'api-info', namespace: 'api' },
            ],
            suggestions: [suggest('api:M', 'mention', 'mention evidence'), suggest('api:D', 'done', 'done evidence')],
          },
          {
            namespace: 'extra',
            findings: [{ level: 'ERROR', code: 'V8', message: 'extra-error', namespace: 'extra' }],
            suggestions: [],
          },
        ],
      },
      {
        label: '../web',
        entries: [{
          namespace: 'web',
          findings: [{ level: 'ERROR', code: 'V8', message: 'see ```` here @someone <b>bold</b>', namespace: 'web' }],
          suggestions: [],
          statusError: 'boom-status',
        }],
      },
    ],
  };
}

test('healthReport groups by repository, drops INFO, and keeps plan order', () => {
  const { full, issue } = healthReport(sample(), 'en');
  const at = (needle: string) => {
    const index = full.indexOf(needle);
    assert.ok(index >= 0, needle);
    return index;
  };
  assert.equal(full.split('\n')[0], '# Plan health');
  assert.equal(full.split('\n')[2], 'Last run: 2026-11-04T00:00:00.000Z');
  assert.equal(issue.split('\n')[0], '<!-- plan-atlas:health -->');
  assert.equal(issue.split('\n')[1], 'Last run: 2026-11-04T00:00:00.000Z');
  assert.equal(issue.split('\n')[2], '# Plan health');
  assert.equal(issue.split('\n').filter((line) => line.startsWith('Last run:')).length, 1);
  assert.equal(full.includes('<!-- plan-atlas:health -->'), false);
  assert.equal(issue.includes('more findings'), false);
  assert.equal(fencedBodies(full).find((body) => body === 'sdk'), 'sdk');
  assert.match(full, /3 error\(s\), 2 warning\(s\), 2 suggestion\(s\)/);
  assert.ok(at('Workspace file') < at('## Workspace'));
  assert.ok(at('## Workspace') < at('general-error'));
  assert.ok(at('general-error') < at('general-warn'));
  assert.ok(at('general-warn') < at('## org/sdk'));
  assert.ok(at('## org/sdk') < at('Nothing to report.'));
  assert.ok(at('Nothing to report.') < at('## org/api'));
  assert.ok(at('## org/api') < at('extra-error'));
  assert.ok(at('extra-error') < at('api-warn'));
  assert.ok(at('api-warn') < at('api:M'));
  assert.ok(at('api:M') < at('api:D'));
  assert.ok(at('api:D') < at('../web'));
  assert.ok(at('../web') < at('boom-status'));
  assert.ok(at('boom-status') < at('@someone'));
  assert.equal(full.includes('general-info'), false);
  assert.equal(full.includes('api-info'), false);
  assert.equal(full.includes('sdk-info-only'), false);
  assert.match(full, /^release\/1$/m);
  assert.match(full, /^abc123sha$/m);
  assert.match(full, /^resolved-ref$/m);
  assert.match(full, /^resolved-sha$/m);
  const outside = outsideFences(full);
  assert.equal(outside.includes('@someone'), false);
  assert.equal(outside.includes('<b>'), false);
  assert.equal(outside.includes('````'), false);
  assert.equal(outside.includes('boom-status'), false);
  assert.equal(outside.includes('resolved-ref'), false);
  assert.equal(outside.includes('extra-error'), false);
  assert.match(full, /`````text\n[\s\S]*````[\s\S]*\n`````/);
  assert.doesNotMatch(full, cjk);
});

test('healthReport truncates the issue on whole lines and counts what was left out', () => {
  const messages = Array.from({ length: 16 }, (_, i) => `ITEM-${String(i).padStart(2, '0')} ${'x'.repeat(80)}`);
  const evidence = `SUGGESTION ${'y'.repeat(80)}`;
  const input: HealthInput = {
    generatedAt: '2026-11-04T00:00:00.000Z',
    workspace: 'hub/plan-atlas.workspace.json',
    general: [
      { level: 'INFO', code: 'V7', message: 'ignore-this-info' },
      ...messages.map((message) => ({ level: 'ERROR' as const, code: 'V0', message })),
    ],
    repositories: [{
      label: 'org/sdk',
      entries: [{ namespace: 'sdk', findings: [], suggestions: [suggest('sdk:X1', 'check', evidence)] }],
    }],
  };
  const limit = 1500;
  const intact = healthReport(input, 'en');
  assert.ok(intact.issue.length > limit);
  assert.equal(intact.issue.includes('more findings'), false);
  assert.equal(intact.issue.includes('ignore-this-info'), false);
  const cut = healthReport(input, 'en', limit);
  assert.ok(cut.issue.length <= limit, String(cut.issue.length));
  const uncut = intact.issue.replace(/\n$/, '').split('\n');
  const lines = cut.issue.replace(/\n$/, '').split('\n');
  const last = lines[lines.length - 1];
  const found = /^(\d+) more findings: see the run artifact\.$/.exec(last ?? '');
  assert.ok(found, last);
  const presentFindings = messages.filter((message) => lines.includes(message)).length;
  const presentSuggestion = lines.includes(evidence) ? 1 : 0;
  assert.ok(presentFindings > 0 && presentFindings < messages.length, String(presentFindings));
  assert.equal(Number(found[1]), messages.length + 1 - presentFindings - presentSuggestion);
  let cursor = 0;
  for (const line of lines.slice(0, -1)) {
    if (cursor < uncut.length && line === uncut[cursor]) { cursor++; continue; }
    assert.match(line, /^`{3,}$/);
  }
  for (const count of fenceCounts(cut.issue).values()) assert.equal(count % 2, 0);
});

test('healthReport points at the artifact when a cut drops no findings', () => {
  const input: HealthInput = {
    generatedAt: '2026-11-04T00:00:00.000Z',
    workspace: 'hub/plan-atlas.workspace.json',
    general: [],
    repositories: Array.from({ length: 40 }, (_, i) => ({
      label: `org/repo${i}`,
      entries: [{ namespace: `ns${i}`, ref: 'main', sha: 'abc', findings: [], suggestions: [] }],
    })),
  };
  const limit = 1200;
  const { issue } = healthReport(input, 'en', limit);
  assert.ok(issue.length <= limit, String(issue.length));
  assert.equal(issue.trimEnd().split('\n').at(-1), 'The report continues in the run artifact.');
  assert.equal(issue.includes('more findings'), false);
  assert.match(issue, /## org\/repo0/);
  assert.equal(issue.includes('## org/repo39'), false);
  assert.doesNotMatch(issue, cjk);
  const zh = healthReport(input, 'zh-TW', limit);
  assert.ok(zh.issue.length <= limit, String(zh.issue.length));
  assert.equal(zh.issue.trimEnd().split('\n').at(-1), '報告其餘部分請看這次執行的 artifact。');
  assert.equal(zh.issue.includes('The report continues'), false);
});

test('healthReport cuts 20000 findings inside the default limit', () => {
  const input: HealthInput = {
    generatedAt: '2026-11-04T00:00:00.000Z',
    workspace: 'hub/plan-atlas.workspace.json',
    general: Array.from({ length: 20000 }, (_, i) => ({
      level: 'ERROR' as const, code: 'V0', message: `finding ${i} ${'x'.repeat(40)}`,
    })),
    repositories: [],
  };
  const { issue } = healthReport(input, 'en');
  assert.ok(issue.length <= 60000, String(issue.length));
  assert.equal(issue.split('\n')[0], '<!-- plan-atlas:health -->');
  assert.match(issue, /\d+ more findings: see the run artifact\.\n$/);
  for (const count of fenceCounts(issue).values()) assert.equal(count % 2, 0);
});

test('a finding that quotes the issue marker stays inside a fence', () => {
  const marker = '<!-- plan-atlas:health -->';
  const { issue } = healthReport({
    generatedAt: '2026-11-04T00:00:00.000Z',
    workspace: 'hub/plan-atlas.workspace.json',
    general: [{ level: 'ERROR', code: 'V0', message: marker }],
    repositories: [],
  }, 'en');
  const lines = issue.split('\n');
  assert.equal(lines[0], marker);
  assert.match(lines[1], /^Last run: /);
  assert.equal(lines.slice(2).filter((line) => line === marker).length, 1);
  let fence: string | null = null;
  let quotedInside = false;
  for (const line of lines.slice(2)) {
    const open = /^(`{3,})text$/.exec(line);
    const close = /^(`{3,})$/.exec(line);
    if (fence === null && open) { fence = open[1]; continue; }
    if (fence !== null && close && close[1] === fence) { fence = null; continue; }
    if (line === marker) {
      assert.notEqual(fence, null);
      quotedInside = true;
    }
  }
  assert.equal(quotedInside, true);
  assert.equal(outsideFences(issue).split('\n').filter((line) => line === marker).length, 1);
});

test('healthReport uses Traditional Chinese for fixed text', () => {
  const { full, issue } = healthReport(sample(), 'zh-TW');
  assert.match(full, /計畫健康/);
  assert.match(full, /沒有需要回報的內容/);
  assert.match(full, /3 個錯誤、2 個警告、2 個建議/);
  assert.match(full, /狀態：boom-status/);
  assert.doesNotMatch(full, /Nothing to report/);
  assert.equal(issue.split('\n')[0], '<!-- plan-atlas:health -->');
  assert.equal(issue.split('\n')[1], '上次執行：2026-11-04T00:00:00.000Z');
  assert.equal(issue.split('\n')[2], '# 計畫健康');
  assert.match(full, /上次執行：2026-11-04T00:00:00.000Z/);
  assert.match(full, /工作區檔案/);
  assert.equal(full.includes('Last run:'), false);
  assert.equal(full.includes('<!-- plan-atlas:health -->'), false);
});

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-atlas-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const save = (file: string, data: unknown) => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
    return path;
  };
  const plan = (namespace: string, dependsOn?: { id: string; type: 'hard' }[]) => ({
    version: 1, namespace,
    nodes: [
      { id: namespace, title: namespace, parent: null, sources: ['plan.md'] },
      { id: 'X1', title: 'X1', parent: namespace, status: 'open', source: 'plan.md §1', ...(dependsOn ? { dependsOn } : {}) },
    ],
  });
  save('sdk/plan.json', plan('sdk', [{ id: 'api:Nope', type: 'hard' }]));
  save('api/plan.json', plan('api'));
  save('web/plan.json', plan('web'));
  const file = save('hub/plan-atlas.workspace.json', { version: 1, plans: [
    { namespace: 'sdk', path: '../sdk', file: 'plan.json' },
    { namespace: 'api', path: '../api', file: 'plan.json' },
    { namespace: 'web', path: '../web', file: 'plan.json' },
  ] });
  return { dir, save, file };
}

test('health writes the map and both reports and exits 0 with an ERROR finding', (t) => {
  const { dir, file } = fixture(t);
  const out = join(dir, 'atlas');
  const run = runCli('health', '--workspace', file, '--out', out, '--no-status');
  assert.equal(run.status, 0, run.stderr + run.stdout);
  for (const name of ['atlas.html', 'atlas.json', 'atlas.md', 'atlas.drawio', 'health.md', 'health-issue.md']) {
    assert.equal(existsSync(join(out, name)), true, name);
  }
  const report = readFileSync(join(out, 'health.md'), 'utf8');
  const issue = readFileSync(join(out, 'health-issue.md'), 'utf8');
  assert.match(run.stdout, /ERROR +V8/);
  assert.match(run.stdout, /health\.md/);
  assert.equal(report.split('\n')[0], '# Plan health');
  assert.equal(report.includes('<!-- plan-atlas:health -->'), false);
  assert.match(issue, /^<!-- plan-atlas:health -->\nLast run: \d{4}-\d{2}-\d{2}T/);
  const at = (needle: string) => {
    const index = report.indexOf(needle);
    assert.ok(index >= 0, needle);
    return index;
  };
  assert.ok(at('../sdk') < at('api:Nope') && at('api:Nope') < at('../api') && at('../api') < at('../web'));
  assert.match(report, /Nothing to report\./);

  const zhOut = join(dir, 'zh');
  const zh = runCliLang('zh-TW', 'health', '--workspace', file, '--out', zhOut, '--no-status');
  assert.equal(zh.status, 0, zh.stderr + zh.stdout);
  const zhReport = readFileSync(join(zhOut, 'health.md'), 'utf8');
  assert.match(zhReport, /沒有需要回報的內容/);
  assert.match(zhReport, /依賴/);
});

test('health writes both reports for a workspace with V0 errors and still exits 0', (t) => {
  const { dir, save } = fixture(t);
  const bad = save('hub/bad.json', { version: 1 });
  const out = join(dir, 'bad-out');
  const run = runCli('health', '--workspace', bad, '--out', out, '--no-status');
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(existsSync(join(out, 'atlas.html')), false);
  assert.match(readFileSync(join(out, 'health.md'), 'utf8'), /plans array/);
  assert.match(readFileSync(join(out, 'health-issue.md'), 'utf8'), /^<!-- plan-atlas:health -->\nLast run: /);
  assert.equal(readFileSync(join(out, 'health.md'), 'utf8').includes('## Path'), false);
});

test('health rejects a missing workspace, positional files and self options', (t) => {
  const { dir, file } = fixture(t);
  const rejected = join(dir, 'rejected');
  for (const args of [
    ['health'],
    ['health', '--no-status'],
    ['health', 'plan.json'],
    ['health', '--self', 'sdk'],
    ['health', '--workspace', file, '--out', rejected, 'plan.json', '--no-status'],
    ['health', '--workspace', file, '--out', rejected, '--self', 'sdk', '--no-status'],
    ['health', '--workspace', file, '--out', rejected, '--self-repo', 'org/sdk', '--no-status'],
    ['health', '--workspace', file, '--out', rejected, '--self-files', 'files.txt', '--no-status'],
    ['health', '--workspace', file, '--out', rejected, '--against', 'atlas.json', '--no-status'],
    ['health', '--workspace', file, '--out', rejected, '--annotations', 'notes.txt', '--no-status'],
  ]) {
    const run = runCli(...args);
    assert.equal(run.status, 2, `${args.join(' ')}\n${run.stderr}${run.stdout}`);
    assert.equal(existsSync(join(rejected, 'health.md')), false, args.join(' '));
  }
  for (const lang of ['en', 'zh-TW']) {
    const help = runCliLang(lang, '--help');
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /plan-atlas health/);
    assert.match(help.stdout, /--no-status/);
  }
});

test('health lists a missing path file and a namespace mismatch under their repositories', (t) => {
  const { dir, save } = fixture(t);
  save('wrong/plan.json', {
    version: 1, namespace: 'other',
    nodes: [
      { id: 'other', title: 'other', parent: null, sources: ['plan.md'] },
      { id: 'X1', title: 'X1', parent: 'other', status: 'open', source: 'plan.md §1' },
    ],
  });
  const file = save('hub/split.json', { version: 1, plans: [
    { namespace: 'gone', path: '../missing', file: 'plan.json' },
    { namespace: 'sdk', path: '../wrong', file: 'plan.json' },
  ] });
  const out = join(dir, 'split-out');
  const run = runCli('health', '--workspace', file, '--out', out, '--no-status');
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = readFileSync(join(out, 'health.md'), 'utf8');
  const general = report.split(/^## /m)[1] ?? '';
  assert.match(general, /^Workspace\n/);
  assert.match(general, /Nothing to report\./);
  assert.doesNotMatch(general, /Cannot read workspace entry/);
  assert.doesNotMatch(general, /does not match file namespace/);
  const gone = fencedBodies(report).find((body) => body.split('\n').includes('gone'));
  const sdk = fencedBodies(report).find((body) => body.split('\n').includes('sdk'));
  assert.match(gone ?? '', /Cannot read workspace entry gone/);
  assert.match(sdk ?? '', /Workspace namespace sdk does not match file namespace other/);
});

test('health reports a status error for each path entry that is not a git repository', (t) => {
  const { dir, file } = fixture(t);
  const out = join(dir, 'status-out');
  // Keep git from walking into a parent repository and using that history for these directories.
  const run = spawnSync(process.execPath, [cli, 'health', '--workspace', file, '--out', out], {
    encoding: 'utf8',
    env: { ...process.env, PLAN_ATLAS_LANG: 'en', GIT_CEILING_DIRECTORIES: dir },
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr + run.stdout);
  for (const name of ['health.md', 'health-issue.md']) {
    const text = readFileSync(join(out, name), 'utf8');
    for (const ns of ['sdk', 'api', 'web']) {
      const body = fencedBodies(text).find((block) => block.split('\n').includes(ns));
      assert.ok(body, `${name} ${ns}`);
      assert.match(body!, /^Status: /m, `${name} ${ns}`);
    }
  }
});
