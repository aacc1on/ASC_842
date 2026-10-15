import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, CheckCircle2, AlertCircle, Clock, Zap, Shield, Star, ChevronRight, RefreshCw, Package, ExternalLink, XCircle, RotateCcw, ArrowRightLeft } from 'lucide-react';
import { getErrorMessage, SESSION_EXPIRED_MESSAGE, UserFacingError } from '../utils/errors';
import { useBillingData } from '../hooks/useBillingData';
import type { SubscriptionPlan } from '../hooks/useBillingData';
import { effectiveSubscriptionStatus, type MyPlan } from '../utils/planFeatures';
import { PaymentHistory } from './billing/PaymentHistory';
import { formatBillingDate } from '../utils/formatting';
import { edgeFunctionError } from '../utils/edgeFunctionError';
import { LoadError } from './LoadError';
import { ChangePlanDialog } from './billing/ChangePlanDialog';
import { callBillingFunction, CHANGE_PLAN_ERROR_MESSAGES, PORTAL_ERROR_MESSAGES, type PlanChangePreview } from '../utils/billingApi';
import { prepareExternalNavigation, type PendingExternalNavigation } from '../utils/externalNavigation';

const PLAN_ICONS: Record<string, React.ElementType> = {
  starter: Zap,
  professional: Shield,
  enterprise: Star,
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  trialing: { label: 'Free Trial', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', icon: Clock },
  active: { label: 'Active', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  past_due: { label: 'Past Due', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', icon: AlertCircle },
  expired: { label: 'Trial Expired', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: AlertCircle },
  not_started: { label: 'No Subscription', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: Package },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function BillingView({ myPlan }: { myPlan?: MyPlan | null }) {
  const { plans, currentSubscription, stripeSubscription, invoices, loading, error: billingError, reload, sync, getSessionToken } = useBillingData();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annually'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [confirmingSwitch, setConfirmingSwitch] = useState(false);
  const [blockedLink, setBlockedLink] = useState<{ url: string; label: string } | null>(null);

  const openStripePage = (nav: PendingExternalNavigation, url: string, label: string) => {
    const result = nav.go(url);
    if (result === 'blocked') setBlockedLink({ url, label });
    else if (result === 'new-tab') setNotice(`${label} opened in a new tab. Come back to this page when you're done.`);
  };

  const pendingPlanKey = searchParams.get('pending_plan');
  const pendingCycle = searchParams.get('pending_cycle') as 'monthly' | 'annually' | null;
  const pendingPlan = pendingPlanKey ? plans.find(p => p.plan_key === pendingPlanKey) ?? null : null;

  const clearPendingPlan = useCallback(() => {
    try { localStorage.removeItem('pendingPlan'); } catch { /* noop */ }
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (searchParams.get('billing_success')) {
      setSuccessMessage('Payment successful! Your subscription is now active.');
      clearPendingPlan();
      reload();
    } else if (searchParams.get('portal_return')) {
      setSearchParams({}, { replace: true });
      void sync();
    } else if (searchParams.get('billing_cancel')) {
      setNotice('Checkout was cancelled. No charge was made.');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, reload, sync, clearPendingPlan]);

  useEffect(() => {
    if (currentSubscription?.billing_cycle) {
      setBillingCycle(currentSubscription.billing_cycle);
    }
  }, [currentSubscription?.billing_cycle]);

  useEffect(() => {
    if (pendingCycle) {
      setBillingCycle(pendingCycle);
    }
  }, [pendingCycle]);

  const handleCheckout = async (plan: SubscriptionPlan) => {
    const priceId = billingCycle === 'monthly' ? plan.stripe_price_id_monthly : plan.stripe_price_id_annually;

    if (!priceId) {
      setError(`Stripe Price ID not configured for ${plan.plan_name} (${billingCycle}). Please configure it in Stripe Dashboard and update the subscription_plans table.`);
      return;
    }

    if (pendingPlanKey && plan.plan_key !== pendingPlanKey) {
      clearPendingPlan();
    }

    setCheckoutLoading(plan.plan_key);
    setError(null);
    setBlockedLink(null);
    const nav = prepareExternalNavigation();

    try {
      const token = await getSessionToken();
      if (!token) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          price_id: priceId,
          mode: 'subscription',
          success_url: `${window.location.origin}/billing?billing_success=true`,
          cancel_url: `${window.location.origin}/billing?billing_cancel=true`,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw edgeFunctionError(res, data, 'Failed to start checkout. Please try again.');
      }

      if (typeof data.url !== 'string') throw new UserFacingError('Failed to start checkout. Please try again.');
      openStripePage(nav, data.url, 'Stripe Checkout');
    } catch (err) {
      nav.cancel();
      setError(getErrorMessage(err, 'Failed to start checkout. Please try again.'));
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleCancel = async () => {
    setCancelLoading(true);
    setError(null);
    try {
      const token = await getSessionToken();
      if (!token) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/stripe-manage-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'cancel' }),
      });

      const data = await res.json();
      if (!res.ok) throw edgeFunctionError(res, data, 'Failed to cancel subscription. Please try again.');

      setShowCancelDialog(false);
      setSuccessMessage('Your subscription will be cancelled at the end of the current billing period.');
      reload();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to cancel subscription. Please try again.'));
    } finally {
      setCancelLoading(false);
    }
  };

  const handleResume = async () => {
    setCancelLoading(true);
    setError(null);
    try {
      const token = await getSessionToken();
      if (!token) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/stripe-manage-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'resume' }),
      });

      const data = await res.json();
      if (!res.ok) throw edgeFunctionError(res, data, 'Failed to resume subscription. Please try again.');

      setSuccessMessage('Your subscription has been resumed and will renew normally.');
      reload();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to resume subscription. Please try again.'));
    } finally {
      setCancelLoading(false);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    setError(null);
    setBlockedLink(null);
    const nav = prepareExternalNavigation();
    try {
      const data = await callBillingFunction<{ url?: unknown }>(
        'stripe-customer-portal',
        await getSessionToken(),
        { return_url: `${window.location.origin}/billing?portal_return=1` },
        'Failed to open billing portal. Please try again.',
        PORTAL_ERROR_MESSAGES,
      );
      if (typeof data.url !== 'string') throw new UserFacingError('Failed to open billing portal. Please try again.');
      openStripePage(nav, data.url, 'The billing portal');
    } catch (err) {
      nav.cancel();
      setError(getErrorMessage(err, 'Failed to open billing portal. Please try again.'));
    } finally {
      setPortalLoading(false);
    }
  };

  const handleSwitchPreview = async (plan: SubscriptionPlan) => {
    setPreviewLoading(plan.plan_key);
    setError(null);
    setSuccessMessage(null);
    try {
      const data = await callBillingFunction<PlanChangePreview>(
        'stripe-change-plan',
        await getSessionToken(),
        { action: 'preview', plan_key: plan.plan_key, billing_cycle: billingCycle },
        'Could not calculate the price for this change. Please try again.',
        CHANGE_PLAN_ERROR_MESSAGES,
      );
      if (typeof data.amount_due !== 'number' || !Array.isArray(data.lines)) {
        throw new UserFacingError('Could not calculate the price for this change. Please try again.');
      }
      setPreview(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not calculate the price for this change. Please try again.'));
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!preview) return;
    setConfirmingSwitch(true);
    setError(null);
    try {
      await callBillingFunction<{ changed?: boolean }>(
        'stripe-change-plan',
        await getSessionToken(),
        { action: 'confirm', plan_key: preview.plan_key, billing_cycle: preview.billing_cycle, proration_date: preview.proration_date },
        'Failed to change your plan. Please try again.',
        CHANGE_PLAN_ERROR_MESSAGES,
      );
      setSuccessMessage(`You're now on the ${preview.plan_name} plan, billed ${preview.billing_cycle === 'annually' ? 'annually' : 'monthly'}.`);
      setPreview(null);
      reload();
    } catch (err) {
      setPreview(null);
      setError(getErrorMessage(err, 'Failed to change your plan. Please try again.'));
    } finally {
      setConfirmingSwitch(false);
    }
  };

  const internalSub = currentSubscription;
  const stripeSub = stripeSubscription;
  const hasStripeSubscription = !!stripeSub?.subscription_id && stripeSub.subscription_status !== 'not_started';
  const currentStatus = internalSub
    ? effectiveSubscriptionStatus(internalSub.status, internalSub.trial_ends_at)
    : (stripeSub?.subscription_status as string) ?? 'not_started';
  const statusCfg = STATUS_CONFIG[currentStatus] ?? STATUS_CONFIG.not_started;
  const StatusIcon = statusCfg.icon;
  const trialDays = myPlan?.days_left ?? (internalSub?.trial_ends_at ? daysUntil(internalSub.trial_ends_at) : null);
  const currentPlan = internalSub ? plans.find(p => p.plan_key === internalSub.plan_key) : null;

  // Determine the plan source: Stripe, trial, or manually set.
  const isTrial = currentStatus === 'trialing' || myPlan?.plan_key === 'trial';
  const isManualEnterprise = !hasStripeSubscription && currentPlan?.plan_key === 'enterprise' && !isTrial;
  const isManualPlan = !hasStripeSubscription && internalSub?.status === 'active' && !isTrial;
  const canSwitchPlan = hasStripeSubscription && currentStatus === 'active' && !stripeSub?.cancel_at_period_end;
  const periodEndDate = stripeSub?.current_period_end
    ? new Date(stripeSub.current_period_end * 1000).toISOString()
    : internalSub?.current_period_end ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const pendingPriceLabel = pendingPlan
    ? pendingCycle === 'annually'
      ? '$' + pendingPlan.price_annually + '/mo, billed annually'
      : '$' + pendingPlan.price_monthly + '/mo, billed monthly'
    : '';

  const renewalPrice = billingCycle === 'annually'
    ? (currentPlan?.price_annually ?? 0)
    : (currentPlan?.price_monthly ?? 0);
  const renewalInterval = billingCycle === 'annually' ? 'year' : 'month';

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Billing & Subscription</h1>
          <p className="text-sm text-slate-500 mt-1">
            {currentPlan ? <>Current plan: <span className="font-bold text-slate-700">{currentPlan.plan_name}</span></> : 'Manage your plan and payment details'}
          </p>
        </div>
        <button
          onClick={reload}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {successMessage && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {billingError && <LoadError className="mb-6" message={billingError} onRetry={reload} />}

      {error && (
        <div role="alert" className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {blockedLink && (
        <div role="alert" className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Your browser blocked the new tab. {blockedLink.label} can't be shown inside this preview window.{' '}
            <a
              href={blockedLink.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setBlockedLink(null)}
              className="inline-flex items-center gap-1 font-semibold underline hover:text-amber-900"
            >
              Open it in a new tab <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </span>
        </div>
      )}

      {pendingPlan && (
        <div className="mb-6 p-5 rounded-2xl border-2 border-blue-500 bg-blue-50 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="p-3 rounded-xl bg-blue-600">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-base font-bold text-blue-900">Complete your subscription</p>
              <p className="text-sm text-blue-700 mt-0.5">
                You selected the {pendingPlan.plan_name} plan &mdash; {pendingPriceLabel}. Click below to start checkout.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleCheckout(pendingPlan)}
            disabled={checkoutLoading === pendingPlan.plan_key || (pendingCycle === 'monthly' ? !pendingPlan.stripe_price_id_monthly : !pendingPlan.stripe_price_id_annually)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition flex items-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkoutLoading === pendingPlan.plan_key ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Processing...</>
            ) : (
              <>Complete Subscription <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      )}

      {/* Current Status Card */}
      <div className={`mb-8 p-6 rounded-2xl border ${statusCfg.bg} flex flex-col sm:flex-row sm:items-center gap-4`}>
        <div className="flex items-center gap-4 flex-1">
          <div className={`p-3 rounded-xl bg-white shadow-sm border ${statusCfg.bg}`}>
            <StatusIcon className={`w-6 h-6 ${statusCfg.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-base font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
              {currentPlan && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white text-slate-700 border border-slate-200">
                  {currentPlan.plan_name}
                </span>
              )}
            </div>
            {currentStatus === 'trialing' && trialDays !== null && (
              <p className="text-sm text-blue-600 font-medium mt-0.5">
                {trialDays > 0
                  ? `${trialDays} day${trialDays !== 1 ? 's' : ''} remaining in your free trial${myPlan?.trial_ends_at ? ` — ends ${formatBillingDate(myPlan.trial_ends_at)}` : ''}`
                  : 'Trial has ended'}
              </p>
            )}
            {currentStatus === 'expired' && (
              <p className="text-sm text-red-600 font-medium mt-0.5">Trial has ended</p>
            )}
            {currentStatus === 'active' && periodEndDate && (
              <p className="text-sm text-emerald-600 mt-0.5">
                {stripeSub?.cancel_at_period_end
                  ? <>Cancels on {formatBillingDate(periodEndDate)} — no further charges</>
                  : <>Renews on {formatBillingDate(periodEndDate)}</>
                }
              </p>
            )}
            {currentStatus === 'past_due' && (
              <p className="text-sm text-amber-600 mt-0.5">Please update your payment method to avoid service interruption.</p>
            )}
            {isManualPlan && !hasStripeSubscription && (
              <p className="text-xs text-slate-500 mt-1">
                {isManualEnterprise
                  ? `${currentPlan?.plan_name ?? 'This plan'} — set up by the administrator, not billed through Stripe`
                  : 'Set up by the administrator, not billed through Stripe'
                }
              </p>
            )}
            {currentStatus === 'active' && stripeSub?.cancel_at_period_end && periodEndDate && (
              <p className="text-xs text-slate-500 mt-1">
                After {formatBillingDate(periodEndDate)}, your account becomes read-only. Fees are non-refundable.
              </p>
            )}
          </div>
        </div>

        {stripeSub?.payment_method_last4 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
            <CreditCard className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700 capitalize">
              {stripeSub.payment_method_brand} &middot;&middot;&middot;&middot; {stripeSub.payment_method_last4}
            </span>
          </div>
        )}

        {/* Cancel / Resume / Manage billing buttons — only for Stripe subscriptions */}
        {hasStripeSubscription && currentStatus === 'active' && (
          <div className="flex flex-col sm:flex-row gap-2">
            {stripeSub?.cancel_at_period_end ? (
              <button
                onClick={handleResume}
                disabled={cancelLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                {cancelLoading ? <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Resume subscription
              </button>
            ) : (
              <button
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Cancel subscription
              </button>
            )}
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {portalLoading ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              Manage billing
            </button>
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      {showCancelDialog && (
        <div className="mb-8 p-6 rounded-2xl border-2 border-red-200 bg-red-50">
          <h3 className="text-lg font-bold text-red-900 mb-2">Cancel subscription?</h3>
          <p className="text-sm text-red-700 mb-1">
            Your subscription will remain active until <strong>{periodEndDate ? formatBillingDate(periodEndDate) : 'the end of your current billing period'}</strong>.
          </p>
          <p className="text-sm text-red-700 mb-1">
            After that date, your account becomes <strong>read-only</strong> — you can view your data but cannot add or edit leases, transactions, or reports.
          </p>
          <p className="text-sm text-red-700 mb-4">
            Fees already paid are <strong>non-refundable</strong>. You can resume at any time before the period ends.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              disabled={cancelLoading}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
            >
              {cancelLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" /> : null}
              Yes, cancel at period end
            </button>
            <button
              onClick={() => setShowCancelDialog(false)}
              className="px-5 py-2.5 bg-white text-slate-700 text-sm font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition"
            >
              Keep subscription
            </button>
          </div>
        </div>
      )}

      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center mb-8">
        <div className="inline-flex items-center bg-slate-100 rounded-xl p-1 gap-1">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${billingCycle === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('annually')}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${billingCycle === 'annually' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Annual
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-extrabold">-15%</span>
          </button>
        </div>
      </div>

      {/* Renewal disclosure */}
      <p className="text-center text-xs text-slate-500 mb-6 max-w-2xl mx-auto">
        Subscriptions renew automatically every {renewalInterval} at ${renewalPrice} until you cancel. Cancel anytime in Billing. Fees are non-refundable. See our{' '}
        <a href="/legal/terms" className="text-blue-600 hover:underline">Terms of Service</a>.
      </p>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {plans.map((plan) => {
          const PlanIcon = PLAN_ICONS[plan.plan_key] ?? Zap;
          const price = billingCycle === 'monthly' ? plan.price_monthly : plan.price_annually / 12;
          const isCurrentPlan = internalSub?.plan_key === plan.plan_key;
          const isPro = plan.plan_key === 'professional';
          const hasPriceId = billingCycle === 'monthly' ? !!plan.stripe_price_id_monthly : !!plan.stripe_price_id_annually;
          const isLoading = checkoutLoading === plan.plan_key;
          const cyclePriceId = billingCycle === 'monthly' ? plan.stripe_price_id_monthly : plan.stripe_price_id_annually;
          const isCurrentPrice = !!stripeSub?.price_id && stripeSub.price_id === cyclePriceId;
          const switchLabel = isCurrentPlan
            ? `Switch to ${billingCycle === 'annually' ? 'annual' : 'monthly'} billing`
            : `Switch to ${plan.plan_name}`;

          return (
            <div
              key={plan.plan_key}
              className={`relative rounded-2xl border-2 p-6 flex flex-col transition-all ${
                isPro
                  ? 'border-blue-500 bg-blue-600 text-white shadow-xl shadow-blue-200'
                  : isCurrentPlan
                  ? 'border-emerald-400 bg-white'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
              }`}
            >
              {isPro && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-blue-500 border-2 border-white text-white text-xs font-extrabold whitespace-nowrap shadow">
                  Most Popular
                </div>
              )}
              {isCurrentPlan && !isPro && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-emerald-500 border-2 border-white text-white text-xs font-extrabold whitespace-nowrap shadow">
                  Current Plan
                </div>
              )}

              <div className={`p-2.5 rounded-xl w-fit mb-4 ${isPro ? 'bg-blue-500' : 'bg-slate-100'}`}>
                <PlanIcon className={`w-5 h-5 ${isPro ? 'text-white' : 'text-slate-700'}`} />
              </div>

              <h3 className={`text-lg font-extrabold mb-1 ${isPro ? 'text-white' : 'text-slate-900'}`}>{plan.plan_name}</h3>
              <p className={`text-xs font-semibold mb-4 ${isPro ? 'text-blue-200' : 'text-slate-500'}`}>
                Up to {plan.max_leases} active leases
              </p>

              <div className="mb-6">
                <span className={`text-4xl font-extrabold ${isPro ? 'text-white' : 'text-slate-900'}`}>
                  ${Math.round(price)}
                </span>
                <span className={`text-sm font-semibold ml-1 ${isPro ? 'text-blue-200' : 'text-slate-500'}`}>/mo</span>
                {billingCycle === 'annually' && (
                  <p className={`text-xs mt-1 ${isPro ? 'text-blue-200' : 'text-slate-500'}`}>
                    Billed ${plan.price_annually}/yr
                  </p>
                )}
              </div>

              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((feat: string, fi: number) => (
                  <li key={fi} className="flex items-start gap-2.5">
                    <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${isPro ? 'text-blue-200' : 'text-emerald-500'}`} />
                    <span className={`text-sm ${isPro ? 'text-blue-100' : 'text-slate-600'}`}>{feat}</span>
                  </li>
                ))}
              </ul>

              {canSwitchPlan && hasPriceId && !isCurrentPrice ? (
                <button
                  onClick={() => handleSwitchPreview(plan)}
                  disabled={previewLoading !== null}
                  className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    isPro ? 'bg-white text-blue-600 hover:bg-blue-50' : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {previewLoading === plan.plan_key ? (
                    <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Calculating...</>
                  ) : (
                    <><ArrowRightLeft className="w-4 h-4" />{switchLabel}</>
                  )}
                </button>
              ) : isCurrentPlan && currentStatus === 'active' && hasStripeSubscription ? (
                <div className={`w-full py-3 rounded-xl text-sm font-bold text-center ${isPro ? 'bg-blue-500 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                  <CheckCircle2 className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                  Active Plan
                </div>
              ) : isCurrentPlan && (isManualPlan || (isTrial && (trialDays ?? 0) > 0)) ? (
                <div className={`w-full py-3 rounded-xl text-sm font-bold text-center ${isPro ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                  {isTrial ? 'Free Trial' : 'Current Plan'}
                </div>
              ) : (
                <button
                  onClick={() => handleCheckout(plan)}
                  disabled={isLoading || !hasPriceId}
                  title={!hasPriceId ? 'Stripe price ID not configured for this plan' : undefined}
                  className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    isPro
                      ? 'bg-white text-blue-600 hover:bg-blue-50'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isLoading ? (
                    <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Processing...</>
                  ) : !hasPriceId ? (
                    'Contact Sales'
                  ) : isCurrentPlan ? (
                    <>Renew Plan <ChevronRight className="w-4 h-4" /></>
                  ) : (
                    <>Subscribe <ChevronRight className="w-4 h-4" /></>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <PaymentHistory invoices={invoices} />

      {preview && (
        <ChangePlanDialog
          preview={preview}
          confirming={confirmingSwitch}
          onConfirm={handleConfirmSwitch}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
