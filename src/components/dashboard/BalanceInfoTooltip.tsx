import { useId } from 'react';
import { Info } from 'lucide-react';
import { BALANCE_CONVENTION_NOTE } from '../../utils/leaseBalanceAsOf';

export const BALANCE_EXPLANATION =
  `${BALANCE_CONVENTION_NOTE} For finance leases the ROU asset is amortized straight-line while the liability decreases only by the principal portion of each payment, so the ROU asset is normally lower than the liability until the end of the lease. For operating leases they are usually equal unless there is prepaid/accrued rent, initial direct costs or incentives.`;

interface BalanceInfoTooltipProps {
  align?: 'left' | 'right';
}

export function BalanceInfoTooltip({ align = 'left' }: BalanceInfoTooltipProps) {
  const id = useId();
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        aria-label="How these balances are calculated"
        aria-describedby={id}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute top-full mt-2 z-30 w-80 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-normal normal-case tracking-normal leading-relaxed text-slate-100 shadow-xl opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {BALANCE_EXPLANATION}
      </span>
    </span>
  );
}
