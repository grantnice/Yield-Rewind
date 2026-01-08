import { NextResponse } from 'next/server';
import { getSyncStatus } from '@/lib/queries';

export async function GET() {
  try {
    const statuses = getSyncStatus();

    // Convert array to object keyed by data_type
    const result: Record<string, any> = {
      yield: { status: 'unknown', last_sync_at: null },
      sales: { status: 'unknown', last_sync_at: null },
      tank: { status: 'unknown', last_sync_at: null },
    };

    for (const status of statuses) {
      result[status.data_type] = {
        status: status.status,
        last_sync_at: status.last_sync_at,
        last_synced_date: status.last_synced_date,
        records_synced: status.records_synced,
        sync_duration_ms: status.sync_duration_ms,
        error_message: status.error_message,
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching sync status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync status' },
      { status: 500 }
    );
  }
}
