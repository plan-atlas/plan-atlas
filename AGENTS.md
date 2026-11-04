# Working on plan data with plan-atlas

This file is for coding agents (and people) that edit plan files or this repository.

## Editing a plan file

- Extracting a plan for the first time? Follow [skills/onboard/SKILL.md](skills/onboard/SKILL.md).
- Only record what the plan documents say. If a status or dependency is your judgement, set `"inferred": true` on the item and explain in `evidence`.
- Every item needs `status` and `source` (file + section). Groups never get `status`; plan-atlas derives it. A `dependsOn` on a group is a dependency the plan states at group level and applies to its first items.
- A dependency that crosses groups or files needs `source` and a `quote` of at most 15 words from the plan text.
- Record only what this file's own plan documents say. If another plan says an item here must wait for something of theirs, do not copy that into this file: the other plan records it under `claims`, and plan-atlas reports when the two plans disagree (V9). Copying it in hides exactly the disagreement a person needs to see.
- Plan text often lags behind the code. When a status comes from git (a merged PR or a commit that cites the step id), say so in `evidence`, and update the plan document in the same change.
- Fill `links` only from what the plan or the repository states: a `closes #N` in a commit or pull request, an issue URL in the plan, or a convention the plan tool documents (Spec Kit: the `specs/<feature>` folder is the branch name, so the feature's group gets `branch:<feature>`). Never guess a number or a branch. Run `plan-atlas status --github` or `status --git` afterwards; a `MISSING-LINK` means the link is wrong, not that GitHub is.
- Use `order`, not `hard`, for a sequence the plan prefers but does not require. When unsure, use `order` and say so in the quote.
- When you add, remove or retype a cross-group dependency, change the plan document it cites in the same change. `plan-atlas coupling` fails otherwise. Do not edit the document only to satisfy the check; the document is the decision.
- Never edit `atlas.json`, `atlas.md`, `atlas.drawio` or `atlas.html` by hand. Run `plan-atlas build` again.
- Run `node src/cli.ts check <files>` before finishing. Fix every ERROR that comes from extraction (format, a missing source or citation, a mistyped target). If an ERROR reflects the plan text itself (a V6a hard cycle, a V8a1/V9a target another plan removed), ask the user; never change the plan to silence it. A WARN is a question for a person, not something to suppress.

## Working on this repository

- No runtime dependencies. Node 22.18+ runs the TypeScript directly; keep to erasable syntax (no enums, namespaces or parameter properties) and import with `.ts` extensions.
- `npm test` runs `node --test`. `npm run typecheck` needs `npm install` for TypeScript and `@types/node`.
- The rules are specified in `docs/RULES.md`: a general part (§G) and per-rule elements. Every §G concept is implemented once in `src/semantics.ts`; a rule may compute one differently only where RULES.md states an express departure ("Departs from §G…"), with a comment and a test. Derived facts live in `src/model.ts`. Renderers (`src/render/*`) and the viewer (`viewer/template.html`) only display them; the viewer computes no dependency itself.
- A new validation rule gets a code, a test in `test/faults.test.ts` or `test/parse.test.ts`, and a row in the README table in both README.md and README.zh-TW.md.
- `README.md` and `README.zh-TW.md` change together in the same change.
