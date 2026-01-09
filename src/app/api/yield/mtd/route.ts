import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getBucketConfigs } from '@/lib/queries';

interface BucketMTD {
  bucket_name: string;
  display_order: number;
  mtd_daily_avg: number;
  is_virtual: boolean;
}

// GET - Fetch MTD yield data aggregated by bucket (daily averages)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // Format: YYYY-MM

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

    // Get last day of month, but cap at yesterday for current month
    const lastDay = new Date(year, monthNum, 0).getDate();
    let endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (endDate > yesterdayStr) {
      endDate = yesterdayStr;
    }

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

    const endTime = performance.now();

    return NextResponse.json({
      data: sortedResults,
      meta: {
        month,
        start_date: startDate,
        end_date: endDate,
        day_count: dayCount,
        crude_rate_daily_avg: crudeRateDailyAvg,
        query_time_ms: Math.round(endTime - startTime),
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
