import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const { searchParams } = new URL(request.url);

  const dataType = searchParams.get('data_type');
  const month = searchParams.get('month'); // YYYY-MM format

  try {
    // Get freshness info for each data type from sync_status
    let freshnessQuery = `
      SELECT
        data_type,
        last_synced_date,
        last_sync_at,
        records_synced,
        status,
        ROUND((julianday('now') - julianday(last_sync_at)) * 24, 1) as hours_since_sync
      FROM sync_status
    `;

    if (dataType) {
      freshnessQuery += ' WHERE data_type = ?';
    }

    const freshnessStmt = db.prepare(freshnessQuery);
    const freshness = dataType
      ? freshnessStmt.all(dataType)
      : freshnessStmt.all();

    // Get prior month refresh status if month is specified
    let priorMonthRefresh: unknown[] = [];
    if (month) {
      const priorMonthQuery = `
        SELECT
          sync_reason,
          completed_at,
          records_updated,
          records_inserted,
          status
        FROM sync_log
        WHERE sync_mode = 'prior_month_refresh'
        AND date_range_start LIKE ?
        ORDER BY completed_at DESC
        LIMIT 2
      `;
      const priorMonthStmt = db.prepare(priorMonthQuery);
      priorMonthRefresh = priorMonthStmt.all(`${month}%`);
    }

    // Get recent change statistics (last 7 days)
    const recentChangesQuery = `
      SELECT
        'yield' as data_type,
        COUNT(*) as change_count,
        MAX(captured_at) as last_change_at
      FROM yield_data_history
      WHERE captured_at > datetime('now', '-7 days')
    `;
    const recentChangesStmt = db.prepare(recentChangesQuery);
    const recentChanges = recentChangesStmt.all();

    // Get total history records count
    const historyCountQuery = `
      SELECT COUNT(*) as total FROM yield_data_history
    `;
    const historyCountStmt = db.prepare(historyCountQuery);
    const historyCount = historyCountStmt.get() as { total: number };

    // Get last sync log entries
    const lastSyncsQuery = `
      SELECT
        data_type,
        sync_mode,
        sync_reason,
        completed_at,
        records_inserted,
        records_updated,
        status
      FROM sync_log
      WHERE status = 'success'
      ORDER BY completed_at DESC
      LIMIT 5
    `;
    const lastSyncsStmt = db.prepare(lastSyncsQuery);
    const lastSyncs = lastSyncsStmt.all();

    const queryTime = Math.round(performance.now() - startTime);

    return NextResponse.json({
      freshness,
      priorMonthRefresh,
      recentChanges,
      historyCount: historyCount?.total || 0,
      lastSyncs,
      serverTime: new Date().toISOString(),
      meta: {
        query_time_ms: queryTime,
      },
    });
  } catch (error) {
    console.error('Error fetching freshness data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch freshness data' },
      { status: 500 }
    );
  }
}
