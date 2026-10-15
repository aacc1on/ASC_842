/*
# Fix RLS initplan warnings and add missing FK index

## Summary
Replaces bare `auth.uid()` calls with `(SELECT auth.uid())` subquery wrappers
in RLS policies on 7 tables to prevent per-row re-evaluation, improving query
performance at scale. Also adds a missing index on the `subscriptions.plan_key`
foreign key.

## Tables affected
1. user_profiles — "Admins can delete profiles" policy
2. fixed_asset_types — 4 ownership policies (select/insert/update/delete)
3. companies — 4 ownership policies (select/insert/update/delete)
4. subscriptions — 4 ownership policies (select/insert/update/delete)
5. stripe_customers — 1 select policy
6. stripe_subscriptions — 1 select policy
7. stripe_orders — 1 select policy

## Index added
- `idx_subscriptions_plan_key` on `subscriptions(plan_key)` to cover the
  `subscriptions_plan_key_fkey` foreign key.

## Security
No security model changes — all policy predicates remain logically identical,
only the evaluation strategy changes from per-row to per-query initialization.
*/