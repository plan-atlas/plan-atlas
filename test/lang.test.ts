import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { checkCoupling, derive, drawio, load, loadFiles, markdown, mergePlans, pageMermaid, parsePlan, renderHtml, validate, viewModel } from '../src/index.ts';
import { example, node } from './helpers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'src/cli.ts');
// CJK text, CJK punctuation and full-width forms: none may appear in English output
const cjk = /[\u3000-\u9fff\uff00-\uffef]/;
const run = (args: string[], lang?: string) => {
  const env = { ...process.env };
  delete env.PLAN_ATLAS_LANG;
  if (lang !== undefined) env.PLAN_ATLAS_LANG = lang;
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', env,
  });
  if (result.error) throw result.error;
  return result;
};

test('V0 and V11 keep their Traditional Chinese wording on request', () => {
  assert.equal(parsePlan(null).findings[0].message, 'File is not a JSON object');
  assert.equal(parsePlan(null, 'zh-TW').findings[0].message, '檔案不是 JSON 物件');
  const p = example('bookshop');
  node(p, 'C3').status = 'done';
  const en = load([p]);
  const zh = load([p], undefined, 'zh-TW');
  assert.equal(zh.findings.find((f) => f.code === 'V11')!.message, 'C3 已完成，但前置還沒完成：C2、T1；狀態或計畫有一邊過時');
  assert.doesNotMatch(en.findings.map((f) => f.message).join('\n'), cjk);
  assert.deepEqual(derive(en.model!), derive(zh.model!));
  assert.deepEqual(validate(en.model!, undefined, 'zh-TW'), zh.findings);
});

test('merge and coupling accept a language without changing their findings or rule codes', () => {
  const p = example('bookshop');
  assert.equal(mergePlans([p, p], 'zh-TW').findings[0].message, '兩個檔案使用同一個 namespace：bookshop');
  assert.doesNotMatch(mergePlans([p, p]).findings[0].message, cjk);
  const after = structuredClone(p);
  node(after, 'C3').dependsOn = node(after, 'C3').dependsOn!.filter((d) => d.id !== 'T1');
  const zh = checkCoupling(p, after, [], 'zh-TW');
  assert.equal(zh[0].message, '刪除了跨群組依賴：T1 → C3，但它引用的 docs/plans/checkout-v2.md 沒有在同一次變更中修改；請先更新計畫文字，或請人確認');
  assert.deepEqual(zh.map((f) => [f.level, f.code, f.nodes]), checkCoupling(p, after, []).map((f) => [f.level, f.code, f.nodes]));
});

test('English HTML and other renderers contain no CJK; Chinese is selected separately', () => {
  const { model, findings } = load([example('bookshop'), example('warehouse')]);
  const html = renderHtml(model!, findings);
  assert.doesNotMatch(html, cjk);
  assert.doesNotMatch(html, /\{\{ui\w+\}\}/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, />☰ Outline<\/button>/);
  assert.match(html, />← Up one level<\/button>/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  assert.doesNotThrow(() => new Script(script));
  assert.doesNotMatch(markdown(model!, findings), cjk);
  assert.doesNotMatch(drawio(model!), cjk);
  for (const p of model!.pages.values()) assert.doesNotMatch(pageMermaid(model!, p), cjk);
  const zh = renderHtml(model!, findings, undefined, 'zh-TW');
  assert.match(zh, /<html lang="zh-TW">/);
  assert.match(zh, />☰ 大綱<\/button>/);
  assert.match(zh, />← 上一層<\/button>/);
  assert.equal(viewModel(model!, findings, 'zh-TW').ui.uiDone, '已完成');
  assert.match(markdown(model!, findings, 'zh-TW'), /驗證結果/);
  assert.match(drawio(model!, 'zh-TW'), /完成 1・可開工 1・被擋 1/);
  assert.match(pageMermaid(model!, model!.pages.get('bookshop')!, 'zh-TW'), /完成 1・可開工 1・被擋 1/);
});

test('a virtual root without a plan title is localized by each renderer', () => {
  const { model } = load([{ version: 1, nodes: [] }]);
  assert.equal(model!.pages.get('@root')!.title, 'Overview');
  const pages = viewModel(model!, [], 'zh-TW').pages as Record<string, { title: string }>;
  assert.equal(pages['@root'].title, '總覽');
  assert.match(markdown(model!, [], 'zh-TW'), /## 總覽/);
  assert.match(drawio(model!, 'zh-TW'), /name="總覽"/);
});

test('CLI language selection is flag, then environment, then English, including build and coupling', (t) => {
  const dir = mkdtempSync(join(root, '.plan-atlas-lang-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'plan.json');
  writeFileSync(path, 'null');
  const english = run(['check', path]);
  assert.equal(english.status, 1, english.stderr);
  assert.match(english.stdout, /File is not a JSON object/);
  const zh = run(['check', path, '--lang', 'zh-TW'], 'en');
  assert.equal(zh.status, 1, zh.stderr);
  assert.match(zh.stdout, /檔案不是 JSON 物件/);
  const env = run(['check', path], 'zh-TW');
  assert.match(env.stdout, /檔案不是 JSON 物件/);
  const override = run(['check', path, '--lang', 'en'], 'invalid');
  assert.equal(override.status, 1, override.stderr);
  assert.doesNotMatch(override.stdout, cjk);
  const plan = example('bookshop');
  writeFileSync(path, JSON.stringify(plan));
  assert.match(loadFiles([path], undefined, 'zh-TW').findings[0].message, /的狀態是推論/);
  const out = join(dir, 'atlas');
  const built = run(['build', path, '--lang', 'zh-TW', '--out', out], 'en');
  assert.equal(built.status, 0, built.stderr);
  assert.match(readFileSync(join(out, 'atlas.html'), 'utf8'), /<html lang="zh-TW">/);
  const before = join(dir, 'before.json'), changed = join(dir, 'changed.txt');
  writeFileSync(before, JSON.stringify(plan));
  node(plan, 'C3').dependsOn = node(plan, 'C3').dependsOn!.filter((d) => d.id !== 'T1');
  writeFileSync(path, JSON.stringify(plan));
  writeFileSync(changed, 'plan.json\n');
  const coupling = run(['coupling', '--before', before, '--after', path, '--changed', changed, '--lang', 'zh-TW'], 'en');
  assert.equal(coupling.status, 1, coupling.stderr);
  assert.match(coupling.stdout, /刪除了跨群組依賴/);
});

test('CLI rejects an invalid language with English text and exit 2 on every command', () => {
  for (const cmd of ['check', 'build', 'status', 'coupling']) {
    const result = run([cmd, '--lang', 'fr'], 'zh-TW');
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'Invalid language "fr"; use en or zh-TW');
  }
  const env = run(['check', 'examples/bookshop/plan.json'], 'fr');
  assert.equal(env.status, 2, env.stderr);
  assert.equal(env.stderr.trim(), 'Invalid language "fr"; use en or zh-TW');
  assert.equal(run(['check', 'examples/bookshop/plan.json'], '').status, 2);
});

test('findings name the virtual top page in the language they are printed in', () => {
  const item = (id: string) => ({ id, title: id, parent: null, status: 'open' as const, source: 'plan.md §1' });
  const plan = { version: 1, rules: { maxPageNodes: 3 }, nodes: ['A', 'B', 'C', 'D'].map(item) };
  const zh = load([plan], undefined, 'zh-TW');
  const en = validate(zh.model!, undefined, 'en').find((f) => f.code === 'V5')!;
  assert.match(en.message, /^"Overview" has 4 nodes/);
  assert.match(validate(load([plan]).model!, undefined, 'zh-TW').find((f) => f.code === 'V5')!.message, /^「總覽」頁/);
});

test('Traditional Chinese CLI help, counts, usage errors and build summary are translated', (t) => {
  const dir = mkdtempSync(join(root, '.plan-atlas-lang-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const english = /\b(?:Usage|Validate|error\(s\)|warning\(s\)|needs|give|unknown command|wrote|is not a valid plan)\b/;
  const help = run(['--help'], 'zh-TW');
  assert.doesNotMatch(help.stdout, english);
  assert.match(help.stdout, /用法/);
  const checked = run(['check', 'examples/bookshop/plan.json'], 'zh-TW');
  assert.match(checked.stdout, /\n0 個錯誤、0 個警告、\d+ 個提醒\n$/);
  const built = run(['build', 'examples/bookshop/plan.json', '--out', join(dir, 'atlas')], 'zh-TW');
  assert.equal(built.status, 0, built.stderr);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{"version":1}');
  for (const [args, status] of [[['check'], 2], [['coupling'], 2], [['nope'], 2],
    [['coupling', '--before', bad, '--after', bad, '--changed', bad], 1]] as const) {
    const r = run([...args], 'zh-TW');
    assert.equal(r.status, status, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, english, args.join(' '));
    assert.match(r.stdout + r.stderr, cjk);
  }
  assert.doesNotMatch(built.stdout, english);
});
