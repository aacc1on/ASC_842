import { useCallback, useEffect, useRef, useState } from 'react';
import { toUserMessage } from '../utils/errors';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { currentOrgId } from '../utils/currentOrg';

export interface SubscriptionPlan {
  id: string;
  plan_key: string;
  plan_name: string;
  max_leases: number;
  price_monthly: number;
  price_annually: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annually: string | null;
}

export interface InternalSubscription {
  id: string;
  plan_key: string;
  billing_cycle: 'monthly' | 'annually';
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string;
}

export interface StripeSubscription {
  customer_id: string;
  subscription_id: string | null;
  subscription_status: string | null;
  price_id: string | null;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  plan_key: string | null;
  billing_cycle: string | null;
  internal_status: string | null;
  trial_ends_at: string | null;
  internal_period_end: string | null;
}

export interface StripeOrder {
  order_id: number;
  checkout_session_id: string;
  amount_total: number;
  currency: string;
  payment_status: string;
  order_status: string;
  order_date: string;
}

export interface StripeInvoice {
  id: number;
  stripe_invoice_id: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: string;
  plan_key: string | null;
  billing_cycle: string | null;
  period_start: string | null;
  period_end: string | null;
  invoice_date: string;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
}

interface UseBillingDataResult {
  plans: SubscriptionPlan[];
  currentSubscription: InternalSubscription | null;
  stripeSubscription: StripeSubscription | null;
  orders: StripeOrder[];
  invoices: StripeInvoice[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  sync: () => Promise<void>;
  getSessionToken: () => Promise<string | null>;
}

export function useBillingData(): UseBillingDataResult {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [currentSubscription, setCurrentSubscription] =
    useState<InternalSubscription | null>(null);
  const [stripeSubscription, setStripeSubscription] =
    useState<StripeSubscription | null>(null);
  const [orders, setOrders] = useState<StripeOrder[]>([]);
  const [invoices, setInvoices] = useState<StripeInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const syncRef = useRef(false);

  const loadAll = useCallback(async () => {
    const id = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const orgId = await currentOrgId();
      const [plansRes, subRes, stripeSubRes, ordersRes, invoicesRes] = await Promise.all([
        supabase
          .from('subscription_plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.from('subscriptions').select('*').eq('organization_id', orgId).maybeSingle(),
        supabase.from('stripe_org_subscriptions').select('*').maybeSingle(),
        supabase
          .from('stripe_user_orders')
          .select('*')
          .order('order_date', { ascending: false })
          .limit(20),
        supabase
          .from('stripe_org_invoices')
          .select('*')
          .limit(50),
      ]);
      if (id !== requestRef.current) return;
      const failed = [plansRes, subRes, stripeSubRes, ordersRes, invoicesRes].find((r) => r.error);
      if (failed) throw failed.error;

      if (plansRes.data) {
        setPlans(
          plansRes.data.map((p) => ({
            ...p,
            features: Array.isArray(p.features)
              ? p.features
              : JSON.parse(p.features),
          })),
        );
      }
      if (subRes.data) {
        setCurrentSubscription({
          ...subRes.data,
          status: subRes.data.status as InternalSubscription['status'],
          billing_cycle: subRes.data
            .billing_cycle as InternalSubscription['billing_cycle'],
        });
      }
      if (stripeSubRes.data?.customer_id) {
        setStripeSubscription(stripeSubRes.data);
      } else {
        setStripeSubscription(null);
      }
      if (ordersRes.data) {
        setOrders(
          ordersRes.data.filter(
            (o: { order_id?: number | null }) => o.order_id != null,
          ),
        );
      }
      if (invoicesRes.data) {
        setInvoices(invoicesRes.data as StripeInvoice[]);
      }
    } catch (err) {
      if (id === requestRef.current) setError(toUserMessage(err, 'Failed to load billing information.'));
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, []);

  const getSessionToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    return session.access_token;
  }, []);

  const sync = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (!token) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const { synced } = await res.json();
        if (synced) await loadAll();
      }
    } catch {
      // Silent — webhook will catch up.
    }
  }, [getSessionToken, loadAll]);

  useEffect(() => {
    const requests = requestRef;
    loadAll();
    if (!syncRef.current) {
      syncRef.current = true;
      void sync();
    }
    return () => {
      requests.current++;
    };
  }, [loadAll, sync]);

  return {
    plans,
    currentSubscription,
    stripeSubscription,
    orders,
    invoices,
    loading,
    error,
    reload: loadAll,
    sync,
    getSessionToken,
  };
}

/** Re-exported so the checkout flow can type its session reference if needed. */
export type { Session };
