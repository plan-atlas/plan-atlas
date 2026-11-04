---
name: onboard
description: Set up plan-atlas on a repository. Extract ONE plan document (markdown step tables or checklists, .agents/plans, ADR step lists, Spec Kit specs/FEATURE/tasks.md) into plan-atlas JSON, run check and status against git and GitHub, build the drill-down map, report what needs the user's decision, and offer a "Configure plan-atlas" pull request. Use when the user says "map my plans", "check my plan", "plan-atlas", or asks whether their plan matches the code.
---

# plan-atlas onboarding

Goal: within about 30 minutes, show the user a real finding about their own plan: a step merged in git but still open in the plan, two plans that disagree, a dependency on something that does not exist. plan-atlas runs no LLM. You do the reading and extraction; the CLI does the checking.

Work in the user's repository (the target). Do not edit the plan-atlas checkout.

## 0. Set up

1. Run `node --version`. plan-atlas needs Node 22.18 or later (it runs TypeScript directly). If it is older, stop and tell the user.
2. Find the CLI. This skill ships inside a plan-atlas checkout located at:

   `${CLAUDE_PLUGIN_ROOT}`

   Try these in order and use the first where `node "<path>/src/cli.ts" --help` works:
   - **Claude Code** (installed as a plugin) replaces that line with the plugin's path.
   - **Any agent that knows where this SKILL.md is** (Codex installed as a plugin, a clone): the plan-atlas root is two folders up from this file (`<root>/skills/onboard/SKILL.md`). Codex calls it the plugin root.
   - **Otherwise** (the line still shows a `${...}` variable name, which is expected outside Claude Code, and the skill folder was copied on its own): ask the user for the path to their plan-atlas clone (`git clone https://github.com/plan-atlas/plan-atlas`).
3. Below, `plan-atlas` stands for `node "<plan-atlas path>/src/cli.ts"`. Quote the path; it may contain spaces. The package is not on npm yet; `npx plan-atlas` is the future form and does not work today.
4. Read `<plan-atlas path>/AGENTS.md` and skim `<plan-atlas path>/schema/plan-atlas.schema.json` and `<plan-atlas path>/examples/bookshop/plan.json`. They are short and they are the rules.

## 1. Pick one plan document

Extract one plan, not the whole repository. A whole repository took 6 to 30 agent-minutes per repository in the proof of concept; one plan takes a few minutes.

- If the user named a file, use it.
- Otherwise look for candidates and suggest up to five, then let the user choose:
  - markdown plans with a step table or a checklist (`docs/plans/*.md`, `PLAN*.md`, `ROADMAP.md` with numbered steps),
  - `.agents/plans/` or `.agents/PLANS/`,
  - ADR-style documents that list implementation steps,
  - Spec Kit features: `specs/<feature>/tasks.md`.
- Prefer a plan with stable step ids (`R2`, `M1-S4`, `T001`), 10 to 60 steps, and recent activity (`git log -1 --format=%cs -- <file>`).
- Rank the candidates by how likely the plan and git or GitHub disagree; a disagreement is what gives a finding on the first run:
  1. A Spec Kit feature whose branch merged or whose issue closed while `tasks.md` still has unchecked boxes.
  2. A plan whose frontmatter or header says merged, done or blocked while its boxes say otherwise, or whose release tag already exists while boxes are open.
  3. A plan whose step ids appear in commit subjects.
  4. Last: a plan whose boxes are all checked. It usually agrees with git, so the tools find nothing.
- Cheap commands to rank them (a few seconds each; run them, do not guess):
  - open boxes: `grep -c "^- \[ \]" specs/<feature>/tasks.md` (or the plan file),
  - merged branch: `gh pr list --head <feature> --state merged --json number,mergedAt`; closed issue: `gh issue view <N> --json state,closedAt`,
  - release tags: `git tag --list`,
  - ids in commits: `git log --oneline -i --grep "<id>"`.
- Short numeric ids grep badly: `--grep 631` also matched unrelated dependency bumps. Grep the full feature or step name (`042-export-csv`, not `042`) and read the subjects before counting a match.
- A prose roadmap without steps does not qualify. Plans kept in Jira or Linear are out of scope.

Read the chosen document fully, plus only those companion files (decisions, ADRs) that its steps cite.

## 2. Extract it into `plans/<name>.json`

`<name>` is short and stable, usually the namespace. A checklist; AGENTS.md and the schema have the details.

File:
- `"$schema": "https://raw.githubusercontent.com/plan-atlas/plan-atlas/main/schema/plan-atlas.schema.json"` (exactly this URL; it is the schema's `$id`. The examples use a relative path only because they live inside plan-atlas), `"version": 1`, `"title"`, `"namespace"` (letters, digits, `.`, `_`, `-`; other plans reference this file's nodes as `<namespace>:<id>`).
- One root group (`"parent": null`) for the plan.

Groups (nodes with children):
- Never give a group `status`; plan-atlas derives it.
- Give the group that owns the document `"sources": ["<repo-relative path>"]`. Every item's `source` must start with a file listed by its nearest group that has `sources` (V3).
- Create groups only from structure the plan states (phases, epics, sections). Do not invent groupings. More than 15 nodes on one page is a V5 warning; report it, do not hide it.

Items (nodes without children):
- `id`: the plan's own id. Make up a short stable id only when the plan has none, and say so in the notes. No `:` in ids; unique within the file.
- A checklist without ids: use `<plan id>-<short slug>` (`A13-version`, `A13-tests`) and say so in the notes. Such ids never appear in commits, so `status --git` has nothing to match; put the plan's issue, pull request or branch in the group's `links` (when the plan or repository states one) so `status` still has a signal.
- `title`: at most 40 characters, in the plan's language, starting with the id (`"C3 Checkout page redesign"`).
- `status`: `done` only when the text says so: a checked box (`[x]` or `[X]`), a status column, "merged (#123)", "完成". Put where it says so in `evidence`.
- No status in the plan: `"status": "open"`, `"evidence": "no status in the plan"`. Do not mark anything done from reading the code; step 6 asks git.
- Any status that is your judgement: `"inferred": true` and the reason in `evidence`. If it comes from git, name the commit or pull request.
- Checked but the text says verification is still pending, or unchecked but partly done: follow the box, put the caveat in `evidence`, list it in the notes.
- Struck-through or cancelled work: there is no `cancelled` status yet. Leave it out and list it in the notes.
- A status in the frontmatter or header (`status: blocked`, `review`, `merged`, …) is not a plan-atlas status; item status still comes from the boxes or the text above. Record the value in the notes, and in the `evidence` of the items it concerns. When it disagrees with the boxes (frontmatter `merged`, every box empty), that is a contradiction for the report.
- `source`: `"<repo-relative path> §<section>"`. Repo-relative paths matter: `coupling` compares them with changed files.

Dependencies:
- If `plan-atlas.workspace.json` exists, use its namespaces for cross-repository references.
- Record only those the plan states. Never add one to make the graph look complete.
- `hard`: must finish first ("requires", "blocked by", "only once X runs"). `order`: a sequence the plan prefers (row order, a schedule, "then"). When unsure, use `order` and say so in the quote.
- Within one group, `{ "id": "C2", "type": "hard" }` is enough. A dependency that crosses groups or files needs `source` and a `quote` of at most 15 words copied from the plan text (V8).
- Depending on a group means depending on its final items (for a `hard` dependency, an `order` inside the group does not make an item first or final). A dependency the plan states at group level ("Phase 2 blocks all user stories", "the import epic depends on the parser epic") goes on the group node and applies to its first items; do not expand it to every item pair.
- Another repository's item: `<namespace>:<id>`. Unknown namespace or id: keep the reference, plan-atlas reports it, and say in the notes what the text calls it.
- If THIS plan says an item of ANOTHER plan must wait for one of ours, write it under top-level `claims` (`{ "from": "<our id>", "to": "<ns>:<id>", "type", "source", "quote" }`). If another plan says something about this one, do not copy it in; plan-atlas reports the disagreement (V9).

Releases and links:
- A release the plan or repository states (tags, CHANGELOG): an item with `"kind": "release"`, id `<package>@<version>`, `"tag": "v1.2.0"`, and `dependsOn` listing the work that ships in it. A consumer that "needs sdk 2.1.0" depends on `<ns>:sdk@2.1.0`.
- `links` (items and groups): `#N` (this repository), `owner/repo#N`, `branch:<name>`. Only from what the plan or repository states: an issue URL or number in the plan, `closes #N` in a commit, a documented naming convention. Never guess a number or a branch.

Leave out: invented items, dates or dependencies; decision records that are not work steps (cite them as `source` instead); anything derived (group status, counts). `areas`, `touches` and overlap `rules` are optional; skip them on a first extraction unless the plan names modules.

## 3. Product conventions

- **Spec Kit** (`specs/<feature>/tasks.md`): one group per feature folder with `"sources": ["specs/<feature>/tasks.md"]` and `"links": ["branch:<feature-folder>"]` (the folder name is the branch name), plus `"#N"` when the spec names an issue. Each `## Phase N: ...` heading is a sub-group. Each `- [ ] T001 [P] [US1] ...` line is an item with id `T001`; `[x]`/`[X]` is done. `[P]` means parallel: no edge. Dependencies are mostly prose in "Dependencies & Execution Order" or the phase text, so expect few edges, mostly group-level. Task ids repeat across features: extract one feature per plan file and use the feature folder as the namespace. Note template drift (`T-001:`, tables) in the notes.
- **Plans whose steps cite issues or pull requests**: put them in `links` (`"links": ["#42"]`). `status --github` then compares them with GitHub.
- **Step table with a status column**: take status from the column. **Without one**: status only from checkboxes or explicit text; otherwise `open` as above, and let `status` suggest.

## 4. Write `plans/<name>.notes.md`

Short, for a person: what did not fit the format, ids you made up, ambiguous statuses, dependencies you left out and why, and contradictions you noticed while reading (a step counted differently in two places, stale numbering, a section that says "not started" while every box is checked). These were among the most useful findings of the proof of concept. No check catches them; only reading does.

## 5. Check

Run `plan-atlas check plans/<name>.json`. Add other plan files it references if they exist locally (several files are merged; refs use `<namespace>:<id>`).

- Fix every ERROR that comes from your extraction (the format, a missing `source` or citation, a mistyped target) and run again. Exit code 1 means errors remain.
- If an ERROR reflects the plan text itself (for example a V6 hard cycle the plan states, or a V8/V9 target that another plan removed), do not change the plan data to silence it: ask the user, and put it in the report.
- Do not suppress a WARN (V5, V6, V9, V11, V12). A warning is a question for the user; it goes in the report.
- INFO notes (V7 inferred status, V8/V9 on a plan that is not loaded) are fine.

Messages are in English by default. You may pass `--lang zh-TW` if the user works in Chinese; the rule codes are in the plan-atlas README.

## 6. Status suggestions

Run `plan-atlas status --git . plans/<name>.json`. If the repository is on GitHub and `gh auth status` succeeds, also run `plan-atlas status --github <owner/repo> plans/<name>.json`.

Explain each label:
- `CHECK`: git or GitHub says work happened that the plan does not show: an open item cited where a commit says what it does, an open group whose branch merged ("N items still open"), an issue closed while the item is open, or a done item whose issue is still open.
- `MENTION`: the id only appears mid-sentence in a commit. Weakest signal; usually a reference to later work.
- `DONE?`: a release item is open but its git tag exists.
- `MISSING-TAG`: a release is done but its tag is not in the repository.
- `MISSING-LINK`: GitHub cannot find a link. The link is wrong, not GitHub.

Never change a status on a suggestion alone. Ask the user. When they confirm, change the plan document and the JSON together (status, `evidence` naming the commit or pull request). Fix a wrong link in the JSON.

## 7. Build the map

Run `plan-atlas build plans/<name>.json` (add `--out <dir>` to write elsewhere; default `atlas`). Tell the user to open `atlas/atlas.html` in a browser: the left outline shows the whole hierarchy, a click on a group opens it, `← Up one level` goes up one level, and a click on an item shows its dependencies, citations and evidence. `atlas/atlas.md` is the same map as Mermaid.

## 8. Report

In this order:
1. **Needs your decision**: each WARN and each CHECK / DONE? / MISSING-TAG / MISSING-LINK, in the user's language, with the plan text or commit behind it and what the user could change. Then the contradictions from the notes.
2. **What the map shows**: groups, items, done and open counts, the main dependency chains.
3. **Next**: answer the questions above; extract the next plan; keep the JSON updated in the same pull request as the plan document (AGENTS.md).

If `check` and `status` found nothing and the notes list no contradiction, say so plainly: the plan agrees with git and GitHub, which is a good result, not a failed run. Then suggest, for the next run, a plan from rank 1 or 2 of step 1 (merged or closed with boxes still open; a header or tag that disagrees with the boxes), with the command output that points to it.

Then OFFER, and do nothing without a yes: a branch and pull request "Configure plan-atlas" with `plans/<name>.json`, `plans/<name>.notes.md`, and `.github/workflows/plan-atlas.yml` below, with your report as the description. Do not commit `atlas/` unless the user wants CI to compare with it (`against: atlas/atlas.json`).

```yaml
name: plan-atlas
on:
  pull_request:
  push:
    branches: [main]
jobs:
  plans:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: plan-atlas/plan-atlas@v0.2.0
        with:
          plans: plans/*.json
          # fail-on: error   # block pull requests on an ERROR; the default, none, only reports
```

Adjust `main` to the default branch. The action runs `check`, `coupling` on pull requests and `status --git`, and writes the report to the job summary, with each ERROR and WARN as an annotation on its plan file; it needs a Linux runner. By default it only reports (`fail-on: none`). With `fail-on: error` it fails a pull request on an ERROR, for example from `coupling`, which reports a pull request that adds, removes or retypes a cross-group dependency without changing the plan document it cites. Status suggestions never fail it. Ask the user which they want. Other inputs (`against`, `status`, `fail-on`, `lang`): `<plan-atlas path>/docs/GETTING-STARTED.md`, section 7.
