# plan-atlas 第一批外部使用者：前 30 分鐘、管道與輸入

日期：2026-11-03。依據：repo 內 README.md、AGENTS.md、docs/ROADMAP.md，PoC 的筆記（未公開），加上網路調查（每項外部說法附 URL；第三方或社群來源另外標示）。

## 結論與建議（先寫）

1. **起點輸入：repo 裡的 markdown 計畫，由使用者自己的 agent 擷取，但一次只擷取一份計畫。** 這是 plan-atlas 獨有發現（計畫文字落後 git、兩份計畫互相矛盾、跨 repo 參照斷掉）的來源。PoC 一次擷取整個 repo 要 6–30 分鐘 agent 時間，所以前 30 分鐘只能做一份計畫加 `status --git`，不能整個 repo 一起做。
2. **GitHub Issues 當第二個入口，不當主入口。** sub-issues、blocked-by、issue types 都已有 REST、GraphQL 和 `gh` 支援（見 §1），所以 adapter 不需要 AI，幾秒就能產生地圖。但 Issues 的關係只存一份，不會出現「兩份計畫互相矛盾」（V9）。能抓的主要是「已關閉但仍被未關閉 issue 擋住」與「父 issue 關閉、子 issue 未關閉」。它的價值是**地圖**（GitHub 沒有依賴圖檢視，見 §4）和作者自己 dogfood，不是主要賣點。
3. **管道順序：npm 套件 → agent skill（包成 Claude Code plugin，同一份 SKILL.md 給 Codex 用）→ GitHub Action → MCP 最後或不做。** Action、plugin、MCP registry 最後都要呼叫 `npx`，而 Node 不會剝除 `node_modules` 裡的 TypeScript 型別（§2），所以 build step 加 npm 發布是一切的前提。
4. **第一次執行的體驗照 Renovate 的「onboarding PR」做**：skill 開一個「Configure plan-atlas」PR，內含計畫 JSON、CI workflow，PR 說明裡直接放第一份真實發現。CI 這層（每個 PR 都跑）在第 2 天才開始，第 1 天只要第一份發現。
5. **要先做的功能（依序）**：build step 和 npm 發布、英文訊息、`plan-atlas-onboard` skill（範圍限定在一份計畫，並在 PR 說明產生報告）、`status --git` 支援範圍寫法（A4-A6）、GitHub Issues adapter（`from-github`），最後才是 Action。
6. **最大的未驗證假設**：外部使用者的 commit 是否引用計畫步驟編號。如果沒有，`status --git` 什麼都找不到，路線 A 的第一個發現就只剩跨計畫的矛盾。這要先找 3–5 個外部 repo 驗證（§6）。

## 1 GitHub Issues 輸入

### 現況（2026-11）

| 功能 | 狀態 | REST | GraphQL | `gh` CLI | 限制 |
|---|---|---|---|---|---|
| Sub-issues | 文件未標 preview | `GET .../issues/{n}/sub_issues`、`GET .../issues/{n}/parent`、POST、DELETE，以及 PATCH `priority` [1] | `Issue.subIssues`、`parent`、`subIssuesSummary`、`addSubIssue` [3] | v2.94.0 起有 `--parent`、`--add-sub-issue` 等旗標 [4] | 每個父 issue 最多 100 個子 issue，最多 8 層；可以加入其他 repo 的 issue [5]；「sub-issue 必須與父 issue 屬於同一個 owner」[1] |
| Issue dependencies（blocked by／blocking） | 2025-08-21 GA [6] | `GET/POST .../dependencies/blocked_by`、`GET .../dependencies/blocking`、DELETE [2] | `Issue.blockedBy`、`blocking`、`issueDependenciesSummary`、`addBlockedBy` [3] | `--blocked-by`、`--blocking`、`--add-blocked-by` [4] | 每種關係最多 50 個 [6]；**能否跨 repo：官方文件沒寫（not found）** |
| Issue types | REST 管理 2025-03 [7] | 有（org 層級） [7] | `Issue.issueType` [3] | `gh issue` 可設定和篩選 type [4] | 只限 organization，最多 25 種 [8]；個人帳號的 repo 用不到 |
| Projects 欄位 | 2025-09 新增 REST：列出 project、欄位、項目，並更新欄位值 [9] | 有 [9] | ProjectV2（早已存在） | `gh project`（本次沒有核對細節） | — |
| Milestone | 早已存在 | 有 | `Issue.milestone` [3] | 有 | — |

`gh issue view/list --json` 新增 parent、sub-issue、type、dependency 欄位 [4]。第三方文章列出欄位名稱 `parent,subIssues,subIssuesSummary,blockedBy,blocking` [10]。

**Rate limit**：PAT 為每小時 5,000 次 REST 請求、GraphQL 5,000 點；Actions 的 `GITHUB_TOKEN` 是每個 repo 每小時 1,000 次（GraphQL 1,000 點），Enterprise Cloud 為 15,000 [11][12]。GraphQL 另有每分鐘 2,000 點的次要限制 [12]。一個有 300 個 issue 的 repo 用 GraphQL 分頁（每頁 100 筆，巢狀抓 subIssues 和 blockedBy），估計只要幾十點，不是瓶頸（推估，還沒實測）。
**跨 repo 的權限**：`GITHUB_TOKEN`「的權限只限於包含這個 workflow 的 repo」[13]。在 CI 裡讀另一個私有 repo 的 issue 需要 PAT 或 GitHub App。在本機用 `gh` 的登入就沒有這個問題。

### 不靠 AI 的 adapter 可行嗎？可行。對應如下

| plan-atlas | GitHub | 備註 |
|---|---|---|
| 頂層群組 | repo，或 milestone | 用 milestone 分群會和 sub-issue 樹衝突，建議 sub-issue 樹優先，milestone 只當標籤 |
| 群組 | 有 sub-issues 的 issue | 群組不能有 `status`（AGENTS.md），父 issue 本身的 open/closed 要拿來和推導出的狀態比對，不寫進資料 |
| 項目 | 沒有 sub-issues 的 issue | `status` = closed → done（`state_reason: not_planned` → 未來的 `cancelled`） |
| `dependsOn` hard | blocked-by | `source` = issue URL；`quote` 取不到計畫原文，要放寬 V8（例如 `source` 是 issue URL 時不需要 quote） |
| `kind: release` | milestone 或 tag | 推論，需要設計 |
| namespace | `owner/repo` | 跨 repo 的 sub-issue 自然變成 `<ns>:<id>` |

**Issues 輸入能抓到的發現**（是否符合實際，要用真實 repo 驗證）：
- 已關閉的 issue，blocked-by 還沒關閉（V11 的對應）。GitHub 是否禁止這種情況：not found。
- 父 issue 已關閉，但子 issue 未關閉（V2 的對應）；或子 issue 全部關閉，父 issue 還開著。
- blocked-by 形成循環（V6）。GitHub 是否禁止循環：not found。
- `status --git`：commit 引用 `#123`，但沒有用 closing keyword，issue 還開著。
- 抓不到：V9（關係只存一份，兩邊不可能說法不同）、V10（沒有計畫文件）、「計畫文字落後」。

## 2 發布管道

| 管道 | 需要什麼 | 使用者第一步 | 到第一個結果多快 | 適合 plan-atlas 的哪一段 |
|---|---|---|---|---|
| npm／`npx` | build step（Node 拒絕處理 `node_modules` 下的 TS：「To discourage package authors from publishing packages written in TypeScript」[14]）、npm 帳號 | `npx plan-atlas ...` | 秒級，**但需要已經有 plan JSON** | 所有其他管道的基礎 |
| GitHub Action（Marketplace） | 公開 repo、根目錄只能有一個 `action.yml`、名稱不能重複、2FA、同意開發者協議；符合條件就立即上架，不經審核 [15] | 寫 workflow，或接受 onboarding PR | 下一個 PR | 第 2 天：每個 PR 都跑。fork 來的 PR，`GITHUB_TOKEN` 是唯讀 [16]，不能留言；但 job summary 支援 GFM、每步 1 MiB [17]，可以當作不需要寫入權限的報告位置 |
| Claude Code plugin／skill | `.claude-plugin/plugin.json` 加 `skills/*/SKILL.md`；可以自架 marketplace repo（`/plugin marketplace add`），也可以申請進 Anthropic 目錄 [18] | `/plugin` 安裝後，對 agent 說「map my plans」 | 擷取一份計畫約 6 分鐘以上（PoC 的下限） | **第 1 天的主要入口**：擷取需要 agent，plan-atlas 本身沒有 LLM |
| Codex skills／AGENTS.md | Codex skills 採用 open agent skills standard，會掃描從工作目錄到 repo 根目錄的 `.agents/skills` [19]；據第三方說法，同一格式約有 30–40 種工具支援 [20] | 把 skill 資料夾複製到 `.agents/skills/` | 同上 | 同一份 SKILL.md 共用；plan-atlas 的 AGENTS.md 已經是寫給 agent 的規則 |
| MCP server | 官方 registry 只存 metadata，套件要先發布到 npm；需要 `server.json`、`mcpName`，仍是 preview（第三方指南）[21] | 設定 MCP | 和 skill 相同，多一個常駐程序 | 價值低：agent 本來就能執行 CLI，MCP 只是多一層。等有人要求「讓 agent 查詢地圖」時再做 |

**最短路徑**：一個人只要用 agent，「skill 加 `npx`」最快。一個團隊要每個 PR 都跑，就用「onboarding PR 加 Action」。MCP 不在最短路徑上。

## 3 同類工具的上手模式

| 工具 | 第一次的動作 | 第一個結果 | 可借用的模式 |
|---|---|---|---|
| Renovate | 安裝 App 後自動開「Configure Renovate」PR，內含 `renovate.json`、發現的警告；合併前不做任何事；關閉即退出 [22]。PR 說明的「What to Expect」列出之後會開的 PR（範例 [23]） | **還沒設定就先看到預覽** | onboarding PR，先給發現，設定之後再說 |
| Renovate Dependency Dashboard | 一個 issue，持續更新所有待處理的項目、被否決的項目，可以勾選重做 [24] | 長期的總覽 | plan-atlas 的「計畫健康」issue：V9／V11 的清單 |
| Dependabot | 開啟 alerts 就能看到弱點，不需要設定檔；version updates 才需要 `dependabot.yml` [25] | 零設定的發現 | 零設定預設：`npx plan-atlas scan` 不需要設定檔就能產生報告 |
| CodeRabbit | 登入、選 repo，「No credit card required」；下一個 PR「within minutes」就有回饋，客製化是之後的事 [26] | 下一個 PR | 預設就有用，規則之後再加 |
| Changesets bot | 在 PR 留言：可能需要 changeset，並附預填檔名的連結 [27] | PR 留言 | 「你改了 cross-group 依賴，但沒改計畫文件」（V10）用同樣的語氣，附修正連結 |
| Danger JS | `danger init`；起始的 Dangerfile 只列出變更的檔案，但要先設好驗證 [28] | 設定完 CI 之後 | 反例：第一個結果要等 CI 驗證設定好 |
| husky | `npx husky init` 建立 `.husky/pre-commit`，並改 `prepare` script [29] | 下一次 commit | `init` 只寫檔案，不產生發現 |
| log4brains／adr-tools | `log4brains init` 會建立範本和第一份 ADR，`preview` 在本機開 UI [30]；`adr init` 建立第一份 ADR [31] | 本機網頁／檔案 | 本機預覽：對應 `atlas.html` |

**共同點**：會讓人留下來的工具（Renovate、Dependabot、CodeRabbit），**第一個結果是關於使用者自己 repo 的真實發現，而且不需要先寫設定檔**。`init` 類工具（husky、Danger、adr-tools）只產生骨架，第一個價值要等之後。plan-atlas 的 `check` 目前要先有 JSON，屬於後者，所以 onboarding 要把「擷取＋檢查」包成一個動作。

## 4 相鄰／競品

| 工具 | 做什麼 | 不做什麼（相對 plan-atlas） |
|---|---|---|
| GitHub Projects roadmap | 依日期或 iteration 欄位畫時間軸，有 milestone 標記，拖拉改日期，依欄位分組 [32]；被擋住的 issue 在 project 中有標示 [6] | 依賴圖檢視：not found；不比對計畫文件和 git |
| Linear 專案依賴 | 只有 end-to-start；timeline 上畫線，日期衝突時線變紅，可以篩選違反的依賴 [33] | 跨團隊：文件沒寫；只比日期，不比文件出處 |
| Jira Plans（Advanced Roadmaps） | Dependencies report 唯讀，日期不一致時箭頭變紅 [34]；據社群回報，計畫外的依賴不在 report 裡，跨計畫的可見度還是功能請求 [35] | 不檢查計畫文字；跨計畫弱 |
| Zenhub | 依賴可以跨 repo，但限同一個 workspace [36]；roadmap 上有線 | 同上 |
| GitHub Spec Kit（約 146k stars）[37] | 每個 feature 有 spec、plan、tasks；`analyze` 唯讀檢查 spec、plan、tasks 的覆蓋和一致性，依嚴重度排序（社群鏡像）[38] | 範圍是單一 feature；不跨 feature 或 repo，不比對 git 狀態（就目前資料，not found） |
| Task Master（約 28k stars）[39] | tasks.json；`validate-dependencies` 檢查循環和缺少的 id，`fix-dependencies` 自動修正（社群鏡像）[40]；MCP 加 `npx` | 內含 LLM；單一專案；不要求出處，不比對 git |
| Markplane（193 stars）[41] | markdown 加 YAML 的項目，`blocks`／`depends_on`，`markplane check` 驗證交叉參照，MCP，依賴圖 | 多 repo：沒寫；沒有計畫文字和資料一致性的檢查 |
| plan-as-code 等 [42] | YAML 計畫產生 Gantt 和依賴圖 | 只做轉換，不檢查 |
| adr-tools [31] | ADR 編號和 supersede 連結 | 決策，不是工作依賴 |

**定位結論**：大部分工具只檢查單一來源內部的結構（循環、缺 id、日期衝突）。目前找到的工具都不做這四件事：（a）兩份計畫對同一個依賴說法不同，（b）計畫文字和 git 不一致，（c）依賴必須附原文出處，（d）跨 repo 的 release 依賴。Spec Kit 的使用者正是「agent 維護計畫」的人群，而且規模大，是最可能的第一批外部使用者，plan-atlas 可以當它的跨 feature 檢查層（假設，§6）。

## 5 建議的使用者旅程

### 旅程 A：「我的 agent 寫的計畫在 repo 裡」（主要）

- **起點**：repo 裡有 `docs/plans/*.md`、`.agents/PLANS/`，或 Spec Kit 的 `specs/*/tasks.md`；使用 Claude Code 或 Codex。
- **指令**：
  ```
  /plugin marketplace add <owner>/plan-atlas
  /plugin install plan-atlas@<owner>
  > /plan-atlas:onboard docs/plans/checkout.md     # 一份計畫，不做整個 repo
  ```
  skill 依 AGENTS.md 擷取 JSON，接著執行 `npx plan-atlas check` 和 `npx plan-atlas status --git . plan.json`，最後開 `atlas.html`。
- **前 30 分鐘看到什麼**：第 1–2 分鐘安裝；第 3–10 分鐘擷取一份計畫（PoC 下限 6 分鐘）；第 10–12 分鐘看到報告。報告依序列出：git 建議的狀態（例如「C3 在 #211 已合併，計畫還寫未完成」）、V8 斷掉的參照、V11 停滯的關卡，接著是地圖。第 15–30 分鐘：skill 問要不要開「Configure plan-atlas」PR（計畫 JSON 加 workflow，PR 說明附上報告）。
- **要先做的功能**：build step 和 npm 發布；英文訊息；`onboard` skill（限定一份計畫、產生報告和 PR 說明、預設不寫 `inferred` 的猜測）；`status --git` 支援範圍寫法；報告依「需要你決定」排序，並且一則陳述只報一次（PoC 教訓 3）。

### 旅程 B：「我只用 GitHub Issues」（第二入口、作者 dogfood）

- **起點**：有 sub-issues 或 blocked-by 的 repo，或多個 repo；已用 `gh auth login` 登入。
- **指令**：
  ```
  npx plan-atlas from-github owner/repo [owner/repo2] --out atlas
  npx plan-atlas check atlas/plan.*.json && open atlas/atlas.html
  ```
- **前 30 分鐘看到什麼**：不用 AI，1 分鐘內出現可以鑽入的地圖（父 issue → 子 issue，blocked-by 的線），加上「已關閉但仍被擋」「父關子開」「循環」的清單。第 5–30 分鐘：在 Actions 排程每天跑一次，結果寫進一個「Plan health」issue（Renovate Dashboard 模式）。
- **要先做的功能**：`from-github` adapter（只用 GraphQL，讀取 `gh auth token` 或 `GITHUB_TOKEN`）；V8 接受 issue URL 當出處；`cancelled`（對應 `not_planned`）；「父 issue 狀態和推導狀態不一致」的規則（新的 code、測試、README 列）。

### 旅程 C：「每個 PR 都檢查」（第 2 天，A 或 B 之後）

- **起點**：A 的 onboarding PR 已經合併。
- **指令**：workflow 用 `uses: <owner>/plan-atlas-action@v1`，執行 `check --against`、和 base branch 比對的 `coupling`、`status --git`。
- **看到什麼**：每個 PR 的 job summary（fork 也能看）。如果有寫入權限，也會在 PR 留言：「這個 PR 改了 cross-group 依賴，但沒改 `docs/plans/x.md`」，或「commit 引用 C5，計畫仍是 open」。
- **要先做的功能**：Action（ROADMAP 第 5 項），Mermaid 摘要寫進 job summary，留言要能更新同一則（不要每次推送都新增一則）。

## 6 待驗證的假設

| # | 假設 | 為什麼重要 | 怎麼驗證（便宜的方法） |
|---|---|---|---|
| H1 | 外部使用者的 commit 會引用計畫步驟編號（PoC 三個 repo 都有，但都是作者的） | 不成立時 `status --git` 什麼都找不到，旅程 A 的第一個發現就沒了 | 在 GitHub 找 10 個有 `docs/plans` 或 `specs/*/tasks.md` 的公開 repo，用 grep 看 commit 訊息 |
| H2 | 只擷取一份計畫，10 分鐘內就能產生至少一個真實發現 | 30 分鐘目標的核心 | 在 3 個外部公開 repo 計時 |
| H3 | Spec Kit 的 `tasks.md` 格式固定，可以不靠 AI 解析 | 成立的話，旅程 A 對 Spec Kit 使用者可以變成秒級 | 讀 Spec Kit 的 tasks 範本（本次沒有讀到官方文件） |
| H4 | GitHub 允許「關閉被擋住的 issue」和「關閉有未關閉子 issue 的父 issue」 | 決定旅程 B 有沒有發現可報 | 在測試 repo 試做 |
| H5 | blocked-by 可以跨 repo | 決定 B 的跨 repo 地圖 | 用 `gh issue edit --add-blocked-by <其他 repo 的 URL>` 試 |
| H6 | 使用者願意讓 agent 開 onboarding PR，而不是只看本機報告 | 決定 C 的轉換率 | 前 5 位使用者訪談 |
| H7 | job summary 會渲染 Mermaid | 決定 C 的地圖能不能出現在 CI | 試一次 workflow |
| H8 | 一則陳述只報一次之後，外部計畫的雜訊仍然可以接受（PoC：16 個警告，全部是真的） | 第一次看到 50 個警告的人會離開 | H2 同一批 repo 計數 |

## 來源

[1] https://docs.github.com/en/rest/issues/sub-issues
[2] https://docs.github.com/en/rest/issues/issue-dependencies
[3] https://docs.github.com/en/graphql/reference/issues
[4] https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/
[5] https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
[6] https://github.blog/changelog/2025-08-21-dependencies-on-issues/
[7] https://github.blog/changelog/2025-03-18-github-issues-projects-rest-api-support-for-issue-types
[8] https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization
[9] https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/
[10] https://dev.classmethod.jp/en/articles/github-cli-294-issue-types-sub-issues/ （第三方）
[11] https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[12] https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
[13] https://docs.github.com/en/actions/concepts/security/github_token
[14] https://nodejs.org/api/typescript.html
[15] https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace
[16] https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
[17] https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
[18] https://code.claude.com/docs/en/plugins
[19] https://developers.openai.com/codex/skills
[20] https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/ （第三方）
[21] https://modelcontextprotocol.info/tools/registry/publishing/ （第三方）
[22] https://docs.renovatebot.com/getting-started/installing-onboarding/
[23] https://github.com/loopbackio/create-loopback/pull/1 （範例 PR）
[24] https://docs.renovatebot.com/key-concepts/dashboard/
[25] https://docs.github.com/en/code-security/getting-started/dependabot-quickstart-guide
[26] https://docs.coderabbit.ai/getting-started/quickstart
[27] https://github.com/changesets/bot
[28] https://danger.systems/js/guides/getting_started.html
[29] https://typicode.github.io/husky/get-started.html
[30] https://github.com/thomvaill/log4brains
[31] https://github.com/npryce/adr-tools
[32] https://docs.github.com/en/enterprise-server@3.17/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout
[33] https://linear.app/docs/project-dependencies
[34] https://confluence.atlassian.com/advancedroadmapscloud/dependencies-report-1055953530.html
[35] https://community.atlassian.com/forums/Advanced-Planning-in-Jira/Is-there-a-way-to-show-dependencies-from-outside-of-the-plan-in/m-p/1867046 （社群）
[36] https://support.zenhub.com/article/how-do-i-create-issue-dependencies
[37] https://github.com/github/spec-kit
[38] https://skills.cat/skills/dceoy/speckit-agent-skills/speckit-analyze （社群鏡像）
[39] https://github.com/eyaltoledano/claude-task-master
[40] https://glama.ai/mcp/servers/@eyaltoledano/claude-task-master/blob/3b3dbabed18a5c37ef770604ec2357d054e79e21/docs/command-reference.md （社群鏡像）
[41] https://github.com/zerowand01/markplane
[42] https://github.com/topics/plan-as-code
