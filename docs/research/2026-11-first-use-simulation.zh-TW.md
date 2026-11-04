# 第一次使用模擬：兩個沒有專案背景的 agent 用 onboarding skill

日期：2026-11-03。目的：在決定是否公開 repo 之前，看一般使用者第一次透過自己的 agent 使用 `skills/onboard/SKILL.md` 會發生什麼事。

## 方法

| | 模擬 A | 模擬 B |
|---|---|---|
| Agent | Grok 4.7（xhigh） | Gemini 3.8 Flash（high，經 agy） |
| 目標 repo | tv-labs/lua（`.agents/plans/`，一個步驟一份檔案，自訂編號 A13、B5） | rshade/finfocus（Spec Kit，`specs/<feature>/tasks.md`） |
| 給的東西 | 一份 plan-atlas clone（`git archive main`，只有 repo 追蹤的檔案）＋目標 repo＋一則開場訊息 | 同左 |

- **沒有專案背景**：開場訊息只說「我剛找到 plan-atlas，clone 在某路徑，請照它的 onboarding skill 幫我設定一份計畫」。沒有 PoC 資料、沒有之前的對話、沒有設計說明。
- **沒有 shell**：依派工規則，兩個 agent 都不能自己執行指令。它們把要跑的指令寫進 `RUN.md`，Claude 在 repo 根目錄代跑（只跑 plan-atlas、唯讀的 git／gh），把輸出原樣貼回。要問使用者的寫進 `QUESTIONS.md`，Claude 以一般使用者的程度回答（例如「1」）。這和真實使用的差別只在多了一層轉手。
- **記錄**：要求 agent 維護 `ONBOARDING-LOG.md`，每一步寫做了什麼、文件哪裡不清楚。
- `gh auth status` 的輸出裡的帳號名稱，貼回前先遮掉。

## 結果摘要

| | 模擬 A（Grok，lua） | 模擬 B（Gemini，finfocus） |
|---|---|---|
| 完成 skill 全部 8 步 | 是，另加一輪「使用者做決定後，計畫文件與 JSON 一起改」 | 是 |
| 來回輪數／時間 | 4 輪，約 15 分鐘（含代跑） | 5 輪，約 14 分鐘 |
| 選的計畫 | A13「Cut 1.0.0 final」，12 項（自己從 86 份裡推薦） | `631-carbon-plugin`，27 項、6 個階段（自己從數百個 feature 裡推薦） |
| 第一次 `check` | 0 錯誤 | 0 錯誤 |
| **工具抓到的發現** | 3 個：`DONE? lua@1.0.0`（tag v1.0.0 在 2026-07-15 已存在，計畫未完成）；`CHECK A13`（issue #174 已關閉，12 項未勾）；`MISSING-LINK`（計畫寫的分支 `release/1-0-0` 不存在） | 0 個：27 項全部勾選，和 git、GitHub 一致 |
| 讀計畫時發現的矛盾 | 7 個：檔名寫 rc1、標題寫 1.0.0 final；同一句寫 20/29 又寫 17/29；roadmap 說效能檢查已完成、A13 沒勾；清單順序和實作說明不同… | 1 個：tasks.md 標頭寫「PR #1842 open」，實際上已合併 |
| 有沒有自作主張改狀態或開 PR | 沒有。先問，使用者同意後才改，而且計畫文件和 JSON 一起改 | 沒有 |

**結論**：skill 足以讓沒有背景的 agent 在 15 分鐘內走完，第一次 `check` 就通過。兩個 agent 都遵守「只建議、先問」。模擬 A 達成「30 分鐘內看到關於自己 repo 的真實發現」。模擬 B 的工具沒有發現，原因是 skill 的選擇提示讓它挑了一個已經全部完成的 feature。

## 要修的地方（依優先順序）

### 工具

1. **V11 一個 release 報 8 次。** 模擬 A 把 tag 標成完成後，`lua@1.0.0` 的 8 個前置項目各報一則 V11。這是同一件事，應該合併成一則（「`lua@1.0.0` 已完成，但 8 個前置還沒完成：…」）。ROADMAP 教訓 3（一則陳述只報一次）在這裡沒做到，因為 8 條依賴是各自宣告的。第一次使用的人看到 8 則重複警告會覺得很吵。

### Skill 與文件

2. **選計畫的提示會挑到已完成的計畫。** 目前寫「分支已合併的 Spec Kit feature 最快有發現」，但已合併的 feature 通常也已全部勾選。改成：優先挑「**分支已合併或 issue 已關閉，但還有未勾選項目**」的計畫；全部勾選的計畫放最後。
3. **`${CLAUDE_PLUGIN_ROOT}` 在 Claude Code 以外不會展開。** 兩個 agent 都遇到，都照備案改用使用者給的路徑，所以沒卡住。可以把「不在 Claude Code 裡」直接寫成第一種情況，不要讓它看起來像錯誤。
4. **`$schema` 寫法不一致**：skill 要求 raw GitHub 網址，schema 的 `$id` 是另一個網址，範例用相對路徑。統一成一種。
5. **勾選清單沒有編號時怎麼取 id**：模擬 A 自己決定用 `A13-version`、`A13-tests`。skill 應該直接寫這個慣例（計畫 id＋短名稱），並說明這種 id 不會出現在 commit 裡，`status --git` 只能靠 `links`。
6. **frontmatter 的狀態值**（`blocked`、`review`、`merged`）沒有地方放。至少在 skill 裡寫明：記在 `evidence`，和勾選框對不上時列進 notes（模擬 A 指出 A48 的 frontmatter 是 `merged`、勾選框全空）。

### 模擬本身的雜訊（不是產品問題）

- Gemini 有一次覆寫 `RUN.md` 而不是接在後面寫，代跑流程改成「每次全部執行後清空」。
- 第一次啟動時 prompt 是空的（路徑替換錯誤），重跑後正常，未計入結果。

## 對「是否公開」的判斷

**可以準備公開，但先做三件事：**

1. 修上面的 1、2（小改動），再用同樣的方法對 finfocus 挑一個「已合併但未勾完」的 feature 重跑一次，確認 Spec Kit 使用者也能在第一次就看到工具抓到的發現。
2. **清理私有資訊**：文件與測試裡來自私有計畫的編號、版本號與 commit 內容已改成一般化的描述；公開版本從一個乾淨的初始 commit 開始，不帶舊歷史。
3. 英文驗證訊息（ROADMAP 第 2 項）不是公開的前提，但第一批外部使用者多半看不懂中文訊息；兩個 agent 都能翻譯，所以可以排在公開之後。

## 重跑（修正後）：Gemini 3.8 Flash high，finfocus，全新對話

V11 合併與 skill 的選擇排序修好後，用一份乾淨的 finfocus 和新版 plan-atlas 重跑，開場訊息相同，沒有上一次的記憶。

| | 結果 |
|---|---|
| 選計畫 | 自己跑了排序指令（未勾數量、已合併 PR、tag），提出的 5 個候選**全部**是「已合併但還有未勾項目」的 feature；推薦 `1734-analyzer-language-plugin`（33 項，PR #1917 已合併，4 項未勾） |
| 第一次 `check` | 0 錯誤，1 個 V11（Polish 階段已有完成項，但前置階段的 T017 未完成） |
| **工具抓到的發現** | `status --github`：PR #1917 已在 2026-10-28 合併並關閉 issue #1895，計畫還有 4 項未完成；`status --git`：同一個群組的 CHECK |
| 時間 | 5 輪，約 15 分鐘 |

**結論**：Spec Kit 使用者第一次使用也能看到工具抓到的發現，選擇排序的修正有效。

剩下的小問題（不影響公開）：
- Spec Kit 的 task id（`T030`、`T033`）在每個 feature 都重複，`status --git` 會比對到很久以前其他 feature 的 commit。它們都被標為 MENTION，排在最後，但可以考慮讓有 `links` 的群組底下的項目只看該分支的 commit。
- `status --github` 的證據在分支連結和 `#N` 指到同一個 PR 時會重複列出那個 PR。
