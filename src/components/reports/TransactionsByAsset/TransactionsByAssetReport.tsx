import { type TransactionsByAssetData } from '../../../hooks/reports/useTransactionsByAssetData';
import { AssetBreakdownModal } from './AssetBreakdownModal';
import { TransactionsByAssetTable } from './TransactionsByAssetTable';

type Props = { periodStart: string; periodEnd: string } & TransactionsByAssetData;

export function TransactionsByAssetReport({ periodStart, periodEnd, assetBreakdown, setAssetBreakdown, ...table }: Props) {
  return (
    <>
      <TransactionsByAssetTable {...table} />
      {assetBreakdown && (
        <AssetBreakdownModal assetBreakdown={assetBreakdown} setAssetBreakdown={setAssetBreakdown} periodStart={periodStart} periodEnd={periodEnd} />
      )}
    </>
  );
}
