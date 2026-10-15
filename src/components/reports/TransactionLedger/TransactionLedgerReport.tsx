import { type FinancialReportsData } from '../../../hooks/reports/useFinancialReportsData';
import { monthSlices, weekSlices } from '../../../utils/reports/breakdownRows';
import { LedgerSliceTable } from './LedgerSliceTable';
import { TransactionLedgerTable } from './TransactionLedgerTable';

type Props = { periodStart: string; periodEnd: string } & Pick<FinancialReportsData, 'detailedLedger' | 'ledgerPage' | 'ledgerPageSize' | 'setLedgerPage' | 'setLedgerPageSize' | 'weekReports' | 'monthReports'>;

export function TransactionLedgerReport({ weekReports, monthReports, ...table }: Props) {
  return (
    <>
      <TransactionLedgerTable {...table} />
      {weekReports.length >= 2 && table.detailedLedger.length > 0 && (
        <LedgerSliceTable title="Transaction Ledger by Week" firstColumn="Week" slices={weekSlices(weekReports)} detailedLedger={table.detailedLedger} />
      )}
      {monthReports.length >= 2 && table.detailedLedger.length > 0 && (
        <LedgerSliceTable title="Transaction Ledger by Month" firstColumn="Month" slices={monthSlices(monthReports)} detailedLedger={table.detailedLedger} />
      )}
    </>
  );
}
