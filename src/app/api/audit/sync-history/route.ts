import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const { searchParams } = new URL(request.url);

  const dataType = searchParams.get('data_type');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    let query = `
      SELECT
        id, data_type, sync_mode, sync_reason,
        date_range_start, date_range_end,
        started_at, completed_at, status,
        records_fetched, records_inserted, records_updated, records_unchanged,
        error_message
      FROM sync_log
    `;

    const params: (string | number)[] = [];

    if (dataType) {
      query += ' WHERE data_type = ?';
      params.push(dataType);
    }

    query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = db.prepare(query);
    const logs = stmt.all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM sync_log';
    if (dataType) {
      countQuery += ' WHERE data_type = ?';
    }
    const countStmt = db.prepare(countQuery);
    const countResult = dataType ? countStmt.get(dataType) : countStmt.get();
    const total = (countResult as { total: number })?.total || 0;

    const queryTime = Math.round(performance.now() - startTime);

    return NextResponse.json({
      logs,
      meta: {
        total,
        limit,
        offset,
        query_time_ms: queryTime,
      },
    });
  } catch (error) {
    console.error('Error fetching sync history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync history' },
      { status: 500 }
    );
  }
}
