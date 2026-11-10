import { describe, expect, it } from 'vitest';
import {
  adventureMonthName,
  adventureStatTiles,
  daysLeftInChicagoMonth,
  daysLeftLabel,
  swapsRemainingForHeader,
} from '@/lib/challenges/adventure-header';

describe('adventure header', () => {
  it('counts Chicago days left without using the process time zone', () => {
    const noon = new Date('2026-11-04T18:00:00.000Z');
    expect(daysLeftInChicagoMonth(noon)).toBe(26);
    expect(daysLeftLabel(26)).toBe('26 days left this month');
    expect(daysLeftInChicagoMonth(new Date('2026-11-29T18:00:00.000Z'))).toBe(1);
    expect(daysLeftLabel(1)).toBe('1 day left this month');
    expect(daysLeftInChicagoMonth(new Date('2026-11-30T18:00:00.000Z'))).toBe(0);
    expect(daysLeftLabel(0)).toBe('Last day of this month');
    expect(daysLeftInChicagoMonth(new Date('2026-11-01T04:30:00.000Z'))).toBe(0);
  });

  it('names the loaded cycle month, then the Chicago month', () => {
    const december = new Date('2026-12-15T18:00:00.000Z');
    expect(adventureMonthName('2026-11-01', december)).toBe('November');
    expect(adventureMonthName(null, december)).toBe('December');
    expect(adventureMonthName('not-a-month', december)).toBe('December');
  });

  it('drops a tile when that count was not loaded and keeps a real zero', () => {
    expect(
      adventureStatTiles({ activeItems: null, swapsRemaining: null }).map((tile) => tile.id),
    ).toEqual([]);

    const withPair = adventureStatTiles({
      activeItems: [{ visitStatus: 'ready' }, { visitStatus: 'code_issued' }],
      swapsRemaining: swapsRemainingForHeader(0, null),
    });
    expect(withPair).toEqual([
      { id: 'verified', value: '0', suffix: '/2', label: 'verified' },
      { id: 'codes', value: '1', suffix: undefined, label: 'code issued' },
      { id: 'swaps', value: '1', suffix: undefined, label: 'swap left' },
    ]);

    const noneLeft = adventureStatTiles({
      activeItems: [{ visitStatus: 'note_added' }, { visitStatus: 'code_expired' }],
      swapsRemaining: swapsRemainingForHeader(1, null),
    });
    expect(noneLeft.find((tile) => tile.id === 'verified')).toMatchObject({ value: '1', suffix: '/2' });
    expect(noneLeft.find((tile) => tile.id === 'codes')).toMatchObject({ value: '0', label: 'codes issued' });
    expect(noneLeft.find((tile) => tile.id === 'swaps')).toMatchObject({ value: '0', label: 'swaps left' });

    expect(swapsRemainingForHeader(null, null)).toBeNull();
    expect(swapsRemainingForHeader(0, 0)).toBe(0);
    expect(
      adventureStatTiles({ activeItems: null, swapsRemaining: 0 }).map((tile) => tile.id),
    ).toEqual(['swaps']);
    expect(adventureStatTiles({ activeItems: [], swapsRemaining: 1 }).map((tile) => tile.id)).toEqual([
      'swaps',
    ]);
  });

  it('counts an issued make-up code without changing the pair or a real zero', () => {
    const pair = [{ visitStatus: 'verified' as const }, { visitStatus: 'note_added' as const }];
    expect(
      adventureStatTiles({ activeItems: pair, swapsRemaining: 1 }).find((tile) => tile.id === 'codes'),
    ).toMatchObject({ value: '0', label: 'codes issued' });
    expect(
      adventureStatTiles({ activeItems: pair, swapsRemaining: 1, makeupIssuedCodes: 0 }).find(
        (tile) => tile.id === 'codes',
      ),
    ).toMatchObject({ value: '0', label: 'codes issued' });

    const withMakeup = adventureStatTiles({
      activeItems: pair,
      swapsRemaining: 1,
      makeupIssuedCodes: 1,
    });
    expect(withMakeup.find((tile) => tile.id === 'codes')).toMatchObject({
      value: '1',
      label: 'code issued',
    });
    expect(withMakeup.find((tile) => tile.id === 'verified')).toMatchObject({
      value: '2',
      suffix: '/2',
    });

    expect(
      adventureStatTiles({
        activeItems: [{ visitStatus: 'code_issued' }],
        swapsRemaining: null,
        makeupIssuedCodes: 1,
      }).find((tile) => tile.id === 'codes'),
    ).toMatchObject({ value: '2', label: 'codes issued' });
  });
});
