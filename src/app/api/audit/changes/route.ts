import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const { searchParams } = new URL(request.url);

  const dataType = searchParams.get('data_type') || 'yield';
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const productName = searchParams.get('product_name');
  const syncId = searchParams.get('sync_id');
  const limit = parseInt(searchParams.get('limit') || '100');

  try {
    // Currently only yield_data_history is implemented
    if (dataType !== 'yield') {
      return NextResponse.json({
        changes: [],
        meta: { message: 'Only yield data history is currently supported' },
      });
    }

    let query = `
      SELECT
        h.id,
        h.original_id,
        h.date,
        h.product_name,
        h.product_class,
        h.yield_qty,
        h.previous_yield_qty,
        h.change_type,
        h.captured_at,
        h.sync_id,
        sl.sync_mode,
        sl.sync_reason,
        sl.started_at as sync_started_at
      FROM yield_data_history h
      LEFT JOIN sync_log sl ON h.sync_id = sl.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (startDate && endDate) {
      query += ' AND h.date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    if (productName) {
      query += ' AND h.product_name = ?';
      params.push(productName);
    }

    if (syncId) {
      query += ' AND h.sync_id = ?';
      params.push(parseInt(syncId));
    }

    query += ' ORDER BY h.captured_at DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    const changes = stmt.all(...params);

    // Calculate change statistics
    const statsQuery = `
      SELECT
        change_type,
        COUNT(*) as count
      FROM yield_data_history
      WHERE captured_at > datetime('now', '-7 days')
      GROUP BY change_type
    `;
    const statsStmt = db.prepare(statsQuery);
    const stats = statsStmt.all();

    const queryTime = Math.round(performance.now() - startTime);

    return NextResponse.json({
      changes,
      stats,
      meta: {
        count: changes.length,
        query_time_ms: queryTime,
      },
    });
  } catch (error) {
    console.error('Error fetching change history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch change history' },
      { status: 500 }
    );
  }
}
