import { supabase } from '../lib/supabase';
import type { AmortizationSchedule } from '../types/lease';
import { currentOrgId } from '../utils/currentOrg';
import { fetchAll } from '../utils/fetchAll';
import { useAsyncData } from './useAsyncData';

const NO_ROWS: AmortizationSchedule[] = [];

export function useAmortizationSchedule(leaseId: string) {
  return useAsyncData<AmortizationSchedule[]>(async () => {
    const orgId = await currentOrgId();
    return fetchAll<AmortizationSchedule>('amortization schedule', (from, to) => supabase
      .from('amortization_schedules')
      .select('*')
      .eq('organization_id', orgId)
      .eq('lease_id', leaseId)
      .order('period_number', { ascending: true })
      .order('id')
      .range(from, to));
  }, [leaseId], NO_ROWS, 'Failed to load the amortization schedule.');
}
