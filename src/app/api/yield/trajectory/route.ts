import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getBucketConfigs } from '@/lib/queries';

interface TrajectoryData {
  bucket_name: string;
  display_order: number;
  mtd_total: number;
  mtd_daily_avg: number;
  recent_total: number;
  recent_avg: number;
  trend_pct: number; // % change from MTD avg to recent avg
  days_remaining: number;
  projected_total: number;
  projected_daily_avg: number;
  target_rate: number | null;
  variance_pct: number | null;
}

// GET - Fetch trajectory projections based on recent trend
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // Format: YYYY-MM
    const rollingDays = parseInt(searchParams.get('rolling_days') || '2', 10);

    if (!month) {
      return NextResponse.json(
        { error: 'month parameter is required (format: YYYY-MM)' },
        { status: 400 }
      );
    }

    const startTime = performance.now();

    // Parse month to get date range
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;

    // Get last day of month
    const lastDay = new Date(year, monthNum, 0).getDate();
    const totalDaysInMonth = lastDay;

    // Cap end date at yesterday for current month
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let mtdEndDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    if (mtdEndDate > yesterdayStr) {
      mtdEndDate = yesterdayStr;
    }

    // Count MTD days with data
    const mtdDaysStmt = db.prepare(`
      SELECT COUNT(DISTINCT date) as day_count
      FROM yield_data
      WHERE date BETWEEN ? AND ?
    `);
    const mtdDaysResult = mtdDaysStmt.get(startDate, mtdEndDate) as { day_count: number };
    const mtdDays = mtdDaysResult.day_count || 1;

    // Find the most recent N days that actually have data (not calendar days)
    // This handles the case where yesterday's data isn't in yet
    const recentDatesStmt = db.prepare(`
      SELECT DISTINCT date
      FROM yield_data
      WHERE date BETWEEN ? AND ?
      ORDER BY date DESC
      LIMIT ?
    `);
    const recentDates = recentDatesStmt.all(startDate, mtdEndDate, rollingDays) as { date: string }[];
    const actualRecentDays = recentDates.length || 1;

    // Get the date range for recent data (oldest to newest of the N most recent days with data)
    const recentStartStr = recentDates.length > 0
      ? recentDates[recentDates.length - 1].date
      : mtdEndDate;
    const recentEndStr = recentDates.length > 0
      ? recentDates[0].date
      : mtdEndDate;

    // Check data freshness - flag if most recent data is too old
    const mostRecentDataDate = new Date(recentEndStr);
    const dataAgeDays = Math.floor((yesterday.getTime() - mostRecentDataDate.getTime()) / (1000 * 60 * 60 * 24));
    const hasNoData = recentDates.length === 0;
    const dataIsStale = dataAgeDays > 7; // Flag if data is more than 7 days old
    const dataWarning = hasNoData
      ? 'No data available for this month'
      : dataIsStale
        ? `Data is ${dataAgeDays} days old (most recent: ${recentEndStr})`
        : null;

    // Calculate days remaining in month based on actual last day of data (not calendar yesterday)
    // This ensures we project from where data actually ends
    const endOfMonth = new Date(year, monthNum, 0);
    const lastDataDay = mostRecentDataDate.getDate();
    const daysRemaining = Math.max(0, endOfMonth.getDate() - lastDataDay);

    // Get bucket configurations
    const buckets = getBucketConfigs('yield');

    // Get targets for this month
    const targetsStmt = db.prepare(`
      SELECT bucket_name, monthly_plan_rate
      FROM yield_targets
      WHERE month = ?
    `);
    const targets = targetsStmt.all(month) as { bucket_name: string; monthly_plan_rate: number | null }[];
    const targetMap: Record<string, number> = {};
    targets.forEach((t) => {
      if (t.monthly_plan_rate !== null) {
        targetMap[t.bucket_name] = t.monthly_plan_rate;
      }
    });

    // Calculate trajectory for each bucket
    const results: TrajectoryData[] = [];
    let crudeRateMtdTotal = 0;
    let crudeRateRecentTotal = 0;
    let nonCrudeMtdTotal = 0;
    let nonCrudeRecentTotal = 0;

    for (const bucket of buckets) {
      let mtdTotal = 0;
      let recentTotal = 0;

      // Handle special component syntax
      const specialComponents = bucket.component_products.filter((p: string) => p.startsWith('__'));
      const regularComponents = bucket.component_products.filter((p: string) => !p.startsWith('__'));

      // Track bucket-specific day counts
      let bucketMtdDays = mtdDays;
      let bucketRecentDays = actualRecentDays;

      // Handle __CLASS:F (Feedstock/Crude)
      if (specialComponents.some((p: string) => p === '__CLASS:F')) {
        // Count days with actual data for this bucket
        const mtdDaysStmt = db.prepare(`
          SELECT COUNT(DISTINCT date) as day_count
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'F' AND yield_qty != 0
        `);
        const mtdDaysResult = mtdDaysStmt.get(startDate, mtdEndDate) as { day_count: number };
        bucketMtdDays = mtdDaysResult.day_count || 1;

        const recentDaysStmt = db.prepare(`
          SELECT COUNT(DISTINCT date) as day_count
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'F' AND yield_qty != 0
        `);
        const recentDaysResult = recentDaysStmt.get(recentStartStr, recentEndStr) as { day_count: number };
        bucketRecentDays = recentDaysResult.day_count || 1;

        const mtdStmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'F'
        `);
        const mtdResult = mtdStmt.get(startDate, mtdEndDate) as { total: number };
        mtdTotal += mtdResult.total;
        crudeRateMtdTotal = mtdResult.total;

        const recentStmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'F'
        `);
        const recentResult = recentStmt.get(recentStartStr, recentEndStr) as { total: number };
        recentTotal += recentResult.total;
        crudeRateRecentTotal = recentResult.total;
      }

      // Handle __CLASS:P (Products/Non-Crude)
      if (specialComponents.some((p: string) => p === '__CLASS:P')) {
        // Count days with actual data for this bucket
        const mtdDaysStmt = db.prepare(`
          SELECT COUNT(DISTINCT date) as day_count
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'P' AND yield_qty != 0
        `);
        const mtdDaysResult = mtdDaysStmt.get(startDate, mtdEndDate) as { day_count: number };
        bucketMtdDays = mtdDaysResult.day_count || 1;

        const recentDaysStmt = db.prepare(`
          SELECT COUNT(DISTINCT date) as day_count
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'P' AND yield_qty != 0
        `);
        const recentDaysResult = recentDaysStmt.get(recentStartStr, recentEndStr) as { day_count: number };
        bucketRecentDays = recentDaysResult.day_count || 1;

        const mtdStmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'P'
        `);
        const mtdResult = mtdStmt.get(startDate, mtdEndDate) as { total: number };
        mtdTotal += mtdResult.total;
        nonCrudeMtdTotal = mtdResult.total;

        const recentStmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_class = 'P'
        `);
        const recentResult = recentStmt.get(recentStartStr, recentEndStr) as { total: number };
        recentTotal += recentResult.total;
        nonCrudeRecentTotal = recentResult.total;
      }

      // Handle __CALC:LOSS - will calculate after all other buckets
      if (specialComponents.some((p: string) => p === '__CALC:LOSS')) {
        results.push({
          bucket_name: bucket.bucket_name,
          display_order: bucket.display_order,
          mtd_total: 0,
          mtd_daily_avg: 0,
          recent_total: 0,
          recent_avg: 0,
          trend_pct: 0,
          days_remaining: daysRemaining,
          projected_total: 0,
          projected_daily_avg: 0,
          target_rate: targetMap[bucket.bucket_name] || null,
          variance_pct: null,
        });
        continue;
      }

      // Handle regular product components
      if (regularComponents.length > 0) {
        const placeholders = regularComponents.map(() => '?').join(',');

        // Count days with actual data for this bucket
        const mtdDaysStmt = db.prepare(`
          SELECT COUNT(DISTINCT date) as day_count
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_name IN (${placeholders}) AND yield_qty != 0
        `);
        const mtdDaysResult = mtdDaysStmt.get(startDate, mtdEndDate, ...regularComponents) as { day_count: number };
        bucketMtdDays = mtdDaysResult.day_count || 1;

        const recentDaysStmt = db.prepare(`
          SELECT COUNT(DISTINCT date) as day_count
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_name IN (${placeholders}) AND yield_qty != 0
        `);
        const recentDaysResult = recentDaysStmt.get(recentStartStr, recentEndStr, ...regularComponents) as { day_count: number };
        bucketRecentDays = recentDaysResult.day_count || 1;

        const mtdStmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_name IN (${placeholders})
        `);
        const mtdResult = mtdStmt.get(startDate, mtdEndDate, ...regularComponents) as { total: number };
        mtdTotal += mtdResult.total;

        const recentStmt = db.prepare(`
          SELECT COALESCE(SUM(yield_qty), 0) as total
          FROM yield_data
          WHERE date BETWEEN ? AND ? AND product_name IN (${placeholders})
        `);
        const recentResult = recentStmt.get(recentStartStr, recentEndStr, ...regularComponents) as { total: number };
        recentTotal += recentResult.total;
      }

      // Calculate averages and projections using bucket-specific day counts
      const mtdDailyAvg = mtdTotal / bucketMtdDays;
      const recentAvg = recentTotal / bucketRecentDays;
      const trendPct = mtdDailyAvg !== 0 ? ((recentAvg - mtdDailyAvg) / Math.abs(mtdDailyAvg)) * 100 : 0;

      // Project forward using recent average
      // Use operating days (bucketMtdDays + daysRemaining) not calendar days (totalDaysInMonth)
      // This ensures projected avg is consistent with MTD avg calculation
      const projectedAdditional = recentAvg * daysRemaining;
      const projectedTotal = mtdTotal + projectedAdditional;
      const expectedOperatingDays = bucketMtdDays + daysRemaining;
      const projectedDailyAvg = projectedTotal / expectedOperatingDays;

      // Calculate variance from target (use absolute values since crude rate is negative)
      const targetRate = targetMap[bucket.bucket_name] || null;
      let variancePct: number | null = null;
      if (targetRate !== null && targetRate !== 0) {
        variancePct = ((Math.abs(projectedDailyAvg) - Math.abs(targetRate)) / Math.abs(targetRate)) * 100;
      }

      results.push({
        bucket_name: bucket.bucket_name,
        display_order: bucket.display_order,
        mtd_total: mtdTotal,
        mtd_daily_avg: mtdDailyAvg,
        recent_total: recentTotal,
        recent_avg: recentAvg,
        trend_pct: trendPct,
        days_remaining: daysRemaining,
        projected_total: projectedTotal,
        projected_daily_avg: projectedDailyAvg,
        target_rate: targetRate,
        variance_pct: variancePct,
      });
    }

    // Calculate Loss trajectory
    const lossIdx = results.findIndex(r => r.bucket_name === 'Loss');
    if (lossIdx >= 0) {
      const lossMtdTotal = Math.abs(crudeRateMtdTotal) - nonCrudeMtdTotal;
      const lossRecentTotal = Math.abs(crudeRateRecentTotal) - nonCrudeRecentTotal;
      const lossMtdAvg = lossMtdTotal / mtdDays;
      const lossRecentAvg = lossRecentTotal / actualRecentDays;
      const lossTrendPct = lossMtdAvg !== 0 ? ((lossRecentAvg - lossMtdAvg) / Math.abs(lossMtdAvg)) * 100 : 0;
      const lossProjectedTotal = lossMtdTotal + (lossRecentAvg * daysRemaining);
      const lossExpectedDays = mtdDays + daysRemaining;
      const lossProjectedAvg = lossProjectedTotal / lossExpectedDays;
      const lossTarget = targetMap['Loss'] || null;
      const lossVariance = lossTarget !== null && lossTarget !== 0
        ? ((Math.abs(lossProjectedAvg) - Math.abs(lossTarget)) / Math.abs(lossTarget)) * 100
        : null;

      results[lossIdx] = {
        ...results[lossIdx],
        mtd_total: lossMtdTotal,
        mtd_daily_avg: lossMtdAvg,
        recent_total: lossRecentTotal,
        recent_avg: lossRecentAvg,
        trend_pct: lossTrendPct,
        projected_total: lossProjectedTotal,
        projected_daily_avg: lossProjectedAvg,
        variance_pct: lossVariance,
      };
    }

    // Sort by display_order and filter hidden buckets
    const sortedResults = results
      .filter(r => r.display_order < 99)
      .sort((a, b) => a.display_order - b.display_order);

    const endTime = performance.now();

    return NextResponse.json({
      data: sortedResults,
      meta: {
        month,
        rolling_days: rollingDays,
        actual_recent_days: actualRecentDays,
        mtd_start: startDate,
        mtd_end: mtdEndDate,
        recent_start: recentStartStr,
        recent_end: recentEndStr,
        mtd_days: mtdDays,
        days_remaining: daysRemaining,
        total_days_in_month: totalDaysInMonth,
        data_age_days: dataAgeDays,
        data_is_stale: dataIsStale,
        data_warning: dataWarning,
        query_time_ms: Math.round(endTime - startTime),
      },
    });
  } catch (error) {
    console.error('Error fetching trajectory data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trajectory data' },
      { status: 500 }
    );
  }
}
