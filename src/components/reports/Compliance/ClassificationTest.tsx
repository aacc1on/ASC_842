import { CheckCircle2, XCircle, AlertTriangle, Pencil, Eye } from 'lucide-react';
import { formatCurrencyVal } from '../shared/formatters';
import { type Lease } from '../../../types/lease';
import { getLeaseDiscountRate } from '../../../utils/discountRate';
import { parseLocalDate } from '../../../utils/formatting';
import { type ClassificationRow } from '../../../utils/reports/complianceCalculations';

interface ClassificationTestProps {
  rows: ClassificationRow[];
  activeLeaseCount: number;
  onEditLease: (lease: Lease) => void;
  onViewLease: (lease: Lease) => void;
}

const Pass = () => <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold"><CheckCircle2 className="w-3 h-3" />Met</span>;
const Fail = () => <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold"><XCircle className="w-3 h-3" />Not Met</span>;
const NA = (reason: string) => <span title={reason} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold border border-amber-200">N/A</span>;

export function ClassificationTest({ rows, activeLeaseCount, onEditLease, onViewLease }: ClassificationTestProps) {
  const mismatchCount = rows.filter((r) => r.mismatch).length;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h4 className="font-bold text-slate-900">Lease Classification Test (ASC 842-10-25-2)</h4>
          <p className="text-xs text-slate-500 mt-0.5">A lease is a finance lease if ANY of the five criteria is met. Otherwise it is operating.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">{activeLeaseCount - mismatchCount} aligned</span>
          {mismatchCount > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {mismatchCount} potential mismatch{mismatchCount === 1 ? '' : 'es'}
            </span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase sticky left-0 bg-slate-50">Lease</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase" title="ASC 842-10-25-2(a): Title transfers at end of term">Transfer of Ownership</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase" title="ASC 842-10-25-2(b): Reasonably certain to exercise purchase option">Purchase Option</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase" title="ASC 842-10-25-2(c): Lease term major part of remaining economic life (~75%)">{'Major Part of Life'}</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase" title="ASC 842-10-25-2(d): PV of payments substantially all of fair value (~90%)">{'Substantially All FV'}</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase" title="ASC 842-10-25-2(e): Specialized asset with no alternative use">Specialized Asset</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">System Result</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">Recorded</th>
              <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No active leases to evaluate</td></tr>
            )}
            {rows.map(({ lease, reassessedOn, tests, classification, mismatch, termRatio, pvRatio, pv, fv }) => (
              <tr key={lease.id} className={mismatch ? 'bg-amber-50/40' : 'hover:bg-slate-50'}>
                <td className="px-4 py-3 font-semibold text-slate-900 sticky left-0 bg-inherit">
                  <div className="truncate max-w-xs">{lease.lease_name}</div>
                  <div className="text-[11px] font-normal text-slate-500">Term {(Number(lease.lease_term_months) || 0)} mo · Rate {(getLeaseDiscountRate(lease) || 0).toFixed(2)}%</div>
                  {reassessedOn && (
                    <div className="text-[11px] font-semibold text-blue-700">Reassessed at modification {parseLocalDate(reassessedOn).toLocaleDateString()}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {tests.transferOwnership ? <Pass /> : <Fail />}
                </td>
                <td className="px-3 py-3 text-center">
                                  {tests.purchaseOptionReasonablyCertain ? <Pass /> : (!lease.purchase_option ? Fail() : <div className="flex flex-col items-center gap-0.5"><Fail /><span className="text-[10px] text-slate-500">Not reasonably certain</span></div>)}
                </td>
                <td className="px-3 py-3 text-center">
                  {termRatio === null ? NA('Asset economic life not set') : (
                    <div className="flex flex-col items-center gap-0.5">
                      {tests.majorPartOfLife ? <Pass /> : <Fail />}
                      <span className="text-[10px] text-slate-500">{(termRatio * 100).toFixed(1)}% of life</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {pvRatio === null ? NA('Asset fair value not set') : (
                    <div className="flex flex-col items-center gap-0.5">
                      {tests.substantiallyAllValue ? <Pass /> : <Fail />}
                      <span className="text-[10px] text-slate-500">{(Math.trunc(pvRatio * 1000) / 10).toFixed(1)}% of FV</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-center">{tests.specializedAsset ? <Pass /> : <Fail />}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-1 text-xs font-bold rounded-full ${classification === 'finance' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{classification === 'finance' ? 'Finance' : 'Operating'}</span>
                  <div className="text-[10px] text-slate-500 mt-1">PV {formatCurrencyVal(pv)}{fv > 0 && <> / FV {formatCurrencyVal(fv)}</>}</div>
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${lease.lease_classification === 'finance' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{lease.lease_classification === 'finance' ? 'Finance' : 'Operating'}</span>
                    {mismatch && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        Review
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => onViewLease(lease)}
                      title="View lease details"
                      className="p-1.5 rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-200 transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onEditLease(lease)}
                      title="Edit lease"
                      aria-label={`Edit ${lease.lease_name}`}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 leading-relaxed">
        <span className="font-semibold text-slate-700">Methodology:</span> PV is the lease's recorded Lease Fair Value (or, if blank, the present value of payments plus prepaid payments and residual value guarantee), compared against the Asset Fair Value — the same inputs used by the lease form's classification wizard. Thresholds applied per ASC 842-10-25-2: 75% (major part of life) and 90% (substantially all of fair value / bargain purchase). A lease is finance if any one criterion is met.
      </div>
    </div>
  );
}
