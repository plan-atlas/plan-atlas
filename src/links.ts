/**
 * Links name the issue, pull request or branch that carries a node's work:
 * `#123` (in the repository being checked), `owner/repo#123`, or `branch:<name>`.
 */
export type Link =
  | { kind: 'number'; text: string; repo: string | null; number: number }
  | { kind: 'branch'; text: string; name: string };

/** Same pattern as `links` in schema/plan-atlas.schema.json. */
export const LINK_PATTERN = /^(?:(?:([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+))?#([1-9][0-9]*)|branch:([^\s~^:?*[\\]+))$/;

/** `owner/repo`, as `status --github` takes it. */
export const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

export function parseLink(text: string): Link | null {
  const m = LINK_PATTERN.exec(text);
  if (!m) return null;
  if (m[3] !== undefined) return { kind: 'branch', text, name: m[3] };
  return { kind: 'number', text, repo: m[1] ?? null, number: Number(m[2]) };
}

/** A web address for a link that names its repository; others have none without knowing the repository. */
export function linkUrl(text: string): string | null {
  const l = parseLink(text);
  return l?.kind === 'number' && l.repo ? `https://github.com/${l.repo}/issues/${l.number}` : null;
}
