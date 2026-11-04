#!/usr/bin/env bash
# Runs plan-atlas for action.yml: check, coupling on pull requests, and status suggestions.
# Writes one report to the job summary and one annotation per ERROR and WARN on its plan file.
# fail-on: none (default) only reports; error exits 1 on an ERROR from check or coupling; warn
# also on a WARN. A command that could not run always fails the step. Status suggestions never
# fail. Inputs arrive as PA_* variables. With PA_WORKSPACE, one workspace check replaces the
# per-file check; coupling and status then use the self files.
set -euo pipefail

cli="$GITHUB_ACTION_PATH/src/cli.ts"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
workspace="$(realpath -- "${GITHUB_WORKSPACE:-$PWD}")"
export PLAN_ATLAS_CONFINE="$workspace"
# Coupling snapshots are CLI inputs too, so keep them inside the confinement root.
tmp="$(mktemp -d "$workspace/.plan-atlas.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
body="$tmp/body.md"
: > "$body"
export NODE_NO_WARNINGS=1

die() {
  local message="${1//$'\r'/}"
  message="${message//$'\n'/}"
  echo "::error::plan-atlas: $message"
  printf '## plan-atlas could not run\n\n%s\n' "$message" >> "$summary"
  exit 2
}

case "$PA_FAIL_ON" in error | warn | none) ;; *) die "fail-on must be error, warn or none, not '$PA_FAIL_ON'" ;; esac
case "$PA_STATUS" in git | github | none) ;; *) die "status must be git, github or none, not '$PA_STATUS'" ;; esac
case "$PA_COUPLING" in true | false) ;; *) die "coupling must be true or false, not '$PA_COUPLING'" ;; esac
if [[ -n "${PA_SELF:-}" && -z "${PA_WORKSPACE:-}" ]]; then
  die "self needs workspace"
fi

# Expand the globs, separated by spaces or newlines (`plans: |`). A pattern that matches nothing
# is a mistake in the workflow.
shopt -s nullglob globstar
files=()
selves=()
declare -A seen=()
expand_plans() {
  local -a patterns=()
  local pattern matched f resolved
  # -d '' reads past newlines; read then reports the end of input, which is expected here
  read -r -d '' -a patterns <<< "$PA_PLANS" || true
  for pattern in "${patterns[@]}"; do
    matched=($pattern) # unquoted on purpose: this expands the glob
    [[ ${#matched[@]} -gt 0 ]] || die "plans: '$pattern' matches no file"
    for f in "${matched[@]}"; do
      [[ -f "$f" && ! -L "$f" ]] || die "plans: '$pattern' must match regular files, not symlinks"
      resolved="$(realpath -- "$f" 2>/dev/null)" || die "plans: '$pattern' could not resolve a file"
      case "$resolved" in
        "${workspace%/}/"*) ;;
        *) die "plans: '$pattern' matches a file outside the workspace" ;;
      esac
      [[ -n "${seen[$f]:-}" ]] || files+=("$f")
      seen[$f]=1
    done
  done
}

if [[ -n "${PA_WORKSPACE:-}" ]]; then
  # Secrets plus a pull request's workflow can point the workspace at any repo the token reads.
  if [[ "${GITHUB_EVENT_NAME:-}" == pull_request_target ]]; then
    die "pull_request_target is rejected with a workspace: it runs with this repository's secrets on a pull request's files, so a fork could point the workspace at any repository the token can read"
  fi
  # Namespaces, not globs: read once, as expand_plans reads patterns, and do not expand them.
  read -r -d '' -a selves <<< "${PA_SELF:-}" || true
  if [[ -n "${PA_SELF:-}" && ${#selves[@]} -eq 0 ]]; then
    die "self is empty"
  fi
  for ns in "${selves[@]}"; do
    [[ "$ns" =~ ^[A-Za-z0-9._-]+$ ]] || die "self: '$ns' must contain only letters, digits, dots, underscores and hyphens"
  done
  if [[ "$PA_WORKSPACE" != github:* ]]; then
    [[ -f "$PA_WORKSPACE" && ! -L "$PA_WORKSPACE" ]] || die "workspace: '$PA_WORKSPACE' must be a regular file, not a symlink"
    resolved="$(realpath -- "$PA_WORKSPACE" 2>/dev/null)" || die "workspace: '$PA_WORKSPACE' could not resolve a file"
    case "$resolved" in
      "${workspace%/}/"*) ;;
      *) die "workspace: '$PA_WORKSPACE' matches a file outside the workspace" ;;
    esac
  fi
  if [[ -n "${PA_PLANS:-}" ]]; then
    expand_plans
  fi
else
  expand_plans
  [[ ${#files[@]} -gt 0 ]] || die "the plans input is empty"
fi

# escape <value>: GitHub's escaping for a value in a workflow command line.
escape() {
  local s="${1//%/%25}"
  s="${s//$'\r'/%0D}"
  printf '%s' "${s//$'\n'/%0A}"
}

# run <args>: runs the CLI and leaves its output in $out and its exit code in $code.
run() {
  set +e
  out="$(node "$cli" "$@" 2>&1)"
  code=$?
  set -e
  # file names and inputs may hold CR or LF, which would start a workflow command of their own
  echo "::group::$(escape "plan-atlas $*")"
  # plan titles may come from a fork's pull request: never let them act as workflow commands
  local stop="plan-atlas-$RANDOM$RANDOM$RANDOM"
  echo "::stop-commands::$stop"
  printf '%s\n' "$out"
  echo "::$stop::"
  echo "::endgroup::"
}

# annotations: prints the annotations the last check or coupling wrote. The CLI escapes their
# properties and messages, so they stay outside the stop-commands region on purpose.
annotations="$tmp/annotations.txt"
annotations() {
  if [[ -f "$annotations" ]]; then
    cat "$annotations"
    rm -f "$annotations"
  fi
}

# The CLI's last line is "N error(s), N warning(s), N note(s)" or a suggestion count; in
# Traditional Chinese "N 個錯誤、N 個警告、N 個提醒" or "N 個建議". Both are matched instead of
# forcing --lang en, so PLAN_ATLAS_LANG still sets the language of the job summary.
count() {
  local last
  last="$(printf '%s\n' "$1" | tail -n 1)"
  if [[ $last =~ ([0-9]+)\ $2 ]]; then echo "${BASH_REMATCH[1]}"; else echo 0; fi
}

fenced() {
  printf '```text\n%s\n```\n\n' "${1#$'\n'}" >> "$body"
}

errors=0 warnings=0 notes=0 suggestions=0 broken=0

# report: adds the counts of the last check or coupling run and writes its output.
report() {
  errors=$((errors + $(count "$out" '(error|個錯誤)')))
  warnings=$((warnings + $(count "$out" '(warning|個警告)')))
  notes=$((notes + $(count "$out" '(note|個提醒)')))
  # exit code 1 is an ERROR, which fails the step only by fail-on; 2 means the command could not
  # run (bad argument, a failure of git) and printed no counts: one error, and the step fails
  if [[ $code -gt 1 ]]; then
    broken=1
    errors=$((errors + 1))
    printf 'Could not run (exit code %s):\n\n' "$code" >> "$body"
  fi
  fenced "$out"
}

# On a pull request, know the changed files before the workspace check. Coupling reuses the list.
base_fetched=0
if [[ -n "${PA_WORKSPACE:-}" && "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
  base="origin/$GITHUB_BASE_REF"
  if ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
    git fetch --no-tags --quiet origin "+refs/heads/$GITHUB_BASE_REF:refs/remotes/$base" || true
  fi
  if git merge-base "$base" HEAD > /dev/null 2>&1; then
    git diff --name-only "$base...HEAD" > "$tmp/changed.txt"
  else
    : > "$tmp/changed.txt"
  fi
  base_fetched=1
fi

# check
if [[ -n "${PA_WORKSPACE:-}" ]]; then
  args=(check --workspace "$PA_WORKSPACE")
  if [[ -n "${PA_SELF:-}" ]]; then
    for ns in "${selves[@]}"; do
      args+=(--self "$ns")
    done
  else
    args+=(--self-repo "${GITHUB_REPOSITORY:-}")
  fi
  if [[ "${GITHUB_EVENT_NAME:-}" == pull_request && -n "${GITHUB_HEAD_REF:-}" ]]; then
    args+=(--head-ref "$GITHUB_HEAD_REF")
  elif [[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/* && -n "${GITHUB_REF_NAME:-}" && "${GITHUB_REF_NAME}" != "${PA_DEFAULT_BRANCH:-}" ]]; then
    args+=(--head-ref "$GITHUB_REF_NAME")
  fi
  # Fork pull requests and Dependabot have no token that can read the other repositories.
  if [[ "${PA_NO_SECRETS:-}" == true ]]; then
    args+=(--allow-missing)
  fi
  if [[ -n "$PA_AGAINST" ]]; then args+=(--against "$PA_AGAINST"); fi
  printf '### check\n\n' >> "$body"
  run "${args[@]}" --annotations "$annotations" --self-files "$tmp/self.txt"
  annotations
  report
  if [[ -f "$tmp/self.txt" ]]; then
    self_files=()
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -n "$line" ]] && self_files+=("$line")
    done < "$tmp/self.txt"
    if [[ -n "${PA_PLANS:-}" && ${#self_files[@]} -gt 0 ]]; then
      for s in "${self_files[@]}"; do
        s_real="$(realpath -- "$s" 2>/dev/null)" || die "self file '$s' could not be resolved"
        covered=0
        for f in "${files[@]}"; do
          f_real="$(realpath -- "$f" 2>/dev/null)" || die "plans: '$f' could not resolve a file"
          if [[ "$s_real" == "$f_real" ]]; then covered=1; break; fi
        done
        [[ $covered -eq 1 ]] || die "self file '$s' is not among the plans matches"
      done
    fi
    files=()
    if [[ ${#self_files[@]} -gt 0 ]]; then
      files=("${self_files[@]}")
    fi
  elif [[ $code -eq 0 || $code -eq 1 ]]; then
    # No workspace was loaded (unreadable or invalid). plans, when given, is checked on its own.
    if [[ -n "${PA_PLANS:-}" ]]; then
      args=(check)
      if [[ ${#files[@]} -gt 0 ]]; then args+=("${files[@]}"); fi
      if [[ -n "$PA_AGAINST" ]]; then args+=(--against "$PA_AGAINST"); fi
      printf '### check\n\nNo workspace was loaded (see the findings above); the plans files are checked on their own.\n\n' >> "$body"
      run "${args[@]}" --annotations "$annotations"
      annotations
      report
    else
      printf 'No plan file of this repository was read.\n\n' >> "$body"
    fi
  fi
  if [[ "${GITHUB_EVENT_NAME:-}" == pull_request && "$PA_WORKSPACE" != github:* && -f "$tmp/self.txt" && -f "$tmp/changed.txt" ]]; then
    ws_rel="$(realpath --relative-to="$workspace" -- "$PA_WORKSPACE")"
    if grep -Fxq -- "$ws_rel" "$tmp/changed.txt"; then
      printf 'The workspace file changed in this pull request; entries were read from this version.\n\n' >> "$body"
    fi
  fi
else
  args=(check "${files[@]}")
  if [[ -n "$PA_AGAINST" ]]; then args+=(--against "$PA_AGAINST"); fi
  printf '### check\n\n' >> "$body"
  run "${args[@]}" --annotations "$annotations"
  annotations
  report
fi

# coupling: compare each plan file with its version on the base branch
if [[ ${#files[@]} -gt 0 && "$PA_COUPLING" == true && "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
  base="origin/$GITHUB_BASE_REF"
  printf '### coupling against `%s`\n\n' "$base" >> "$body"
  if [[ $base_fetched -eq 0 ]]; then
    if ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
      git fetch --no-tags --quiet origin "+refs/heads/$GITHUB_BASE_REF:refs/remotes/$base" || true
    fi
  fi
  if ! git merge-base "$base" HEAD > /dev/null 2>&1; then
    errors=$((errors + 1))
    broken=1
    printf 'Could not find where this branch left `%s`. Set `fetch-depth: 0` on actions/checkout.\n\n' "$base" >> "$body"
  else
    if [[ $base_fetched -eq 0 ]]; then
      git diff --name-only "$base...HEAD" > "$tmp/changed.txt"
    fi
    new=()
    for f in "${files[@]}"; do
      if ! git cat-file -e "$base:$f" 2> /dev/null; then
        new+=("$f")
        continue
      fi
      git show "$base:$f" > "$tmp/before.json"
      printf '`%s`\n\n' "$f" >> "$body"
      run coupling --before "$tmp/before.json" --after "$f" --changed "$tmp/changed.txt" --annotations "$annotations"
      annotations
      report
    done
    if [[ ${#new[@]} -gt 0 ]]; then
      printf 'New in this pull request, not compared: %s\n\n' "$(printf '`%s` ' "${new[@]}")" >> "$body"
    fi
  fi
fi

# status: suggestions for a person to review; never fails the job
if [[ ${#files[@]} -gt 0 && "$PA_STATUS" != none ]]; then
  printf '### status --%s\n\nSuggestions only; they never fail the job. Labels: [docs/STATUS.md](https://github.com/plan-atlas/plan-atlas/blob/main/docs/STATUS.md).\n\n' "$PA_STATUS" >> "$body"
  for f in "${files[@]}"; do
    if [[ "$PA_STATUS" == git ]]; then
      run status --git . "$f"
    else
      run status --github "$GITHUB_REPOSITORY" "$f"
    fi
    printf '`%s`\n\n' "$f" >> "$body"
    if [[ $code -ne 0 ]]; then
      printf 'Could not run (exit code %s):\n\n' "$code" >> "$body"
    else
      suggestions=$((suggestions + $(count "$out" '(suggestion\(s\)|個建議)')))
    fi
    fenced "$out"
  done
fi

failed=$broken
if [[ "$PA_FAIL_ON" != none && $errors -gt 0 ]]; then failed=1; fi
if [[ "$PA_FAIL_ON" == warn && $warnings -gt 0 ]]; then failed=1; fi
result=passed
if [[ $errors -gt 0 || $warnings -gt 0 ]]; then result=reported; fi
if [[ $failed -eq 1 ]]; then result=failed; fi

plan_list=''
if [[ ${#files[@]} -gt 0 ]]; then
  plan_list="$(printf '`%s` ' "${files[@]}")"
fi
{
  printf '## plan-atlas %s: %s error(s), %s warning(s), %s note(s), %s status suggestion(s)\n\n' \
    "$result" "$errors" "$warnings" "$notes" "$suggestions"
  if [[ -n "${PA_WORKSPACE:-}" ]]; then
    printf 'Plan files: %sworkspace: `%s` (fail-on: %s)\n\n' "$plan_list" "$PA_WORKSPACE" "$PA_FAIL_ON"
  else
    printf 'Plan files: %s(fail-on: %s)\n\n' "$plan_list" "$PA_FAIL_ON"
  fi
  cat "$body"
} >> "$summary"

if [[ $failed -eq 1 ]]; then
  message="plan-atlas $result: $errors error(s), $warnings warning(s) (fail-on: $PA_FAIL_ON)"
  message="${message//$'\r'/}"
  message="${message//$'\n'/}"
  echo "::error::$message"
  exit 1
fi
