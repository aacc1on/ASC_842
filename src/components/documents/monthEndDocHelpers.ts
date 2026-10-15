export interface MonthEndDocument {
  id: string;
  user_id: string;
  period: string;
  period_label: string;
  lease_count: number;
  transaction_count: number;
  total_interest: number;
  total_depreciation: number;
  total_principal: number;
  status: string;
  created_at: string;
}

export interface DocumentTransaction {
  id: string;
  lease_id: string;
  transaction_date: string;
  transaction_type: string;
  account_debited: string;
  account_credited: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  reference_number: string;
  period: string;
  lease_name?: string;
}

const TYPE_COLORS: Record<string, string> = {
  payment: 'bg-blue-100 text-blue-700',
  interest: 'bg-orange-100 text-orange-700',
  amortization: 'bg-green-100 text-green-700',
  operating_lease_expense: 'bg-teal-100 text-teal-700',
  month_end_catch_up: 'bg-amber-100 text-amber-800',
};

export const getTypeColor = (type: string) => TYPE_COLORS[type] || 'bg-slate-100 text-slate-700';

export function documentYears(documents: MonthEndDocument[], selectedYear: string): string[] {
  const set = new Set(documents.map((d) => d.period.slice(0, 4)));
  set.add(selectedYear);
  return Array.from(set).sort().reverse();
}

export function undocumentedPeriods(pendingPeriods: string[], documents: MonthEndDocument[]): string[] {
  return pendingPeriods.filter((p) => !documents.some((d) => d.period === p));
}

export function mapDocumentTransactions(data: Record<string, unknown>[], selectedCompanyId?: string | null): DocumentTransaction[] {
  return data
    .filter((t: Record<string, unknown>) => !selectedCompanyId || (t.leases as { company_id?: string } | undefined)?.company_id === selectedCompanyId)
    .map((t) => {
      const { leases, ...rest } = t as typeof t & { leases?: { lease_name?: string; company_id?: string } | null };
      return { ...rest, lease_name: leases?.lease_name || 'Unknown Lease' } as DocumentTransaction;
    });
}
