import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { t, type Lang } from './messages.ts';
import type { Finding } from './types.ts';

/** File errors contain only a label, location or code, never parser excerpts. */
export class InputFileError extends Error {}
/** The file exists but lies outside the confinement root or is not a regular file. */
export class ConfinedFileError extends InputFileError {}

function readError(file: string, err: unknown, lang: Lang): InputFileError {
  const code = err && typeof err === 'object' && 'code' in err &&
    typeof err.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(err.code) ? err.code : 'UNKNOWN';
  return new InputFileError(t(lang, 'fileRead', file, code));
}

export function readText(file: string | number, lang: Lang): string {
  try { return readFileSync(file, 'utf8'); }
  catch (err) { throw readError(String(file), err, lang); }
}

function jsonPosition(content: string, err: unknown): number {
  const position = err instanceof Error ? / at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(err.message) : null;
  if (position) return Math.min(Number(position[1]), content.length);
  if (err instanceof Error && err.message === 'Unexpected end of JSON input') return content.length;
  // V8 omits the position for invalid tokens. Walk complete JSON tokens to find
  // the offending character, including a mismatch partway through a literal.
  const token = /[ \t\r\n]+|"(?:[^"\\\u0000-\u001f]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/y;
  let i = 0;
  while (i < content.length) {
    token.lastIndex = i;
    const match = token.exec(content);
    if (match) { i = token.lastIndex; continue; }
    const literal = ({ t: 'true', f: 'false', n: 'null' } as Record<string, string>)[content[i]];
    if (literal) {
      let j = 0;
      while (j < literal.length && content[i + j] === literal[j]) j++;
      return i + j;
    }
    // An unfinished string/number is an end-of-input error.
    return content[i] === '"' || content[i] === '-' ? content.length : i;
  }
  return i;
}

export function parseJson(content: string, file: string, lang: Lang): unknown {
  try { return JSON.parse(content); }
  catch (err) {
    const position = jsonPosition(content, err);
    const lines = content.slice(0, position).split(/\r\n|\r|\n/);
    const line = lines.length;
    const column = lines.at(-1)!.length + 1;
    throw new InputFileError(t(lang, 'fileJson', file, line, column));
  }
}

export const readJson = (file: string, lang: Lang): unknown => parseJson(readText(file, lang), file, lang);

/** CLI input files must be real regular files below the configured directory. */
export function confineFiles(files: string[], root: string | undefined, lang: Lang): void {
  if (root === undefined) return;
  for (const file of files) {
    let valid: boolean;
    try {
      const base = realpathSync(root);
      const stat = lstatSync(file);
      const path = relative(base, realpathSync(file));
      valid = statSync(base).isDirectory() && stat.isFile() && !stat.isSymbolicLink() &&
        !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
    } catch (err) { throw readError(file, err, lang); }
    if (!valid) throw new ConfinedFileError(t(lang, 'fileConfined', file, root));
  }
}

/**
 * §V0.1-3: a file given on the command line is read into a V0 finding when it cannot be read,
 * is not valid JSON, or lies outside the confinement root, instead of stopping the command.
 */
export function readInput(file: string, confine: string | undefined, lang: Lang, json = true): { value: unknown } | { finding: Finding } {
  try {
    confineFiles([file], confine, lang);
    const text = readText(file, lang);
    return { value: json ? parseJson(text, file, lang) : text };
  } catch (err) {
    if (!(err instanceof InputFileError)) throw err;
    return { finding: { level: 'ERROR', code: 'V0', message: err.message } };
  }
}
