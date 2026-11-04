# Roadmap

State after 0.1 (2026-11-03) and what to do next, in order. Written as a handoff: a new session should be able to start from this file and `AGENTS.md`.

## Where things stand

- Core works end to end: parse → merge → model → validate → render (HTML map, Mermaid, draw.io, summary). Strict type check clean; `npm test` runs the suite.
- Since 0.1: release items (`kind: "release"`, `tag`, V12), `links`, `plan-atlas status --git` and `status --github` (suggestions only), the outline viewer, and the onboarding skill.
- Zero runtime dependencies on purpose. TypeScript runs through Node 22.18+ type stripping; tests use `node:test`; layout is the small layered algorithm in `src/layout.ts` (pages are capped near 15 nodes, so it is enough).
- Proof of concept on three real, partly private repositories (259 items, 29 pages). Its data is not part of this repository. Lessons below, in general terms.

## What the proof of concept taught

1. **Plans rarely record status; git does.** Two of three plan sets had no status column. All three repositories cite plan step ids in commit messages ("step C3", "(E4-T12)"), which made statuses checkable in minutes. Status must come from git, not from reading plan prose.
2. **Real plans depend on groups.** "C7 waits for C4–C6" and "E06 depends on E03, E04" are the norm. Supported since 0.1: a dependency *on* a group means its final items; a dependency declared *by* a group applies to its first items.
3. **Noise decides usefulness.** One epic-level statement expanded to item pairs produced 146 warnings; aggregating per declared dependency brought the same data to 16, all real. Every new rule must report once per statement in the plan, not once per expanded edge.
4. **Agents copy other plans' assertions.** An extraction agent recorded another repository's gate inside the gated repository's data, which hid the disagreement. `AGENTS.md` now forbids it; such statements belong in `claims`.
5. **Cross-repo ids do not line up.** Consumers referenced producer work by descriptive names ("runtime 2.1", "the one-pass mode") that are not items in the producer's plan (V8 errors). Releases need to be first-class.
6. **Big epics exceed the page limit.** Four epics had 23–34 tasks. The plans had no sub-grouping to split by.
7. **Git suggestions are cheap to review and catch misses.** Across the three repositories `status --git` made 12 suggestions: 3 were mentions of later steps, and one found a step finished in a commit that a person checking by hand had missed (the subject named a range of steps, the body listed the middle one). Ranges are expanded since; mentions mid-sentence are reported separately as MENTION.
8. **Consumers pin releases, and release docs go stale too.** A producer's release notes described which version its consumers pinned and in what order they would migrate; the consumers' lock files showed otherwise. Pins are facts in the consumer's repository, not in any plan.

## Done since 0.1

- **GitHub Action**: a composite action in this repository (`uses: plan-atlas/plan-atlas@v0.1.1`) running `check`, `coupling` against the base branch and `status --git` on pull requests, with the report in the job summary and each ERROR and WARN as an annotation on its plan file (works for pull requests from forks, whose token is read-only). Decided 2026-11-04: it reports by default (`fail-on: none`); a repository opts in to blocking with `fail-on: error` or `warn`. It runs the TypeScript sources directly, so it needs no npm package.
- **Multi-repo step 1: workspaces**: `--workspace`, local replacement, batched GitHub loading, branch fallback and repository-specific status are done. See [the multi-repo design](design/multi-repo.md).
- **English messages**: English by default throughout the CLI, validation, status evidence and maps. A single message table keeps Traditional Chinese available through `--lang zh-TW` or `PLAN_ATLAS_LANG=zh-TW`; the Action accepts `lang`.

- **Status from git**: `plan-atlas status --git <repo> <plan.json>`, with id ranges, `links` in merge commits, planning commits skipped and `MENTION` for ids mid-sentence. Still open: PR titles and bodies, ids with spaces ("Phase 30"), optionally a JSON patch.
- **Release items**: `kind: "release"` with `tag`; V12 for a done release without a tag. Still open: read consumer pins (lock files, version constants) so a stale "pins X" statement can be checked.
- **`links` and `status --github`** (decided 2026-11-03 instead of one importer per plan product: plan formats multiply, git and GitHub are what every repository shares).
- **Onboarding skill** as a Claude Code plugin, a getting-started guide, and a first-use simulation with two agents ([docs/research/2026-11-first-use-simulation.zh-TW.md](research/2026-11-first-use-simulation.zh-TW.md)).
- **Checked the riskiest assumption** ([docs/research/2026-11-h1-step-ids-in-commits.zh-TW.md](research/2026-11-h1-step-ids-in-commits.zh-TW.md)): only small agent-heavy repositories cite step ids in commits; Spec Kit repositories link plans to git per feature branch and leave `tasks.md` unchecked after merging. Hence `links`.

## Release stop criterion

Only these block a release: security problems, crashes, and false ERRORs of the structural rules on valid plans. WARN-level edge cases and the semantic edge cases below go to the backlog. Rules and their competition are specified in [RULES.md](RULES.md); the code follows it.

## Backlog

- **Explicit `self` namespace for workspace CI**: an Action and CLI input that names the current repository's entry, instead of inferring it from `GITHUB_REPOSITORY` and the lone positional plan.
- **Open minors**: an invalid `parent` (a number, say) is reported as V0.10 but the node is still stored as a root, so V0.13 `noRoot` does not fire beside it; the README's description of a group's "final items" does not mention loops, which §G5.2 makes one component.
- **Semantic edge cases**: rule interactions that only a person can judge today, found by review rather than by any shipped plan.

## Next, in priority order

The first outside user needs a real finding about their own repository within 30 minutes, before writing any configuration ([docs/research/2026-11-onboarding.zh-TW.md](research/2026-11-onboarding.zh-TW.md)).

1. **Multi-repo step 2: Action `workspace` input**: load the canonical workspace from the base branch or hub, pass `--head-ref`, reject `path` entries and handle fork permissions. See [Step 2](design/multi-repo.md#step-2-ci-across-repositories).
2. **Multi-repo step 3: hub**: publish a combined map and maintain one health issue. See [Step 3](design/multi-repo.md#step-3-combined-map-and-health-issue).
3. **GitHub Issues adapter** (`plan-atlas from-github owner/repo`), no AI: parent issues → groups, sub-issues → items, closed → done (`not_planned` → cancelled), blocked-by → hard dependencies with the issue URL as source. Read through `gh api graphql`, which works with any `gh` version. It cannot produce V9 (a link is stored once), so its value is the map and the stale-gate checks.
4. **`cancelled` status**: excluded from counts and from blocking; shown dimmed. Struck-through tasks had nowhere to go; the Issues adapter needs it too.
5. **Small status fixes from the simulation**: Spec Kit task ids repeat in every feature, so items under a group with `links` should only match that branch's commits; `status --github` lists a pull request twice when a branch link and `#N` name the same one.
6. **Sub-grouping hints for V5**: when a page is too big, suggest groups from the dependency structure (connected components or ranks), as text, never applied silently.
7. **Viewer**: keep it dependency-free until a feature needs more (pinch zoom, minimap). React Flow is the candidate then.
8. **Architecture maps**: a second input that reads the architecture graph JSON a repository already produces (contexts → layers → modules), rendered with the same viewer. One extractor per repository; plan-atlas only renders and checks.

**On demand, not planned: npm.** Decided 2026-11-03. The Claude Code plugin and the Action run the sources from a checkout, and git tags pin versions, so no current channel needs a package. Publishing needs a build step (`tsc` to `dist/`), because Node does not strip types inside `node_modules` (`npx github:…` installs there too), and a second way to run and test the same code. Do it when someone needs a one-line command outside Claude Code or wants to import plan-atlas as a library.

## Decisions taken

- Data and layout are separate: the map never edits dependencies; dragged positions are stored per viewer and can be exported as JSON.
- Every derived fact (group status, aggregated edges, stubs, overlaps) is computed; the committed `atlas.json` exists only so CI can catch hand edits.
- Structure checks cannot see semantic edits; `coupling` closes most of that gap by requiring the cited plan document to change together with any cross-group dependency. The rest needs a person, and the tests say so.
