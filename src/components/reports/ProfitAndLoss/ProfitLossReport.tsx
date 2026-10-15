import { type FinancialReportsData } from '../../../hooks/reports/useFinancialReportsData';
import { type ProfitLossData } from '../../../utils/financialReports';
import { monthSlices, PL_BREAKDOWN_ROWS, weekSlices } from '../../../utils/reports/breakdownRows';
import { BreakdownTable } from '../shared/BreakdownTable';
import { ProfitLossStatement } from './ProfitLossStatement';

type Props = { profitLoss: ProfitLossData } & Pick<FinancialReportsData, 'weekReports' | 'weekReportsLoading' | 'monthReports' | 'monthReportsLoading'>;

export function ProfitLossReport({ profitLoss, weekReports, weekReportsLoading, monthReports, monthReportsLoading }: Props) {
  return (
    <>
      <ProfitLossStatement profitLoss={profitLoss} />
      {weekReports.length >= 2 && (
        <BreakdownTable title="P&L by Week" loading={weekReportsLoading} slices={weekSlices(weekReports)} rows={PL_BREAKDOWN_ROWS} variant="pl" columnMinWidth="min-w-[120px]" />
      )}
      {monthReports.length >= 2 && (
        <BreakdownTable title="P&L by Month" loading={monthReportsLoading} slices={monthSlices(monthReports)} rows={PL_BREAKDOWN_ROWS} variant="pl" columnMinWidth="min-w-[100px]" />
      )}
    </>
  );
}
