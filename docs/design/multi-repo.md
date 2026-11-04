# Design: plans across several repositories

Status: accepted 2026-11-03 (Step 1 done); Steps 2–3 revised 2026-11-04 after a second review. Findings marked [R#] come from that review and were checked against the code.

## Problem

plan-atlas already checks several plan files together (`<namespace>:<id>` references; V8, V9, V11 across files). Missing: gathering other repositories' plan files, CI that sees other repositories, a namespace registry for agents, and a combined map that stays current.

## Fix first (existing bugs, independent of workspaces)

Done: reference resolution now also runs for a single file, preserving its node ids; V8/V9 distinguish missing nodes from unloaded namespaces, and namespace-root aliases resolve.

- [R3] A claim whose `to` or `from` is missing inside a **loaded** namespace is only an INFO ("plan not loaded"). Make it ERROR V9; keep INFO only when the namespace is not loaded.
- [R3] A reference to an unknown namespace (a typo like `skd:R1`) is INFO. Keep INFO without a workspace; with a workspace, it is ERROR V8 unless the id is listed in `externalRefs`.
- [R3] Resolve and report cross-file references even when only one plan file is loaded (today `load` skips the merge step).
- [R7] `ns:ns` must resolve to a root group whose id equals its namespace.

## Step 1: workspace file, `--workspace`, `status --workspace`

Done: workspace parsing, local replacement, batched GitHub loading, branch fallback, repository-specific status, localized messages, documentation and regression tests are implemented. The Action remains Step 2.

One canonical `plan-atlas.workspace.json`, kept in a hub repository (or one designated repository) [R open-1]:

```jsonc
{
  "version": 1,
  "plans": [
    { "namespace": "sdk", "github": "org/sdk", "file": "plans/sdk.json", "ref": "main" },
    { "namespace": "api", "github": "org/api", "file": "plans/api.json" },
    { "namespace": "web", "path": "../web",    "file": "plans/web.json" }
  ]
}
```

- **One entry per plan file**, with an explicit `file`, not globs [R1, R4]: two files may not share a namespace (V0 today), and globs over the GitHub tree API need a glob engine and break on truncated trees. A repository with two plan files has two entries.
- The workspace is the namespace authority: an entry's `namespace` must equal the `namespace` inside its file (ERROR otherwise).
- `path` entries resolve relative to the workspace file; all paths are normalized to `/` [R8].
- **Fetching** `github` entries: one batched GraphQL query through `gh api graphql`, `repository(owner, name) { object(expression: "<ref>:<file>") { ... on Blob { text } } }`, plus the commit SHA of `<ref>`, which the summary prints so a run is reproducible [R4]. Refs with slashes, tags and SHAs work in expressions. No clone, no tree walk.
- **Local files replace entries before fetching** [R5]: positional plan files are parsed first; any workspace namespace they cover is not fetched. In CI the current repository is also matched by `$GITHUB_REPOSITORY`, so a pull request that changes its own `namespace` is a mismatch ERROR rather than loading both versions.
- **Branches in lockstep** [R2, open-2]: `--head-ref <branch>` makes each `github` entry use a branch of that name when it exists in that repository, falling back to `ref`. Coordinated renames across repositories then pass when both pull requests use the same branch name.
- An entry that cannot be read is an ERROR; `--allow-missing` makes it a WARN for local use.
- `status --workspace` [open-3]: runs `status --git` for `path` entries and `status --github` for `github` entries, one report.
- Links: `#N` in a plan loaded from `github: owner/repo` is qualified to `owner/repo#N` in the merged model, so links stay correct and clickable in the combined map [R9].
- The onboarding skill reads the workspace, if any, for other repositories' namespaces.

## Step 2: CI across repositories

Decided 2026-11-04 (product owner, after a second-opinion review): the Action reports by default (`fail-on: none`) and annotates plan files. The repository's own entries are named exactly (`self`), never guessed. The workspace file is read from the checkout, like every other input. What a run can read is bounded by its token, not by where the workspace file comes from: on `pull_request` the workflow file itself comes from the pull request, so a base-only read would protect nothing, and it would stop a pull request that edits the workspace from checking its own edit.

### CLI

- **`--self <ns>`** (repeatable) and **`--self-repo <owner/repo>`** on `check`, `build` and `status` with `--workspace` (not `health`, which reads every entry from where the workspace says). `--self-repo` selects every entry whose `github` equals it, compared without case. Both may be given; the self set is their union.
  - A self entry is read from `<current directory>/<file>`, whatever its `github`, `path` or `ref`. It is an input file like a positional one: confinement applies (V0.3), and an unreadable self file is V0.35 ERROR even with `--allow-missing`, which is for entries read from elsewhere.
  - With a self option, positional plan files are exit 2 and §G10.2 matching is not used. A `--self` that names no entry, or a `--self-repo` that selects none, is exit 2.
  - **V0.36 (WARN)**: with `GITHUB_REPOSITORY` set, a self entry whose `github` is another repository, or an entry of this repository (compared without case) left out of the self set. A transferred repository keeps running, and the gap is visible. A WARN does not stop the run (§G8.5 stops only on ERROR). Self entries with `path` get no V0.36.
  - **`--self-files <file>`** writes the self files that were read, one path relative to the current directory per line. It is written only when the workspace was read and is valid (no V0.31–V0.33 ERROR); an empty file means no self file was read. The Action uses it for coupling and status.
- **Remote workspace:** `--workspace github:<owner>/<repo>:<path>[@<ref>]` fetches the workspace file through `gh api graphql`, behind the same injectable `run` as the entries. The ref is the text after the last `@` (the default branch without one). `<owner>/<repo>` must match the repository pattern, `<path>` must be relative with no `..` or glob, and the ref must not start with `-`; otherwise exit 2. The run prints the ref and commit SHA it read. A `path` entry in a remote workspace is V0.32 ERROR unless it is a self entry: a workspace with `path` entries is a local one. A remote workspace file that cannot be fetched is V0.35 (ERROR; WARN with `--allow-missing`, and then nothing is checked against the workspace).

### Action

- **Inputs** (action.yml):
  - `workspace`: a repository-relative path, or `github:<owner>/<repo>:<path>[@<ref>]` for a hub's canonical file. A repository-relative path must be a regular file inside the workspace, not a symlink (exit 2 otherwise, like `plans`).
  - `self`: namespaces this repository owns, separated by spaces. Each must match `^[A-Za-z0-9._-]+$` (exit 2). Empty (the default) passes `--self-repo "$GITHUB_REPOSITORY"`: exact matching against the hub, which is the authority, and no extra input for the common one-plan repository.
  - `plans` becomes optional. Without `workspace` it is required, as today. With `workspace`, coupling and status use the self files from `--self-files`. When `plans` is given as well, the run is exit 2 unless every self file is among its matches, and `plans` serves as the fallback below.
- **One check.** With `workspace` set, a single `check --workspace … --self …|--self-repo … --annotations … --self-files …` replaces the per-file check, so no file is parsed twice and no finding appears twice. Findings on self files are annotated on them. Findings of other entries are annotated on the workspace file when it is in this repository, and otherwise appear only in the summary, under the read refs the CLI prints. `coupling` and `status` stay per repository, over the self files.
- **Events:**
  - `pull_request_target` with `workspace` is exit 2: it runs with secrets on a pull request's files, so a fork could point the workspace at any repository the token can read and print its plans in the summary.
  - On `pull_request` the base branch is fetched before the check. `--head-ref "$GITHUB_HEAD_REF"` is passed [R2]. When the repository-relative workspace file is among the changed files, the summary says that the entries were read from the pull request's version.
  - On `push` to a branch other than the default (`PA_DEFAULT_BRANCH` from `github.event.repository.default_branch`), `--head-ref "$GITHUB_REF_NAME"` is passed, so the branch is compared like its pull request.
- **Runs without secrets:** action.yml sets `PA_NO_SECRETS` for pull requests from forks (`github.event.pull_request.head.repo.full_name != github.repository`, on `pull_request` only) and for Dependabot (`github.actor == 'dependabot[bot]'`). Only then does the Action pass `--allow-missing`: unreadable entries become WARN annotations. Elsewhere an unreadable entry stays an ERROR finding, so an expired token is visible; it blocks only with `fail-on: error`.
- **Fallback:** whenever no workspace was loaded (no `--self-files` written: the workspace could not be read, or is invalid) and `plans` is given, the Action also runs the per-file check of `plans`, so a pull request still gets its own findings. The workspace finding stays in the report; the fallback adds to it, it does not replace it.
- **Tokens:** input `token` (default `github.token`) is passed as `GH_TOKEN`. Private repositories need a token with `contents: read` on the listed repositories only (fine-grained PAT or GitHub App); no write scopes. The job summary shows findings, ids and titles from the listed repositories to everyone who can read this repository's Actions logs, which for a public repository is everyone.

## Step 3: combined map and health issue

- **`plan-atlas health --workspace <file> [--out <dir>] [--no-status]`**, a thin composition:
  - Writes what `build --workspace` writes, plus `health.md` and `health-issue.md`, into `--out` (default `atlas`).
  - `health.md` reports every ERROR and WARN finding and every status suggestion, grouped by repository in workspace order, ERROR before WARN before suggestions within each, with the namespace, ref and commit SHA of each entry. A finding about an entry itself (V0.32 `path` in a fetched workspace, V0.34, V0.35, V0.36) carries that entry's namespace, so it is reported under its repository, not as a general finding.
  - `health-issue.md` is the same report cut at whole lines to at most 60,000 characters (issue bodies are capped at 65,536), ending with "N more findings: see the run artifact". Its first line is the hidden marker `<!-- plan-atlas:health -->`, its second the run time.
  - Plan text (messages, refs, paths) appears only inside fenced code blocks, with a fence longer than any backtick run in it: an `@name` in a plan title then notifies nobody, and HTML or Markdown in it renders as text.
  - Status suggestions use `status --workspace`: one GraphQL query per `github` entry. For private members a fine-grained token then needs `issues: read` and `pull_requests: read` besides `contents: read`; without them every linked item would show as a false `MISSING-LINK`. `--no-status` skips the suggestions, and `contents: read` is then enough.
  - Exit 0 whenever the reports were written, including with ERROR findings; exit 2 when it could not run.
  - The Markdown comes from a pure `healthReport()` in `src/render/health.ts`, tested without a network.
- **Hub workflow**, shipped as `examples/hub/plan-health.yml` and documented in GETTING-STARTED:
  - Runs on `schedule` and `workflow_dispatch`, with `concurrency: plan-atlas-health` [R9]. Top-level `permissions: {}`; each job asks for its own, so the step that reads members never holds a write token:
    - job `health` (`contents: read`): runs `health` with the read secret, or the job's read-only `github.token` when no secret is set (public members), and uploads `atlas/` (map and reports) as a workflow artifact;
    - job `issue` (`issues: write`, needs `health`): downloads the artifact and updates the issue with its own `github.token`.
  - Updates one open issue titled "Plan health": it lists open issues with the label `plan-atlas` (`gh issue list --json number,body`) and takes the one whose body starts with the marker, since search may not index HTML comments and a marker quoted inside a finding must not count. It creates the issue (and the label) when none is open, and otherwise edits the body on every run, so the run-time line shows the last run; editing a body sends no notification.
  - **GitHub Pages is opt-in**, as a separate job behind `vars.PLAN_ATLAS_PAGES == 'true'` with `pages: write`, `id-token: write` and `environment: github-pages`. On Free, Pro and Team plans the Pages site of a private repository is public, and the combined map carries every member's titles, quotes and evidence; the example and GETTING-STARTED say so, and that Pages must be set to deploy from GitHub Actions. On a public hub the artifact and the issue expose the same text.
  - Member repositories triggering the hub after merges (`repository_dispatch`) is documented as optional: it needs a token with write access to the hub, stored in every member.
- Documented with the hub: a namespace or file rename takes three merges (the member's pull request reports V0.34 or V0.35, then the hub changes, then the next run is clean), which `fail-on: none` allows; do not "fix" that ERROR in the plan. Scheduled workflows in public repositories stop after 60 days without activity; the run-time line in the issue shows when the last run happened.
- This is where two pull requests that each passed against the other's `main` but conflict after both merge become visible.

## Testing

- Unit: workspace parsing; namespace mismatch; one entry per file; replacement before fetch (no fetch for a covered namespace); `--head-ref` fallback; unreadable entry ERROR vs WARN; `#N` qualification; Windows paths normalized.
- The fixed bugs: claim target deleted in a loaded namespace → ERROR V9; namespace typo with a workspace → ERROR V8; single loaded file still resolves cross references; `ns:ns` resolves.
- GraphQL fetch behind an injected function, no network.
- `--self`: self entries read from the current directory and never fetched; `--self-repo` without case; positional files with a self option, an unknown `--self` and an empty `--self-repo` are exit 2; an unreadable self file is ERROR even with `--allow-missing`; V0.36 both ways; `--self-files` contents, and absent when the workspace was not read; remote workspace parsing, fetch, bad forms (exit 2) and `path` entries (V0.32).
- `action/run.sh`, with a fake `gh` on `PATH` that returns canned JSON: one check per self file (no duplicate annotations); default `self` from `GITHUB_REPOSITORY`; a bad `self` value; `plans` that do not cover the self files; `pull_request_target` rejected; `PA_NO_SECRETS` passes `--allow-missing` and falls back to `plans`; the workspace-changed line.
- `health`: `healthReport()` grouping, order and truncation at whole lines; the marker; `--no-status`; exit 0 with ERROR findings; entry findings under their repository.
- End to end: a local three-repository demo (`sdk`, `api`, `web`) with `path` entries.
