import { useContext } from 'react';
import { type LeaseBreakdownItem } from '../../../utils/financialReports';
import { BreakdownContext } from './breakdownContext';
import { formatCurrency } from './formatters';

export function AmountButton({
  value,
  display = value,
  items,
  label,
  isNegative = false,
  className = '',
}: {
  value: number;
  display?: number;
  items: LeaseBreakdownItem[];
  label: string;
  isNegative?: boolean;
  className?: string;
}) {
  const openBreakdown = useContext(BreakdownContext);
  return (
    <button
      onClick={() => openBreakdown({ title: label, total: value, items, isNegative })}
      className={`font-semibold underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity cursor-pointer ${className}`}
      title="Click to see breakdown by lease"
    >
      {isNegative ? `(${formatCurrency(display)})` : formatCurrency(display)}
    </button>
  );
}
