import { Lease } from '../types/lease';
import { supabase } from '../lib/supabase';
import { toYMD } from './formatting';
import { round2 } from './leaseCalculations';
import { fetchAll } from './fetchAll';
import { currentOrgId } from './currentOrg';

export interface LeaseTransaction {
  id?: string;
  lease_id: string;
  modification_id?: string;
  transaction_date: string;
  transaction_type: 'initial_recognition' | 'modification' | 'remeasurement' | 'termination';
  description: string;
  account_debited: string;
  account_credited: string;
  amount: number;
  user_id?: string;
  organization_id?: string;
  leases?: { lease_name: string };
}

export async function generateInitialRecognitionTransactions(
  lease: Lease,
  userId: string
): Promise<LeaseTransaction[]> {
  const transactions: LeaseTransaction[] = [];
  const transactionDate = String(lease.lease_start_date).split('T')[0];

  const idc = lease.initial_direct_costs || 0;
  const incentives = lease.lease_incentives || 0;
  const rvg = lease.residual_value_guarantee || 0;
  void rvg;
  const leaseLiability = lease.lease_liability || 0;
  const rouAsset = lease.rou_asset || 0;
  const orgId = lease.organization_id;

  // Step 1: Recognize Lease Liability (PV of payments + PV of RVG).
  // Skip when the liability rounds to zero — a $0.00 recognition entry has no
  // accounting meaning and pollutes the transactions register.
  if (leaseLiability > 0) {
    transactions.push({
      lease_id: lease.id,
      transaction_date: transactionDate,
      transaction_type: 'initial_recognition',
      description: `Initial lease liability recognized for lease: ${lease.lease_name}`,
      account_debited: 'Right-of-Use Asset',
      account_credited: 'Lease Liability',
      amount: leaseLiability,
      user_id: userId,
      organization_id: orgId,
    });
  }

  // Step 2: Initial Direct Costs capitalize into ROU asset (cash/AP paid)
  if (idc > 0) {
    transactions.push({
      lease_id: lease.id,
      transaction_date: transactionDate,
      transaction_type: 'initial_recognition',
      description: `Initial direct costs capitalized into ROU asset for lease: ${lease.lease_name}`,
      account_debited: 'Right-of-Use Asset',
      account_credited: 'Cash / Accounts Payable',
      amount: idc,
      user_id: userId,
      organization_id: orgId,
    });
  }

  // Step 3: Lease incentives received reduce ROU asset
  if (incentives > 0) {
    transactions.push({
      lease_id: lease.id,
      transaction_date: transactionDate,
      transaction_type: 'initial_recognition',
      description: `Lease incentives received reduce ROU asset for lease: ${lease.lease_name}`,
      account_debited: 'Cash / Lease Incentive Receivable',
      account_credited: 'Right-of-Use Asset',
      amount: incentives,
      user_id: userId,
      organization_id: orgId,
    });
  }

  // Step 4: Prepaid lease payments capitalize into ROU asset (cash paid at commencement)
  const prepaid = lease.prepaid_lease_payments || 0;
  if (prepaid > 0) {
    transactions.push({
      lease_id: lease.id,
      transaction_date: transactionDate,
      transaction_type: 'initial_recognition',
      description: `Prepaid lease payments capitalized into ROU asset for lease: ${lease.lease_name}`,
      account_debited: 'Right-of-Use Asset',
      account_credited: 'Prepaid Rent (Cash)',
      amount: prepaid,
      user_id: userId,
      organization_id: orgId,
    });
  }

  // Verification entry: confirm net ROU asset equals computed value
  const computedRou = round2(leaseLiability + idc + prepaid - incentives);
  if (Math.abs(computedRou - rouAsset) > 0.01) {
    const diff = rouAsset - computedRou;
    if (Math.abs(diff) > 0.00) {
      transactions.push({
        lease_id: lease.id,
        transaction_date: transactionDate,
        transaction_type: 'initial_recognition',
        description: `ROU asset adjustment for lease: ${lease.lease_name}`,
        account_debited: diff > 0 ? 'Right-of-Use Asset' : 'Lease Expense',
        account_credited: diff > 0 ? 'Lease Liability' : 'Right-of-Use Asset',
        amount: Math.abs(diff),
        user_id: userId,
        organization_id: orgId,
      });
    }
  }

  return transactions;
}

export async function saveTransactions(transactions: LeaseTransaction[]): Promise<boolean> {
  if (transactions.length === 0) return true;

  const { error } = await supabase
    .from('lease_transactions')
    .insert(transactions);

  if (error) {
    console.error('Error saving transactions:', error);
    return false;
  }

  return true;
}

export async function getTransactionsByLease(leaseId: string): Promise<LeaseTransaction[]> {
  try {
    const orgId = await currentOrgId();
    return await fetchAll<LeaseTransaction>('lease transactions', (from, to) => supabase
      .from('lease_transactions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('lease_id', leaseId)
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to));
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
}

export async function getAllTransactions(
  startDate?: Date,
  endDate?: Date
): Promise<LeaseTransaction[]> {
  const orgId = await currentOrgId();
  return fetchAll<LeaseTransaction>('lease transactions', (from, to) => {
    let query = supabase
      .from('lease_transactions')
      .select(`
        *,
        leases:lease_id (
          lease_name,
          lease_classification
        )
      `)
      .eq('organization_id', orgId);
    if (startDate) query = query.gte('transaction_date', toYMD(startDate));
    if (endDate) query = query.lte('transaction_date', toYMD(endDate));
    return query
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
  });
}
