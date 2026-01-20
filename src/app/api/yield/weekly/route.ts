import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getBucketConfigs } from '@/lib/queries';

interface DailyYieldRow {
  date: string;
  product_name: string;
  product_class: string;
  yield_qty: number;
}

interface YieldTarget {
  bucket_name: string;
  monthly_plan_target: number | null;
  monthly_plan_rate: number | null;
}

// GET - Fetch weekly yield data with MOP targets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let endDate = searchParams.get('end_date');

    const startTime = performance.now();

    // If no end_date provided, get the most recent date with data
    if (!endDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const latestStmt = db.prepare(`
        SELECT MAX(date) as latest_date
        FROM yield_data
        WHERE date <= ?
      `);
      const latestResult = latestStmt.get(yesterdayStr) as { latest_date: string | null };
      endDate = latestResult.latest_date || yesterdayStr;
    }

    // Cap at yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (endDate > yesterdayStr) {
      endDate = yesterdayStr;
    }

    // Calculate start date (7 days including end date)
    const endDateObj = new Date(endDate);
    const startDateObj = new Date(endDateObj);
    startDateObj.setDate(startDateObj.getDate() - 6);
    const startDate = startDateObj.toISOString().split('T')[0];

    // Generate all 7 dates in the range
    const dates: string[] = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDateObj) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Determine which month to use for MOP targets (use end_date's month)
    const targetMonth = endDate.substring(0, 7);

    // Fetch yield data for the 7-day range
    const yieldStmt = db.prepare(`
      SELECT date, product_name, product_class, COALESCE(yield_qty, 0) as yield_qty
      FROM yield_data
      WHERE date BETWEEN ? AND ?
      ORDER BY date, product_name
    `);
    const yieldData = yieldStmt.all(startDate, endDate) as DailyYieldRow[];

    // Fetch MOP targets for the target month
    const targetsStmt = db.prepare(`
      SELECT bucket_name, monthly_plan_target, monthly_plan_rate
      FROM yield_targets
      WHERE month = ?
    `);
    const targets = targetsStmt.all(targetMonth) as YieldTarget[];
    const targetMap = new Map(targets.map(t => [t.bucket_name, t]));

    // Get bucket configurations
    const buckets = getBucketConfigs('yield');

    // Group yield data by date
    const byDate: Record<string, Record<string, number>> = {};
    const byDateClass: Record<string, { F: number; P: number }> = {};

    for (const date of dates) {
      byDate[date] = {};
      byDateClass[date] = { F: 0, P: 0 };
    }

    yieldData.forEach(row => {
      if (!byDate[row.date]) return; // Skip if outside our date range
      byDate[row.date][row.product_name] = row.yield_qty;

      const classCode = row.product_class as 'F' | 'P';
      if (classCode && byDateClass[row.date]) {
        byDateClass[row.date][classCode] += row.yield_qty;
      }
    });

    // Calculate daily crude rate (absolute value of feedstock)
    const dailyCrudeRates: Record<string, number> = {};
    dates.forEach(date => {
      dailyCrudeRates[date] = Math.abs(byDateClass[date]?.F || 0);
    });

    // Build bucket data with daily values
    const bucketsResult: Record<string, {
      daily_pct: (number | null)[];
      daily_rate: (number | null)[];
      target_pct: number | null;
      target_rate: number | null;
    }> = {};

    for (const bucket of buckets) {
      if (bucket.display_order >= 99) continue; // Skip hidden buckets

      const dailyPct: (number | null)[] = [];
      const dailyRate: (number | null)[] = [];

      const specialComponents = bucket.component_products.filter(p => p.startsWith('__'));
      const regularComponents = bucket.component_products.filter(p => !p.startsWith('__'));

      for (const date of dates) {
        const products = byDate[date];
        const classData = byDateClass[date];
        const crudeRate = dailyCrudeRates[date];

        let bucketYield = 0;
        let hasData = crudeRate > 0;

        // Handle __CLASS:F (Crude Rate)
        if (specialComponents.some(p => p === '__CLASS:F')) {
          bucketYield = Math.abs(classData.F);
        }
        // Handle __CLASS:P (Non-Crude Total)
        else if (specialComponents.some(p => p === '__CLASS:P')) {
          bucketYield = classData.P;
        }
        // Handle __CALC:LOSS
        else if (specialComponents.some(p => p === '__CALC:LOSS')) {
          bucketYield = Math.abs(classData.F) - classData.P;
        }
        // Regular bucket - sum component products
        else if (regularComponents.length > 0) {
          bucketYield = regularComponents.reduce((sum, prod) => sum + (products[prod] || 0), 0);
        }

        if (hasData) {
          // Calculate yield percentage
          let pct: number;
          if (specialComponents.some(p => p === '__CLASS:F')) {
            pct = 100; // Crude Rate is always 100%
          } else {
            pct = crudeRate !== 0 ? (bucketYield / crudeRate) * 100 : 0;
          }
          dailyPct.push(pct);
          dailyRate.push(bucketYield);
        } else {
          dailyPct.push(null);
          dailyRate.push(null);
        }
      }

      // Get target for this bucket
      const target = targetMap.get(bucket.bucket_name);

      bucketsResult[bucket.bucket_name] = {
        daily_pct: dailyPct,
        daily_rate: dailyRate,
        target_pct: target?.monthly_plan_target ?? null,
        target_rate: target?.monthly_plan_rate ?? null,
      };
    }

    // Also include crude rate data
    bucketsResult['Crude Rate'] = bucketsResult['Crude Rate'] || {
      daily_pct: dates.map(() => 100),
      daily_rate: dates.map(d => dailyCrudeRates[d] || null),
      target_pct: targetMap.get('Crude Rate')?.monthly_plan_target ?? null,
      target_rate: targetMap.get('Crude Rate')?.monthly_plan_rate ?? null,
    };

    const endTime = performance.now();

    return NextResponse.json({
      data: {
        dates,
        buckets: bucketsResult,
      },
      meta: {
        start_date: startDate,
        end_date: endDate,
        month: targetMonth,
        query_time_ms: Math.round(endTime - startTime),
      },
    });
  } catch (error) {
    console.error('Error fetching weekly yield data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly yield data' },
      { status: 500 }
    );
  }
}
