import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getBucketConfigs } from '@/lib/queries';

// Buckets that report in absolute BBL/day rather than yield %
const FEEDSTOCK_BUCKETS = new Set(['Crude Rate', 'UMO VGO']);

/** Return list of YYYY-MM strings between start and end inclusive. */
function getMonthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [sy, sm] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

/**
 * GET /api/yield/monthly?start=YYYY-MM&end=YYYY-MM
 *
 * Returns monthly-aggregated actuals (yield % for products, BBL/day for feedstocks)
 * alongside MOP and BP targets for each configured yield bucket.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start'); // YYYY-MM
    const end = searchParams.get('end');     // YYYY-MM

    if (!start || !end) {
      return NextResponse.json(
        { error: 'start and end query params are required (format: YYYY-MM)' },
        { status: 400 }
      );
    }

    const startDate = `${start}-01`;

    // Cap end date at yesterday (current month only has MTD actuals)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const [ey, em] = end.split('-').map(Number);
    const lastDayOfEnd = new Date(ey, em, 0).getDate();
    const rawEndDate = `${end}-${String(lastDayOfEnd).padStart(2, '0')}`;
    const endDate = rawEndDate > yesterdayStr ? yesterdayStr : rawEndDate;

    const months = getMonthRange(start, end);

    // ── 1. Distinct day count per month ──────────────────────────────────
    const dayCountRows = db.prepare(`
      SELECT strftime('%Y-%m', date) AS month, COUNT(DISTINCT date) AS day_count
      FROM yield_data
      WHERE date >= ? AND date <= ?
      GROUP BY strftime('%Y-%m', date)
    `).all(startDate, endDate) as { month: string; day_count: number }[];
    const dayCountMap = new Map(dayCountRows.map(r => [r.month, r.day_count]));

    // ── 2. CLASS-level totals per month (for __CLASS:F / __CALC:LOSS) ────
    const classRows = db.prepare(`
      SELECT
        strftime('%Y-%m', date) AS month,
        product_class,
        SUM(yield_qty) AS total_qty
      FROM yield_data
      WHERE date >= ? AND date <= ? AND product_class IN ('F', 'P')
      GROUP BY strftime('%Y-%m', date), product_class
    `).all(startDate, endDate) as { month: string; product_class: string; total_qty: number }[];
    const monthClassMap = new Map<string, { F: number; P: number }>();
    for (const r of classRows) {
      if (!monthClassMap.has(r.month)) monthClassMap.set(r.month, { F: 0, P: 0 });
      const entry = monthClassMap.get(r.month)!;
      if (r.product_class === 'F') entry.F = r.total_qty;
      else entry.P = r.total_qty;
    }

    // ── 3. Product-level totals per month (for regular bucket components) ─
    const productRows = db.prepare(`
      SELECT
        strftime('%Y-%m', date) AS month,
        product_name,
        SUM(yield_qty) AS total_qty
      FROM yield_data
      WHERE date >= ? AND date <= ?
      GROUP BY strftime('%Y-%m', date), product_name
    `).all(startDate, endDate) as { month: string; product_name: string; total_qty: number }[];
    const monthProductMap = new Map<string, Map<string, number>>();
    for (const r of productRows) {
      if (!monthProductMap.has(r.month)) monthProductMap.set(r.month, new Map());
      monthProductMap.get(r.month)!.set(r.product_name, r.total_qty);
    }

    // ── 4. Targets for the full date range ───────────────────────────────
    const targetRows = db.prepare(`
      SELECT bucket_name, month,
             monthly_plan_target, monthly_plan_rate,
             business_plan_target, business_plan_rate
      FROM yield_targets
      WHERE month >= ? AND month <= ?
    `).all(start, end) as {
      bucket_name: string;
      month: string;
      monthly_plan_target: number | null;
      monthly_plan_rate: number | null;
      business_plan_target: number | null;
      business_plan_rate: number | null;
    }[];
    // targetsMap: bucket_name → month → target row
    const targetsMap = new Map<string, Map<string, typeof targetRows[0]>>();
    for (const r of targetRows) {
      if (!targetsMap.has(r.bucket_name)) targetsMap.set(r.bucket_name, new Map());
      targetsMap.get(r.bucket_name)!.set(r.month, r);
    }

    // ── 5. Bucket configs ─────────────────────────────────────────────────
    const buckets = getBucketConfigs('yield').filter(b => b.display_order < 99);

    // ── 6. Per-month bucket daily averages (in raw BBL/day) ───────────────
    // month → bucket_name → daily avg in BBL/day (absolute value)
    const monthBucketAvg = new Map<string, Map<string, number | null>>();

    for (const month of months) {
      const dayCount = dayCountMap.get(month) || 0;
      const bucketAvgs = new Map<string, number | null>();
      monthBucketAvg.set(month, bucketAvgs);

      if (dayCount === 0) continue; // No data for this month

      const classData = monthClassMap.get(month);
      const productMap = monthProductMap.get(month);

      for (const bucket of buckets) {
        const specials = bucket.component_products.filter((p: string) => p.startsWith('__'));
        const regulars = bucket.component_products.filter((p: string) => !p.startsWith('__'));

        // __CALC:LOSS: defer until after all other buckets
        if (specials.some((p: string) => p === '__CALC:LOSS')) {
          bucketAvgs.set(bucket.bucket_name, null); // placeholder
          continue;
        }

        let total = 0;
        let hasData = false;

        if (specials.some((p: string) => p === '__CLASS:F') && classData) {
          total += classData.F;
          hasData = true;
        }
        if (specials.some((p: string) => p === '__CLASS:P') && classData) {
          total += classData.P;
          hasData = true;
        }
        if (regulars.length > 0 && productMap) {
          for (const comp of regulars) {
            const qty = productMap.get(comp);
            if (qty != null) { total += qty; hasData = true; }
          }
        }

        bucketAvgs.set(bucket.bucket_name, hasData ? Math.abs(total) / dayCount : null);
      }

      // Fill __CALC:LOSS: |Crude (F class)| - Non-Crude (P class)
      if (buckets.some(b => b.component_products.includes('__CALC:LOSS'))) {
        const crudeTotal = classData ? Math.abs(classData.F) : 0;
        const nonCrudeTotal = classData ? classData.P : 0;
        bucketAvgs.set('Loss', (crudeTotal - nonCrudeTotal) / dayCount);
      }
    }

    // ── 7. Build final response per bucket ────────────────────────────────
    const resultBuckets: Record<string, {
      actuals: (number | null)[];
      mop: (number | null)[];
      bp: (number | null)[];
    }> = {};

    for (const bucket of buckets) {
      const isFeedstock = FEEDSTOCK_BUCKETS.has(bucket.bucket_name);
      const isBaseOil = bucket.bucket_name === 'Base Oil';
      const actuals: (number | null)[] = [];
      const mop: (number | null)[] = [];
      const bp: (number | null)[] = [];

      for (const month of months) {
        const avgs = monthBucketAvg.get(month);
        const rawAvg = avgs?.get(bucket.bucket_name) ?? null;

        // Actuals
        if (rawAvg == null) {
          actuals.push(null);
        } else if (isFeedstock) {
          actuals.push(Math.round(rawAvg));
        } else if (isBaseOil) {
          const umoAvg = avgs?.get('UMO VGO') ?? null;
          actuals.push(umoAvg && umoAvg > 0
            ? parseFloat((rawAvg / umoAvg * 100).toFixed(2))
            : null
          );
        } else {
          const crudeAvg = avgs?.get('Crude Rate') ?? null;
          actuals.push(crudeAvg && crudeAvg > 0
            ? parseFloat((rawAvg / crudeAvg * 100).toFixed(2))
            : null
          );
        }

        // MOP and BP targets
        const t = targetsMap.get(bucket.bucket_name)?.get(month);
        if (t) {
          mop.push(isFeedstock ? t.monthly_plan_rate : t.monthly_plan_target);
          bp.push(isFeedstock ? t.business_plan_rate : t.business_plan_target);
        } else {
          mop.push(null);
          bp.push(null);
        }
      }

      resultBuckets[bucket.bucket_name] = { actuals, mop, bp };
    }

    return NextResponse.json({ months, buckets: resultBuckets });
  } catch (error) {
    console.error('Error fetching monthly yield summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch monthly yield summary' },
      { status: 500 }
    );
  }
}
