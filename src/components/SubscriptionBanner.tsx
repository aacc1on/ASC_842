import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, CreditCard } from 'lucide-react';
import type { PlanKey } from '../utils/planFeatures';

export function SubscriptionBanner({ variant, planKey, daysLeft, trialEndsAt, daysRemaining }: {
  variant: 'inactive' | 'pastDue';
  planKey?: PlanKey;
  daysLeft?: number | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
}) {
  const navigate = useNavigate();

  if (variant === 'inactive') {
    const isTrialEnded = planKey === 'trial' || (trialEndsAt && daysLeft === 0);
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-800">
              {isTrialEnded ? 'Your free trial has ended' : 'Your subscription is inactive'}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              You can still view and export your data, but creating, editing, or deleting is disabled until you subscribe.
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/billing')}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition flex items-center gap-2"
        >
          Go to Billing
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const days = daysRemaining ?? 0;
  return (
    <div className="bg-red-50 border-b border-red-200 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-red-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-red-800">
            Payment failed — update billing within {days} day{days === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-red-700 mt-0.5">
            Your subscription payment failed. You have full access for {days} more day{days === 1 ? '' : 's'} before access is restricted.
          </p>
        </div>
      </div>
      <button
        onClick={() => navigate('/billing')}
        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition flex items-center gap-2"
      >
        Update Billing
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
