import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getBucketConfigs } from '@/lib/queries';

interface BucketMTD {
  bucket_name: string;
  display_order: number;
  mtd_daily_avg: number;
  is_virtual: boolean;
}

interface MonthlyPeriod {
  id: number;
  month: string;
  period_number: number;
  start_day: number;
  end_day: number;
}

interface PeriodTarget {
  bucket_name: string;
  period_number: number;
  monthly_plan_target: number | null;
  monthly_plan_rate: number | null;
  business_plan_target: number | null;
  business_plan_rate: number | null;
}

// Calculate blended target based on day-weighted average
function calculateBlendedTarget(
  periods: MonthlyPeriod[],
  targets: PeriodTarget[],
  daysElapsed: number,
  bucketName: string
): { monthly_plan_target: number | null; monthly_plan_rate: number | null; business_plan_target: number | null; business_plan_rate: number | null } {
  let weightedPlanTarget = 0;
  let weightedPlanRate = 0;
  let weightedBpTarget = 0;
  let weightedBpRate = 0;
  let totalDays = 0;
  let hasPlanTarget = false;
  let hasPlanRate = false;
  let hasBpTarget = false;
  let hasBpRate = false;

  for (const period of periods) {
    const periodStart = period.start_day;
    const periodEnd = Math.min(period.end_day, daysElapsed);

    if (periodStart > daysElapsed) break; // Haven't reached this period yet

    const daysInPeriod = periodEnd - periodStart + 1;
    if (daysInPeriod <= 0) continue;

    const periodTarget = targets.find(
      (t) => t.period_number === period.period_number && t.bucket_name === bucketName
    );

    if (periodTarget) {
      if (periodTarget.monthly_plan_target !== null) {
        weightedPlanTarget += daysInPeriod * periodTarget.monthly_plan_target;
        hasPlanTarget = true;
      }
      if (periodTarget.monthly_plan_rate !== null) {
        weightedPlanRate += daysInPeriod * periodTarget.monthly_plan_rate;
        hasPlanRate = true;
      }
      if (periodTarget.business_plan_target !== null) {
        weightedBpTarget += daysInPeriod * periodTarget.business_plan_target;
        hasBpTarget = true;
      }
      if (periodTarget.business_plan_rate !== null) {
        weightedBpRate += daysInPeriod * periodTarget.business_plan_rate;
        hasBpRate = true;
      }
    }
    totalDays += daysInPeriod;
  }

  return {
    monthly_plan_target: hasPlanTarget && totalDays > 0 ? weightedPlanTarget / totalDays : null,
    monthly_plan_rate: hasPlanRate && totalDays > 0 ? weightedPlanRate / totalDays : null,
    business_plan_target: hasBpTarget && totalDays > 0 ? weightedBpTarget / totalDays : null,
    business_plan_rate: hasBpRate && totalDays > 0 ? weightedBpRate / totalDays : null,
  };
}

// GET - Fetch MTD yield data aggregated by bucket (daily averages)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // Format: YYYY-MM
    const periodParam = searchParams.get('period'); // Optional: 1, 2, or 3

    if (!month) {
      return NextResponse.json(
        { error: 'month parameter is required (format: YYYY-MM)' },
        { status: 400 }
      );
    }

    const startTime = performance.now();

    // Parse month to get date range
    const [year, monthNum] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNum, 0).getDate();

    // Fetch periods configuration for this month
    const periodsStmt = db.prepare(`
      SELECT id, month, period_number, start_day, end_day
      FROM monthly_periods
      WHERE month = ?
      ORDER BY period_number
    `);
    const periods = periodsStmt.all(month) as MonthlyPeriod[];
    const hasPeriods = periods.length > 0;

    // Fetch period targets if periods exist
    let periodTargets: PeriodTarget[] = [];
    if (hasPeriods) {
      const targetsStmt = db.prepare(`
        SELECT bucket_name, period_number, monthly_plan_target, monthly_plan_rate, business_plan_target, business_plan_rate
        FROM period_targets
        WHERE month = ?
      `);
      periodTargets = targetsStmt.all(month) as PeriodTarget[];
    }

    // Determine date range based on period parameter
    let startDate: string;
    let endDate: string;
    let selectedPeriod: MonthlyPeriod | null = null;

    if (periodParam && hasPeriods) {
      const periodNum = parseInt(periodParam, 10);
      selectedPeriod = periods.find((p) => p.period_number === periodNum) || null;

      if (!selectedPeriod) {
        return NextResponse.json(
          { error: `Period ${periodNum} does not exist for month ${month}` },
          { status: 400 }
        );
      }

      startDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(selectedPeriod.start_day).padStart(2, '0')}`;
      endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(selectedPeriod.end_day).padStart(2, '0')}`;
    } else {
      // Full month
      startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    // Cap at yesterday for current/future dates
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (endDate > yesterdayStr) {
      endDate = yesterdayStr;
    }

    // Calculate days elapsed for blended target calculation
    const endDateObj = new Date(endDate);
    const daysElapsed = endDateObj.getDate();

    // Count distinct days with data for averaging
    const daysStmt = db.prepare(`
      SELECT COUNT(DISTINCT date) as day_count
      FROM yield_data
      WHERE date BETWEEN ? AND ?
    `);
    const daysResult = daysStmt.get(startDate, endDate) as { day_count: number };
    const dayCount = daysResult.day_count || 1; // Avoid division by zero

    // Get bucket configurations
    const buckets = getBucketConfigs('yield');

    // Calculate MTD daily average for each bucket
    const results: BucketMTD[] = [];
    let crudeRateTotal = 0;
    let nonCrudeTotal = 0;

    for (const bucket of buckets) {
      let mtdTotal = 0;

      // Handle special component syntax
      const specialComponents = bucket.component_products.filter(p => p.startsWith('__'));
      const regularComponents = bucket.component_products.filter(p => !p.startsWith('__'));

      // Handle __CLASS:F (Feedstock/Crude)
      if (specialComponents.some(p => p === '__CLASS:F')) {
        const stmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ?
            AND product_class = 'F'
        `);
        const result = stmt.get(startDate, endDate) as { total: number };
        mtdTotal += result.total;
        crudeRateTotal = result.total;
      }

      // Handle __CLASS:P (Products/Non-Crude)
      if (specialComponents.some(p => p === '__CLASS:P')) {
        const stmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ?
            AND product_class = 'P'
        `);
        const result = stmt.get(startDate, endDate) as { total: number };
        mtdTotal += result.total;
        nonCrudeTotal = result.total;
      }

      // Handle __CALC:LOSS - will calculate after all other buckets
      if (specialComponents.some(p => p === '__CALC:LOSS')) {
        // Mark for later calculation
        results.push({
          bucket_name: bucket.bucket_name,
          display_order: bucket.display_order,
          mtd_daily_avg: 0, // Will be calculated
          is_virtual: bucket.is_virtual,
        });
        continue;
      }

      // Handle regular product components
      if (regularComponents.length > 0) {
        const placeholders = regularComponents.map(() => '?').join(',');
        const stmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ?
            AND product_name IN (${placeholders})
        `);
        const result = stmt.get(startDate, endDate, ...regularComponents) as { total: number };
        mtdTotal += result.total;
      }

      // Calculate daily average
      const dailyAvg = mtdTotal / dayCount;

      results.push({
        bucket_name: bucket.bucket_name,
        display_order: bucket.display_order,
        mtd_daily_avg: dailyAvg,
        is_virtual: bucket.is_virtual,
      });
    }

    // Calculate Loss daily average: |Crude Rate| - Non-Crude Total
    // Crude is typically stored as negative (feedstock IN), products as positive (output)
    const lossIdx = results.findIndex(r => r.bucket_name === 'Loss');
    if (lossIdx >= 0) {
      results[lossIdx].mtd_daily_avg = (Math.abs(crudeRateTotal) - nonCrudeTotal) / dayCount;
    }

    // Calculate crude rate daily average for percentage calculations (use absolute value)
    const crudeRateDailyAvg = Math.abs(crudeRateTotal) / dayCount;

    // Sort by display_order and filter out hidden buckets (display_order >= 99)
    const sortedResults = results
      .filter(r => r.display_order < 99)
      .sort((a, b) => a.display_order - b.display_order);

    // Calculate blended targets for each bucket if periods exist
    interface BucketWithTargets extends BucketMTD {
      blended_monthly_plan_target?: number | null;
      blended_monthly_plan_rate?: number | null;
      blended_business_plan_target?: number | null;
      blended_business_plan_rate?: number | null;
      period_monthly_plan_target?: number | null;
      period_monthly_plan_rate?: number | null;
      period_business_plan_target?: number | null;
      period_business_plan_rate?: number | null;
    }

    const resultsWithTargets: BucketWithTargets[] = sortedResults.map((bucket) => {
      const result: BucketWithTargets = { ...bucket };

      if (hasPeriods && periodTargets.length > 0) {
        if (selectedPeriod) {
          // Return the specific period's target
          const periodTarget = periodTargets.find(
            (t) => t.period_number === selectedPeriod!.period_number && t.bucket_name === bucket.bucket_name
          );
          if (periodTarget) {
            result.period_monthly_plan_target = periodTarget.monthly_plan_target;
            result.period_monthly_plan_rate = periodTarget.monthly_plan_rate;
            result.period_business_plan_target = periodTarget.business_plan_target;
            result.period_business_plan_rate = periodTarget.business_plan_rate;
          }
        } else {
          // Calculate blended target for full month view
          const blended = calculateBlendedTarget(periods, periodTargets, daysElapsed, bucket.bucket_name);
          result.blended_monthly_plan_target = blended.monthly_plan_target;
          result.blended_monthly_plan_rate = blended.monthly_plan_rate;
          result.blended_business_plan_target = blended.business_plan_target;
          result.blended_business_plan_rate = blended.business_plan_rate;
        }
      }

      return result;
    });

    const endTime = performance.now();

    return NextResponse.json({
      data: resultsWithTargets,
      meta: {
        month,
        start_date: startDate,
        end_date: endDate,
        day_count: dayCount,
        days_elapsed: daysElapsed,
        crude_rate_daily_avg: crudeRateDailyAvg,
        query_time_ms: Math.round(endTime - startTime),
        has_periods: hasPeriods,
        periods: hasPeriods ? periods.map((p) => ({
          period_number: p.period_number,
          start_day: p.start_day,
          end_day: p.end_day,
        })) : [],
        selected_period: selectedPeriod ? selectedPeriod.period_number : null,
      },
    });
  } catch (error) {
    console.error('Error fetching MTD yield data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch MTD yield data' },
      { status: 500 }
    );
  }
}
