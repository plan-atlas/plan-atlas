# Design: plans across several repositories

Status: accepted 2026-11-03, after a second-opinion review. Findings marked [R#] come from that review and were checked against the code.

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

- The action will pass `--head-ref` from `$GITHUB_HEAD_REF` for coordinated branches [R2, open-2].
- Action input `workspace`: a local path, or `owner/repo:path@ref` for the hub's canonical file [open-1]. In CI the workspace file is read from the **base branch or the hub**, never from the pull request's head, and `path` entries are rejected [R6]: a pull request must not be able to point the action at other files on the runner or at other repositories the token can read.
- Private repositories need a token with `contents: read` on the listed repositories (fine-grained PAT or GitHub App), input `token`. Least privilege: no write scopes.
- Fork pull requests get no secrets. Only for a fork pull request does the action pass `--allow-missing`, and unreadable entries are reported in the summary without counting toward `fail-on: warn` [R6]. For pull requests from the same repository an unreadable entry stays an ERROR, so an expired token is not silent.
- `coupling` stays per repository.

## Step 3: combined map and health issue

- A hub workflow on schedule, `workflow_dispatch` or `repository_dispatch` from each repository's main branch runs `build --workspace` and `status --workspace`, publishes `atlas.html` to GitHub Pages, and updates one "Plan health" issue in place. A workflow `concurrency` group serializes runs [R9].
- This is where two pull requests that each passed against the other's `main` but conflict after both merge become visible.

## Testing

- Unit: workspace parsing; namespace mismatch; one entry per file; replacement before fetch (no fetch for a covered namespace); `--head-ref` fallback; unreadable entry ERROR vs WARN; `#N` qualification; Windows paths normalized.
- The fixed bugs: claim target deleted in a loaded namespace → ERROR V9; namespace typo with a workspace → ERROR V8; single loaded file still resolves cross references; `ns:ns` resolves.
- GraphQL fetch behind an injected function, no network.
- `action/run.sh` with a simulated workspace: base-branch workspace, fork pull request, `path` entry rejected.
- End to end: a local three-repository demo (`sdk`, `api`, `web`) with `path` entries.
