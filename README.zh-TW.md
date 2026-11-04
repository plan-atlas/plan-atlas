# plan-atlas

[English](README.md) | 繁體中文

找出 AI agent 維護的計畫中可能的矛盾，並畫成地圖。它提出建議，由人決定。

你的 agent 把計畫寫成資料，plan-atlas 檢查它本身是否一致，並對照其他計畫、git 與 GitHub，再畫成一張可以層層鑽入的地圖。

版本 0.2.0。訊息與地圖預設為英文。任何命令都可加上 `--lang zh-TW`，或設定 `PLAN_ATLAS_LANG=zh-TW`，使用繁體中文。`--lang` 優先於環境變數。

## 示範影片

約兩分鐘的操作示範，使用一個小型示範 repo：安裝、擷取一份計畫、檢查、和 git 比對、打開地圖、加入 CI。工具輸出與 agent 訊息重播自一次錄製的 session；安裝指令則取自這份 README。[觀看影片](https://github.com/plan-atlas/plan-atlas/releases/download/v0.1.1/plan-atlas-demo.mp4)（MP4，內嵌英文字幕；[SRT 字幕檔](https://github.com/plan-atlas/plan-atlas/releases/download/v0.1.1/plan-atlas-demo.en.srt)）。

## 為什麼

coding agent 改程式碼的速度，比人檢查背後計畫的速度快得多。計畫文字跟不上 git，兩份計畫互相矛盾，某個步驟依賴一個根本不存在的發布版本（release）。往往要等到出問題才有人發現。

在三個真實的 repo 上，plan-atlas 找到：程式已合併、計畫卻還列為未完成的步驟（其中一個是人工檢查時漏掉的）；一份計畫設下、但另一個 repo 早就越過的門檻；以及四個指向不存在項目的跨 repo 參照。在公開的 Spec Kit repo 上，它找到 pull request（PR）已經合併、`tasks.md` 卻還有未完成任務的功能。

## 運作方式

1. 你的 coding agent 依照 [AGENTS.md](AGENTS.md)，把一份計畫文件擷取成 JSON。plan-atlas 不呼叫 LLM，地圖是自成一體的檔案。只有 `status --github` 與工作區的 `github` 項目會透過你的 `gh` 登入連線到 GitHub。
2. `check` 驗證這份資料。`status --git` 與 `status --github` 根據 commit、tag、issue、PR 與分支提出狀態建議，但從不修改計畫。
3. `build` 產生 `atlas.html`（含大綱的單一檔案地圖）、Mermaid 與 draw.io。
4. 在 CI 中，`check` 與 `coupling` 會在每個 PR 確認資料與計畫文件保持一致。

適合用 coding agent 同時經營多個 repo 的個人開發者與小團隊：計畫放在 repo 裡、有穩定的步驟編號，或使用 Spec Kit。如果計畫放在 Jira 或 Linear，就不適合。

## 快速開始

**透過你的 coding agent。** 這個 repo 本身就是 Claude Code 和 Codex 的 plugin。在 Claude Code：

```
/plugin marketplace add plan-atlas/plan-atlas
/plugin install plan-atlas@plan-atlas
```

在 Codex：

```sh
codex plugin marketplace add plan-atlas/plan-atlas
codex plugin add plan-atlas@plan-atlas
```

接著在你的 repo 裡說「map my plans」（中文也可以，例如「用 plan-atlas 檢查我的計畫」）。agent 會挑一份計畫、擷取、執行檢查、產生地圖，並回報需要你決定的事。兩者執行的是同一份 [skills/onboard/SKILL.md](skills/onboard/SKILL.md)。細節見 [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)。

**手動執行。** 需要 Node.js 22.18 以上；不需要建置，也沒有相依套件。目前沒有發布到 npm。

```sh
node src/cli.ts check examples/bookshop/plan.json examples/warehouse/plan.json
node src/cli.ts build examples/bookshop/plan.json examples/warehouse/plan.json --out atlas
node src/cli.ts status --git ../my-repo plans/plan.json
node src/cli.ts status --github owner/repo plans/plan.json
```

**在 CI 中。** 在 `actions/checkout`（設定 `fetch-depth: 0`）之後加上：

```yaml
- uses: plan-atlas/plan-atlas@v0.2.0
  with:
    plans: plans/*.json
```

它會執行 `check`、在 PR 上執行 `coupling`，以及 `status --git`，並把報告寫進 job summary。每個 ERROR 與 WARN 也會以註記（annotation）標在它所屬的計畫檔上。Action 預設只回報（`fail-on: none`）；要在有 ERROR 時擋下 PR，設定 `fail-on: error`。工具根本無法執行時（glob 寫錯、檔案在工作目錄之外）一律失敗。這個 Action 也接受 `workspace` 與 `self`。輸入參數與完整的 workflow 見 [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md#7-keep-it-current)。

## 多個儲存庫

用一份 `plan-atlas.workspace.json` 列出各計畫的 namespace 與明確的檔案路徑，並指定 `github: "owner/repo"` 或 `path: "../repo"`（相對於工作區檔案）。執行 `check`、`build` 或 `status` 時加上 `--workspace plan-atlas.workspace.json`；位置參數中的計畫檔會在擷取前取代對應項目。`--self <ns>` 與 `--self-repo owner/repo` 會從目前目錄讀取這些項目。`--workspace` 也接受 `github:<owner>/<repo>:<path>[@<ref>]`。`--head-ref feature/name` 會在各儲存庫優先使用存在的同名分支。讀取 GitHub 計畫時會顯示選用的參照與 commit SHA。`health` 會寫出同一份地圖，以及 `health.md` 與 `health-issue.md`；`examples/hub/plan-health.yml` 是 hub 的 workflow，用這兩份報告維持一則 issue。詳見[工作區範例與命令](docs/GETTING-STARTED.md#6-several-repositories)。

## 計畫檔案

```jsonc
{
  "version": 1,
  "namespace": "bookshop",
  "nodes": [
    { "id": "checkout", "title": "Checkout v2", "parent": null, "sources": ["docs/plans/checkout-v2.md"] },
    { "id": "C3", "title": "C3 Checkout page redesign", "parent": "checkout", "status": "open",
      "source": "docs/plans/checkout-v2.md §4", "links": ["#42"],
      "dependsOn": [
        { "id": "C2", "type": "hard" },
        { "id": "tooling:T1", "type": "hard", "source": "docs/plans/checkout-v2.md §4",
          "quote": "ship the redesign only once visual diffs run in CI" }
      ] }
  ]
}
```

- 有子節點的節點是**群組**，狀態由底下的項目推導。沒有子節點的節點是**項目**，需要 `status`（`done` 或 `open`）。
- 硬依賴（`hard`）會擋住後續工作；排序依賴（`order`）只是建議的順序。跨群組或跨檔案的依賴需要 `source` 和一小段 `quote`。
- 依賴一個群組，等的是它的最後項目，也就是群組內沒有其他項目在等的那些；宣告在群組上的依賴，套用在它的第一批項目，也就是在群組內不等任何項目的那些。只有群組內部寫明的依賴才決定其項目的順序；對群組或由群組發出的 `hard` 依賴，只計算群組內的 `hard` 依賴。另一份計畫的宣稱（claim），要來源的每個最後項目都能走到目標的每個第一批項目，才算一致。
- `<namespace>:<id>` 指向另一份計畫檔案裡的節點；一次傳入多個檔案才能解析。
- `links` 標出節點背後的 issue、PR 或分支：`#123`、`owner/repo#123`、`branch:<name>`。
- 發布版本（release）是帶有 `"kind": "release"` 的項目，id 形如 `sdk@2.1.0`，並有 `"tag"`。

完整格式見 [schema/plan-atlas.schema.json](schema/plan-atlas.schema.json)。

## 檢查會抓到什麼

檢查結果是可能的矛盾，交給人判斷。等級：

- **ERROR**：計畫資料本身壞了：格式、缺少出處或引文、目標不存在、依賴改了卻沒改它的計畫文件（coupling），或手改過的 `atlas.json`。
- **WARN**：可能的矛盾，由人判斷，例如兩份計畫說法不一，或狀態與依賴互相矛盾。
- **INFO**：提醒。狀態建議（`status`）不是檢查結果，從不讓任何東西失敗。

| 規則 | 抓到 |
|---|---|
| V0 | 格式錯誤的計畫、工作區、欄位或連結、重複的 id／namespace／檔案、namespace 不符、無法讀取的輸入檔或工作區項目、與這個儲存庫不符的 self 項目（WARN）、未知的 parent、area 或依賴 |
| V1 / V2 / V4 | 已提交的 `atlas.json` 不再與項目相符 |
| V3 | 項目沒有出處（source），或引用了不屬於其群組的計畫文件 |
| V5 | 一頁的節點數超過 `rules.maxPageNodes`（取所有載入檔案中最小的設定；預設 15） |
| V6 | 依賴循環（包括節點依賴包含它的群組，或依賴自己底下的節點），以及只在群組之間才出現的循環 |
| V7 | 狀態是推論而來、不是計畫明文寫的（提醒） |
| V8 | 跨群組或跨檔案的依賴沒有附出處、指向已載入計畫中不存在的項目，或使用工作區未登記且未列入 externalRefs 的 namespace |
| V9 | 兩份計畫對彼此之間的依賴不一致（WARN）；宣稱指向已載入計畫中不存在的節點（ERROR）；宣稱指向未載入的計畫（提醒） |
| V10 | `coupling`：跨群組依賴已改，卻沒有修改它所引用的計畫文件 |
| V11 | 項目已完成，但它的硬依賴還沒完成（每個等待中的節點只報一則）；或另一份計畫宣稱的門檻其實已被越過（每個宣稱報一則） |
| V12 | 發布版本（release）標為 done，卻沒有 git tag |

每條規則的要件、效果，以及哪條規則排除哪條：[docs/RULES.md](docs/RULES.md)。

狀態建議如何對應（`CHECK`、`MENTION`、`DONE?`、`MISSING-LINK`）：[docs/STATUS.md](docs/STATUS.md)。

## 更多

- [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)：第一次使用、手動執行的步驟、多個 repo、CI。
- [AGENTS.md](AGENTS.md)：agent 編輯計畫資料或這個 repo 時要遵守的規則。
- [docs/ROADMAP.md](docs/ROADMAP.md)：接下來做什麼。尚未提供：GitHub Issues adapter。npm 只在有需求時才提供。

上述文件目前只有英文版。

## 授權

MIT
