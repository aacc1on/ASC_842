import { describe, it, expect } from 'vitest';
import { computeCancellation } from './leaseModification';
import { round2 } from './leaseCalculations';

describe('QA-013: Cancellation entries correctness', () => {
  // gainLoss = L - R - penalty - final
  // L > R + cash → you owe more than the asset+cash you give up → GAIN
  // L < R + cash → you give up more than you owe → LOSS

  it('gain case with cash: liability > ROU + cash', () => {
    // carrying liability = 20000, ROU = 15000, penalty = 2000, final = 1000
    // gainLoss = 20000 - 15000 - 3000 = 2000 → GAIN of 2000
    const result = computeCancellation(15000, 20000, 2000, 1000);
    expect(result.carryingLiability).toBe(20000);
    expect(result.carryingRouAsset).toBe(15000);
    expect(result.isGain).toBe(true);
    expect(result.gainLoss).toBe(2000);
  });

  it('loss case with cash: liability < ROU + cash', () => {
    // carrying liability = 10000, ROU = 15000, penalty = 2000, final = 1000
    // gainLoss = 10000 - 15000 - 3000 = -8000 → LOSS of 8000
    const result = computeCancellation(15000, 10000, 2000, 1000);
    expect(result.isGain).toBe(false);
    expect(result.gainLoss).toBe(8000);
  });

  it('gain case without cash (penalty=0, final=0)', () => {
    // liability = 20000, ROU = 15000, no cash → gain = 5000
    const result = computeCancellation(15000, 20000, 0, 0);
    expect(result.isGain).toBe(true);
    expect(result.gainLoss).toBe(5000);
  });

  it('loss case without cash (penalty=0, final=0)', () => {
    // liability = 10000, ROU = 15000, no cash → loss = 5000
    const result = computeCancellation(15000, 10000, 0, 0);
    expect(result.isGain).toBe(false);
    expect(result.gainLoss).toBe(5000);
  });

  it('net gain/loss = L - R - cash in all cases', () => {
    const cases = [
      { rou: 15000, liab: 20000, penalty: 2000, final: 1000 },
      { rou: 15000, liab: 10000, penalty: 2000, final: 1000 },
      { rou: 15000, liab: 20000, penalty: 0, final: 0 },
      { rou: 15000, liab: 10000, penalty: 0, final: 0 },
      { rou: 30000, liab: 25000, penalty: 5000, final: 3000 },
      { rou: 5000, liab: 8000, penalty: 0, final: 0 },
    ];
    for (const c of cases) {
      const cash = round2(c.penalty + c.final);
      const expected = round2(c.liab - c.rou - cash);
      const result = computeCancellation(c.rou, c.liab, c.penalty, c.final);
      const signedGainLoss = result.isGain ? result.gainLoss : -result.gainLoss;
      expect(signedGainLoss).toBe(expected);
    }
  });

  it('zero gain/loss when perfectly balanced', () => {
    // liability = 20000, ROU = 15000, cash = 5000 → 20000 - 15000 - 5000 = 0
    const result = computeCancellation(15000, 20000, 3000, 2000);
    expect(result.gainLoss).toBe(0);
  });

  it('liability debited = carrying, ROU credited = carrying, cash credited = payments', () => {
    // The computeCancellation function returns the carrying amounts and
    // the gain/loss; the caller (applyCancellation) posts the journal entries.
    // Verify the return values match what the entries need.
    const rou = 15000;
    const liab = 20000;
    const penalty = 2000;
    const final = 1000;
    const result = computeCancellation(rou, liab, penalty, final);

    expect(result.carryingLiability).toBe(liab);
    expect(result.carryingRouAsset).toBe(rou);
    // cash = penalty + final
    const cash = round2(penalty + final);
    // net gain/loss = L - R - cash
    const expectedPlug = round2(liab - rou - cash);
    const signedPlug = result.isGain ? result.gainLoss : -result.gainLoss;
    expect(signedPlug).toBe(expectedPlug);
    // |L - R - cash| = |plug|
    expect(result.gainLoss).toBe(Math.abs(expectedPlug));
  });
});
