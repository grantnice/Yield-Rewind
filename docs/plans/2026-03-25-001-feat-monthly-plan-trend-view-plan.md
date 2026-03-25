---
title: Monthly Plan Trend View — Actuals vs MOP vs BP Over Time
type: feat
status: active
date: 2026-03-25
---

# Monthly Plan Trend View — Actuals vs MOP vs BP Over Time

## Overview

Add a **Trend View toggle** to the Monthly Yield page (`/monthly-yield`) that switches from the current single-month snapshot table to a multi-month line chart. The chart shows historical monthly actuals, MOP (Monthly Operating Plan), and BP (Business Plan) for each product bucket — enabling planners to assess plan quality over time and feed back insights to the LP modeller and human planning inputs.

## Problem Statement / Motivation

The monthly yield page today shows a snapshot of one month at a time. There is no way to see how closely the refinery has tracked its plans over a rolling horizon — how often we beat MOP, miss BP, and where variance concentrates. Providing this longitudinal view serves two audiences:

1. **Operations reviewers** — assessing planning performance at end-of-month or in leadership reviews.
2. **LP modellers & planners** — identifying systematic bias (e.g., jet yield consistently planned high) to improve future plan inputs.

Variance decomposition (planning skill vs uncontrollable upsets) is explicitly **deferred** to a future phase.

## Proposed Solution

A two-button view toggle ("Table" / "Trend") in the existing page header action bar. Clicking **Trend** renders a `<TimeSeriesChart>` (the existing ECharts wrapper) fed by:

- **Actuals** — monthly average BBL/day per bucket, aggregated from `yield_data`
- **MOP** — `monthly_plan_target` / `monthly_plan_rate` from `yield_targets`
- **BP** — `business_plan_target` / `business_plan_rate` from `yield_targets`

All values displayed as **yield % of crude rate** for non-crude buckets (consistent with the existing table). Crude Rate itself is displayed in absolute BBL/day.

The user can select which bucket(s) to show and the rolling time window (6 / 12 / 24 months). Clicking **Table** returns to the previously-selected month — `selectedMonth` state is preserved.

## Technical Approach

### Architecture

No new charting library. No new state management library. Follows the `showSPC` boolean toggle pattern already used on `src/app/yield/page.tsx`.

**Key architectural decisions:**
- Single new API endpoint (`GET /api/yield/monthly-summary`) rather than N parallel `/api/yield/mtd` calls. Rationale: 24 sequential round-trips would be slow; the bucket aggregation logic should live in the server.
- Yield % computed server-side in the new endpoint (reusing bucket aggregation logic) so the frontend only receives ready-to-plot series values.
- `selectedMonth` is not reset on view toggle — table resumes at the same month.

### Files to touch

| File | Change |
|---|---|
| `src/app/monthly-yield/page.tsx` | Add `view` state (`'table' \| 'trend'`), view toggle buttons, `<MonthlyTrendChart>` conditional render, bucket selector, time range selector |
| `src/app/api/yield/monthly/route.ts` | **New.** Returns monthly-aggregated actuals per bucket as yield % (and raw BBL/day for Crude Rate) over a date range |
| `src/lib/queries.ts` | Add `getMonthlyYieldSummary(startMonth, endMonth)` — aggregates `yield_data` by calendar month, applies bucket config logic |
| `src/components/charts/monthly-trend-chart.tsx` | **New.** Thin wrapper around `<TimeSeriesChart>` with domain-specific defaults for this view (series colors, legend, formatter) |

### New API endpoint: `GET /api/yield/monthly`

**Query params:** `start` (YYYY-MM), `end` (YYYY-MM), `buckets` (comma-separated bucket names, optional — defaults to all)

**Response shape:**
```typescript
{
  months: string[]  // ["2025-04", "2025-05", ..., "2026-03"]
  buckets: {
    [bucketName: string]: {
      actuals:  (number | null)[]   // yield % per month (or BBL/day for crude)
      mop:      (number | null)[]   // monthly_plan_target per month
      bp:       (number | null)[]   // business_plan_target per month
    }
  }
}
```

Missing months return `null` for all three series (renders as a gap in ECharts — `connectNulls: false`).

**SQL pattern for actuals aggregation:**
```sql
-- Step 1: monthly raw totals from yield_data
SELECT
  strftime('%Y-%m', date) AS month,
  product_name,
  product_class,
  SUM(yield_qty) / COUNT(DISTINCT date) AS daily_avg
FROM yield_data
WHERE date >= :startDate AND date <= :endDate
GROUP BY month, product_name

-- Step 2: apply bucket_config aggregation rules in TypeScript
-- (reuse existing getBucketConfigs() + aggregation logic from /api/yield/mtd)
-- Step 3: compute yield % = bucket_daily_avg / crude_rate_daily_avg * 100
```

**SQL for targets:**
```sql
SELECT bucket_name, month, monthly_plan_target, monthly_plan_rate,
       business_plan_target, business_plan_rate
FROM yield_targets
WHERE month BETWEEN :startMonth AND :endMonth
ORDER BY bucket_name, month
```

### Loss bucket target handling

Loss has no explicit `yield_targets` rows (it is computed as crude minus all products). For the trend chart, the MOP and BP lines for Loss will be **derived server-side**:
- `loss_mop = crude_mop_rate - sum(product_mop_rates)`
- `loss_bp  = crude_bp_rate  - sum(product_bp_rates)`

> ⚠️ Verify with a database query before implementation: `SELECT DISTINCT bucket_name FROM yield_targets ORDER BY 1` — confirm whether "Loss" rows exist or not.

### Chart rendering details

Feed `<TimeSeriesChart>` with month strings as the `date` field (xAxisField stays default or set to `"month"`). Each bucket produces up to 3 series keys:

```
{bucketName}_actual   → solid line, bucket's standard color
{bucketName}_mop      → dashed line, same hue, lighter
{bucketName}_bp       → dotted line, same hue, even lighter
```

When multiple buckets are selected simultaneously, use `autoFitKeys` so each bucket gets its own invisible independent scale — otherwise Crude Rate (800+ BBL/day) drowns out yield % values (10–60%).

**Current-month partial data:** Actuals line terminates at the last date with data (yesterday). MOP/BP lines for the current month render in reduced opacity (0.4) to signal "target, not actuals." Implement via a custom `markArea` on the current month column, or by splitting the series into solid (past) and dashed (current-month plan extension).

### View toggle state management

```typescript
const [view, setView] = useState<'table' | 'trend'>('table')
const [selectedMonth, setSelectedMonth] = useState(currentMonth)  // preserved across views
const [trendMonths, setTrendMonths] = useState<6 | 12 | 24>(12)
const [trendBuckets, setTrendBuckets] = useState<string[]>(['Crude Rate'])  // default: Crude Rate only
```

When toggling back to Table, `selectedMonth` is unchanged — the table renders the same month the user left.

## System-Wide Impact

**Interaction graph:** New endpoint reads `yield_data` + `yield_targets` + `bucket_config` — same tables the MTD endpoint reads. No writes. No callbacks or observers triggered.

**Error propagation:** Missing months (no `yield_targets` rows) return null values rather than errors — the chart renders gaps. API errors fall through to TanStack Query's error state, rendered as an inline error card.

**State lifecycle risks:** None. This is a read-only view. No mutations, no optimistic updates.

**API surface parity:** The new `/api/yield/monthly` endpoint is read-only and additive. No existing endpoints are modified. The targets GET route (`/api/targets`) remains single-month only.

**Integration test scenarios:**
1. A month with actuals data but no `yield_targets` rows → actuals line shows, MOP/BP lines are null/gapped.
2. A time window spanning a year boundary (Dec 2025 → Jan 2026) → no grouping artifacts in SQL `strftime` result.
3. Current month in window → actuals end at yesterday; plan lines extend with reduced opacity.
4. Loss bucket selected → MOP/BP lines derived correctly from crude minus product targets.
5. Bucket with `__CALC:LOSS` sentinel → aggregation logic handles it without throwing.

## Acceptance Criteria

- [ ] A "Table / Trend" two-button toggle appears in the Monthly Yield page header, styled consistently with the page's existing button strip (amber active state)
- [ ] Toggling to Trend renders a line chart showing actuals, MOP, and BP for the selected bucket(s) over the selected time range
- [ ] Default state on first open: Crude Rate bucket selected, 12-month window
- [ ] Bucket selector allows single or multi-select from all configured yield buckets
- [ ] Time range selector offers 6 / 12 / 24 months
- [ ] Yield % is used as the Y-axis unit for non-crude buckets; BBL/day for Crude Rate
- [ ] Multiple buckets selected simultaneously use independent scales (no scale collision)
- [ ] Current in-progress month's plan lines render with reduced opacity or dashed style
- [ ] Toggling back to Table View returns to the same `selectedMonth` the user had before switching
- [ ] Missing MOP/BP targets for a month render as a gap (null) in the line, not an error
- [ ] Loss bucket MOP/BP lines are derived (crude minus products), not read from `yield_targets`
- [ ] The existing Download/Screenshot toolbar buttons are hidden in Trend View; ECharts Save as Image is sufficient
- [ ] The existing period tabs and month navigation buttons are hidden in Trend View (they are irrelevant to the multi-month chart)
- [ ] TanStack Query loading and error states are handled gracefully (spinner on load, error card on failure)
- [ ] No new npm dependencies required

## Dependencies & Risks

**Risk 1 — Loss bucket targets not stored:** If `yield_targets` has no rows for "Loss," the MOP/BP derivation logic must be implemented server-side. Verify first.

**Risk 2 — Sparse historical MOP data:** Users may not have entered MOP targets for months > 6 months ago. Plan lines will show gaps. This is expected behavior, not a bug — document it in a tooltip or legend note.

**Risk 3 — Scale collision on multi-bucket view:** Crude Rate absolute values vs yield % values cannot share a Y-axis. The `autoFitKeys` pattern in `TimeSeriesChart` handles this but is untested at 11 buckets simultaneously. May need to cap the max simultaneous buckets or disable Crude Rate when other buckets are shown (or vice versa).

**Risk 4 — Bucket aggregation logic duplication:** The bucket aggregation (handling `__CLASS:F`, `__CLASS:P`, `__CALC:LOSS`, etc.) currently lives in the `/api/yield/mtd` route handler. For the new endpoint, this logic should be extracted to `src/lib/queries.ts` as a reusable function rather than copy-pasted.

## Sources & References

### Internal References

- Monthly yield page: `src/app/monthly-yield/page.tsx`
- Existing MTD actuals aggregation: `src/app/api/yield/mtd/route.ts`
- Targets API (single-month): `src/app/api/targets/route.ts`
- Shared chart component: `src/components/charts/time-series-chart.tsx`
- Bucket config fetching: `src/lib/queries.ts` → `getBucketConfigs()`
- Yield trend page (reference for toggle patterns): `src/app/yield/page.tsx`
- SPC toggle pattern (showSPC boolean): `src/app/yield/page.tsx`

### Related Work

- `feat: Add historian trend page with PI Web API integration and data caching` (commit `8b8889e`) — adjacent trend page implementation
- `feat: Add SPC charts, audit system, full MTD refresh, and y-axis controls` (commit `6bec2bb`) — SPC toggle pattern reference
