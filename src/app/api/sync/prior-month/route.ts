import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import db from '@/lib/db';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dataType = searchParams.get('data_type') || 'all';

  try {
    // Check if a prior month refresh is already running
    const runningQuery = `
      SELECT id FROM sync_log
      WHERE sync_mode = 'prior_month_refresh'
      AND status = 'running'
      AND started_at > datetime('now', '-1 hour')
    `;
    const runningStmt = db.prepare(runningQuery);
    const running = runningStmt.get();

    if (running) {
      return NextResponse.json(
        { error: 'Prior month refresh already in progress' },
        { status: 409 }
      );
    }

    // Start the refresh process
    const syncScript = path.join(process.cwd(), 'sync', 'sync-worker.py');

    const syncProcess = spawn(
      'python',
      [
        syncScript,
        '--type',
        dataType,
        '--prior-month',
        '--refresh-reason',
        'manual',
      ],
      {
        cwd: path.dirname(syncScript),
        detached: true,
        stdio: 'ignore',
      }
    );

    syncProcess.unref();

    return NextResponse.json({
      success: true,
      message: `Prior month refresh started for ${dataType}`,
      dataType,
    });
  } catch (error) {
    console.error('Error triggering prior month refresh:', error);
    return NextResponse.json(
      { error: 'Failed to trigger prior month refresh' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return status of any running prior month refresh
  try {
    const statusQuery = `
      SELECT
        id,
        data_type,
        sync_reason,
        date_range_start,
        date_range_end,
        started_at,
        completed_at,
        status,
        records_inserted,
        records_updated
      FROM sync_log
      WHERE sync_mode = 'prior_month_refresh'
      ORDER BY started_at DESC
      LIMIT 5
    `;
    const statusStmt = db.prepare(statusQuery);
    const history = statusStmt.all();

    return NextResponse.json({
      history,
    });
  } catch (error) {
    console.error('Error fetching prior month refresh status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
