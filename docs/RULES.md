# plan-atlas validation rules

Status: specification, 2026-11-03, revised after a second review. Where the code or a test does something else, section 4 lists it; this document changes neither.

## 1. Purpose and method

The rules are written the way civil codes are. The **general part** (§G) defines each concept once and applies to every rule. A specific rule prevails over §G only where it departs from it **expressly** (*lex specialis*), in a line "*Departs from §Gx.y:* what and why"; §G applies to everything the rule does not expressly regulate. An implicit departure, a rule computing a §G concept differently without saying so, is a defect: the earlier review rounds kept finding exactly that. In code, `src/semantics.ts` implements each §G concept once and every rule uses it; a rule implements something differently only where this document states the departure, with a comment citing it and a test named "§V… departs from §G…". The **specific part** (§V, §S) states each rule as numbered **elements**, all of which must be met, and a **consequence**: level, unit counted (one finding per what) and message id in `src/messages.ts`. A rule with several branches is split into sub-rules, so every element is atomic. **Competition** says which rule displaces which when both would fire on the same statement; only the displacing rule reports. A finding is a **subsumption**: it names the statement and the facts that meet each element.

A finding is a possible contradiction, not a verdict, and a status suggestion (§S) is only a suggestion: plan-atlas suggests, people decide. The levels say who acts. **ERROR**: the plan data itself is broken (its shape, a missing source or citation, a target that does not exist, a dependency changed without its plan document, an edited committed summary), or the plans state something that can never be carried out (a hard loop). **WARN**: a possible contradiction for a person to judge. **INFO**: a note. The CLI exits 1 on an ERROR; in CI the Action reports by default (`fail-on: none`) and blocks only when a repository opts in with `fail-on: error` or `warn`.

Tests derive from this text. Per rule: one case with every element met, and one case per element negated (no finding). Per competition clause: one case where both rules fire, asserting that only the displacing one reports. An element that another element needs in order to be evaluated (an existing `source`, a resolved endpoint) is a **precondition**. It stays in the rule, and two rules that exclude each other only through a precondition get no competition clause. Every other exclusion is written under Competition, never inside an element.

Marked **[decision]**: places where code, tests and documents disagreed or were silent, and this document chose, with one line of reasoning.

## 2. General part

**§G1 Node, item, group.**
1. A node is one entry of a plan file's `nodes`. A node that is some node's `parent` is a **group**; every other node is an **item**. Being a group is derived, never declared.
2. An item carries `status`; a group never does. A **release** is an item with `kind: "release"`; only a release carries `tag`.
3. *x lies under g* when g is x or an ancestor of x. `leaves(g)` = the items under g. Two nodes are **nested** when one lies under the other, including a node and itself.

**§G2 Plan file, namespace, merged id.**
1. A plan file is one JSON document following `schema/plan-atlas.schema.json`.
2. Its **namespace** is `namespace`, else the id of its single root, else `plan`. A namespace is **loaded** when a file in this run has it, even a file with no nodes.
3. A **reference** is an id of the same file, or `<ns>:<id>`. `<ns>:<ns>` names the root whose id equals the namespace.
4. **Merged id**: when several files are loaded, or a workspace is used, each node becomes `<ns>:<id>`, except a root whose id equals its namespace. One file loaded alone keeps its ids, and its own `<ns>:<id>` references resolve to them. With qualified ids, `source`, `sources` and area keys get the prefix `<ns>/`.

**§G3 Declaration, expanded edge, resolution.**
1. A **declaration** is one `dependsOn` entry on a node n: *n waits for the target*. n is its **source node**.
2. A **claim** (§G9) is a statement in one plan that a node of another plan waits for one of its own. It produces no edges.
3. An **expanded edge** is an ordered item pair (from, to) with a type, produced by binding a declaration (§G5). Readiness, cycles, stale status and agreement are computed on expanded edges; citation and coupling on declarations.
4. A reference is **resolved** when it names a node of a loaded plan. It is **unloaded** when its namespace is not loaded, and **missing** when its namespace is loaded (or it is unqualified) but no such node exists. With a workspace, an unloaded reference is **unknown** when its namespace is not listed in the workspace either (§G10.5).

**§G4 Dependency type.**
1. `hard`: the waiting item must not be done before the prerequisite is done.
2. `order`: the plan prefers the sequence; it never blocks.
3. A hard dependency also fixes the sequence. *Type σ or stronger* means both types for σ = order, and hard only for σ = hard.

**§G5 Binding of a declaration.** For a group g and a type σ:
1. **Inner wait.** Item i *waits inside g* on item j when a declaration of type σ or stronger, not nested, has its source node under g but not g itself with i under it, and its target under g with j under it. **[decision]** Only declarations whose source node and target both lie inside g order the items of g. Paths through nodes outside g do not count, because a group's boundary is decided by what the plan states inside it.
2. **Components.** The leaves of g fall into components: maximal sets of items that all reach each other through inner waits. An item on no loop is a component by itself. The components are ordered without loops.
3. `finalItems(g, σ)` = the items of components that no other component of g waits on. `firstItems(g, σ)` = the items of components that wait on no other component of g. A loop is one component, so its items are final (first) unless another component follows (precedes) it. Example: G = {a, b, c}, with a and b ordering each other and c independent, gives finalItems(G, order) = {a, b, c}.
4. **[decision]** A hard binding counts only hard declarations inside g; an order binding counts both. Reason: a preferred sequence inside a group must not free an item from a hard obligation on or by the group, while a hard declaration inside it does fix the sequence.
5. **Lemma.** Every item under g is final or reaches a final item through inner waits of type σ or stronger. Likewise, every item under g is first or is reached from a first item.

A declaration on n with target t and type σ binds these expanded edges of type σ:

| Case | Edges |
|---|---|
| item n, item t | (t, n) |
| item n, group t | (f, n) for each f in finalItems(t, σ) |
| group n, item t | (t, s) for each s in firstItems(n, σ) |
| group n, group t | (f, s) for each f in finalItems(t, σ), s in firstItems(n, σ) |
| sub-group S under G | binds as above on S, and counts as an inner wait (5.1) of every group above S |
| cross-file | as above on merged ids; a group never spans files |
| n and t nested | no edges (§V6b) |
| t unloaded or missing | (t, s) for each s the source side binds, marked unresolved; an unresolved prerequisite is never done |

**§G6 Status.**
1. An item's status is `done` or `open` as written. A group's **derived status** is done exactly when every item under it is done.
2. Item **state**: an item is done when its status says so. An open item is **blocked** when some hard expanded edge into it comes from an unresolved item or from an item that is not done. Every other open item is **ready**. Order edges never block. A group counts done, ready and blocked over the items under it.
3. **[decision]** Wherever a rule asks for a node's status, a group's derived status is used. Reason: groups never carry `status`, so reading it from the file silently skips every group.

**§G7 Crossing.**
1. A declaration **crosses a group boundary** when its source node and its target have different parents. Siblings never cross, including two roots of one file.
2. A declaration **crosses a file boundary** when its target lies in another namespace, whether resolved, unloaded or missing.
3. A **crossing** declaration crosses either boundary. Crossing is judged after resolving `<own ns>:<id>` (7.4). A missing target in the declaration's own file cannot be judged; §V0 or §V8a1 reports it.
4. **[decision]** A reference `<own ns>:<id>` inside its own file is the node `<id>`, for crossing too. Reason: merging already resolves it so; one statement must not cross in one rule and not in another.

**§G8 Statement, citation, counting.**
1. A **statement** is one assertion in a plan file: an item's status, an item's `source`, a declaration, a claim, a release's tag, or an entry of the committed summary.
2. A declaration is **cited** when it has both `source` (file and section) and `quote` (at most 15 words of plan text). Crossing declarations must be cited; claims may omit both. The **file part** of a `source` is its text before the first whitespace, with a leading `./` removed. A `source` **matches** a listed file s when its file part equals s, or when the `source` starts with s.
3. Each rule names its unit in *Consequence* and reports at most one finding per unit.
4. **Competition.** When rules A and B would fire on the same statement and A's elements imply B's, or B's finding only restates A's defect, A displaces B. When they catch different defects of one statement, both report (concurrence).
5. **Precondition.** A V0 ERROR stops the run before any later stage, merging included. No other rule applies to any file in that run.

**§G9 Claim and agreement.**
1. A claim C = (F, T, τ) in plan P says *T waits for F*. τ is the claim's `type`, or hard when absent. **[decision]** Reason: messages say "must wait for it", and §V11b already treats an untyped claim as a gate; one statement gets one meaning.
2. The **claimed pairs** P(C) are exactly the edges that a declaration of type τ on T with target F would bind under §G5: every (f, t) with f in finalItems(F, τ) and t in firstItems(T, τ), an item standing for itself, and none when F and T are nested. One concept, the binding, decides both readiness and agreement.
3. f **reaches** t at strength σ when a path of resolved expanded edges leads from f to t, every edge of type σ or stronger.
4. C is **agreed** when f reaches t at strength τ for every claimed pair (f, t).
5. C is **stated with another type** when τ is hard, C is not agreed, and f reaches t at strength order for every claimed pair. Then at least one pair needs an order edge.
6. Otherwise C is **unstated**: some claimed pair is not connected even at strength order.
7. **[decision]** Agreement is defined on the binding, not on where declarations sit. Reason: one concept then decides both readiness and agreement. A declaration at any level of either plan counts exactly when it makes T wait. Consequences: a hard claim met by hard on A1 and order on A2 is stated with another type (open review finding). A declaration on one child of T does not agree with a claim on T that has other first items.
8. **[decision]** Strength counts as *τ or stronger*, so a hard declaration agrees with an order claim. Reason: it fixes the sequence the claim asks for (§G4.3).

**§G10 Workspace.**
1. A **workspace entry** is `{namespace, file, github | path, ref?}`, one per plan file. The entry's namespace must equal the plan file's `namespace` field; a file without that field does not match (docs/design/multi-repo.md).
2. Positional plan files **replace** entries before fetching. The match is tried in this order: in CI, the file at the entry's path in the current repository; else the entry with the same namespace; else a lone positional plan for the current repository's only entry. Positional files that match no entry are loaded as further plans.
3. **Confinement**: when `PLAN_ATLAS_CONFINE` is set, every input file and every `path` entry must be a regular file, not a symlink, inside that directory.
4. An entry is **unreadable** when its file cannot be read or fetched. Invalid JSON, an invalid plan and a namespace mismatch are not "unreadable".
5. With a workspace, a namespace is **known** when it is loaded or listed. An id is **excused** when it appears exactly in the referring plan's `externalRefs`.

**§G11 Page, representative, overlap, summary.**
1. There is one **page** per group. A virtual top page `@root` is added when there are several roots or the only root is an item.
2. **Representative** of item x on the page of g:
   - x lies under g: the child of g that x lies under.
   - x does not lie under g: a stub `@n`, where n is the ancestor of x just below the lowest common ancestor of x and g, or x's root when there is none.
   - x is unresolved: the stub `@x`.
   - On the top page: x's root.
3. **Page edges**: every expanded edge and every overlap with at least one end under g (on the top page, all of them) is mapped to the representatives of its ends. An edge whose two ends get the same representative is dropped. Dependency edges are keyed by (type, from, to) and overlap edges by their unordered pair. Each page edge counts its item pairs. **Page nodes** are g's children plus the stubs used.
4. **Overlap**: under an overlap rule r, two open items a ≠ b overlap in an area when all of these hold:
   - a matches `r.a` and b matches `r.b`. A selector matches when `kind` is equal (if given) and the id without its namespace prefix starts with `idPrefix` (if given).
   - Neither item reaches the other over resolved expanded edges of either type.
   - The area is in both items' `touches`.

   There is one overlap per (rule, unordered pair, area).
5. The **summary** (`atlas.json`) holds each group's derived status and counts, and each page's nodes and edge counts.

## 3. Specific part

### §V0 Shape

*Elements.* (1) The subject exists. (2) It meets the condition of its row.

| Sub-rule | Subject | Condition | Message |
|---|---|---|---|
| V0.1 | input file given on the command line (not a workspace entry) | cannot be read | `fileRead` |
| V0.2 | input or entry file | not valid JSON | `fileJson` (entry: `workspaceRead`) |
| V0.3 | input or entry file | outside confinement or not a regular file (§G10.3) | `fileConfined` (entry: `workspaceRead`) |
| V0.4 | plan file | not an object | `jsonObject` |
| V0.5 | plan or workspace file | `version` ≠ 1 | `version` |
| V0.6 | plan file | `nodes` not an array | `nodesArray` |
| V0.7 | node | no string `id` or `title` | `nodeFields` |
| V0.8 | node | id used before in the file | `duplicateId` |
| V0.9 | node | id contains `:` | `idColon` |
| V0.10 | node | `parent` neither string nor null | `parentType` |
| V0.11 | node | `parent` names no node | `unknownParent` |
| V0.12 | parent loop | a set of nodes whose parent chain returns to itself | `parentCycle` |
| V0.13 | plan file | has nodes, and none is a root | `noRoot` |
| V0.14 | node | `status` neither `done` nor `open` | `statusType` |
| V0.15 | group | has `status` | `groupStatus` |
| V0.16 | item | has no `status` | `itemStatus` |
| V0.17 | release | has children | `releaseChildren` |
| V0.18 | node | `tag` without `kind: "release"` | `tagOnItem` |
| V0.19 | node | `dependsOn` not an array | `depsArray` |
| V0.20 | `dependsOn` entry | no string `id`, or `type` not hard/order | `depFields` |
| V0.21 | declaration | unqualified target names no node of the file | `unknownDep` |
| V0.22 | `touches` entry | not a declared area | `unknownArea` |
| V0.23 | node | `links` not an array | `linksArray` |
| V0.24 | link | does not match the link pattern | `badLink` |
| V0.25 | node field | `source`, `quote`, `evidence`, `kind`, `tag` not a string; `sources`, `touches` not an array of strings | `fieldType` |
| V0.26 | plan file | `namespace` breaks its pattern | `planNamespace` |
| V0.27 | `claims`, `externalRefs`, `rules.overlaps` | not an array | `listArray` |
| V0.28 | claim, external ref, overlap rule | malformed | `claimFields`, `externalRefFields`, `overlapFields` |
| V0.29 | `rules.maxPageNodes` | not an integer ≥ 3 | `maxPageNodes` |
| V0.30 | loaded files | two share a namespace | `duplicateNamespace` |
| V0.31 | workspace file | not an object; `plans` not an array | `workspaceObject`, `workspacePlans` |
| V0.32 | workspace entry | bad namespace or `file`; not exactly one of github/path; absolute `path`; empty `ref` | `workspaceFields`, `workspaceFile`, `workspaceLocation`, `workspacePath`, `workspaceRef` |
| V0.33 | workspace | a namespace or a repository file listed twice | `duplicateNamespace`, `workspaceDuplicateFile` |
| V0.34 | workspace entry | namespace ≠ file's `namespace` field (§G10.1) | `workspaceNamespace` |
| V0.35 | workspace entry | its file cannot be read or fetched (§G10.4) | `workspaceRead` |

*Consequence.* ERROR per subject and row; V0.12 one per loop. With `--allow-missing`, V0.35 is WARN. Every other row stays ERROR on entries, notably V0.2 (invalid JSON), V0.3 (confinement), the plan-shape rows V0.4–0.29 and V0.34.

*Competition.* V0 displaces every other rule for the run (§G8.5). Within V0, V0.1–4 and V0.6 stop parsing of that file, so its later rows are not evaluated.

### §V1, §V2, §V4 Committed summary

*Elements.* (1) A committed summary is given (`--against`). (2) The condition of the row, comparing it with the derived summary (§G11.5).

| Sub-rule | Condition | Message |
|---|---|---|
| V2.1 | a derived group is absent | `summaryMissingGroup` |
| V2.2 | a group's entry (status with counts) differs | `summaryStatus` |
| V2.3 | a group in the summary is not derived | `summaryUnknownGroup` |
| V4.1 | a derived page is absent | `summaryMissingPage` |
| V4.2 | a page in the summary is not derived | `summaryUnknownPage` |
| V4.3 | a page's node list differs | `summaryNodes` |
| V1.1 / V4.4 | a dependency / overlap edge in the summary is not derived | `summaryExtraEdge` |
| V1.2 / V4.5 | a derived dependency / overlap edge is absent | `summaryMissingEdge` |
| V1.3 / V4.6 | a dependency / overlap edge count differs | `summaryCount` |

*Consequence.* ERROR per group, page or edge.

*Competition.* V4.1 displaces V4.3 and V1.2 / V4.5 on that page.

*Not covered.* Whether the plan is right; the summary is regenerated, never edited (AGENTS.md).

### §V3 Provenance

**V3a.** *Elements.* (1) An item. (2) It has no `source`. *Consequence.* ERROR per item, `noSource`.

**V3b.** *Elements.* (1) An item. (2) It has a `source` (precondition). (3) Some ancestor group has non-empty `sources`; take the nearest. (4) The `source` matches none of them (§G8.2). *Consequence.* ERROR per item, `wrongSource`.

*Competition.* Concurrent with §V7.

*Not covered.* Group `source`; whether the cited section exists.

### §V5 Page size

*Elements.* (1) A page (§G11.1). (2) Its node count, stubs included, exceeds `maxPageNodes`: the smallest value over the loaded files, default 15.

*Consequence.* WARN per page, `pageSize`.

### §V6 Cycles

**V6a hard loop.** *Elements.* (1) A set S of at least two items. (2) S is a strongly connected component of the graph of resolved hard expanded edges. *Consequence.* ERROR per component, `hardCycle`, with one loop through it.

**V6b nested declaration.** *Elements.* (1) A declaration. (2) Its target is resolved (precondition). (3) Its source node and target are nested (§G1.3). *Consequence.* Per declaration, `nestedDep`: ERROR when hard, WARN when order.

**V6c contradicted order.** *Elements.* (1) A declaration. (2) Its type is order. (3) It binds a resolved expanded edge (a, b). (4) a is reachable from b over resolved expanded edges of either type. *Consequence.* WARN per declaration, `orderCycle`, with one example path.

**V6d grouping artifact.** *Elements.* (1) A page. (2) A strongly connected component of at least two of its own nodes (stubs excluded) over its dependency page edges. *Consequence.* WARN per component and page, `groupCycle`. *Departs from §G11.3:* the component is taken over the page's own nodes and the edges between them; stubs, which §G11.3 counts as page nodes, are left out. Reason: a loop through a stub is the same items seen from inside one group, and the page of their common ancestor reports it.

*Competition.*
- V6b binds nothing (§G5), so it never feeds V6a, V6c or V6d.
- An edge (a, b) of V6c that has a hard expanded edge (a, b) beside it is displaced. The hard declaration states the same sequence, and the loop is reported for its other edges: by V6a, or by V6c on their order declarations.
- V6a and V6c are concurrent on a loop of mixed types.
- V6a or V6c displaces V6d when the edges of one item component (over resolved expanded edges of either type) cover every page edge inside the V6d component, once mapped to representatives.
- V6b displaces §V8b on the same declaration **[decision]**. Reason: the declaration binds nothing, so there is no crossing dependency to cite; the fix is to remove it.

*Not covered.* Loops through unresolved items; claims.

### §V7 Inferred status

*Elements.* (1) An item. (2) `inferred: true`. *Consequence.* INFO per item, `inferredStatus`, with `evidence`.

*Competition.* Concurrent with §V3 **[decision]**. Reason: V3 concerns the item's source, V7 its status; these are two statements.

*Not covered.* `inferred` on groups; empty `evidence`.

### §V8 References and citations

**V8a1 missing item.** *Elements.* (1) A declaration. (2) Its target is qualified. (3) Its namespace is loaded. (4) No node has that id. *Consequence.* ERROR per declaration, `missingExternalItem`.

**V8a2 unknown namespace (declaration).** *Elements.* (1) A declaration. (2) A workspace is used. (3) The target is unknown (§G3.4). (4) It is not excused (§G10.5). *Consequence.* ERROR per declaration, `unknownNamespace`.

**V8a3 unknown namespace (claim).** *Elements.* (1) A claim. (2) A workspace is used. (3) An endpoint is unknown. (4) It is not excused. *Consequence.* ERROR per claim, `claimUnknownNamespace`, listing every such endpoint.

**V8a4 unloaded.** *Elements.* (1) A declaration. (2) Its target is unloaded. *Consequence.* INFO per declaration, `externalUnloaded`.

**V8b citation.** *Elements.* (1) A declaration. (2) It crosses (§G7). (3) It is not cited (§G8.2). *Consequence.* ERROR per declaration, `depCitation`, however many edges it binds.

*Competition.*
- V8a2 displaces V8a4.
- V8a1 and V8a2 each displace V8b on the same declaration **[decision]**. Reason: the target must be fixed first, and crossing is judged again on the fixed target. V8a4 does not displace V8b.
- §V6b displaces V8b.
- V8a3 displaces §V9a on the same claim **[decision]**. Reason: one finding per claim, and an unknown namespace is fixed before missing nodes can be judged.
- V8a3 displaces §V9b when every endpoint V9b would name is one that V8a3 names.

*Not covered.* Claims need no citation (schema). The 15-word limit, and whether the quote occurs in the source, are not checked.

### §V9 Claims

**V9a missing endpoint.** *Elements.* (1) A claim. (2) F or T is missing (§G3.4). *Consequence.* ERROR per claim, `claimMissingNode`, listing the missing endpoints.

**V9b unloaded endpoint.** *Elements.* (1) A claim. (2) F or T is unloaded. *Consequence.* INFO per claim, `claimUnloaded`.

**V9c unstated.** *Elements.* (1) A claim. (2) F and T are resolved (precondition). (3) C is unstated (§G9.6). *Consequence.* WARN per claim, `claimMissing`.

**V9d another type.** *Elements.* (1) A claim. (2) F and T are resolved (precondition). (3) C is stated with another type (§G9.5). *Consequence.* WARN per claim, `claimType`.

*Competition.* V9a displaces V9b. V9c and V9d are each concurrent with §V11b: "the plans disagree" and "the gate is passed" are two defects.

*Not covered.* A declaration with no matching claim in the other plan (V9 checks one direction). Whether F belongs to the claiming plan.

### §V10 Change coupling (`plan-atlas coupling`)

A declaration is keyed by (source node, target, type) **[decision]**. Reason: two declarations on one pair are two statements, each with its own `source`. *Departs from §G3.1:* a declaration is identified across the two versions by its key, not as one `dependsOn` entry, so two entries with the same key count once; V10c counts per (source node, target) pair. Reason: an entry has no identity across versions other than what it states. Each version is one plan file on its own, so §G7 is judged without merging, with `<own ns>:<id>` resolved per §G7.4. Every sub-rule has (1) two versions of one plan file and the list of changed files.

| Sub-rule | (2) Change | (3) Crosses (§G7) in | (4) Citation | Message |
|---|---|---|---|---|
| V10a1 / a2 | a key exists only in the new version, and its (source node, target) is not retyped | new | no `source` / its file part not changed | `addedDep` with `couplingNoSource` / `couplingUnchanged` |
| V10b1 / b2 | a key exists only in the old version, and its (source node, target) is not retyped | old | as above, old `source` | `removedDep` with the same |
| V10c1 / c2 | the (source node, target) is **retyped**: the old version has exactly one type for it, the new version exactly the other | new or old | the new declaration's `source` when it crosses in the new version; the old `source` only when it crosses solely in the old version | `retypedDep` with the same |

*Consequence.* ERROR per key (V10c: per pair). A change to `source` alongside a retype does not turn it into an addition or removal.

*Competition.* None: the "not retyped" part of element (2) keeps V10a and V10b off retyped pairs.

*Not covered.* Claims; what the document change says (known limit, test F3); a change to `source` or `quote` alone; other repositories.

### §V11 Status against hard dependencies

**V11a stale status.** *Elements.* (1) A declaration on node b. (2) Its type is hard. (3) It binds a resolved expanded edge (from, to). (4) `to` is done. (5) `from` is open. *Consequence.* One WARN per b, covering all of b's declarations that meet 1–5: `staleStatus` with `doneItem`/`doneItems`, and `openPre`, `openGroupPre`, or `openPrereqs` with `groupPre` and `morePre` (at most four named).

**V11b passed gate.** *Elements.* (1) A claim. (2) τ is hard (§G9.1). (3) F is resolved (precondition). (4) F is open, by derived status for a group (§G6.3). (5) T is resolved (precondition). (6) Some item under T is done. *Consequence.* WARN per claim, `passedGate`, with done and total items under T.

*Competition.* V11a and V11b are concurrent: a declaration and a claim are two statements (test "a claimed gate that the other plan already passed").

*Not covered.* Unresolved prerequisites, which cannot be seen; order dependencies.

### §V12 Release tag

*Elements.* (1) A release item. (2) Its status is done. (3) It has no `tag`. *Consequence.* WARN per release, `releaseNoTag`.

*Not covered.* Whether the tag exists in git (§S `MISSING-TAG`).

### §S Status suggestions (`plan-atlas status`)

Suggestions are not findings: they never fail a run and never change the plan. Statuses come from the raw plan; a group's status is derived (§G6.1). An id **counts** for commit matching when it has at least two characters and is not all digits **[decision]**. Reason: shorter or numeric ids match unrelated text. An id matches when it is followed by a character other than a letter, digit or underscore, so C3 matches C3-projects and C3.1 but not C3b; sub-steps carry the parent id as prefix. Details: [STATUS.md](STATUS.md).

*Departs from §G2.4:* suggestions are computed on each raw plan with the ids it writes, also in a workspace, and only the reported ids are qualified afterwards. Reason: commits and links name a repository's own ids. *Departs from §G1.1:* where §G would let a group stand for its items, a group takes part only through its `links`, never through its id. Reason: a group's id is usually a word, not a step id, and matches unrelated text.

| Label | Elements | Unit |
|---|---|---|
| `DONE?` (git) | release item; open; `tag` resolves to a commit | release |
| `MISSING-TAG` (git) | release item; done; `tag` does not resolve | release |
| `CHECK` (git, id) | open item; its id counts; a non-planning commit names it where the commit says what it does | node |
| `CHECK` (git, link) | open item or group; a non-planning commit matches one of its `links` | node |
| `MENTION` (git) | open item; its id counts; a non-planning commit names it, only mid-sentence | node |
| `CHECK` (GitHub) | a link's state disagrees with the node's status (table in STATUS.md) | node |
| `MISSING-LINK` (GitHub) | GitHub cannot find one of the node's links | node |

A non-planning commit is one that does not change only the cited plan documents.

*Competition.* On one release, DONE? and MISSING-TAG displace the git CHECK and MENTION rows. On one node, CHECK displaces MENTION. GitHub CHECK and MISSING-LINK are concurrent.

*Not covered.* Unparseable links are left to `check`.

## 4. Divergences

The code follows this specification. Every divergence listed on 2026-11-03 was fixed in code, tests or documents; each fix has a test named after its section in `test/rules.test.ts` or `test/rules-general.test.ts`. One row stays open:

| # | Where | Spec | Current behaviour | Why it stays |
|---|---|---|---|---|
| 1 | src/cli.ts, `status --git` and `status --github` with one plan file | §V0.1-3 | An input file that cannot be read, is not valid JSON or lies outside confinement stops the command with exit code 2, not a V0 finding. | These commands print suggestions, which are not findings (§S), so there is no finding list to put it in. `check`, `build`, `coupling` and `status --workspace` report V0 findings. |
