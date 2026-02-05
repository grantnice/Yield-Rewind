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
  month: string;
}

interface MonthlyPeriod {
  month: string;
  period_number: number;
  start_day: number;
  end_day: number;
}

interface PeriodTarget {
  bucket_name: string;
  month: string;
  period_number: number;
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

    // Determine which months are covered by the date range
    const startMonth = startDate.substring(0, 7);
    const endMonth = endDate.substring(0, 7);
    const uniqueMonths = Array.from(new Set([startMonth, endMonth]));

    // Fetch yield data for the 7-day range
    const yieldStmt = db.prepare(`
      SELECT date, product_name, product_class, COALESCE(yield_qty, 0) as yield_qty
      FROM yield_data
      WHERE date BETWEEN ? AND ?
      ORDER BY date, product_name
    `);
    const yieldData = yieldStmt.all(startDate, endDate) as DailyYieldRow[];

    // Fetch MOP targets for all months in the range (month-level fallback)
    const targetsStmt = db.prepare(`
      SELECT bucket_name, monthly_plan_target, monthly_plan_rate, month
      FROM yield_targets
      WHERE month IN (${uniqueMonths.map(() => '?').join(', ')})
    `);
    const targets = targetsStmt.all(...uniqueMonths) as YieldTarget[];

    // Fetch monthly periods for all months in range
    const periodsStmt = db.prepare(`
      SELECT month, period_number, start_day, end_day
      FROM monthly_periods
      WHERE month IN (${uniqueMonths.map(() => '?').join(', ')})
      ORDER BY month, period_number
    `);
    const periods = periodsStmt.all(...uniqueMonths) as MonthlyPeriod[];

    // Fetch period-level targets for all months in range
    const periodTargetsStmt = db.prepare(`
      SELECT bucket_name, month, period_number, monthly_plan_target, monthly_plan_rate
      FROM period_targets
      WHERE month IN (${uniqueMonths.map(() => '?').join(', ')})
    `);
    const periodTargets = periodTargetsStmt.all(...uniqueMonths) as PeriodTarget[];

    // Group periods by month
    const periodsByMonth: Record<string, MonthlyPeriod[]> = {};
    for (const month of uniqueMonths) {
      periodsByMonth[month] = [];
    }
    for (const p of periods) {
      periodsByMonth[p.month]?.push(p);
    }

    // Group period targets by month+period
    const periodTargetsByKey: Record<string, Map<string, PeriodTarget>> = {};
    for (const pt of periodTargets) {
      const key = `${pt.month}-P${pt.period_number}`;
      if (!periodTargetsByKey[key]) {
        periodTargetsByKey[key] = new Map();
      }
      periodTargetsByKey[key].set(pt.bucket_name, pt);
    }

    // Group targets by month (fallback when no periods defined)
    const targetsByMonth: Record<string, Map<string, YieldTarget>> = {};
    for (const month of uniqueMonths) {
      targetsByMonth[month] = new Map();
    }
    for (const t of targets) {
      targetsByMonth[t.month]?.set(t.bucket_name, t);
    }

    // For backward compatibility, use end month as primary
    const targetMap = targetsByMonth[endMonth] || new Map();

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

    // Helper to format date from month and day
    const formatPeriodDate = (month: string, day: number): string => {
      const paddedDay = day.toString().padStart(2, '0');
      return `${month}-${paddedDay}`;
    };

    // Build targets by period for multi-period support
    // Key format: "YYYY-MM-P1" for period 1 of a month, or "YYYY-MM" for months without periods
    const targetsByPeriod: Record<string, {
      startDate: string;
      endDate: string;
      buckets: Record<string, { target_pct: number | null; target_rate: number | null }>;
    }> = {};

    for (const month of uniqueMonths) {
      const monthPeriods = periodsByMonth[month];
      const monthTargets = targetsByMonth[month];

      if (monthPeriods && monthPeriods.length > 0) {
        // Month has defined periods - create entry for each period
        for (const period of monthPeriods) {
          const key = `${month}-P${period.period_number}`;
          const periodTargetMap = periodTargetsByKey[key];

          targetsByPeriod[key] = {
            startDate: formatPeriodDate(month, period.start_day),
            endDate: formatPeriodDate(month, period.end_day),
            buckets: {},
          };

          // Add bucket targets for this period
          for (const bucket of buckets) {
            const periodTarget = periodTargetMap?.get(bucket.bucket_name);
            // Fall back to month-level target if no period-level target
            const monthTarget = monthTargets?.get(bucket.bucket_name);
            targetsByPeriod[key].buckets[bucket.bucket_name] = {
              target_pct: periodTarget?.monthly_plan_target ?? monthTarget?.monthly_plan_target ?? null,
              target_rate: periodTarget?.monthly_plan_rate ?? monthTarget?.monthly_plan_rate ?? null,
            };
          }
          // Include Crude Rate
          const periodCrudeTarget = periodTargetMap?.get('Crude Rate');
          const monthCrudeTarget = monthTargets?.get('Crude Rate');
          targetsByPeriod[key].buckets['Crude Rate'] = {
            target_pct: periodCrudeTarget?.monthly_plan_target ?? monthCrudeTarget?.monthly_plan_target ?? null,
            target_rate: periodCrudeTarget?.monthly_plan_rate ?? monthCrudeTarget?.monthly_plan_rate ?? null,
          };
        }
      } else {
        // No periods defined - use month-level targets spanning entire month
        const [year, monthNum] = month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNum, 0).getDate();

        targetsByPeriod[month] = {
          startDate: formatPeriodDate(month, 1),
          endDate: formatPeriodDate(month, daysInMonth),
          buckets: {},
        };

        for (const bucket of buckets) {
          const target = monthTargets?.get(bucket.bucket_name);
          targetsByPeriod[month].buckets[bucket.bucket_name] = {
            target_pct: target?.monthly_plan_target ?? null,
            target_rate: target?.monthly_plan_rate ?? null,
          };
        }
        // Include Crude Rate
        const crudeTarget = monthTargets?.get('Crude Rate');
        targetsByPeriod[month].buckets['Crude Rate'] = {
          target_pct: crudeTarget?.monthly_plan_target ?? null,
          target_rate: crudeTarget?.monthly_plan_rate ?? null,
        };
      }
    }

    return NextResponse.json({
      data: {
        dates,
        buckets: bucketsResult,
        targetsByPeriod, // New: targets grouped by month
      },
      meta: {
        start_date: startDate,
        end_date: endDate,
        months: uniqueMonths, // Changed from single month to array
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
