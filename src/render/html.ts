import { t, type Lang } from '../messages.ts';
import { readFileSync } from 'node:fs';
import type { Model } from '../model.ts';
import type { Finding } from '../types.ts';
import { viewModel } from './viewmodel.ts';

const SLOT = '/*PLAN_ATLAS_DATA*/';
const TEMPLATE = new URL('../../viewer/template.html', import.meta.url);

/** The single-file interactive map: the viewer template with the view model inlined. */
export function renderHtml(m: Model, findings: Finding[], template = readFileSync(TEMPLATE, 'utf8'), lang: Lang = 'en'): string {
  if (template.split(SLOT).length !== 2) throw new Error(t(lang, 'templateSlot'));
  // "</" would end the <script> element early; JSON allows "<\/".
  const vm = viewModel(m, findings, lang);
  const data = JSON.stringify(vm).replace(/<\//g, '<\\/');
  const ui = vm.ui;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return template.replace(/\{\{(ui\w+)\}\}/g, (_, id: string) => esc(ui[id]))
    .replace('<html lang="en">', '<html lang="' + lang + '">')
    .replace(SLOT, () => data);
}
