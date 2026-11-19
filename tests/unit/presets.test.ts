import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePresetFile } from '../../src/config/presets';
import { ROOT } from '../helpers/diskTiles';

const raw = () => JSON.parse(readFileSync(resolve(ROOT, 'data/mountains.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'data/sources.json'), 'utf8')) as Record<
  string,
  unknown
>;

describe('data/mountains.json', () => {
  it('validates, with the Matterhorn as default and the three required presets', () => {
    const f = parsePresetFile(raw());
    expect(f.default).toBe('matterhorn');
    expect(f.presets.map((p) => p.id)).toEqual(['matterhorn', 'eiger-moench-jungfrau', 'everest']);
  });
  it('every preset source exists in data/sources.json with licence + attribution', () => {
    for (const p of parsePresetFile(raw()).presets)
      for (const s of p.sources) {
        const c = catalog[s.id] as Record<string, string> | undefined;
        expect(c, `${p.id}: ${s.id}`).toBeDefined();
        expect(c!['license']).toBeTruthy();
        expect(c!['attribution']).toBeTruthy();
      }
  });
  it('every preset has summit + overview bookmarks', () => {
    for (const p of parsePresetFile(raw()).presets) {
      const ids = p.bookmarks.map((b) => b.id);
      expect(ids).toContain('overview');
      expect(ids).toContain('summit');
    }
  });
  it('rejects invalid presets', () => {
    const r = raw();
    r.presets[0].extent.rootSizeM = 60000;
    expect(() => parsePresetFile(r)).toThrow(/power of two/);
    const r2 = raw();
    r2.default = 'nope';
    expect(() => parsePresetFile(r2)).toThrow(/default/);
    const r3 = raw();
    r3.presets[0].bookmarks.push(r3.presets[0].bookmarks[0]);
    expect(() => parsePresetFile(r3)).toThrow(/duplicate/);
  });
});
