import { type FinancialReportsData } from '../../../hooks/reports/useFinancialReportsData';
import { type CashFlowData } from '../../../utils/financialReports';
import { CF_BREAKDOWN_ROWS, monthSlices, weekSlices } from '../../../utils/reports/breakdownRows';
import { BreakdownTable } from '../shared/BreakdownTable';
import { CashFlowStatement } from './CashFlowStatement';

type Props = { cashFlow: CashFlowData } & Pick<FinancialReportsData, 'weekReports' | 'weekReportsLoading' | 'monthReports' | 'monthReportsLoading'>;

export function CashFlowReport({ cashFlow, weekReports, weekReportsLoading, monthReports, monthReportsLoading }: Props) {
  return (
    <>
      <CashFlowStatement cashFlow={cashFlow} />
      {weekReports.length >= 2 && (
        <BreakdownTable title="Cash Flow by Week" loading={weekReportsLoading} slices={weekSlices(weekReports)} rows={CF_BREAKDOWN_ROWS} variant="cf" columnMinWidth="min-w-[120px]" />
      )}
      {monthReports.length >= 2 && (
        <BreakdownTable title="Cash Flow by Month" loading={monthReportsLoading} slices={monthSlices(monthReports)} rows={CF_BREAKDOWN_ROWS} variant="cf" columnMinWidth="min-w-[100px]" />
      )}
    </>
  );
}
