export type Lang = 'en' | 'zh-TW';

const messages = {
  jsonObject: { en: "File is not a JSON object", 'zh-TW': '檔案不是 JSON 物件' },
  version: { en: (version: string) => `Unsupported version ${version} (only 1 is supported)`, 'zh-TW': (version: string) => `不支援的版本 ${version}（只支援 1）` },
  nodesArray: { en: "Missing nodes array", 'zh-TW': '缺少 nodes 陣列' },
  nodeFields: { en: (i: number) => `nodes[${i}] needs id and title`, 'zh-TW': (i: number) => `nodes[${i}] 需要 id 與 title` },
  duplicateId: { en: (id: string) => `Duplicate id: ${id}`, 'zh-TW': (id: string) => `重複的 id：${id}` },
  idColon: { en: (id: string) => `id cannot contain a colon (reserved for cross-file references): ${id}`, 'zh-TW': (id: string) => `id 不能包含冒號（冒號保留給跨檔參照）：${id}` },
  parentType: { en: (id: string) => `${id}: parent must be a string or null`, 'zh-TW': (id: string) => `${id} 的 parent 必須是字串或 null` },
  statusType: { en: (id: string) => `${id}: status must be done or open`, 'zh-TW': (id: string) => `${id} 的 status 只能是 done 或 open` },
  depsArray: { en: (id: string) => `${id}: dependsOn must be an array`, 'zh-TW': (id: string) => `${id} 的 dependsOn 必須是陣列` },
  depFields: { en: (id: string) => `${id}: a dependsOn entry needs id and type (hard/order)`, 'zh-TW': (id: string) => `${id} 有一筆 dependsOn 缺少 id 或 type（hard／order）` },
  unknownArea: { en: (id: string, area: string) => `${id} touches unknown area ${area}`, 'zh-TW': (id: string, area: string) => `${id} 觸及未定義的區塊 ${area}` },
  tagOnItem: { en: (id: string) => `${id} is not a release and cannot have a tag`, 'zh-TW': (id: string) => `${id} 不是 release，不能記錄 tag` },
  linksArray: { en: (id: string) => `${id}: links must be an array`, 'zh-TW': (id: string) => `${id} 的 links 必須是陣列` },
  badLink: { en: (id: string, link: string) => `${id} has an invalid link: ${link} (use #123, owner/repo#123, branch:<name>)`, 'zh-TW': (id: string, link: string) => `${id} 的連結格式不對：${link}（可用 #123、owner/repo#123、branch:<名稱>）` },
  fieldType: { en: (id: string, field: string) => `${id}: ${field} has the wrong type (${field === 'sources' || field === 'touches' ? 'an array of strings' : 'a string'} expected)`, 'zh-TW': (id: string, field: string) => `${id} 的 ${field} 型別不對（應為${field === 'sources' || field === 'touches' ? '字串陣列' : '字串'}）` },
  maxPageNodes: { en: (value: string) => `rules.maxPageNodes must be an integer of at least 3, not ${value}`, 'zh-TW': (value: string) => `rules.maxPageNodes 必須是至少 3 的整數，不能是 ${value}` },
  unknownParent: { en: (id: string, parent: string) => `${id}: parent ${parent} does not exist`, 'zh-TW': (id: string, parent: string) => `${id} 的上層 ${parent} 不存在` },
  parentCycle: { en: (path: string) => `Parent cycle: ${path}`, 'zh-TW': (path: string) => `上層關係形成循環：${path}` },
  releaseChildren: { en: (id: string) => `${id} is a release and cannot have children; a release must be an item`, 'zh-TW': (id: string) => `${id} 是 release，不能有子項目；release 只能是項目` },
  groupStatus: { en: (id: string) => `${id} has children and is a group; its status is derived from its items`, 'zh-TW': (id: string) => `${id} 底下有子項目，是群組；群組的狀態由子項目推導，不能自己填` },
  itemStatus: { en: (id: string) => `${id} is an item and needs status`, 'zh-TW': (id: string) => `${id} 是項目，需要 status` },
  unknownDep: { en: (id: string, dep: string) => `${id} depends on missing node ${dep}`, 'zh-TW': (id: string, dep: string) => `${id} 依賴不存在的 ${dep}` },
  noRoot: { en: "No top-level node (parent must be null)", 'zh-TW': '沒有最上層節點（parent 為 null）' },
  planNamespace: { en: "namespace must be letters, digits and ._- only", 'zh-TW': 'namespace 只能使用英文字母、數字與 ._-' },
  listArray: { en: (name: string) => `${name} must be an array`, 'zh-TW': (name: string) => `${name} 必須是陣列` },
  claimFields: { en: (i: number) => `claims[${i}] needs from and to ids; type must be hard or order; source and quote must be text`, 'zh-TW': (i: number) => `claims[${i}] 需要 from 與 to；type 只能是 hard 或 order；source 與 quote 必須是文字` },
  externalRefFields: { en: (i: number) => `externalRefs[${i}] needs an id; meaning must be text`, 'zh-TW': (i: number) => `externalRefs[${i}] 需要 id；meaning 必須是文字` },
  overlapFields: { en: (i: number) => `rules.overlaps[${i}] needs an id and selectors a and b, whose kind and idPrefix must be text`, 'zh-TW': (i: number) => `rules.overlaps[${i}] 需要 id 與選擇器 a、b；選擇器的 kind 與 idPrefix 必須是文字` },
  noSource: { en: (i: string) => `${i} has no source`, 'zh-TW': (i: string) => `${i} 沒有出處（source）` },
  wrongSource: { en: (i: string, source: string, owner: string) => `${i}: source ${source} is not in the plan files declared by "${owner}"`, 'zh-TW': (i: string, source: string, owner: string) => `${i} 的出處 ${source} 不在「${owner}」宣告的計畫檔中` },
  inferredStatus: { en: (i: string, evidence: string | undefined) => `${i}: status is inferred, not confirmed by the plan${evidence ? `: ${evidence}` : ''}`, 'zh-TW': (i: string, evidence: string | undefined) => `${i} 的狀態是推論，未經計畫文字確認${evidence ? `：${evidence}` : ''}` },
  depCitation: { en: (from: string, to: string) => `Cross-group dependency ${from} → ${to} needs a source and quote`, 'zh-TW': (from: string, to: string) => `跨群組依賴 ${from} → ${to} 缺少出處或引文` },
  pageSize: { en: (title: string, count: number, max: number) => `"${title}" has ${count} nodes (limit ${max}); consider another level`, 'zh-TW': (title: string, count: number, max: number) => `「${title}」頁有 ${count} 個節點（上限 ${max}），考慮再分一層` },
  hardCycle: { en: (path: string) => `Hard dependency cycle; these items can never finish: ${path}`, 'zh-TW': (path: string) => `項目之間有循環的硬依賴，永遠無法完成：${path}` },
  orderCycle: { en: (a: string, b: string, path: string) => `Order "${b} after ${a}" contradicts a dependency, for example: ${path}`, 'zh-TW': (a: string, b: string, path: string) => `排程「${a} 之後才做 ${b}」與依賴矛盾，例如：${path}` },
  nestedDep: { en: (id: string, dep: string) => `${id} depends on ${dep}, but one contains the other; a group finishes only with its items, so this waits for itself`, 'zh-TW': (id: string, dep: string) => `${id} 依賴 ${dep}，但兩者互相包含；群組要等子項目都完成才算完成，所以這是在等自己` },
  groupCycle: { en: (title: string, path: string) => `"${title}" has a cycle only between groups: ${path}. Check the grouping`, 'zh-TW': (title: string, path: string) => `「${title}」頁出現循環，但項目層沒有：${path}。這是分組造成的，檢查分組是否恰當` },
  claimUnloaded: { en: (from: string, to: string) => `${from} claims ${to} must wait for it, but a referenced plan is not loaded`, 'zh-TW': (from: string, to: string) => `${from} 宣稱 ${to} 要等它，但參照的計畫未載入` },
  claimMissingNode: { en: (from: string, to: string, ids: string) => `Claim ${from} → ${to} refers to missing nodes in loaded plans: ${ids}`, 'zh-TW': (from: string, to: string, ids: string) => `宣稱 ${from} → ${to} 參照已載入計畫中不存在的節點：${ids}` },
  unspecifiedSource: { en: "no source given", 'zh-TW': '未註明出處' },
  claimMissing: { en: (from: string, to: string, source: string) => `Plans disagree: ${from}'s plan says ${to} must wait for it (${source}), but ${to}'s plan has no such dependency`, 'zh-TW': (from: string, to: string, source: string) => `計畫不一致：${from} 的計畫說 ${to} 要等它（${source}），但 ${to} 的計畫沒有這條依賴` },
  claimType: { en: (from: string, to: string, a: string, b: string) => `Plans disagree: ${from} → ${to} is ${a} in one plan and ${b} in the other`, 'zh-TW': (from: string, to: string, a: string, b: string) => `計畫不一致：${from} → ${to} 一邊寫 ${a}，另一邊寫 ${b}` },
  listSep: { en: ", ", 'zh-TW': '、' },
  clauseSep: { en: "; ", 'zh-TW': '；' },
  doneItems: { en: (id: string, count: number) => `${id} has ${count} done ${count === 1 ? 'item' : 'items'}`, 'zh-TW': (id: string, count: number) => `${id} 已有 ${count} 項完成` },
  doneItem: { en: (id: string) => `${id} is done`, 'zh-TW': (id: string) => `${id} 已完成` },
  openGroupPre: { en: (id: string, count: number, items: string) => `its prerequisite ${id} has ${count} open ${count === 1 ? 'item' : 'items'} (${items})`, 'zh-TW': (id: string, count: number, items: string) => `前置 ${id} 還有 ${count} 項未完成（${items}）` },
  openPre: { en: (id: string) => `its prerequisite ${id} is not`, 'zh-TW': (id: string) => `前置 ${id} 還沒完成` },
  groupPre: { en: (id: string, count: number, items: string) => `${id} (${count} open ${count === 1 ? 'item' : 'items'}: ${items})`, 'zh-TW': (id: string, count: number, items: string) => `${id}（${count} 項：${items}）` },
  morePre: { en: (count: number) => `, … (${count} total)`, 'zh-TW': (count: number) => `、…（共 ${count} 項）` },
  openPrereqs: { en: (items: string, more: string) => `its prerequisites are not done: ${items}${more}`, 'zh-TW': (items: string, more: string) => `前置還沒完成：${items}${more}` },
  staleStatus: { en: (done: string, open: string) => `${done}, but ${open}; the status or the plan is out of date`, 'zh-TW': (done: string, open: string) => `${done}，但${open}；狀態或計畫有一邊過時` },
  passedGate: { en: (from: string, to: string, done: number, total: number) => `${from}'s plan says ${to} must wait for it, but ${to} has ${done}/${total} done items; this gate has been passed and the plan needs updating`, 'zh-TW': (from: string, to: string, done: number, total: number) => `${from} 的計畫要 ${to} 等它，但 ${to} 已有 ${done}/${total} 項完成；這個門檻已經被越過，計畫需要更新` },
  releaseNoTag: { en: (id: string) => `release ${id} is marked done without a tag; git cannot confirm it`, 'zh-TW': (id: string) => `release ${id} 標記完成，但沒有記錄 tag；無法從 git 確認` },
  summaryMissingGroup: { en: (g: string) => `Summary is missing group ${g}`, 'zh-TW': (g: string) => `摘要少了群組 ${g}` },
  summaryStatus: { en: (g: string, status: string, counts: string, derivedStatus: string, derivedCounts: string) => `${g}: summary says ${status} ${counts}, items give ${derivedStatus} ${derivedCounts}`, 'zh-TW': (g: string, status: string, counts: string, derivedStatus: string, derivedCounts: string) => `${g} 的狀態與項目不符：摘要寫 ${status} ${counts}，項目推導為 ${derivedStatus} ${derivedCounts}` },
  summaryUnknownGroup: { en: (g: string) => `Summary has unknown group ${g}`, 'zh-TW': (g: string) => `摘要有不存在的群組 ${g}` },
  summaryMissingPage: { en: (pid: string) => `Summary is missing page ${pid}`, 'zh-TW': (pid: string) => `摘要少了頁面 ${pid}` },
  summaryUnknownPage: { en: (pid: string) => `Summary has unknown page ${pid}`, 'zh-TW': (pid: string) => `摘要有不存在的頁面 ${pid}` },
  summaryNodes: { en: (pid: string, claimed: string, derived: string) => `Page ${pid}: summary nodes and stubs differ: ${claimed}; derived ${derived}`, 'zh-TW': (pid: string, claimed: string, derived: string) => `頁面 ${pid} 的節點與外部接頭不符：摘要 ${claimed}；推導 ${derived}` },
  summaryExtraEdge: { en: (pid: string, k: string) => `Page ${pid} has ${k} with no item-level relationship behind it`, 'zh-TW': (pid: string, k: string) => `頁面 ${pid} 有 ${k}，但沒有任何項目層的關係支撐` },
  summaryCount: { en: (pid: string, k: string, claimed: number, derived: number) => `Page ${pid}: ${k} count differs: summary ${claimed}, items ${derived}`, 'zh-TW': (pid: string, k: string, claimed: number, derived: number) => `頁面 ${pid} 的 ${k} 條數不符：摘要 ${claimed}，項目層 ${derived}` },
  summaryMissingEdge: { en: (pid: string, k: string) => `Page ${pid} is missing ${k} (present at item level)`, 'zh-TW': (pid: string, k: string) => `頁面 ${pid} 少了 ${k}（項目層有這個關係）` },
  duplicateNamespace: { en: (dup: string) => `Two files use the same namespace: ${dup}`, 'zh-TW': (dup: string) => `兩個檔案使用同一個 namespace：${dup}` },
  missingExternalItem: { en: (id: string, dep: string, space: string) => `${id} depends on ${dep}, but the ${space} plan has no such item`, 'zh-TW': (id: string, dep: string, space: string) => `${id} 依賴 ${dep}，但 ${space} 的計畫裡沒有這個項目` },
  externalUnloaded: { en: (id: string, dep: string) => `${id} depends on ${dep}; that plan is not loaded and cannot be checked`, 'zh-TW': (id: string, dep: string) => `${id} 依賴 ${dep}，該計畫未載入，無法確認` },
  unknownNamespace: { en: (id: string, dep: string, ns: string) => `${id} depends on ${dep}, but namespace ${ns} is not in the workspace or externalRefs`, 'zh-TW': (id: string, dep: string, ns: string) => `${id} 依賴 ${dep}，但 namespace ${ns} 不在工作區或 externalRefs 中` },
  claimUnknownNamespace: { en: (from: string, to: string, ids: string) => `Claim ${from} → ${to} references ${ids}, whose namespace is not in the workspace or externalRefs`, 'zh-TW': (from: string, to: string, ids: string) => `宣稱 ${from} → ${to} 參照 ${ids}，但其 namespace 不在工作區或 externalRefs 中` },
  workspaceObject: { en: 'Workspace is not a JSON object', 'zh-TW': '工作區檔案不是 JSON 物件' },
  workspacePlans: { en: 'Workspace needs a plans array', 'zh-TW': '工作區需要 plans 陣列' },
  workspaceFields: { en: (i: number) => `plans[${i}] needs a namespace (letters, digits, ._- only) and file`, 'zh-TW': (i: number) => `plans[${i}] 需要 namespace（限英文字母、數字、._-）與 file` },
  workspaceFile: { en: (i: number) => `plans[${i}].file must name one repository-relative file, without globs`, 'zh-TW': (i: number) => `plans[${i}].file 必須指定一個儲存庫相對路徑的檔案，不能使用萬用字元` },
  workspaceLocation: { en: (i: number) => `plans[${i}] needs exactly one of github (owner/repo) or path (a nonempty directory)`, 'zh-TW': (i: number) => `plans[${i}] 必須指定 github（owner/repo）或 path（非空目錄），且只能選一個` },
  workspacePath: { en: (i: number) => `plans[${i}].path must be relative to the workspace file, such as ../repo; absolute and UNC paths are not allowed`, 'zh-TW': (i: number) => `plans[${i}].path 必須是相對於工作區檔案的路徑，例如 ../repo；不能使用絕對路徑或 UNC 路徑` },
  workspaceRef: { en: (i: number) => `plans[${i}].ref must be a nonempty string`, 'zh-TW': (i: number) => `plans[${i}].ref 必須是非空字串` },
  workspaceDuplicateFile: { en: (file: string) => `Workspace lists the same repository file more than once: ${file}`, 'zh-TW': (file: string) => `工作區重複列出同一儲存庫的檔案：${file}` },
  workspaceNamespace: { en: (expected: string, actual: string, file: string) => `Workspace namespace ${expected} does not match file namespace ${actual}: ${file}`, 'zh-TW': (expected: string, actual: string, file: string) => `工作區 namespace ${expected} 與檔案 namespace ${actual} 不符：${file}` },
  fileRead: { en: (file: string, code: string) => `Cannot read ${file}: ${code}`, 'zh-TW': (file: string, code: string) => `無法讀取 ${file}：${code}` },
  fileJson: { en: (file: string, line: number, column: number) => `Invalid JSON in ${file}: line ${line}, column ${column}`, 'zh-TW': (file: string, line: number, column: number) => `${file} 的 JSON 語法錯誤：第 ${line} 行，第 ${column} 欄` },
  fileConfined: { en: (file: string, root: string) => `Input ${file} must be a regular file, not a symlink, inside ${root}`, 'zh-TW': (file: string, root: string) => `輸入 ${file} 必須是 ${root} 內的一般檔案，不能是符號連結` },
  workspaceRead: { en: (entry: string, reason: string) => `Cannot read workspace entry ${entry}: ${reason}`, 'zh-TW': (entry: string, reason: string) => `無法讀取工作區項目 ${entry}：${reason}` },
  workspaceFetch: { en: (spec: string, reason: string) => `Cannot fetch workspace ${spec}: ${reason}`, 'zh-TW': (spec: string, reason: string) => `無法取得工作區 ${spec}：${reason}` },
  workspaceBlob: { en: (errors: string) => `GitHub did not return the plan blob, ref and commit SHA${errors ? `: ${errors}` : ''}`, 'zh-TW': (errors: string) => `GitHub 未回傳計畫檔內容、參照與 commit SHA${errors ? `：${errors}` : ''}` },
  workspaceReadAt: { en: (ns: string, repo: string, ref: string, sha: string) => `Read ${ns} from ${repo} at ${ref} (${sha})`, 'zh-TW': (ns: string, repo: string, ref: string, sha: string) => `已從 ${repo} 的 ${ref}（${sha}）讀取 ${ns}` },
  workspaceSourceReadAt: { en: (repo: string, path: string, ref: string, sha: string) => `Read workspace from ${repo}:${path} at ${ref} (${sha})`, 'zh-TW': (repo: string, path: string, ref: string, sha: string) => `已從 ${repo}:${path} 的 ${ref}（${sha}）讀取工作區` },
  workspaceRemoteForm: { en: (value: string) => `--workspace ${value} must look like github:<owner>/<repo>:<path>[@<ref>], with a relative path that does not contain .. and a ref that does not start with -`, 'zh-TW': (value: string) => `--workspace ${value} 必須形如 github:<owner>/<repo>:<path>[@<ref>]，路徑須為相對路徑且不能包含 ..，ref 不能以 - 開頭` },
  workspaceRemotePath: { en: (ns: string) => `Workspace entry ${ns} uses path, which a workspace read from GitHub cannot resolve`, 'zh-TW': (ns: string) => `工作區項目 ${ns} 使用 path，但從 GitHub 讀取的工作區無法解析 path` },
  selfUnknown: { en: (name: string) => `--self ${name} matches no workspace entry`, 'zh-TW': (name: string) => `--self ${name} 沒有對應的工作區項目` },
  selfRepoNone: { en: (repo: string) => `--self-repo ${repo} matches no workspace entry`, 'zh-TW': (repo: string) => `--self-repo ${repo} 沒有對應的工作區項目` },
  selfOtherRepository: { en: (ns: string, github: string, repository: string) => `Self entry ${ns} (${github}) is not this repository (${repository})`, 'zh-TW': (ns: string, github: string, repository: string) => `self 項目 ${ns}（${github}）不是這個儲存庫（${repository}）` },
  selfLeftOut: { en: (ns: string, github: string, repository: string) => `Entry ${ns} (${github}) is part of this repository (${repository}) but is not in the self set`, 'zh-TW': (ns: string, github: string, repository: string) => `項目 ${ns}（${github}）屬於這個儲存庫（${repository}），但不在 self 集合中` },
  selfArgs: { en: '--self and --self-repo cannot be used with positional plan files', 'zh-TW': '--self 與 --self-repo 不能和位置參數的計畫檔一起使用' },
  workspaceArgs: { en: '--head-ref, --allow-missing, --self, --self-repo and --self-files need --workspace; workspace status cannot use --git, --github or --ref', 'zh-TW': '--head-ref、--allow-missing、--self、--self-repo 與 --self-files 需要 --workspace；工作區 status 不能使用 --git、--github 或 --ref' },
  removedDep: { en: "Removed cross-group dependency", 'zh-TW': '刪除了跨群組依賴' },
  addedDep: { en: "Added cross-group dependency", 'zh-TW': '新增了跨群組依賴' },
  retypedDep: { en: (before: string, after: string) => `Dependency type changed from ${before} to ${after}`, 'zh-TW': (before: string, after: string) => `依賴類型從 ${before} 改成 ${after}` },
  couplingNoSource: { en: (what: string, from: string, to: string) => `${what}: ${from} → ${to}, but it has no source to check against the plan`, 'zh-TW': (what: string, from: string, to: string) => `${what}：${from} → ${to}，但這條依賴沒有出處，無法對照計畫文字` },
  couplingUnchanged: { en: (what: string, from: string, to: string, file: string) => `${what}: ${from} → ${to}, but its cited plan ${file} was not changed; update the plan or ask someone to confirm`, 'zh-TW': (what: string, from: string, to: string, file: string) => `${what}：${from} → ${to}，但它引用的 ${file} 沒有在同一次變更中修改；請先更新計畫文字，或請人確認` },
  planNodes: { en: "Plan needs a nodes array", 'zh-TW': '計畫需要 nodes 陣列' },
  rawNodeFields: { en: "Node needs id and title strings", 'zh-TW': '節點需要 id 與 title 字串' },
  badRef: { en: "--ref needs a valid git reference", 'zh-TW': '--ref 需要有效的 git 參照' },
  tagFound: { en: (tag: string, date: string, sha: string) => `tag ${tag} (${date}, ${sha})`, 'zh-TW': (tag: string, date: string, sha: string) => `tag ${tag}（${date}，${sha}）` },
  tagMissing: { en: (tag: string) => `Cannot find tag ${tag}`, 'zh-TW': (tag: string) => `找不到 tag ${tag}` },
  groupOpen: { en: (count: number) => `, but ${count} ${count === 1 ? 'item is' : 'items are'} still open`, 'zh-TW': (count: number) => `，但還有 ${count} 項未完成` },
  commitCheck: { en: (count: number, latest: string, rest: string) => `${count} commit(s) cite it, latest ${latest}${rest}`, 'zh-TW': (count: number, latest: string, rest: string) => `${count} 個 commit 引用，最近 ${latest}${rest}` },
  commitMention: { en: (count: number, latest: string) => `${count} commit(s) only mention it mid-sentence, latest ${latest}`, 'zh-TW': (count: number, latest: string) => `${count} 個 commit 只在句中提到，最近 ${latest}` },
  ghFailed: { en: (msg: string) => `gh api graphql failed: ${msg}`, 'zh-TW': (msg: string) => `gh api graphql 失敗：${msg}` },
  unknownDate: { en: "unknown date", 'zh-TW': '日期不明' },
  badRepo: { en: (repo: string) => `--github needs owner/repo, received ${repo}`, 'zh-TW': (repo: string) => `--github 需要 owner/repo，收到 ${repo}` },
  ghNoData: { en: (errors: string) => `GitHub returned no data${errors ? `: ${errors}` : ''}`, 'zh-TW': (errors: string) => `GitHub 沒有回傳資料${errors ? `：${errors}` : ''}` },
  closingIssues: { en: (issues: string) => `, closes ${issues}`, 'zh-TW': (issues: string) => `，關閉 ${issues}` },
  notPlannedOpen: { en: (link: string) => `issue ${link} closed as not planned (work dropped?)`, 'zh-TW': (link: string) => `issue ${link} 以 not planned 關閉（不做了？）` },
  notPlannedDone: { en: (link: string) => `issue ${link} closed as not planned, but the plan marks it done`, 'zh-TW': (link: string) => `issue ${link} 以 not planned 關閉，計畫卻記為完成` },
  issueClosed: { en: (link: string, reason: string) => `issue ${link} is closed (${reason})`, 'zh-TW': (link: string, reason: string) => `issue ${link} 已關閉（${reason}）` },
  issueOpen: { en: (link: string) => `issue ${link} is still open`, 'zh-TW': (link: string) => `issue ${link} 還開著` },
  prMerged: { en: (link: string, date: string, branch: string, closing: string) => `PR ${link} merged (${date}, branch ${branch}${closing})`, 'zh-TW': (link: string, date: string, branch: string, closing: string) => `PR ${link} 已合併（${date}，branch ${branch}${closing}）` },
  prOpen: { en: (link: string) => `PR ${link} is not merged yet`, 'zh-TW': (link: string) => `PR ${link} 還沒合併` },
  prClosed: { en: (link: string) => `PR ${link} closed without merging`, 'zh-TW': (link: string) => `PR ${link} 已關閉但沒有合併` },
  branchPending: { en: (branch: string, number: number) => `branch ${branch}: PR #${number} is not merged yet`, 'zh-TW': (branch: string, number: number) => `branch ${branch} 的 PR #${number} 還沒合併` },
  branchUnmerged: { en: (branch: string) => `branch ${branch}: no pull request from it was merged`, 'zh-TW': (branch: string) => `branch ${branch} 沒有任何已合併的 PR` },
  ghMissing: { en: (links: string) => `GitHub cannot find ${links}`, 'zh-TW': (links: string) => `GitHub 上找不到 ${links}` },
  overview: { en: "Overview", 'zh-TW': "總覽" },
  mapTitle: { en: "Plan map", 'zh-TW': "計畫地圖" },
  generated: { en: "> Generated by plan-atlas; do not edit. Group status, aggregated edges and overlaps are derived from items.", 'zh-TW': "> 由 plan-atlas 產生，勿手改。群組的狀態、聚合的邊與重疊標記都由項目推導。" },
  validationCounts: { en: (errors: number, warnings: number) => `**Validation: ${errors} error(s), ${warnings} warning(s)** (see below)`, 'zh-TW': (errors: number, warnings: number) => `**驗證：${errors} 個錯誤、${warnings} 個警告**（見文末）` },
  validationClean: { en: "**Validation: no errors**", 'zh-TW': "**驗證：無錯誤**" },
  validationHeading: { en: "## Validation results", 'zh-TW': "## 驗證結果" },
  noFindings: { en: "None.", 'zh-TW': "無。" },
  findingsHeader: { en: "| Level | Rule | Message |", 'zh-TW': "| 等級 | 規則 | 內容 |" },
  groupCounts: { en: (done: number, ready: number, blocked: number) => `Done ${done} · Ready ${ready} · Blocked ${blocked}`, 'zh-TW': (done: number, ready: number, blocked: number) => `完成 ${done}・可開工 ${ready}・被擋 ${blocked}` },
  innerOverlaps: { en: (count: number) => `Internal overlaps ${count}`, 'zh-TW': (count: number) => `內部重疊 ${count}` },
  inferred: { en: "(inferred)", 'zh-TW': "（推論）" },
  order: { en: "Order", 'zh-TW': "排程" },
  sharedArea: { en: (areas: string) => `Shared area ${areas}`.trim(), 'zh-TW': (areas: string) => `同改 ${areas}`.trim() },
  edgeCount: { en: (count: number) => `${count} links`, 'zh-TW': (count: number) => `${count} 條` },
  up: { en: "← Up one level", 'zh-TW': "← 上一層" },
  planTooltip: { en: (sources: string) => `Plan: ${sources}`, 'zh-TW': (sources: string) => `計畫：${sources}` },
  sourceTooltip: { en: (source: string) => `Source: ${source}`, 'zh-TW': (source: string) => `出處：${source}` },
  none: { en: "(none)", 'zh-TW': "（無）" },
  templateSlot: { en: "viewer template must contain exactly one /*PLAN_ATLAS_DATA*/", 'zh-TW': "檢視頁範本必須剛好有一個 /*PLAN_ATLAS_DATA*/" },
  help: { en: `plan-atlas — layered, validated maps of plans

Usage:
  plan-atlas check  <plan.json...> [--against atlas.json]
  plan-atlas build  <plan.json...> [--out dir]
  plan-atlas status --git <repo> <plan.json> [--ref <ref>] [--json]
  plan-atlas status --github <owner/repo> <plan.json> [--json]
  plan-atlas check|build|status --workspace <file> [plan.json...] [--head-ref <branch>] [--allow-missing]
                     [--self <ns>] [--self-repo <owner/repo>] [--self-files <file>]
  plan-atlas health --workspace <file|github:...> [--out dir] [--no-status] [--head-ref <branch>] [--allow-missing]
  plan-atlas coupling --before old.json --after new.json --changed <file-list|->

  check     Validate plans (several files are merged; refs use <namespace>:<id>).
            --against  also compare with a committed atlas.json (summary drift).
  build     Validate and write atlas.json, atlas.md (Mermaid), atlas.drawio, atlas.html.
  status    Suggest statuses; never edits the plan. Give exactly one of --git, --github.
            --git     a commit citing an open item (its id, an id range such as A4-A6,
                      or one of its links) asks for a check; an existing release tag
                      suggests done. --ref defaults to HEAD.
            --github  checks each node's links through gh: a closed issue or merged
                      pull request on an open item or group, or an open one on a done
                      item, asks for a check; a link GitHub cannot find is reported.
            --json    prints the suggestions as JSON.
  health    Write the combined map (when the plans load) plus health.md and health-issue.md.
            --no-status skips git and GitHub status suggestions. Exit 0 when both
            reports were written, even with ERROR findings.
  coupling  For a change set: every added, removed or retyped cross-group dependency
            must come with a change to the plan file it cites. --changed takes a file
            with one repo-relative path per line (e.g. git diff --name-only), or - for stdin.

  --lang en|zh-TW  Output language (default: PLAN_ATLAS_LANG, else en).

  --workspace <file>  Load a plan-atlas.workspace.json. github:<owner>/<repo>:<path>[@<ref>] fetches
                     that file through gh. Positional plans replace their entries.
                     status uses git for path entries and GitHub for github entries, in one report.
  --self <ns>         Read that entry from its file in the current directory. Repeatable.
                     With --self or --self-repo, positional plan files are not allowed.
  --self-repo <owner/repo>  Read every entry whose github equals this, compared without case.
  --self-files <file> Write each self file that was read, one path relative to the current
                     directory per line. Written only when the workspace was read and is valid.
  --head-ref <branch> Prefer that branch in each GitHub repository when it exists, else ref/default.
                     Prints each fetched plan's selected ref and commit SHA.
  --allow-missing     Report unreadable workspace entries as WARN instead of ERROR.
                     An unreadable self file stays an ERROR.
  --no-status         With health, do not collect status suggestions.
  --annotations <file> check, build and coupling also write a GitHub annotation for each
                     ERROR and WARN finding, on its plan file.

Exit code 1 when any ERROR is found; health exits 0 when its reports were written. Exit code 2 for bad arguments or git and gh failures.`, 'zh-TW': `plan-atlas — 分層、經過驗證的計畫地圖

用法：
  plan-atlas check  <plan.json...> [--against atlas.json]
  plan-atlas build  <plan.json...> [--out dir]
  plan-atlas status --git <repo> <plan.json> [--ref <ref>] [--json]
  plan-atlas status --github <owner/repo> <plan.json> [--json]
  plan-atlas check|build|status --workspace <file> [plan.json...] [--head-ref <branch>] [--allow-missing]
                     [--self <ns>] [--self-repo <owner/repo>] [--self-files <file>]
  plan-atlas health --workspace <file|github:...> [--out dir] [--no-status] [--head-ref <branch>] [--allow-missing]
  plan-atlas coupling --before old.json --after new.json --changed <file-list|->

  check     驗證計畫（多個檔案會合併；跨檔參照寫成 <namespace>:<id>）。
            --against  同時比對已提交的 atlas.json（摘要是否漂移）。
  build     驗證並寫出 atlas.json、atlas.md（Mermaid）、atlas.drawio、atlas.html。
  status    建議狀態，從不修改計畫。--git 與 --github 二選一。
            --git     引用未完成項目（其 id、A4-A6 這類 id 範圍或其連結）的 commit
                      會提示檢查；已存在的 release tag 會建議完成。--ref 預設為 HEAD。
            --github  透過 gh 檢查每個節點的連結：未完成的項目或群組，其 issue 已關閉
                      或 pull request 已合併；或已完成的項目，其 issue 或 pull request
                      還開著，都會提示檢查；GitHub 找不到的連結也會列出。
            --json    以 JSON 輸出建議。
  health    寫出合併地圖（計畫能載入時）以及 health.md 與 health-issue.md。
            --no-status 略過 git 與 GitHub 的狀態建議。兩份報告都寫出時結束碼為 0，
            即使有 ERROR。
  coupling  針對一組變更：每條新增、刪除或改類型的跨群組依賴，都必須同時修改它
            引用的計畫檔。--changed 接受每行一個儲存庫相對路徑的檔案（例如
            git diff --name-only 的輸出），或用 - 代表標準輸入。

  --lang en|zh-TW  輸出語言（預設為 PLAN_ATLAS_LANG，否則為 en）。

  --workspace <file>  載入 plan-atlas.workspace.json。github:<owner>/<repo>:<path>[@<ref>] 會透過 gh
                     取得該檔。位置參數的計畫檔會取代對應項目。
                     status 對 path 項目查 git、對 github 項目查 GitHub，合併成一份報告。
  --self <ns>         從目前目錄的 file 讀取該項目。可重複指定。
                     使用 --self 或 --self-repo 時，不能再給位置參數的計畫檔。
  --self-repo <owner/repo>  讀取 github 與此相同的每個項目，比較時不分大小寫。
  --self-files <file> 寫出已讀取的 self 檔案，每行一個相對於目前目錄的路徑。
                     只有在工作區已讀取且有效時才寫出。
  --head-ref <branch> 各 GitHub 儲存庫若有同名分支就優先使用，否則使用 ref 或預設分支。
                     顯示每份遠端計畫使用的參照與 commit SHA。
  --allow-missing     將無法讀取的工作區項目從 ERROR 改為 WARN。
                     無法讀取的 self 檔案仍是 ERROR。
  --no-status         health 不收集狀態建議。
  --annotations <file> check、build 與 coupling 另外為每個 ERROR 與 WARN 寫出
                     GitHub 註記，標在它所屬的計畫檔上。

有任何 ERROR 時結束碼為 1；health 寫出報告後結束碼為 0。參數錯誤或 git、gh 失敗時為 2。` },
  healthArgs: { en: 'health needs --workspace <file> and takes no plan files; --self, --self-repo, --self-files, --against and --annotations are not accepted', 'zh-TW': 'health 必須指定 --workspace <file>，且不能帶計畫檔；不接受 --self、--self-repo、--self-files、--against 與 --annotations' },
  healthTitle: { en: 'Plan health', 'zh-TW': '計畫健康' },
  healthLastRun: { en: (at: string) => `Last run: ${at}`, 'zh-TW': (at: string) => `上次執行：${at}` },
  healthWorkspace: { en: 'Workspace', 'zh-TW': '工作區' },
  healthWorkspaceFile: { en: 'Workspace file', 'zh-TW': '工作區檔案' },
  healthCounts: { en: (errors: number, warnings: number, suggestions: number) => `${errors} error(s), ${warnings} warning(s), ${suggestions} suggestion(s)`, 'zh-TW': (errors: number, warnings: number, suggestions: number) => `${errors} 個錯誤、${warnings} 個警告、${suggestions} 個建議` },
  healthNone: { en: 'Nothing to report.', 'zh-TW': '沒有需要回報的內容。' },
  healthMore: { en: (count: number) => `${count} more findings: see the run artifact.`, 'zh-TW': (count: number) => `另有 ${count} 項，請看這次執行的 artifact。` },
  healthContinues: { en: 'The report continues in the run artifact.', 'zh-TW': '報告其餘部分請看這次執行的 artifact。' },
  healthStatusError: { en: (message: string) => `Status: ${message}`, 'zh-TW': (message: string) => `狀態：${message}` },
  healthPath: { en: 'Path', 'zh-TW': '路徑' },
  wroteHealth: { en: (out: string) => `wrote ${out}/health.md and ${out}/health-issue.md\n`, 'zh-TW': (out: string) => `已寫出 ${out}/health.md 與 ${out}/health-issue.md\n` },
  findingCounts: { en: (errors: number, warnings: number, notes: number) => `\n${errors} error(s), ${warnings} warning(s), ${notes} note(s)`, 'zh-TW': (errors: number, warnings: number, notes: number) => `\n${errors} 個錯誤、${warnings} 個警告、${notes} 個提醒` },
  suggestionCount: { en: (count: number) => `\n${count} suggestion(s)`, 'zh-TW': (count: number) => `\n${count} 個建議` },
  statusDetail: { en: (status: string, evidence: string) => `${status}; ${evidence}`, 'zh-TW': (status: string, evidence: string) => `${status}；${evidence}` },
  statusArgs: { en: "status needs exactly one of --git <repo> or --github <owner/repo>, and one plan.json", 'zh-TW': "status 需要 --git <repo> 或 --github <owner/repo>（二選一）與一個 plan.json" },
  refGitOnly: { en: "--ref can only be used with --git", 'zh-TW': "--ref 只能和 --git 一起用" },
  couplingArgs: { en: "coupling needs --before, --after and --changed", 'zh-TW': "coupling 需要 --before、--after 與 --changed" },
  unknownCommand: { en: (cmd: string, help: string) => `unknown command ${cmd}\n\n${help}`, 'zh-TW': (cmd: string, help: string) => `未知的指令 ${cmd}\n\n${help}` },
  planArgs: { en: "give at least one plan.json", 'zh-TW': "請至少指定一個 plan.json" },
  wrote: { en: (out: string, pages: number, items: number) => `wrote ${out}/atlas.{json,md,drawio,html}: ${pages} page(s), ${items} item(s)\n`, 'zh-TW': (out: string, pages: number, items: number) => `已寫出 ${out}/atlas.{json,md,drawio,html}：${pages} 頁、${items} 個項目\n` },
  badLang: { en: (value: string) => `Invalid language ${JSON.stringify(value)}; use en or zh-TW`, 'zh-TW': (value: string) => `無效的語言 ${JSON.stringify(value)}；請使用 en 或 zh-TW` },
  uiOutlineToggle: { en: "Show or hide the outline", 'zh-TW': "顯示或收合左側大綱" },
  uiOutlineButton: { en: "☰ Outline", 'zh-TW': "☰ 大綱" },
  uiHierarchy: { en: "Hierarchy", 'zh-TW': "層級" },
  uiResetHint: { en: "Clear manual positions on this page and restore automatic layout", 'zh-TW': "清除本頁的手動位置，回到自動排版" },
  uiReset: { en: "Auto layout", 'zh-TW': "本頁自動排版" },
  uiCopy: { en: "Copy layout JSON", 'zh-TW': "複製版面 JSON" },
  uiPaste: { en: "Paste layout JSON", 'zh-TW': "貼上版面 JSON" },
  uiFoldHint: { en: "Collapse all groups", 'zh-TW': "收合所有群組" },
  uiFold: { en: "Collapse all", 'zh-TW': "全部收合" },
  uiOutlineClose: { en: "Close outline", 'zh-TW': "關閉大綱" },
  uiOutline: { en: "Outline", 'zh-TW': "大綱" },
  uiCanvas: { en: "Dependency map: drag nodes to move them; pan and zoom", 'zh-TW': "依賴圖：拖拉節點只改位置，可平移與縮放" },
  uiUp: { en: "← Up one level", 'zh-TW': "← 上一層" },
  uiBackHint: { en: "Return to the previous page", 'zh-TW': "回到上一個看過的頁面" },
  uiBack: { en: "Back", 'zh-TW': "返回" },
  uiZoomIn: { en: "Zoom in", 'zh-TW': "放大" },
  uiZoomOut: { en: "Zoom out", 'zh-TW': "縮小" },
  uiFit: { en: "Fit to view", 'zh-TW': "符合畫面" },
  uiTemplateTitle: { en: "This plan-atlas template has no data yet", 'zh-TW': "這是 plan-atlas 的頁面範本，還沒有資料" },
  uiTemplateHelp: { en: "Run {command}, then open {file}.", 'zh-TW': "執行 {command}，開啟產生的 {file}。" },
  uiDone: { en: "Done", 'zh-TW': "已完成" },
  uiReady: { en: "Ready", 'zh-TW': "可開工" },
  uiBlocked: { en: "Blocked", 'zh-TW': "被擋住" },
  uiDoneCount: { en: "Done {count}", 'zh-TW': "完成 {count}" },
  uiReadyCount: { en: "Ready {count}", 'zh-TW': "可開工 {count}" },
  uiBlockedCount: { en: "Blocked {count}", 'zh-TW': "被擋 {count}" },
  uiInnerOverlaps: { en: "Internal overlaps {count}", 'zh-TW': "內部重疊 {count}" },
  uiExpand: { en: "{count} children · Click to expand →", 'zh-TW': "{count} 項・點擊展開 →" },
  uiUnloaded: { en: "Plan not loaded", 'zh-TW': "未載入的計畫" },
  uiOpenVisit: { en: "{count} open items · Click to visit", 'zh-TW': "未完成 {count} 項・點擊前往" },
  uiStateVisit: { en: "{state} · Click to visit", 'zh-TW': "{state}・點擊前往" },
  uiInferred: { en: "Inferred", 'zh-TW': "推論" },
  uiOverlap: { en: "Overlap", 'zh-TW': "重疊" },
  uiSheet: { en: "SHEET {index} / {last}", 'zh-TW': "圖紙 {index} / {last}" },
  uiBackTo: { en: "Return to \"{title}\"", 'zh-TW': "回到「{title}」" },
  uiParentPage: { en: "Up one level: {title}", 'zh-TW': "上一層：{title}" },
  uiSiblings: { en: "Same level", 'zh-TW': "同層" },
  uiOrder: { en: "Order", 'zh-TW': "排程" },
  uiOrderSuffix: { en: " (order)", 'zh-TW': "（排程）" },
  uiStatus: { en: "{count} nodes{layout} · Dragging changes positions; data sets dependencies", 'zh-TW': "{count} 個節點{layout}・拖拉只改位置，依賴由資料決定" },
  uiManual: { en: " · {count} moved manually", 'zh-TW': "・手動調整 {count} 個" },
  uiAuto: { en: " · Automatic layout", 'zh-TW': "・自動排版" },
  uiResetDone: { en: "Automatic layout restored for this page", 'zh-TW': "已恢復本頁自動排版" },
  uiCopied: { en: "Layout JSON copied", 'zh-TW': "已複製版面 JSON" },
  uiLayout: { en: "Layout JSON", 'zh-TW': "版面 JSON" },
  uiImportHelp: { en: "Applies positions only. Unknown pages or nodes are skipped; dependencies stay the same.", 'zh-TW': "只套用位置；不認得的頁面或節點會略過，依賴不受影響。" },
  uiCopyHelp: { en: "The browser blocked copying. Select and copy the text manually.", 'zh-TW': "瀏覽器不允許直接複製，請手動選取。" },
  uiApply: { en: "Apply", 'zh-TW': "套用" },
  uiClose: { en: "Close", 'zh-TW': "關閉" },
  uiApplied: { en: "Applied {count} node positions", 'zh-TW': "已套用 {count} 個節點位置" },
  uiInvalidJson: { en: "Invalid JSON. Check that you pasted the complete text.", 'zh-TW': "這不是有效的 JSON，請確認貼上的內容完整。" },
  uiLocation: { en: " ({title})", 'zh-TW': "（{title}）" },
  uiStateInferred: { en: "Status is inferred", 'zh-TW': "狀態為推論" },
  uiSource: { en: "Source", 'zh-TW': "出處" },
  uiEvidence: { en: "Status evidence", 'zh-TW': "狀態依據" },
  uiLinks: { en: "Links", 'zh-TW': "連結" },
  uiTouches: { en: "Touches", 'zh-TW': "觸及" },
  uiNone: { en: "(none)", 'zh-TW': "（無）" },
  uiUnspecified: { en: "Not specified", 'zh-TW': "未註明" },
  uiPrereqs: { en: "Finish first", 'zh-TW': "要先完成" },
  uiAfter: { en: "Scheduled after", 'zh-TW': "排程在這些之後" },
  uiDependents: { en: "Items waiting on this", 'zh-TW': "等它的項目" },
  uiSharedWork: { en: "Work in the same area", 'zh-TW': "同區塊施工" },
  uiSources: { en: "Plan sources", 'zh-TW': "計畫來源" },
  uiPageOrders: { en: "Order dependencies on this page", 'zh-TW': "本頁的排程依賴" },
  uiPageOverlaps: { en: "Work in the same area on this page", 'zh-TW': "本頁的同區塊施工" },
  uiValidation: { en: "Validation", 'zh-TW': "驗證" },
  uiLegend: { en: "Legend", 'zh-TW': "圖例" },
  uiOverlapHelp: { en: ". These items have no dependency between them. Choose an order before branching.", 'zh-TW': "。兩者沒有依賴關係，先決定順序再開分支。" },
  uiExternalHelp: { en: "This item belongs to another plan that is not loaded, so its status is unknown. Pass that plan file to plan-atlas too.", 'zh-TW': "這個項目屬於另一份計畫，目前沒有一起載入，所以看不到它的狀態。把那份計畫檔一起傳給 plan-atlas 就能檢查。" },
  uiGroupHelp: { en: "Click an item for dependencies and sources. Hexagons link to other groups.", 'zh-TW': "點項目看依賴與出處；六角形是其他群組的接頭。" },
  uiMapHelp: { en: "Click a group to expand. Dragging changes positions; data sets connections, statuses and conflicts.", 'zh-TW': "點群組展開；拖拉只改位置，連線、狀態與衝突都由資料計算。" },
  uiValidationCounts: { en: "Total: {errors} error(s), {warnings} warning(s){scope}", 'zh-TW': "全部：{errors} 個錯誤、{warnings} 個警告{scope}" },
  uiPageScope: { en: "; those for this page are below", 'zh-TW': "；以下是和本頁有關的" },
  uiClean: { en: "All levels agree. No errors or warnings.", 'zh-TW': "各層一致，沒有錯誤或警告。" },
  uiNotes: { en: "Notes ({count})", 'zh-TW': "提醒（{count}）" },
  uiLegendHelp: { en: "Solid: finish first  Dashed: planned order  Red dotted: work in the same area", 'zh-TW': "實線：要先完成　虛線：計畫排程　紅色點線：同區塊施工" },
  uiChildren: { en: "Children of {title}", 'zh-TW': "{title} 的子項目" },
  uiBlockedItems: { en: "{count} blocked items", 'zh-TW': "被擋 {count} 項" },
  uiProgress: { en: "{done} done / {total} items", 'zh-TW': "完成 {done}／共 {total} 項" },
  uiRelease: { en: "release", 'zh-TW': "release" },
  uiTag: { en: "tag", 'zh-TW': "tag" },
};

type MessageId = keyof typeof messages;
type Params<K extends MessageId> = (typeof messages)[K]['en'] extends (...args: infer P) => string ? P : [];

export function t<K extends MessageId>(lang: Lang, id: K, ...params: Params<K>): string {
  const message = messages[id][lang];
  return typeof message === 'string' ? message : (message as unknown as (...args: Params<K>) => string)(...params);
}

/** Only the chosen language is embedded in the single-file viewer. */
export function viewerStrings(lang: Lang): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).flatMap(([id, variants]) =>
    id.startsWith('ui') && typeof variants[lang] === 'string' ? [[id, variants[lang] as string]] : []));
}
