# Status suggestions

`plan-atlas status` compares a plan with git or GitHub and prints suggestions. It never changes the plan: a commit that cites a step does not prove the step is finished, so a person (or their agent, after asking) decides.

```sh
node src/cli.ts status --git ../my-repo plans/plan.json      # --ref defaults to HEAD
node src/cli.ts status --github owner/repo plans/plan.json   # needs an authenticated gh
```

Both take `--json`. Messages are in English by default; pass `--lang zh-TW` or set `PLAN_ATLAS_LANG=zh-TW` for Traditional Chinese. The flag overrides the environment variable. Text output ends with `N suggestion(s)` in English or `N 個建議` in Traditional Chinese. Labels are printed strongest first:

| Label | Meaning |
|---|---|
| `DONE?` | A release item is open but its git tag exists. |
| `CHECK` | Git or GitHub shows work the plan does not (or the reverse). Review it. |
| `MISSING-TAG` | A release is done but its tag is not in the repository. |
| `MISSING-LINK` | GitHub cannot find a link. The link is wrong. |
| `MENTION` | The id appears only mid-sentence in commits. Weakest signal, usually a reference to later work. |

## From git

A commit cites an item:

- by its id as a whole token: the id is followed by a character other than a letter, digit or underscore, so `C3` matches `C3-projects` and `C3.1` but not `C3b`, when the id has at least two characters and is not all digits: shorter or numeric ids match unrelated text and are never matched;
- by a range such as `A4-A6`, `C4–C6` or `T054-T056` (every id in the range that exists in the plan; at most 100);
- through the item's `links`: `#N` anywhere in the message, and `branch:<name>` in a merge commit subject (`Merge pull request #N from <owner>/<name>` or `Merge branch '<name>'`).

A release is an item too. When its tag suggests `DONE?` or `MISSING-TAG`, that is its only suggestion; otherwise (no `tag`, an open release whose tag is missing, a done release whose tag exists) commits can still give it `CHECK` or `MENTION`.

A group takes part only through its links: an open group whose branch merged asks for a check and says how many items are still open. This works without GitHub.

Two rules keep the noise down, because commits also name steps they do not do:

- A commit that changes only the plan documents the plan cites is planning, and is skipped.
- An id counts as `CHECK` only where a commit says what it does: the subject, a merge's pull request title, or the start of a body line (`- A5: …`). Elsewhere it is a `MENTION`.

On the three proof-of-concept repositories these rules turned 17 suggestions into 4 checks and 13 mentions, and every known false positive became a mention.

## From GitHub

Resolves every node's `links` through `gh api graphql` (read-only, 50 links per query). `#N` resolves in the repository you name, `owner/repo#N` in its own.

| Suggestion | When |
|---|---|
| `CHECK` | An open item or group whose issue closed, whose pull request merged, or whose branch has a merged pull request. For a group it says how many items are still open: the "feature merged, tasks unchecked" case. |
| `CHECK` | An issue closed as not planned, while the plan has the item open or done. |
| `CHECK` | A done item or group whose issue is still open, whose pull request is open or closed without merging, or whose branch has no merged pull request. |
| `MISSING-LINK` | No such issue, pull request or repository, or a branch that neither exists nor had a pull request. |

Nothing is printed where the plan and GitHub agree.

Example: in rshade/finfocus, a Spec Kit repository, the group for `specs/124-budget-exit-codes/` with `"links": ["branch:124-budget-exit-codes", "#219"]` gets `CHECK`: pull request #496 from that branch merged on 2026-01-25 and closed issue #219, while `tasks.md` still had none of its 61 tasks checked.
