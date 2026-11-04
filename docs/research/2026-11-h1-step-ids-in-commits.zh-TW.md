# H1／H3 驗證：外部 repo 的 commit 會引用計畫步驟編號嗎？（2026-11-03）

## 結論（先寫）

- **H1 只對一小群 repo 成立。** 17 個外部 repo 中，只有 4 個在最近 200 個 commit 裡引用計畫步驟編號，而且 plan-atlas 目前的比對規則抓得到：starling 39%、nj-mmo 26%、tv-labs/lua 8%（PR 標題＋內文 34%）、Infinite 6%。這 4 個都是 1–4 人、大量使用 agent、自訂短編號（`T232`、`Phase 30`、`B5`、`P1`）的 repo，和作者自己的 repo 是同一型。其餘 13 個是 0–5%，而且多半是雜訊或有歧義。
- **Spec Kit repo 不在 commit 裡引用 task id（T001）**：6 個 repo 都在 0–5%。T001 在每個 feature 都會重複出現，就算有引用也分不出是哪個 feature。這些 repo 是在 **feature 層級**和 git 連起來：分支名稱就是 `specs/<slug>`（finfocus PR #496 的 head 是 `124-budget-exit-codes`），conventional-commit 的 scope 是 feature 編號（alkem-io：`feat(092-apple-sign-in):`，最近 200 個中有 11%），或 feature 編號等於 issue 編號（finfocus `specs/1837-…` ↔ `(#1837)`）。
- **引用 issue／PR 編號遠比引用步驟常見**：不算 GitHub 自動加在 squash 標題後的 PR 號碼，commit 引用 `#N` 的比例在 wireguide 是 70%、finfocus 55%、ralphex 33%、apiops-cli 24%、peitho 22%。merged PR 內文寫 `closes/fixes #N` 的比例在 peitho、quotabar、tv-labs、apiops、finfocus 是 35–60%。
- **H3 部分成立。** 官方範本格式（`- [ ] T001 [P] [US1] 描述`、`## Phase N:`、`## Dependencies & Execution Order`）在 cc-spex、finfocus、mux-pod、apiops-cli 幾乎全部遵守，checkbox、id、phase、[P]、[US] 都能用 regex 解析。但有三點要注意：(1) **依賴是散文**，只有 0.1–3% 的 task 寫了行內的「depends on T0xx」，其餘寫在 phase／story 層級的說明段落裡；(2) **同一個 repo 裡格式也會漂移**，alkem-io 96 個 feature 中有 42 個不是範本格式（`T001 [X]`、`[T001]`、`T-001:`、`T1:`、`S-T001`、表格）；(3) commit 用**範圍寫法**引用 task（`T054-T056`），alkem 的 git log 出現 36 次、cc-spex 12 次。
- **checkbox 和 git 不一致的情形真的存在，但要在 feature 層級看。** 例如 finfocus 的 `124-budget-exit-codes`：PR #496 已在 2026-01-25 合併，tasks.md 仍是 0/61 打勾。task 層級則不可靠：我看了 3 個「commit 引用了但 checkbox 沒打勾」的案例，commit 本身都寫明延後或待手動處理，不是漂移。

## 方法

- 用 `gh search code` 找候選 repo（`specs/*/tasks.md`、`docs/plans`、`.agents/plans`、`PLANS.md`），再用 GraphQL 篩選：非 fork、未封存、最近 6 個月 ≥ 40 個 commit。排除作者自己的帳號與組織。最後選了 17 個。
- 每個 repo 用 `git clone --filter=blob:none --no-checkout` 取得，只用 `git ls-tree`／`cat-file` 讀計畫檔，沒有執行 repo 裡的任何內容。
- 「定義的 id」是各 repo 計畫檔裡實際出現的編號，用我為每個 repo 寫的 regex 抽取。「引用」沿用 `src/gitstatus.ts` 的全字比對規則，有區分大小寫。
- 範圍：default branch 最近 200 個 commit（含 merge commit），加上 `gh pr list --state merged --limit 100` 的標題、內文、head 分支。

## 各 repo 結果（最近 200 個 commit）

「步驟 id%」：commit 訊息引用 ≥1 個定義過的 id。「#issue%」：引用 `#N`，不算 squash／merge 自動加上的 PR 號碼。「PR id%」：merged PR 的標題或內文引用 id。

| repo | 類型 | 計畫 id 慣例 | commit 時間範圍 | 步驟 id% | PR id% | #issue% | scope% | 例子／說明 |
|---|---|---|---|---|---|---|---|---|
| starling-build/starling | plan docs | 看板 `T232`、`zh-3c055c9b` | 10-27..11-02 | **39** | –（1 PR） | 0 | 2 | `docs: word gaps board — T232 wip pushed, T233 zh-f2835e26 claimed` |
| tech-leads-club/nj-mmo | plan docs（.specs） | `Phase 30`、`AD-019`；每個 phase 內的 `T1` | 06-29..07-01 | **26** | –（無 PR） | 0 | 97 | `docs(specs): record Verifier PASS …, flip Phase 30 to done`；id 中含空格 |
| tv-labs/lua | agent（.agents/plans） | 檔名 `A13-…`、`B5-…` | 02-10..07-29 | **8** | **34**（內文） | 3 | 74 | `plans(B5): pivot from BEAM codegen …`；`chore(plans): scope B4-B8 …`（範圍） |
| n1m21n/Infinite | agent（docs/plans） | 表格列 `P1`、`S1`、`W2` | 10-31..11-03 | **6** | 19（4/21） | 0 | 0 | `3D next P1+P2: …`；`M2` 這種短 id 有誤判（是量測標籤） |
| alkem-io/server | Spec Kit | `T001`／feature `092-apple-sign-in` | 08-28..11-02 | 5（T id 在內文，有歧義） | 4 | 17 | 37 | `feat(086-app-push-mvp): …`；feature 編號放在 scope：11% |
| thegeronimo/hyperopen | agent（ExecPlan） | `Milestone N` + 計畫路徑 | 08-20..10-31 | 3 | –（無 PR） | 0 | 73 | 內文寫 `Milestone 4 of docs/exec-plans/active/…md`；7% 引用計畫路徑 |
| rshade/finfocus | Spec Kit | `T001`／`1837-spot-…`（= issue 號） | 10-09..11-02 | 2 | 3 | 55 | 90 | `feat(engine): … (#1837) (#2008)`；104/125 個 feature 找得到同名分支或訊息 |
| mizzy/peitho | plan docs | `Milestone N`、`Task N`（每份計畫重新編號） | 09-22..10-24 | 1.5（`Task N`，無法對應） | 17 | 22 | 20 | 分支 `issue-740-partial-line-emphasis`；52% 的 PR 對得上計畫 slug |
| umputun/ralphex | plan docs | `Task N`（每份計畫重新編號） | 03-17..11-02 | 0.5 | 0 | 33 | 21 | `docs: add backlog item from the #459 review` |
| korjwl1/wireguide | Spec Kit 變體 | `T001`，無 [P]／[US] | 09-15..10-26 | 0 | 0 | **70** | 83 | `fix(windows): … (refs #59)`；早期 4 個 commit 在內文寫 `T029-T030` |
| Azure/apiops-cli | Spec Kit | `T001`（單一 tasks.md） | 06-16..10-09 | 0 | 1 | 24 | 7 | PR #151 刻意把 `T0XX` 從程式碼註解拿掉 |
| moezakura/mux-pod | Spec Kit | `T001`；4 個 feature 都編成 `001-…` | 04-03..10-21 | 0 | 0 | 13 | 39 | `feat: support SSH jump host … (#131)` |
| rhuss/cc-spex | Spec Kit（工具本身） | `T001`／`058-codex-ship-progress` | 06-12..11-02 | 0（完整歷史共 10 個） | 0 | 7 | 19 | `Add task breakdown for focused smoke test (#029)` |
| majiayu000/quotabar | Spec Kit 變體 | `specs/GH186`、`SP186-T1`（= issue 號） | 09-04..11-02 | 0 | 6 | 17 | 60 | PR #187 `… (#186)`，內文寫 `SP186-T4` |
| team9ai/team9 | plan docs | `Task N`（每份計畫重新編號） | 05-11..06-10 | 0 | 9（`Task N`，無法對應） | 0 | 49 | `docs: record t9 dev efs migration` |
| BrokkAi/mjolnir | agent（ExecPlan） | 檔名是 slug 或 issue 號（`1302-…`） | 10-27..11-03 | 0 | 0 | 11 | 0 | 19% 的 PR 內文寫 `The full ExecPlan is in .agents/plans/<slug>.md` |
| LibPDF-js/core | agent（.agents/plans） | `001-scanner`（純數字） | 01-12..11-02 | 0 | 0 | 3 | 28 | slug 命中的是一般字詞（`benchmarks`），算雜訊 |

只看 id 比對時的分組結果：Spec Kit 0/6（加上 quotabar 是 0/7）；plan docs 2/5（用 `Task N` 的那幾個不可能命中）；agent 型 2/5。

## Spec Kit：H3 結構與 checkbox 對 git

| repo | feature 數 | task 數（打勾） | 有 Phase 標題 | [P] | 行內依賴 | 不符範本格式 |
|---|---|---|---|---|---|---|
| rhuss/cc-spex | 54 | 1142（91%） | 51 | 401 | 1 | 2 個 feature 沒有 T 行 |
| rshade/finfocus | 125 | 4248（98%） | 122 | 1563 | 21 | 0 |
| alkem-io/server | 96 | 1734（93%） | 59 | 609 | 53 | **42** 個 feature（另有 1077 個非 T 的 checkbox） |
| moezakura/mux-pod | 9 | 445（61%） | 9 | 145 | 0 | 0 |
| Azure/apiops-cli | 1 | 57（72%） | 1 | 16 | 0 | 0 |
| korjwl1/wireguide | 3 | 156（82%） | 3 | 0 | 0 | 45 個非 T 的 checkbox |

feature 層級的漂移候選（feature 已合併，tasks.md 卻沒打完勾）：
- finfocus `124-budget-exit-codes`：PR #496（head 就是這個 slug）已合併，0/61。另外 `589-coderabbit-cleanup` 是 39/50，`001-plugin-init-recorder` 是 20/28。
- mux-pod `001-flutter-migration`：commit c3603b9「complete Flutter migration (Phase 1-8)」改過 tasks.md，但只打勾 31/107，而 repo 已有 419 個 `.dart` 檔。
- alkem-io：12 個 feature 在已合併分支或 commit 訊息中找得到 slug，但只部分打勾，例如 `037-self-hosted-runners` 10/30、`095-collabora-import` 29/34。
- 「commit 引用了、但 checkbox 沒打勾」的 task 層級候選：wireguide T029、finfocus T017、cc-spex T075。三個 commit 都自己寫明「deferred」或「manual pending」，所以是誤報。引用不代表完成。

## 對 onboarding 的意義

外部使用者第一個實際可得的發現，依 repo 類型而定：

1. **Spec Kit 使用者（樣本中最大的一群）**：不靠 AI 匯入 `tasks.md`，再比對「feature 分支已合併，但 tasks.md 沒打完勾」。秒級就能完成，也有真實命中（finfocus #496）。不要賣 task 層級的 `status --git`。
2. **以 issue 為主的 repo**（peitho、ralphex、quotabar、wireguide、finfocus、mjolnir）：計畫是透過 issue 號和 git 連起來的（分支 `issue-740-…`、檔名 `1302-…`、`specs/GH186`、`closes #N`）。這條路是旅程 B 或 `status --github`：把計畫對應到 issue，再讀 issue／PR 狀態，不要依賴步驟 id。
3. **自訂短 id 的 agent repo**（starling、nj-mmo、tv-labs、Infinite）：現在的 `status --git` 就能用，但需要支援範圍（`B4-B8`、`T054-T056`）、含空格的 id（`Phase 30`），並且留意短 id 的誤判（`M2`）。
4. **跨計畫檢查**：這次沒有量測，沒有資料。

建議先做：
- (a) Spec Kit 匯入器：用範本 regex 解析，遇到變體時給 WARN，不要靜默丟掉。再加上 feature 層級的狀態建議，證據來源是 merged PR 的 `headRefName`，或 merge commit 的 `from <owner>/<slug>`。
- (b) `status --git` 也搜尋 PR 標題和內文、分支名稱，支援範圍寫法，並且接受「計畫路徑＋步驟」這種引用（hyperopen：`Milestone 4 of docs/exec-plans/…md`）。
- (c) 用 issue 號連結（`status --github`）。
- 把「commit 引用了步驟」只當成「請確認」，不要當成「已完成」。這次的樣本裡，被引用但沒打勾的 task 都是刻意延後的。

## 注意事項

- 樣本只有 17 個，而且是我從 code search 結果挑的。code search 只索引 default branch，每個查詢最多回傳 100 筆，偏向新的、小型的 repo。
- 活動門檻（≥ 40 commit／6 個月）會偏向 agent 密集的單人 repo：有 4 個 repo 的最近 200 個 commit 只橫跨 3–7 天。
- 「定義的 id」是我為每個 repo 寫的 regex 抽出來的，可能漏掉其他編號慣例。slug 比對對一般字詞有雜訊（LibPDF、Infinite 的 `website`），表格只用 id 欄位下結論。
- 分母包含 merge commit（peitho 的 200 個裡有 91 個）。如果只算非 merge commit，比例會略高，但不會改變結論。
- AI trailer 比例（starling 60%、peitho 54%）只是下限：hyperopen 和 nj-mmo 明顯有用 agent，卻沒有留下 trailer。
- H2、H8（雜訊量）沒有量測。漂移候選沒有逐一確認，可能是刻意不打勾。
