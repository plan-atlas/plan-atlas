import { t, type Lang } from '../messages.ts';
import type { Model } from '../model.ts';
import type { Finding } from '../types.ts';
import { pageTitle } from './viewmodel.ts';
import { pageMermaid } from './mermaid.ts';

/** A report that renders on GitHub: every page as a Mermaid diagram, then the findings. */
export function markdown(m: Model, findings: Finding[], lang: Lang = 'en'): string {
  const out = [`# ${m.plan.title ?? t(lang, 'mapTitle')}`, '', t(lang, 'generated'), ''];
  const errs = findings.filter((f) => f.level !== 'INFO');
  out.push(errs.length ? t(lang, 'validationCounts', errs.filter((f) => f.level === 'ERROR').length, errs.filter((f) => f.level === 'WARN').length) : t(lang, 'validationClean'), '');
  for (const p of m.pages.values()) {
    const depth = p.trail.length;
    out.push(`${'#'.repeat(Math.min(2 + depth, 5))} ${pageTitle(m, p, lang)}`, '');
    if (p.trail.length) out.push(`<sub>${p.trail.map((t) => m.pages.has(t) ? pageTitle(m, m.pages.get(t)!, lang) : t).join(' › ')} › ${pageTitle(m, p, lang)}</sub>`, '');
    out.push('```mermaid', pageMermaid(m, p, lang), '```', '');
  }
  out.push(t(lang, 'validationHeading'), '');
  if (!findings.length) out.push(t(lang, 'noFindings'));
  else out.push(t(lang, 'findingsHeader'), '|---|---|---|', ...findings.map((f) => `| ${f.level} | ${f.code} | ${f.message.replace(/\|/g, '\\|')} |`));
  return out.join('\n') + '\n';
}
