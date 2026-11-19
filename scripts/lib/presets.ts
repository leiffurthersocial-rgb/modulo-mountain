import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePresetFile, type MountainPreset } from '../../src/config/presets';

export const ROOT = resolve(import.meta.dirname, '..', '..');

export function loadPreset(id: string): MountainPreset {
  const file = parsePresetFile(
    JSON.parse(readFileSync(resolve(ROOT, 'data/mountains.json'), 'utf8')),
  );
  const p = file.presets.find((x) => x.id === id);
  if (!p)
    throw new Error(`Unknown preset "${id}". Known: ${file.presets.map((x) => x.id).join(', ')}`);
  return p;
}

export function argValue(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== undefined) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}
