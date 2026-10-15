import { describe, it, expect } from 'vitest';
import { generateInitialRecognitionTransactions } from './transactionGenerator';
import type { Lease } from '../types/lease';

// transactionGenerator.ts functions call Supabase (saveTransactions, getTransactionsByLease, getAllTransactions)
// but the generation functions are pure — they only build transaction objects.
// We test the pure generation functions without calling save/fetch.

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2028-12-31',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    lease_classification: 'finance',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'end',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classified: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('generateInitialRecognitionTransactions', () => {
  it('generates at least the base ROU/Liability entry', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    expect(txns.length).toBeGreaterThanOrEqual(1);
    expect(txns[0].account_debited).toBe('Right-of-Use Asset');
    expect(txns[0].account_credited).toBe('Lease Liability');
    expect(txns[0].amount).toBe(32871.02);
  });

  it('generates IDC entry when initial_direct_costs > 0', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ initial_direct_costs: 5000, rou_asset: 37871.02 }), 'user-1'
    );
    const idcEntry = txns.find(t => t.account_credited === 'Cash / Accounts Payable');
    expect(idcEntry).toBeDefined();
    expect(idcEntry!.amount).toBe(5000);
  });

  it('generates incentive entry when lease_incentives > 0', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ lease_incentives: 2000, rou_asset: 30871.02 }), 'user-1'
    );
    const incentiveEntry = txns.find(t => t.account_debited === 'Cash / Lease Incentive Receivable');
    expect(incentiveEntry).toBeDefined();
    expect(incentiveEntry!.amount).toBe(2000);
  });

  it('does not generate a separate RVG Payable entry (liability already includes PV of RVG)', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ residual_value_guarantee: 3000, rvg_probable_amount: 3000, rou_asset: 35871.02, lease_liability: 35871.02 }), 'user-1'
    );
    const rvgEntry = txns.find(t => t.account_credited === 'Residual Value Guarantee Payable');
    expect(rvgEntry).toBeUndefined();
  });

  it('all transactions have transaction_type initial_recognition', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    for (const t of txns) {
      expect(t.transaction_type).toBe('initial_recognition');
    }
  });

  it('all transactions have the correct lease_id and user_id', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    for (const t of txns) {
      expect(t.lease_id).toBe('lease-1');
      expect(t.user_id).toBe('user-1');
    }
  });

  it('does not generate a $0.00 liability entry when lease_liability is 0', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ lease_liability: 0, rou_asset: 0 }), 'user-1'
    );
    const liabilityEntry = txns.find(
      t => t.account_credited === 'Lease Liability' && t.amount === 0
    );
    expect(liabilityEntry).toBeUndefined();
  });

  it('does not generate any $0.00 entries when lease_liability is 0', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ lease_liability: 0, rou_asset: 0 }), 'user-1'
    );
    for (const t of txns) {
      expect(t.amount).not.toBe(0);
    }
  });

  it('generates the liability entry when lease_liability is positive', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ lease_liability: 5000, rou_asset: 5000 }), 'user-1'
    );
    const liabilityEntry = txns.find(t => t.account_credited === 'Lease Liability');
    expect(liabilityEntry).toBeDefined();
    expect(liabilityEntry!.amount).toBe(5000);
  });
});
