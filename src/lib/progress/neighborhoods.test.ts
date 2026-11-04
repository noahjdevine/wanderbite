import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countDistinctNeighborhoods, distinctNeighborhoods } from '@/lib/progress/neighborhoods';

const ROOT = path.resolve(__dirname, '../../..');

describe('neighborhood count', () => {
  it('trims, drops blanks, and counts each name once', () => {
    expect(distinctNeighborhoods([' Downtown ', 'Downtown', '', '   ', null, undefined, 'Craig Ranch'])).toEqual([
      'Downtown',
      'Craig Ranch',
    ]);
    expect(countDistinctNeighborhoods(['Adriatica', ' Adriatica ', '   '])).toBe(1);
    expect(countDistinctNeighborhoods([])).toBe(0);
    expect(countDistinctNeighborhoods(['Downtown', 'downtown'])).toBe(2);
  });

  it('is the definition getMemberProgress and the passport map share', () => {
    const progress = readFileSync(path.join(ROOT, 'src/lib/progress/get-member-progress.ts'), 'utf8');
    const map = readFileSync(path.join(ROOT, 'src/lib/passport/passport-map.ts'), 'utf8');
    const passport = readFileSync(path.join(ROOT, 'src/components/passport/passport-content.tsx'), 'utf8');
    expect(progress).toContain('countDistinctNeighborhoods');
    expect(progress).not.toContain('exploredNeighborhoodsInPartnerSet');
    expect(map).toContain('distinctNeighborhoods');
    expect(map).toContain('exploredNeighborhoodsInPartnerSet');
    expect(passport).toContain('countDistinctNeighborhoods');
    expect(passport).toContain('exploredNeighborhoodsInPartnerSet');
    expect(passport).toContain(".select('id, neighborhood')");
    expect(passport).toContain(".eq('status', 'active')");
    expect(passport).toContain(".select('id, image_url, lat, lon')");
  });
});
