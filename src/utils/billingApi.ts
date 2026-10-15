import { SESSION_EXPIRED_MESSAGE, UserFacingError } from './errors';
import { edgeFunctionError } from './edgeFunctionError';

export const PORTAL_ERROR_MESSAGES: Record<string, string> = {
  NO_CUSTOMER: 'No billing account was found for your organization yet. Subscribe to a plan first.',
  NOT_ADMIN: 'Only administrators can manage billing.',
  RETURN_URL_NOT_ALLOWED: 'Billing can only be managed from the official site address. Open the app from its published link and try again.',
  PORTAL_STRIPE_ERROR: 'Stripe could not open the billing portal right now. Please try again in a few minutes.',
  STRIPE_NOT_CONFIGURED: 'Payments are temporarily unavailable. Please try again later.',
};

export const CHANGE_PLAN_ERROR_MESSAGES: Record<string, string> = {
  NOT_ADMIN: 'Only administrators can change the plan.',
  PAYMENT_REQUIRED: 'The payment for this change did not go through, so your plan was not changed. Update your card in Manage billing and try again.',
};

export interface PlanChangePreview {
  plan_key: string;
  plan_name: string;
  billing_cycle: 'monthly' | 'annually';
  amount_due: number;
  total: number;
  currency: string;
  proration_date: number;
  lines: { description: string | null; amount: number }[];
}

export async function callBillingFunction<T>(
  name: string,
  token: string | null,
  body: Record<string, unknown>,
  fallback: string,
  codeMessages: Record<string, string> = {},
): Promise<T> {
  if (!token) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw edgeFunctionError(res, data, fallback, codeMessages);
  if (!data || typeof data !== 'object') throw new UserFacingError(fallback, res.status);
  return data as T;
}
