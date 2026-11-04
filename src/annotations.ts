/**
 * GitHub workflow annotations: one per ERROR and WARN finding, on the plan file it concerns.
 * Annotations only report; whether the job fails is the Action's `fail-on`.
 */
import type { Finding } from './types.ts';

/** GitHub's escaping for the message of a workflow command. */
export const escapeData = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** GitHub's escaping for a property value (`file=`, `title=`), which also ends at `:` and `,`. */
export const escapeProperty = (s: string): string => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** `::error` or `::warning` for a finding, or null for INFO. */
export function annotation(f: Finding, file: string): string | null {
  if (f.level === 'INFO') return null;
  const command = f.level === 'ERROR' ? 'error' : 'warning';
  return `::${command} file=${escapeProperty(file)},title=${escapeProperty(`plan-atlas ${f.code}`)}::${escapeData(f.message)}`;
}

/**
 * The file a finding concerns: the input that caused a V0 finding, else the plan file of the
 * namespace that holds the statement, else `fallback`.
 */
export const findingFile = (f: Finding, files: Map<string, string>, fallback: string): string =>
  f.file ?? (f.namespace !== undefined ? files.get(f.namespace) : undefined) ?? fallback;
