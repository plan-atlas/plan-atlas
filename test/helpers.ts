import { readFileSync } from 'node:fs';
import type { PlanFile, PlanNode } from '../src/types.ts';

const root = new URL('../', import.meta.url);

/** A fresh, mutable copy of an example plan. */
export function example(name: 'bookshop' | 'warehouse'): PlanFile {
  return JSON.parse(readFileSync(new URL(`examples/${name}/plan.json`, root), 'utf8'));
}

export function node(plan: PlanFile, id: string): PlanNode {
  const n = plan.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}

export const codes = (fs: { level: string; code: string }[], level?: string) =>
  fs.filter((f) => !level || f.level === level).map((f) => f.code);
