import { round2 } from '../leaseCalculations';
import type { CancellationResult } from './types';

/**
 * Pure function: computes the gain/loss on lease termination.
 * gainLoss = carryingLiability - carryingRouAsset - terminationPenalty - finalPayment
 * Positive = gain (liability extinguished for less than its carrying value)
 * Negative = loss
 */
export function computeCancellation(
  carryingRouAsset: number,
  carryingLiability: number,
  terminationPenalty: number,
  finalPayment: number,
): CancellationResult {
  const gainLoss = round2(carryingLiability - carryingRouAsset - terminationPenalty - finalPayment);
  return {
    carryingRouAsset,
    carryingLiability,
    gainLoss: Math.abs(gainLoss),
    isGain: gainLoss > 0,
  };
}
