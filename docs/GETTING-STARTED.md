# Getting started

This guide takes you from nothing to a checked map of one of your plans, first through your coding agent, then by hand. Runnable commands use the two example plans in `examples/`; replace them with your own files.

## 1. Prerequisites

- Node.js 22.18 or later (`node --version`). plan-atlas runs its TypeScript directly; older Node versions cannot.
- git.
- Optional: the GitHub CLI `gh`, logged in (`gh auth status`), for `status --github` and workspace `github` entries.
- A repository with at least one plan document in it: a markdown plan with a step table or a checklist, files under `.agents/plans/`, ADR-style step lists, or Spec Kit features (`specs/<feature>/tasks.md`). Stable step ids such as `R2`, `M1-S4` or `T001` help.
- For the agent route: Claude Code, or Codex.

The commands below are written for a POSIX shell. On Windows, Git Bash runs them as written; in PowerShell, `node`, `git` and `gh` lines work unchanged.

## 2. Get plan-atlas

plan-atlas is not on npm yet, so clone it:

```sh
git clone https://github.com/plan-atlas/plan-atlas.git
cd plan-atlas
node src/cli.ts --help
```

There is nothing to install: no runtime dependencies, no build step. `npm test` runs the test suite. Once the package is published, `npx plan-atlas <command>` will replace `node src/cli.ts <command>`.

## 3. Install the onboarding skill

The repository is also a Claude Code plugin with one skill, `onboard`. It extracts one plan, runs the checks, builds the map and reports.

**Claude Code**, from GitHub:

```text
/plugin marketplace add plan-atlas/plan-atlas
/plugin install plan-atlas@plan-atlas
```

or from your clone, which Claude Code then loads in place (a `git pull` in the clone updates it at the next session):

```text
/plugin marketplace add /path/to/plan-atlas
/plugin install plan-atlas@plan-atlas
```

To try it for one session without installing, start Claude Code with `claude --plugin-dir /path/to/plan-atlas`.

The skill finds the CLI inside the installed plugin, so you do not need to tell it where plan-atlas is. It runs as `/plan-atlas:onboard`, or when you say "map my plans" or "check my plan".

**Codex** (0.166 or later, which has plugin marketplaces): the repository is also a Codex plugin marketplace (`.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`), sharing the same skill:

```sh
codex plugin marketplace add plan-atlas/plan-atlas
codex plugin add plan-atlas@plan-atlas
```

Codex copies the repository into its plugin cache, and the skill finds the CLI two folders above its own `SKILL.md`. To remove it: `codex plugin remove plan-atlas@plan-atlas` and `codex plugin marketplace remove plan-atlas`.

Older Codex, or any agent that reads skill folders: copy the skill into the repository you want to map (or into your user skills folder):

```sh
mkdir -p .agents/skills
cp -r /path/to/plan-atlas/skills/onboard .agents/skills/plan-atlas-onboard
```

A skill copied on its own has no plan-atlas next to it, so it asks you for the path to your clone.

## 4. First run with your agent

Open your repository in the agent and say:

```text
map my plans
```

or name the plan: `check my plan docs/plans/checkout.md with plan-atlas`.

What happens, with rough timings from the proof of concept:

| Time | What you see |
|---|---|
| 1 to 2 minutes | The agent checks `node --version`, finds the CLI, and lists up to five candidate plan documents. You pick one. It extracts one plan, not the whole repository: a whole repository took 6 to 30 agent-minutes. |
| 5 to 10 minutes | It reads the plan and writes `plans/<name>.json` and `plans/<name>.notes.md` (what did not fit, ambiguities, contradictions it noticed). |
| under a minute | It runs `check`, fixes every ERROR in the JSON, then `status --git` and, on GitHub, `status --github`. |
| under a minute | It runs `build` and points you to `atlas/atlas.html`. |
| then | A report: first what needs your decision (warnings, `CHECK` suggestions), then what the map shows, then what to do next. |

The agent never changes a status because git or GitHub suggests it; it asks you, and when you confirm it changes the plan document and the JSON together. At the end it offers a branch and pull request "Configure plan-atlas" with the plan JSON, the notes, a CI workflow (section 7) and the report as the description. Nothing is committed without your yes.

Messages and maps are in English by default. Every command accepts `--lang zh-TW` for Traditional Chinese, or set `PLAN_ATLAS_LANG=zh-TW`. The flag overrides the environment variable. The rule codes (V0 to V12) are explained in the [README](../README.md#what-the-checks-catch).

In the map (`atlas/atlas.html`, one file, opens in any browser): the left outline is the whole hierarchy, a click on a group opens it, `← Up one level` goes up one level, and a click on an item shows its dependencies, the plan text they cite, and the evidence for its status.

## 5. The same steps by hand

Write the plan file yourself (or have any agent write it) following [AGENTS.md](../AGENTS.md), the [schema](../schema/plan-atlas.schema.json), and the extraction checklist in [skills/onboard/SKILL.md](../skills/onboard/SKILL.md). `examples/bookshop/plan.json` is a complete small example.

In your own repository, start the file with `"$schema": "https://raw.githubusercontent.com/plan-atlas/plan-atlas/main/schema/plan-atlas.schema.json"`, which is also the schema's `$id`. The examples use a relative path (`../../schema/plan-atlas.schema.json`) only because they live inside the plan-atlas repository.

From the plan-atlas clone:

**Check** one or several plan files. Exit code 1 means at least one ERROR.

```sh
node src/cli.ts check examples/bookshop/plan.json examples/warehouse/plan.json
```

```text
INFO  V7   bookshop:T2: status is inferred, not confirmed by the plan: the plan does not say; the generator already runs on main

0 error(s), 0 warning(s), 1 note(s)
```

V7 is a note: the status of T2 is inferred, not confirmed by plan text.

**Status from git.** Run it from your repository with your plan file. It reads commit messages and release tags and only suggests:

```sh
cd ../my-repo
node ../plan-atlas/src/cli.ts status --git . plans/checkout.json
```

A suggestion looks like this (a Spec Kit feature whose branch merged while four tasks are unchecked):

```text
CHECK  001-csv-export  open; 1 commit(s) cite it, latest 2026-11-03, but 4 items are still open "Merge branch '001-csv-export'"
```

`CHECK` means git shows work the plan does not; `MENTION` means an id appeared only mid-sentence; `DONE?` means a release tag exists for an open release; `MISSING-TAG` means a done release has no tag. `--ref <ref>` changes the starting point (default `HEAD`); `--json` prints JSON.

**Status from GitHub.** Resolves each node's `links` (`#N`, `owner/repo#N`, `branch:<name>`) through `gh`; read-only:

```sh
node ../plan-atlas/src/cli.ts status --github my-org/my-repo plans/checkout.json
```

It adds `MISSING-LINK` for a link GitHub cannot find. The example plans have no links, so on them both status commands print `0 suggestion(s)`.

**Build** the map. `--out` defaults to `atlas`:

```sh
node src/cli.ts build examples/bookshop/plan.json examples/warehouse/plan.json --out atlas
```

```text
wrote atlas/atlas.{json,md,drawio,html}: 6 page(s), 10 item(s)
```

Open `atlas/atlas.html`. `atlas.md` is the same map as Mermaid and renders on GitHub; `atlas.drawio` opens in draw.io.

## 6. Several repositories

Each repository keeps its own plan file with its own `namespace`. A node in another file is referenced as `<namespace>:<id>`. The examples show both directions:

- `warehouse` W2 depends on `bookshop:R2`, with the source and quote from the warehouse plan.
- `bookshop` records under `claims` that warehouse W2 must wait for R2, because the bookshop plan says so. A plan never copies another plan's assertion into its own `dependsOn`; plan-atlas compares the two and reports a disagreement (V9).

Checked alone, a reference into a plan that is not loaded is only a note:

```sh
node src/cli.ts check examples/bookshop/plan.json
```

```text
INFO  V7   T2: status is inferred, not confirmed by the plan: the plan does not say; the generator already runs on main
INFO  V9   R2 claims warehouse:W2 must wait for it, but a referenced plan is not loaded

0 error(s), 0 warning(s), 2 note(s)
```

Loaded together, the reference resolves, and a missing id or a disagreement becomes an ERROR or WARN. With the repositories cloned side by side, check and build them together:

```sh
node plan-atlas/src/cli.ts build repo-a/plans/a.json repo-b/plans/b.json --out atlas
```

A dependency on another repository's release ("needs sdk 2.1.0") points at a release item in the producer's plan: `"kind": "release"`, id `<package>@<version>` such as `sdk@2.1.0`, `"tag": "v2.1.0"`. `status --git` in the producer's repository then confirms the tag.

For a reusable set of repositories, keep a canonical `plan-atlas.workspace.json` in a hub repository:

```json
{
  "version": 1,
  "plans": [
    { "namespace": "sdk", "github": "org/sdk", "file": "plans/sdk.json", "ref": "main" },
    { "namespace": "api", "github": "org/api", "file": "plans/api.json" },
    { "namespace": "web", "path": "../web", "file": "plans/web.json" }
  ]
}
```

Each entry names exactly one file (no globs), one namespace, and exactly one of `github` or `path`. The namespace must match the file's explicit `namespace`. A repository can have several entries for distinct files and namespaces. `path` directories resolve relative to the workspace file, with paths normalized to `/`; `../repo` is fine, but an absolute or UNC path is V0. The optional `ref` selects a GitHub branch, tag or SHA; without it the default branch is used. On a `path` entry, `ref` selects the git history for status suggestions; the plan is read from disk.

```sh
node plan-atlas/src/cli.ts check --workspace hub/plan-atlas.workspace.json
node plan-atlas/src/cli.ts build --workspace hub/plan-atlas.workspace.json --out atlas
node plan-atlas/src/cli.ts status --workspace hub/plan-atlas.workspace.json
node plan-atlas/src/cli.ts status --workspace hub/plan-atlas.workspace.json --json
```

GitHub plan files are fetched in one batched `gh api graphql` query. Each read prints the selected ref and commit SHA, so you can reproduce it with `ref` set to that SHA. `#N` links from a GitHub entry become `owner/repo#N` in the combined map. Status checks each `path` entry against its own git repository and each `github` entry against GitHub, with namespace-qualified ids in one report. With `status --json`, findings and read refs go to stderr and the suggestions array goes to stdout.

Pass a local plan to replace the workspace entry with the same namespace before fetching it:

```sh
node plan-atlas/src/cli.ts check --workspace hub/plan-atlas.workspace.json sdk/plans/sdk.json
node plan-atlas/src/cli.ts check --workspace hub/plan-atlas.workspace.json --head-ref feature/shared-rename
```

`--head-ref <branch>` prefers that branch in every GitHub repository where it exists, falling back to the entry's `ref` or the default branch. An existing branch that lacks the plan file is unreadable; it does not fall back. This supports coordinated changes on branches with the same name. In CI, `GITHUB_REPOSITORY` and the positional file's path relative to `GITHUB_WORKSPACE` also identify the current entry, so a namespace rename reports a mismatch instead of loading the old remote version alongside it. A single entry for the current repository also matches a single copied positional file, unless that file's namespace belongs to another entry.

Unreadable entries are ERROR by default. `--allow-missing` reports them as WARN for local use; invalid JSON, invalid plan shapes and namespace mismatches remain ERROR. When `PLAN_ATLAS_CONFINE` is set (the GitHub Action sets it to the workspace), `path` entries must be regular files below that directory, like positional files; an entry outside it is ERROR even with `--allow-missing`. A dependency or claim naming a namespace absent from the workspace is ERROR V8 unless that exact id appears in the referring plan's `externalRefs`. Without a workspace, unloaded namespaces remain INFO. A claim whose `from` or `to` is missing in a loaded namespace is ERROR V9; disagreements between existing nodes remain WARN V9.

`--self <ns>` (repeatable) and `--self-repo <owner/repo>` name the entries of the repository you are in. The self set is their union. `--self-repo` selects every entry whose `github` equals it, compared without case. Each self entry is read from its `file` in the current directory, whatever its `github`, `path` or `ref`, and is never fetched. Positional plan files cannot be combined with either flag. An unreadable self file stays ERROR with `--allow-missing`. `--self-files <file>` writes the self files that were read, one path relative to the current directory per line, and only when the workspace was read and is valid.

`--workspace` also accepts `github:<owner>/<repo>:<path>[@<ref>]`. That form fetches the workspace file through `gh`. The ref is the text after the last `@`; without one, the default branch is used. The command prints the ref and commit SHA. A `path` entry in a workspace read from GitHub is an error unless it is a self entry.

When `GITHUB_REPOSITORY` is set, a self entry whose `github` is another repository, or an entry of this repository left out of the self set, is WARN (V0.36). The run continues.

The GitHub Action takes the same workspace. See [§7](#7-keep-it-current).

## 7. Keep it current

The first extraction is only the start. The plan JSON stays useful when it changes in the same pull request as the plan document and the code:

- An agent that edits a plan document updates the JSON in the same change, following [AGENTS.md](../AGENTS.md).
- A status that comes from git names the commit or pull request in `evidence`, and the plan document is updated too.
- A cross-group dependency is only added, removed or retyped together with the plan document it cites. `coupling` enforces this.

Try `coupling` on the example: retype the cross-group dependency "C3 depends on T1" (T1 → C3) from `hard` to `order` without touching the plan document it cites.

```sh
sed 's/{ "id": "T1", "type": "hard"/{ "id": "T1", "type": "order"/' examples/bookshop/plan.json > after.json
echo examples/bookshop/plan.json | node src/cli.ts coupling --before examples/bookshop/plan.json --after after.json --changed -
```

```text
ERROR V10  Dependency type changed from hard to order: T1 → C3, but its cited plan docs/plans/checkout-v2.md was not changed; update the plan or ask someone to confirm

1 error(s), 0 warning(s), 0 note(s)
```

Add `docs/plans/checkout-v2.md` to the changed list and it passes. `--changed` takes a file with one repository-relative path per line, or `-` for stdin.

**CI.** Save as `.github/workflows/plan-atlas.yml` in your repository. It runs `check` on every push and pull request, `coupling` for each plan file on pull requests, and `status --git` for suggestions. Change `main` to your default branch.

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
```

`fetch-depth: 0` gives `coupling` the base branch and `status --git` the history. The action runs the plan-atlas sources at the tag you name, sets up Node 22 when the runner's `node` cannot run them, and writes one report to the job summary: the counts, then the output of `check`, `coupling` and `status`. Each ERROR and WARN from `check` and `coupling` is also an annotation on the plan file it concerns (`::error` or `::warning`, titled with the rule code); annotations never fail the job by themselves. It needs no write permission and posts no comments, so it also works on pull requests from forks. It runs on Linux runners such as `ubuntu-latest`; Windows runners are not supported.

| Input | Default | Meaning |
|---|---|---|
| `plans` | required without `workspace` | Plan files, as globs separated by spaces or newlines (`plans: \|`). A glob that matches no file fails the step. With `workspace`, this is optional. When it is set, every self file must be among the matches. When no workspace was loaded (unreadable or invalid), the plans files are checked on their own, in addition to the workspace finding. |
| `workspace` | empty | A workspace file in this repository, or `github:<owner>/<repo>:<path>[@<ref>]` for a hub's canonical file. One `check --workspace` replaces the per-file check. |
| `self` | empty | Namespaces this repository owns, separated by spaces. Empty selects every entry whose `github` equals this repository. |
| `against` | empty | A committed `atlas.json` for `check --against`. |
| `coupling` | `true` | On pull requests, run `coupling` for each plan file that exists on the base branch. A plan file new in the pull request has no earlier version and is skipped. |
| `status` | `git` | `git` runs `status --git .`, `github` runs `status --github` for this repository, `none` skips. Suggestions never fail the job. |
| `token` | `github.token` | Used to fetch a `github:` workspace and `github` entries, and for `status: github`. Only read-only queries are made. If the workflow sets `permissions`, give it `issues: read` and `pull-requests: read`. |
| `lang` | `en` | Output language: `en` or `zh-TW`, passed as `PLAN_ATLAS_LANG`. |
| `fail-on` | `none` | `none` only reports. `error` fails the step on an ERROR from `check` or `coupling`; `warn` also on a WARN. A run that could not run at all (a bad glob, a file outside the workspace, exit code 2) counts as one error and fails the step whatever `fail-on` says. |

**A member repository.** Point `workspace` at the hub. Leave `self` empty when this repository's `github` in the hub file is the repository itself; set `self` when it owns a namespace under some other `github`. `plans` stays optional. When it is set and no workspace was loaded (unreadable or invalid), the plans files are checked on their own, in addition to the workspace finding.

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
      # workspace and self need v0.2.0 or later
      - uses: plan-atlas/plan-atlas@v0.2.0
        with:
          workspace: github:org/hub:plan-atlas.workspace.json
          plans: plans/*.json
          # A fine-grained token with contents: read on the listed repositories is needed when any of them is private.
          # Without the secret (forks, Dependabot) github.token still reads public repositories.
          token: ${{ secrets.PLAN_ATLAS_TOKEN || github.token }}
```

The `token` input (default `github.token`) needs `contents: read` on the listed repositories only. The job summary shows findings from those repositories to whoever can read this repository's Actions logs.

A pull request from a fork, and a run by Dependabot, have no token that can read the other repositories. The action then passes `--allow-missing`, so an unreadable entry is a warning. `pull_request_target` is rejected when `workspace` is set: that event runs with this repository's secrets on a pull request's files, so a fork could point the workspace at any repository the token can read.

On a pull request, when the workspace file in this repository is one of the changed files, the summary says the entries were read from that version.

To also catch hand edits of the generated map, commit `atlas/atlas.json` from `build` and add `against: atlas/atlas.json`.

**CI without the action.** The same checks with a clone of plan-atlas, for runners the action does not support or to run other commands:

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
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - name: Get plan-atlas (not on npm yet)
        run: git clone --depth 1 https://github.com/plan-atlas/plan-atlas.git "$RUNNER_TEMP/plan-atlas"
      - name: check
        run: node "$RUNNER_TEMP/plan-atlas/src/cli.ts" check plans/*.json
      - name: coupling
        if: github.event_name == 'pull_request'
        env:
          BASE: origin/${{ github.base_ref }}
        run: |
          git diff --name-only "$BASE"...HEAD > "$RUNNER_TEMP/changed.txt"
          for f in plans/*.json; do
            if git cat-file -e "$BASE:$f" 2>/dev/null; then
              git show "$BASE:$f" > "$RUNNER_TEMP/before.json"
              node "$RUNNER_TEMP/plan-atlas/src/cli.ts" coupling --before "$RUNNER_TEMP/before.json" --after "$f" --changed "$RUNNER_TEMP/changed.txt"
            fi
          done
```

To pin plan-atlas here, replace the clone with a fetch of a specific commit. Add `--against atlas/atlas.json` to the check step to compare with a committed map. This version leaves out `status --git`: its suggestions are for a person to review, not a pass or fail.

**A hub: combined map and health issue.** Copy [examples/hub/plan-health.yml](../examples/hub/plan-health.yml) to `.github/workflows/` in the hub repository, and keep `plan-atlas.workspace.json` at the hub root. The workflow pins plan-atlas at `v0.2.0`. It runs once a day and on demand.

Create a fine-grained secret `PLAN_ATLAS_TOKEN` with `contents: read`, `issues: read` and `pull_requests: read` on the member repositories. `issues: read` and `pull_requests: read` are for status suggestions. With `--no-status`, `contents: read` is enough. The secret reads private members. Public members need no extra token.

The workflow has two jobs. `health` has `contents: read`: it checks out the hub and plan-atlas, runs the health command, and uploads `atlas/` as an artifact named `plan-atlas`. `issue` needs that job and has `issues: write`. It creates or edits one open issue titled "Plan health" with the label `plan-atlas`. Editing the body sends no notification. The hidden first line `<!-- plan-atlas:health -->` is how the next run finds that issue.

`plan-atlas health --workspace plan-atlas.workspace.json --out atlas` writes the combined map (`atlas.json`, `atlas.md`, `atlas.drawio`, `atlas.html`) when the plans load, and always writes `health.md` and `health-issue.md`. The issue file is the same report, cut to fit a GitHub issue. The run exits 0 when both reports were written, even when a finding is an ERROR. `--no-status` skips the status suggestions.

GitHub Pages is off unless the repository variable `PLAN_ATLAS_PAGES` is `true`. Pages must be set to deploy from GitHub Actions (Settings → Pages → Source). On Free, Pro and Team plans the Pages site of a private repository is public, and the map holds every member's titles, quotes and evidence. On a public hub the artifact and the issue expose the same member text as a Pages site would. Leave the variable unset unless a public map is acceptable.

A member repository can trigger the hub after it merges (`repository_dispatch`, type `plan-atlas`). That block is commented out in the example. Turning it on needs a token with write access to the hub, stored in every member, and each dispatch spends Actions minutes on the hub.

A namespace or file rename takes three merges. The member's pull request is checked against the hub's current workspace, so it reports V0.34 (the file's namespace no longer matches) or V0.35 (the old file cannot be read). `fail-on: none` lets that pull request merge. The hub's workspace is updated next. The run after that is clean. Do not change the plan to silence that ERROR.

Scheduled workflows in a public repository stop after 60 days without activity. The `Last run:` line in the issue shows when the last run happened.
