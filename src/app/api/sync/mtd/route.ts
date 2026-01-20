import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import db from '@/lib/db';

// Get first day of a month (defaults to current month)
function getMonthStart(monthStr?: string): string {
  if (monthStr) {
    // Format: YYYY-MM
    return `${monthStr}-01`;
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

// Get yesterday's date
function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dataType = searchParams.get('data_type') || 'yield';
  const month = searchParams.get('month'); // Optional: YYYY-MM format
  const fullRefresh = searchParams.get('full_refresh') === 'true';

  try {
    // Check if an MTD sync is already running for this data type
    const runningQuery = `
      SELECT id FROM sync_log
      WHERE data_type = ?
      AND sync_reason IN ('manual_mtd', 'mtd_full_refresh')
      AND status = 'running'
      AND started_at > datetime('now', '-1 hour')
    `;
    const runningStmt = db.prepare(runningQuery);
    const running = runningStmt.get(dataType);

    if (running) {
      return NextResponse.json(
        { error: 'MTD sync already in progress for this data type' },
        { status: 409 }
      );
    }

    // Calculate date range for MTD
    const startDate = getMonthStart(month || undefined);
    const endDate = getYesterday();

    // Start the sync process with explicit date range for full month refresh
    const syncScript = path.join(process.cwd(), 'sync', 'sync-worker.py');

    const args = [
      syncScript,
      '--type',
      dataType,
    ];

    if (fullRefresh) {
      // Full refresh: explicitly specify date range for the entire month
      args.push(
        '--start-date', startDate,
        '--end-date', endDate,
        '--refresh-reason', 'mtd_full_refresh'
      );
    } else {
      // Regular incremental
      args.push(
        '--mode', 'incremental',
        '--refresh-reason', 'manual_mtd'
      );
    }

    const syncProcess = spawn(
      'python',
      args,
      {
        cwd: path.dirname(syncScript),
        detached: true,
        stdio: 'ignore',
      }
    );

    syncProcess.unref();

    // Wait briefly for the sync log entry to be created
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Query for the sync_id of the just-started sync
    const syncReason = fullRefresh ? 'mtd_full_refresh' : 'manual_mtd';
    const syncIdQuery = `
      SELECT id FROM sync_log
      WHERE data_type = ?
      AND sync_reason = ?
      AND status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const syncIdStmt = db.prepare(syncIdQuery);
    const syncEntry = syncIdStmt.get(dataType, syncReason) as { id: number } | undefined;

    const message = fullRefresh
      ? `Full MTD refresh started for ${dataType} (${startDate} to ${endDate})`
      : `MTD sync started for ${dataType}`;

    if (!syncEntry) {
      // If we can't find the entry yet, return success without syncId
      // The client can poll for it
      return NextResponse.json({
        success: true,
        message,
        dataType,
        dateRange: fullRefresh ? { start: startDate, end: endDate } : undefined,
      });
    }

    return NextResponse.json({
      success: true,
      message,
      dataType,
      syncId: syncEntry.id,
      dateRange: fullRefresh ? { start: startDate, end: endDate } : undefined,
    });
  } catch (error) {
    console.error('Error triggering MTD sync:', error);
    return NextResponse.json(
      { error: 'Failed to trigger MTD sync' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const syncId = searchParams.get('sync_id');

  try {
    if (syncId) {
      // Return status of a specific sync
      const statusQuery = `
        SELECT
          id,
          data_type,
          sync_mode,
          sync_reason,
          date_range_start,
          date_range_end,
          started_at,
          completed_at,
          status,
          records_fetched,
          records_inserted,
          records_updated,
          records_unchanged,
          error_message
        FROM sync_log
        WHERE id = ?
      `;
      const statusStmt = db.prepare(statusQuery);
      const sync = statusStmt.get(parseInt(syncId));

      if (!sync) {
        return NextResponse.json({ error: 'Sync not found' }, { status: 404 });
      }

      return NextResponse.json({ sync });
    }

    // Return latest MTD syncs
    const historyQuery = `
      SELECT
        id,
        data_type,
        sync_mode,
        sync_reason,
        date_range_start,
        date_range_end,
        started_at,
        completed_at,
        status,
        records_fetched,
        records_inserted,
        records_updated,
        records_unchanged,
        error_message
      FROM sync_log
      WHERE sync_reason = 'manual_mtd'
      ORDER BY started_at DESC
      LIMIT 10
    `;
    const historyStmt = db.prepare(historyQuery);
    const history = historyStmt.all();

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching MTD sync status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
