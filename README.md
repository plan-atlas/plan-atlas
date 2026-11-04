# plan-atlas

Finds possible contradictions in plans that AI agents maintain, and maps them. It suggests; people decide.

Your agent writes the plan as data; plan-atlas checks it against itself, other plans, git and GitHub, and draws a map you can drill into.

English | [繁體中文](README.zh-TW.md)

Version 0.1.1. Messages and maps are in English by default. Pass `--lang zh-TW` on any command or set `PLAN_ATLAS_LANG=zh-TW` for Traditional Chinese. `--lang` overrides the environment variable.

## Demo

A two-minute walkthrough on a small demo repository: install, extract one plan, check it, compare it with git, open the map, add CI. The tool output and the agent's messages are replayed from a recorded session; the install commands come from this README. [Watch the video](https://github.com/plan-atlas/plan-atlas/releases/download/v0.1.1/plan-atlas-demo.mp4) (MP4, English subtitles burned in; [subtitles as SRT](https://github.com/plan-atlas/plan-atlas/releases/download/v0.1.1/plan-atlas-demo.en.srt)).

## Why

Coding agents change code faster than people review the plan behind it. Plan text falls behind git, two plans contradict each other, and a step depends on a release that does not exist. Nobody notices until something breaks.

On three real repositories plan-atlas found steps merged while the plan still listed them as open (one missed by a person checking by hand), a gate one plan set that the other repository had already passed, and four cross-repository references to nothing. On public Spec Kit repositories it found features whose pull request had merged while `tasks.md` still had open tasks.

## How it works

1. Your coding agent extracts one plan document into JSON, following [AGENTS.md](AGENTS.md). plan-atlas calls no LLM, and the map is a self-contained file. Only `status --github` and workspace `github` entries contact GitHub, through your `gh` login.
2. `check` validates it. `status --git` and `status --github` suggest statuses from commits, tags, issues, pull requests and branches; they never edit the plan.
3. `build` renders `atlas.html` (a single-file map with an outline), Mermaid and draw.io.
4. In CI, `check` and `coupling` keep the data and the plan documents in step on every pull request.

It fits solo developers and small teams running several repositories with coding agents, who keep plans in the repository with stable step ids or use Spec Kit. It does not fit plans that live in Jira or Linear.

## Quick start

**With your coding agent.** This repository is a plugin for Claude Code and for Codex. In Claude Code:

```
/plugin marketplace add plan-atlas/plan-atlas
/plugin install plan-atlas@plan-atlas
```

In Codex:

```sh
codex plugin marketplace add plan-atlas/plan-atlas
codex plugin add plan-atlas@plan-atlas
```

Then say "map my plans" in your repository. The agent picks one plan, extracts it, runs the checks, builds the map and reports what needs your decision. Both run the same [skills/onboard/SKILL.md](skills/onboard/SKILL.md). Details: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

**By hand.** Node.js 22.18 or later; no build step, no dependencies. Not on npm yet.

```sh
node src/cli.ts check examples/bookshop/plan.json examples/warehouse/plan.json
node src/cli.ts build examples/bookshop/plan.json examples/warehouse/plan.json --out atlas
node src/cli.ts status --git ../my-repo plans/plan.json
node src/cli.ts status --github owner/repo plans/plan.json
```

**In CI.** After `actions/checkout` with `fetch-depth: 0`:

```yaml
- uses: plan-atlas/plan-atlas@v0.1.1
  with:
    plans: plans/*.json
```

It runs `check`, `coupling` on pull requests and `status --git`, and writes the report to the job summary. Each ERROR and WARN also appears as an annotation on the plan file it concerns. By default the Action only reports (`fail-on: none`); set `fail-on: error` to block a pull request on an ERROR. A run that could not run at all (a bad glob, a file outside the workspace) always fails. The action also accepts `workspace` and `self`. Inputs and a full workflow: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md#7-keep-it-current).

## Several repositories

Keep one `plan-atlas.workspace.json` with a namespace and an explicit plan file for each repository, using `github: "owner/repo"` or `path: "../repo"` (relative to the workspace file). Run `check`, `build` or `status` with `--workspace plan-atlas.workspace.json`; positional plan files replace matching entries before fetching. `--self <ns>` and `--self-repo owner/repo` read those entries from the current directory. `--workspace` also accepts `github:<owner>/<repo>:<path>[@<ref>]`. `--head-ref feature/name` prefers that branch wherever it exists. GitHub reads print the selected ref and commit SHA. `health` writes that map plus `health.md` and `health-issue.md`; `examples/hub/plan-health.yml` is a hub workflow that keeps one issue updated from those reports. See the [workspace example and commands](docs/GETTING-STARTED.md#6-several-repositories).

## The plan file

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

- A node with children is a **group**, and its status is derived. A node without children is an **item** and needs `status` (`done` or `open`).
- `hard` dependencies block; `order` dependencies are a preferred sequence. A dependency that crosses groups or files needs a `source` and a short `quote`.
- A dependency on a group waits for its final items, the ones nothing else inside the group waits on; a dependency declared on a group applies to its first items, the ones that wait on nothing inside it. Only dependencies stated inside the group order its items, and a `hard` dependency on or by a group counts only the `hard` ones inside it. A claim from another plan agrees when every final item of its source reaches every first item of its target.
- `<namespace>:<id>` refers to another plan file. Pass several files to resolve it.
- `links` name the issue, pull request or branch behind a node: `#123`, `owner/repo#123`, `branch:<name>`.
- A release is an item with `"kind": "release"`, an id like `sdk@2.1.0` and a `"tag"`.

Full format: [schema/plan-atlas.schema.json](schema/plan-atlas.schema.json).

## What the checks catch

Findings are possible contradictions, for a person to look at. Levels:

- **ERROR**: the plan data itself is broken: its format, a missing source or citation, a target that does not exist, a dependency changed without its plan document (coupling), or a hand-edited `atlas.json`.
- **WARN**: a possible contradiction for a person to judge, such as two plans that disagree or a status that a dependency contradicts.
- **INFO**: a note. Status suggestions (`status`) are not findings and never fail anything.

| Rule | Catches |
|---|---|
| V0 | Malformed plans, workspaces, fields or links, duplicate ids/namespaces/files, namespace mismatches, input files or workspace entries that cannot be read, self entries that do not match the repository (WARN), unknown parents, areas or dependencies |
| V1 / V2 / V4 | A committed `atlas.json` that no longer matches the items |
| V3 | An item without a source, or citing a plan its group does not own |
| V5 | A page with more nodes than `rules.maxPageNodes` (the smallest any loaded file sets; default 15) |
| V6 | Dependency cycles (including a node that depends on a group containing it, or on a node inside it), and cycles that only appear between groups |
| V7 | A status that is judgement, not stated (note) |
| V8 | A cross-group or cross-file dependency without a citation, a missing item in a loaded plan, or an unknown workspace namespace unless listed in externalRefs |
| V9 | Two plans disagreeing about a dependency between them (WARN); a claim naming a missing node in a loaded plan (ERROR); a claim naming a plan that is not loaded (note) |
| V10 | `coupling`: a cross-group dependency changed without changing the plan document it cites |
| V11 | Something done while its hard prerequisite is open (one warning per waiting node), or a gate another plan claims that is already passed (one warning per claim) |
| V12 | A release marked done without a git tag |

Every rule, with its elements, consequence and which rule displaces which: [docs/RULES.md](docs/RULES.md).

How status suggestions are matched (`CHECK`, `MENTION`, `DONE?`, `MISSING-LINK`): [docs/STATUS.md](docs/STATUS.md).

## More

- [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md): the first run, the same steps by hand, several repositories, CI.
- [AGENTS.md](AGENTS.md): rules for agents that edit plan data or this repository.
- [docs/ROADMAP.md](docs/ROADMAP.md): what comes next. Not yet available: GitHub Issues adapter. npm only on demand.

## License

MIT
