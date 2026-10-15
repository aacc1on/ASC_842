# Ledgers

The app keeps three ledgers. They have different jobs and are **not** merged.

| Table | Role | Written by | Rewritten? |
|---|---|---|---|
| `lease_transactions` | **Lease events**: initial recognition, modification, impairment, termination. One row per event. | Lease save / modification flows | No. These rows are the history of each lease. |
| `transactions` | **Posted month-end entries.** What was booked when a month was closed. | Month-end posting | No. Rows for locked months are final. |
| `journal_entries` | **Derived/projected entries**, built from the amortization schedule. | Journal refresh (`refresh_lease_journal_entries`) | Yes, but only for months after the last locked month. |

The same roles are recorded as `COMMENT ON TABLE` in the database (migration `20261012194847_round_c_database_cleanup`).

## Reconciliation

`internal.reconcile_ledgers(p_org, p_from, p_to, p_include_prepared_catch_up)` is read-only and only looks at **locked** periods (`accounting_periods.status` locked or closed). The amortization schedule is the source of truth. It returns one row per difference:

| check_type | Meaning |
|---|---|
| `missing_posting` | A lease-month inside the lease term (short-term exemptions excluded) has no posted month-end entry and no catch-up line. |
| `posted_vs_schedule` | For each lease, month and account, posted `transactions` plus catch-up lines differ from the amounts implied by the schedule row. |
| `posted_vs_journal` | Posted `transactions` differ from `journal_entries` (only months that still have projected entries). |
| `events_vs_journal` | Lease events in `lease_transactions` differ from the matching journal entries. |
| `unbalanced_journal_entry` | A journal entry's debits differ from its credits. |
| `unbalanced_posted_entry` | A posted entry's debits differ from its credits within the period. |

Expected amounts per schedule row (debit positive): interest expense (operating lease expense if operating) = +interest; lease liability = +(payment - interest); depreciation (operating lease expense) = +depreciation; accumulated depreciation (ROU asset if operating) = -depreciation; cash = -payment.

Catch-up lines count against the month they correct. Posted catch-up lines always count. Prepared (not yet posted) lines count only when `p_include_prepared_catch_up` is true. Account names are normalized (lowercase; "right-of-use" is treated as "rou").

Access:
- `public.get_ledger_reconciliation(p_from, p_to, p_include_prepared_catch_up)` checks `internal.has_data_access()` (admin or manage) and is limited to the caller's organization. The 2-argument form still exists and treats prepared catch-up as not posted.
- The UI shows it under Reports > Compliance > Ledger reconciliation, with a "Treat prepared catch-up corrections as posted" switch.

## Results on 2026-10-12 (live, before the month-end fix)

- **MS Consulting** (81 locked periods): 4 differences, all for Vehicle 14 in 2026-09. Projected entries exist, but nothing was posted:
  - cash: 0 vs -260
  - lease liability: 0 vs 243.68
  - operating lease expense: 0 vs 260
  - ROU asset: 0 vs -243.68
- **Test (Default Organization)**: 0 differences. It has no locked periods, so nothing was compared.
- No unbalanced posted entries in any locked period.

## Recognition conventions

- Prepaid lease payments made at or before commencement are credited on one line, "Prepaid Rent (Cash)". This is a reclass out of Prepaid Rent if the payment was already booked as an asset, otherwise the cash paid. The ROU asset carries the debit.
- Lease incentives received are debited to "Cash / Lease Incentive Receivable" and reduce the ROU asset.
- Any rounding gap between the ROU asset and liability + IDC + prepaid - incentives goes on an "ROU asset adjustment" line, so recognition always balances.

## Balance safeguard

A deferred constraint trigger, `ledger_batch_balanced`, rejects any commit that leaves a `journal_entries` or `transactions` group (lease + date + type) with debits != credits. It also rejects any `lease_transactions` row without both accounts or with a negative amount. The error code is 23514.

## Month-end posting gap (found 2026-10-12, corrected by a catch-up in October 2026)

Root cause: the month-end screen loaded every lease's schedule in one request, ordered by period number. The API returns at most 1,000 rows per request, so rows from roughly period 45 onward were cut off. The generator then skipped those leases silently. Day-of-month and date conventions were not the cause. The fix pages the schedule load, records a skip whenever a lease inside its term has no row for the month, refuses to post while any lease is skipped, and never posts a lease twice in a month.

Scope: only MS Consulting has locked months (2020-01 to 2026-09). There are 187 missing lease-months across 9 leases. Each month needs three entries:
- operating: Dr Operating Lease Expense / Cr Lease Liability (interest); Dr Operating Lease Expense / Cr ROU Asset (amortization); Dr Lease Liability / Cr Cash (payment)
- finance: the same with Interest Expense and Amortization Expense

The old journal-based reconciliation flagged only Vehicle 14 2026-09. The schedule-based reconciliation flags all 187 lease-months (`missing_posting`) until the catch-up counts.

| Lease | Period | Schedule # | Interest | ROU amortization | Payment |
|---|---|---|---|---|---|
| Building 6 | 2023-09 | 45 | 561.39 | 524.99 | 900.00 |
| Building 6 | 2023-10 | 46 | 559.70 | 524.99 | 900.00 |
| Building 6 | 2023-11 | 47 | 558.00 | 524.99 | 900.00 |
| Building 6 | 2023-12 | 48 | 556.29 | 524.99 | 900.00 |
| Building 6 | 2024-01 | 49 | 554.57 | 524.99 | 900.00 |
| Building 6 | 2024-02 | 50 | 552.84 | 524.99 | 900.00 |
| Building 6 | 2024-03 | 51 | 551.11 | 524.99 | 900.00 |
| Building 6 | 2024-04 | 52 | 549.36 | 524.99 | 900.00 |
| Building 6 | 2024-05 | 53 | 547.61 | 524.99 | 900.00 |
| Building 6 | 2024-06 | 54 | 545.85 | 524.99 | 900.00 |
| Building 6 | 2024-07 | 55 | 544.08 | 524.99 | 900.00 |
| Building 6 | 2024-08 | 56 | 542.30 | 524.99 | 900.00 |
| Building 6 | 2024-09 | 57 | 540.51 | 524.99 | 900.00 |
| Building 6 | 2024-10 | 58 | 538.71 | 524.99 | 900.00 |
| Building 6 | 2024-11 | 59 | 536.91 | 524.99 | 900.00 |
| Building 6 | 2024-12 | 60 | 535.09 | 524.99 | 900.00 |
| Building 6 | 2025-01 | 61 | 533.27 | 524.99 | 900.00 |
| Building 6 | 2025-02 | 62 | 531.43 | 524.99 | 900.00 |
| Building 6 | 2025-03 | 63 | 529.59 | 524.99 | 900.00 |
| Building 6 | 2025-04 | 64 | 527.74 | 524.99 | 900.00 |
| Building 6 | 2025-05 | 65 | 525.88 | 524.99 | 900.00 |
| Building 6 | 2025-06 | 66 | 524.01 | 524.99 | 900.00 |
| Building 6 | 2025-07 | 67 | 522.13 | 524.99 | 900.00 |
| Building 6 | 2025-08 | 68 | 520.24 | 524.99 | 900.00 |
| Building 6 | 2025-09 | 69 | 518.34 | 524.99 | 900.00 |
| Building 6 | 2025-10 | 70 | 516.43 | 524.99 | 900.00 |
| Building 6 | 2025-11 | 71 | 514.51 | 524.99 | 900.00 |
| Building 6 | 2025-12 | 72 | 512.58 | 524.99 | 900.00 |
| Building 6 | 2026-01 | 73 | 510.65 | 524.99 | 900.00 |
| Building 6 | 2026-02 | 74 | 508.70 | 524.99 | 900.00 |
| Building 6 | 2026-03 | 75 | 506.74 | 524.99 | 900.00 |
| Building 6 | 2026-04 | 76 | 504.78 | 524.99 | 900.00 |
| Building 6 | 2026-05 | 77 | 502.80 | 524.99 | 900.00 |
| Building 6 | 2026-06 | 78 | 500.81 | 524.99 | 900.00 |
| Building 6 | 2026-07 | 79 | 498.82 | 524.99 | 900.00 |
| Building 6 | 2026-08 | 80 | 496.81 | 524.99 | 900.00 |
| Building 6 | 2026-09 | 81 | 494.80 | 524.99 | 900.00 |
| Office Building | 2023-10 | 46 | 1556.37 | 1453.40 | 2500.00 |
| Office Building | 2023-11 | 47 | 1551.66 | 1453.40 | 2500.00 |
| Office Building | 2023-12 | 48 | 1546.94 | 1453.40 | 2500.00 |
| Office Building | 2024-01 | 49 | 1542.19 | 1453.40 | 2500.00 |
| Office Building | 2024-02 | 50 | 1537.42 | 1453.40 | 2500.00 |
| Office Building | 2024-03 | 51 | 1532.62 | 1453.40 | 2500.00 |
| Office Building | 2024-04 | 52 | 1527.80 | 1453.40 | 2500.00 |
| Office Building | 2024-05 | 53 | 1522.95 | 1453.40 | 2500.00 |
| Office Building | 2024-06 | 54 | 1518.08 | 1453.40 | 2500.00 |
| Office Building | 2024-07 | 55 | 1513.19 | 1453.40 | 2500.00 |
| Office Building | 2024-08 | 56 | 1508.27 | 1453.40 | 2500.00 |
| Office Building | 2024-09 | 57 | 1503.33 | 1453.40 | 2500.00 |
| Office Building | 2024-10 | 58 | 1498.36 | 1453.40 | 2500.00 |
| Office Building | 2024-11 | 59 | 1493.37 | 1453.40 | 2500.00 |
| Office Building | 2024-12 | 60 | 1488.36 | 1453.40 | 2500.00 |
| Office Building | 2025-01 | 61 | 1483.31 | 1453.40 | 2500.00 |
| Office Building | 2025-02 | 62 | 1478.25 | 1453.40 | 2500.00 |
| Office Building | 2025-03 | 63 | 1473.16 | 1453.40 | 2500.00 |
| Office Building | 2025-04 | 64 | 1468.04 | 1453.40 | 2500.00 |
| Office Building | 2025-05 | 65 | 1462.90 | 1453.40 | 2500.00 |
| Office Building | 2025-06 | 66 | 1457.73 | 1453.40 | 2500.00 |
| Office Building | 2025-07 | 67 | 1452.53 | 1453.40 | 2500.00 |
| Office Building | 2025-08 | 68 | 1447.31 | 1453.40 | 2500.00 |
| Office Building | 2025-09 | 69 | 1442.07 | 1453.40 | 2500.00 |
| Office Building | 2025-10 | 70 | 1436.80 | 1453.40 | 2500.00 |
| Office Building | 2025-11 | 71 | 1431.50 | 1453.40 | 2500.00 |
| Office Building | 2025-12 | 72 | 1426.17 | 1453.40 | 2500.00 |
| Office Building | 2026-01 | 73 | 1420.82 | 1453.40 | 2500.00 |
| Office Building | 2026-02 | 74 | 1415.44 | 1453.40 | 2500.00 |
| Office Building | 2026-03 | 75 | 1410.04 | 1453.40 | 2500.00 |
| Office Building | 2026-04 | 76 | 1404.61 | 1453.40 | 2500.00 |
| Office Building | 2026-05 | 77 | 1399.15 | 1453.40 | 2500.00 |
| Office Building | 2026-06 | 78 | 1393.66 | 1453.40 | 2500.00 |
| Office Building | 2026-07 | 79 | 1388.15 | 1453.40 | 2500.00 |
| Office Building | 2026-08 | 80 | 1382.61 | 1453.40 | 2500.00 |
| Office Building | 2026-09 | 81 | 1377.04 | 1453.40 | 2500.00 |
| Vehicle 12 | 2025-09 | 45 | 19.20 | 316.31 | 350.00 |
| Vehicle 12 | 2025-10 | 46 | 18.10 | 316.31 | 350.00 |
| Vehicle 12 | 2025-11 | 47 | 17.00 | 316.31 | 350.00 |
| Vehicle 12 | 2025-12 | 48 | 15.89 | 316.31 | 350.00 |
| Vehicle 12 | 2026-01 | 49 | 14.78 | 316.31 | 350.00 |
| Vehicle 12 | 2026-02 | 50 | 13.67 | 316.31 | 350.00 |
| Vehicle 12 | 2026-03 | 51 | 12.55 | 316.31 | 350.00 |
| Vehicle 12 | 2026-04 | 52 | 11.43 | 316.31 | 350.00 |
| Vehicle 12 | 2026-05 | 53 | 10.30 | 316.31 | 350.00 |
| Vehicle 12 | 2026-06 | 54 | 9.17 | 316.31 | 350.00 |
| Vehicle 12 | 2026-07 | 55 | 8.04 | 316.31 | 350.00 |
| Vehicle 12 | 2026-08 | 56 | 6.90 | 316.31 | 350.00 |
| Vehicle 12 | 2026-09 | 57 | 5.76 | 316.31 | 350.00 |
| Vehicle 13 | 2025-10 | 45 | 62.27 | 695.77 | 780.00 |
| Vehicle 13 | 2025-11 | 46 | 59.87 | 695.77 | 780.00 |
| Vehicle 13 | 2025-12 | 47 | 57.47 | 695.77 | 780.00 |
| Vehicle 13 | 2026-01 | 48 | 55.06 | 695.77 | 780.00 |
| Vehicle 13 | 2026-02 | 49 | 52.65 | 695.77 | 780.00 |
| Vehicle 13 | 2026-03 | 50 | 50.22 | 695.77 | 780.00 |
| Vehicle 13 | 2026-04 | 51 | 47.79 | 695.77 | 780.00 |
| Vehicle 13 | 2026-05 | 52 | 45.35 | 695.77 | 780.00 |
| Vehicle 13 | 2026-06 | 53 | 42.90 | 695.77 | 780.00 |
| Vehicle 13 | 2026-07 | 54 | 40.44 | 695.77 | 780.00 |
| Vehicle 13 | 2026-08 | 55 | 37.98 | 695.77 | 780.00 |
| Vehicle 13 | 2026-09 | 56 | 35.51 | 695.77 | 780.00 |
| Vehicle 14 | 2026-09 | 45 | 16.32 | 243.68 | 260.00 |
| Vehicle 4 | 2023-12 | 45 | 15.30 | 104.35 | 120.00 |
| Vehicle 4 | 2024-01 | 46 | 14.96 | 104.35 | 120.00 |
| Vehicle 4 | 2024-02 | 47 | 14.61 | 104.35 | 120.00 |
| Vehicle 4 | 2024-03 | 48 | 14.25 | 104.35 | 120.00 |
| Vehicle 4 | 2024-04 | 49 | 13.90 | 104.35 | 120.00 |
| Vehicle 4 | 2024-05 | 50 | 13.55 | 104.35 | 120.00 |
| Vehicle 4 | 2024-06 | 51 | 13.19 | 104.35 | 120.00 |
| Vehicle 4 | 2024-07 | 52 | 12.84 | 104.35 | 120.00 |
| Vehicle 4 | 2024-08 | 53 | 12.48 | 104.35 | 120.00 |
| Vehicle 4 | 2024-09 | 54 | 12.12 | 104.35 | 120.00 |
| Vehicle 4 | 2024-10 | 55 | 11.76 | 104.35 | 120.00 |
| Vehicle 4 | 2024-11 | 56 | 11.40 | 104.35 | 120.00 |
| Vehicle 4 | 2024-12 | 57 | 11.04 | 104.35 | 120.00 |
| Vehicle 4 | 2025-01 | 58 | 10.68 | 104.35 | 120.00 |
| Vehicle 4 | 2025-02 | 59 | 10.31 | 104.35 | 120.00 |
| Vehicle 4 | 2025-03 | 60 | 9.95 | 104.35 | 120.00 |
| Vehicle 4 | 2025-04 | 61 | 9.58 | 104.35 | 120.00 |
| Vehicle 4 | 2025-05 | 62 | 9.21 | 104.35 | 120.00 |
| Vehicle 4 | 2025-06 | 63 | 8.84 | 104.35 | 120.00 |
| Vehicle 4 | 2025-07 | 64 | 8.47 | 104.35 | 120.00 |
| Vehicle 4 | 2025-08 | 65 | 8.10 | 104.35 | 120.00 |
| Vehicle 4 | 2025-09 | 66 | 7.73 | 104.35 | 120.00 |
| Vehicle 4 | 2025-10 | 67 | 7.35 | 104.35 | 120.00 |
| Vehicle 4 | 2025-11 | 68 | 6.98 | 104.35 | 120.00 |
| Vehicle 4 | 2025-12 | 69 | 6.60 | 104.35 | 120.00 |
| Vehicle 4 | 2026-01 | 70 | 6.22 | 104.35 | 120.00 |
| Vehicle 4 | 2026-02 | 71 | 5.84 | 104.35 | 120.00 |
| Vehicle 4 | 2026-03 | 72 | 5.46 | 104.35 | 120.00 |
| Vehicle 4 | 2026-04 | 73 | 5.08 | 104.35 | 120.00 |
| Vehicle 4 | 2026-05 | 74 | 4.70 | 104.35 | 120.00 |
| Vehicle 4 | 2026-06 | 75 | 4.31 | 104.35 | 120.00 |
| Vehicle 4 | 2026-07 | 76 | 3.93 | 104.35 | 120.00 |
| Vehicle 4 | 2026-08 | 77 | 3.54 | 104.35 | 120.00 |
| Vehicle 4 | 2026-09 | 78 | 3.15 | 104.35 | 120.00 |
| Vehicle 5 | 2025-09 | 45 | 18.40 | 177.27 | 200.00 |
| Vehicle 5 | 2025-10 | 46 | 17.79 | 177.27 | 200.00 |
| Vehicle 5 | 2025-11 | 47 | 17.19 | 177.27 | 200.00 |
| Vehicle 5 | 2025-12 | 48 | 16.58 | 177.27 | 200.00 |
| Vehicle 5 | 2026-01 | 49 | 15.97 | 177.27 | 200.00 |
| Vehicle 5 | 2026-02 | 50 | 15.35 | 177.27 | 200.00 |
| Vehicle 5 | 2026-03 | 51 | 14.74 | 177.27 | 200.00 |
| Vehicle 5 | 2026-04 | 52 | 14.12 | 177.27 | 200.00 |
| Vehicle 5 | 2026-05 | 53 | 13.50 | 177.27 | 200.00 |
| Vehicle 5 | 2026-06 | 54 | 12.88 | 177.27 | 200.00 |
| Vehicle 5 | 2026-07 | 55 | 12.25 | 177.27 | 200.00 |
| Vehicle 5 | 2026-08 | 56 | 11.63 | 177.27 | 200.00 |
| Vehicle 5 | 2026-09 | 57 | 11.00 | 177.27 | 200.00 |
| Vehicle 6 | 2023-09 | 45 | 0.00 | 420.00 | 420.00 |
| Vehicle 6 | 2023-10 | 46 | 0.00 | 420.00 | 420.00 |
| Vehicle 6 | 2023-11 | 47 | 0.00 | 420.00 | 420.00 |
| Vehicle 6 | 2023-12 | 48 | 0.00 | 420.00 | 420.00 |
| Warehouse 2 | 2023-09 | 45 | 341.05 | 701.52 | 960.00 |
| Warehouse 2 | 2023-10 | 46 | 337.95 | 701.52 | 960.00 |
| Warehouse 2 | 2023-11 | 47 | 334.84 | 701.52 | 960.00 |
| Warehouse 2 | 2023-12 | 48 | 331.72 | 701.52 | 960.00 |
| Warehouse 2 | 2024-01 | 49 | 328.57 | 701.52 | 960.00 |
| Warehouse 2 | 2024-02 | 50 | 325.42 | 701.52 | 960.00 |
| Warehouse 2 | 2024-03 | 51 | 322.24 | 701.52 | 960.00 |
| Warehouse 2 | 2024-04 | 52 | 319.06 | 701.52 | 960.00 |
| Warehouse 2 | 2024-05 | 53 | 315.85 | 701.52 | 960.00 |
| Warehouse 2 | 2024-06 | 54 | 312.63 | 701.52 | 960.00 |
| Warehouse 2 | 2024-07 | 55 | 309.39 | 701.52 | 960.00 |
| Warehouse 2 | 2024-08 | 56 | 306.14 | 701.52 | 960.00 |
| Warehouse 2 | 2024-09 | 57 | 302.87 | 701.52 | 960.00 |
| Warehouse 2 | 2024-10 | 58 | 299.59 | 701.52 | 960.00 |
| Warehouse 2 | 2024-11 | 59 | 296.28 | 701.52 | 960.00 |
| Warehouse 2 | 2024-12 | 60 | 292.96 | 701.52 | 960.00 |
| Warehouse 2 | 2025-01 | 61 | 289.63 | 701.52 | 960.00 |
| Warehouse 2 | 2025-02 | 62 | 286.28 | 701.52 | 960.00 |
| Warehouse 2 | 2025-03 | 63 | 282.91 | 701.52 | 960.00 |
| Warehouse 2 | 2025-04 | 64 | 279.52 | 701.52 | 960.00 |
| Warehouse 2 | 2025-05 | 65 | 276.12 | 701.52 | 960.00 |
| Warehouse 2 | 2025-06 | 66 | 272.70 | 701.52 | 960.00 |
| Warehouse 2 | 2025-07 | 67 | 269.27 | 701.52 | 960.00 |
| Warehouse 2 | 2025-08 | 68 | 265.81 | 701.52 | 960.00 |
| Warehouse 2 | 2025-09 | 69 | 262.34 | 701.52 | 960.00 |
| Warehouse 2 | 2025-10 | 70 | 258.85 | 701.52 | 960.00 |
| Warehouse 2 | 2025-11 | 71 | 255.35 | 701.52 | 960.00 |
| Warehouse 2 | 2025-12 | 72 | 251.82 | 701.52 | 960.00 |
| Warehouse 2 | 2026-01 | 73 | 248.28 | 701.52 | 960.00 |
| Warehouse 2 | 2026-02 | 74 | 244.72 | 701.52 | 960.00 |
| Warehouse 2 | 2026-03 | 75 | 241.15 | 701.52 | 960.00 |
| Warehouse 2 | 2026-04 | 76 | 237.55 | 701.52 | 960.00 |
| Warehouse 2 | 2026-05 | 77 | 233.94 | 701.52 | 960.00 |
| Warehouse 2 | 2026-06 | 78 | 230.31 | 701.52 | 960.00 |
| Warehouse 2 | 2026-07 | 79 | 226.66 | 701.52 | 960.00 |
| Warehouse 2 | 2026-08 | 80 | 223.00 | 701.52 | 960.00 |
| Warehouse 2 | 2026-09 | 81 | 219.31 | 701.52 | 960.00 |

## Catch-up corrections (prepared 2026-10-12)

Locked months were not reopened. The 187 missed lease-months are booked once, in October 2026:

- `month_end_catch_up_batches`: one batch per lease (status `prepared` or `posted`, posting date 2026-10-31, type `month_end_catch_up`, description "Catch-up for missed month-end postings <first>-<last> (system error: schedule truncated at 1,000 rows)").
- `month_end_catch_up_lines`: one line per lease, missed month and component (interest, amortization, payment), copied from the stored schedule row. Total 557 lines.
- Prepared by `internal.prepare_month_end_catch_up` (audit entry "Catch-up prepared").
- Posted by the trigger `post_month_end_catch_up` when the October 2026 month-end document is posted. It writes one balanced `transactions` group per lease and component (references `ME-CU-...-2026-10-<id8>`), links the batches to the document and writes "Catch-up posted". Reopening October returns the batches to `prepared`.
- Shown under Month-End documents (a "Catch-up corrections" section, also before the October document exists) and in the month-end process window for October 2026.

Totals: Interest 84,175.11; ROU amortization / operating cost 117,940.63; payments 181,350.00; debits = credits 383,465.74. Existing posted rows plus catch-up lines equal the schedule through 2026-09-30 for every lease and account (largest difference 0.00).

Reconciliation on 2026-10-12, MS Consulting: 187 `missing_posting` rows (plus 4 `posted_vs_journal` rows for Vehicle 14 2026-09) with prepared catch-up not counted; 0 rows when it is counted. Default organization: 0 rows both ways.

## Row limit (1,000 rows per request)

Every read that can return more than 1,000 rows uses `fetchAll` / `fetchAllIn` (`src/utils/fetchAll.ts`). They page with `.range()`, need a stable order ending in `id`, and throw on an error, an oversized page, or a total that differs from an exact count. The backup function (`export-backup`) pages each table the same way and fails the whole export if any read fails. Server-side functions that return many rows (`get_filtered_transactions`) page on the server; the remaining list functions return one row per lease or per issue.
