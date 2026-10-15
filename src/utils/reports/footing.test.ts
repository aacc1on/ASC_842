import { describe, expect, it } from 'vitest';
import { footParts, footTable, footToTotal, fromCents, roundWhole, sumCents, toCents } from './footing';

describe('footing', () => {
  it('converts to and from cents without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
    expect(fromCents(12345)).toBe(123.45);
    expect(sumCents([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('rounds half away from zero', () => {
    expect(roundWhole(2.5)).toBe(3);
    expect(roundWhole(-2.5)).toBe(-3);
    expect(roundWhole(2.49)).toBe(2);
    expect(roundWhole(-0.4)).toBe(0);
  });

  it('footParts makes the total the sum of displayed parts', () => {
    const f = footParts([88918.4, 575149.6]);
    expect(f.parts).toEqual([88918, 575150]);
    expect(f.total).toBe(664068);
  });

  it('footToTotal keeps the rounded total and plugs the last part', () => {
    const f = footToTotal([88918.4, 575149.6], 664068.0 - 0.88);
    expect(f.total).toBe(664067);
    expect(f.parts).toEqual([88918, 575149]);
    expect(f.parts[0] + f.parts[1]).toBe(f.total);
  });

  it('footToTotal handles a single part and no parts', () => {
    expect(footToTotal([10.4], 10.6)).toEqual({ parts: [11], total: 11 });
    expect(footToTotal([], 10.6)).toEqual({ parts: [], total: 11 });
  });

  it('footTable foots every row and column', () => {
    const t = footTable([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    expect(t.cells).toEqual([[1, 1], [1, 1]]);
    expect(t.rowTotals).toEqual([2, 2]);
    expect(t.colTotals).toEqual([2, 2]);
    expect(t.grandTotal).toBe(4);
  });

  it('footTable handles ragged rows', () => {
    const t = footTable([[1.4], [2.6, 3.2]]);
    expect(t.colTotals).toEqual([4, 3]);
    expect(t.grandTotal).toBe(7);
  });
});
