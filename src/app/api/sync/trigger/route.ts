import { NextRequest, NextResponse } from 'next/server';
import { updateSyncStatus } from '@/lib/queries';
import { spawn } from 'child_process';
import path from 'path';

// Track running sync processes
const runningSyncs = new Map<string, boolean>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data_type } = body;

    if (!data_type) {
      return NextResponse.json(
        { error: 'data_type is required' },
        { status: 400 }
      );
    }

    // Check if sync is already running
    if (runningSyncs.get(data_type)) {
      return NextResponse.json(
        { error: `Sync for ${data_type} is already running` },
        { status: 409 }
      );
    }

    // Mark sync as running
    runningSyncs.set(data_type, true);
    updateSyncStatus(data_type, {
      status: 'running',
      last_sync_at: new Date().toISOString(),
    });

    // Spawn Python sync process
    const syncScriptPath = path.join(process.cwd(), 'sync', 'sync-worker.py');

    // Note: In production, you would run the actual Python sync worker
    // For now, we simulate the sync process
    const startTime = Date.now();

    // Simulate async sync (in production, this would be the Python subprocess)
    setTimeout(() => {
      const duration = Date.now() - startTime;

      // Update status to success
      updateSyncStatus(data_type, {
        status: 'success',
        last_synced_date: new Date().toISOString().split('T')[0],
        last_sync_at: new Date().toISOString(),
        records_synced: Math.floor(Math.random() * 1000) + 500, // Simulated
        sync_duration_ms: duration,
      });

      runningSyncs.delete(data_type);
    }, 2000); // Simulate 2 second sync

    return NextResponse.json({
      success: true,
      message: `Sync started for ${data_type}`,
    });
  } catch (error) {
    console.error('Error triggering sync:', error);
    return NextResponse.json(
      { error: 'Failed to trigger sync' },
      { status: 500 }
    );
  }
}

// Background sync runner (would be called by scheduler)
export async function runScheduledSync(dataType: string): Promise<void> {
  if (runningSyncs.get(dataType)) {
    console.log(`Sync for ${dataType} already running, skipping`);
    return;
  }

  console.log(`Starting scheduled sync for ${dataType}`);
  runningSyncs.set(dataType, true);

  try {
    updateSyncStatus(dataType, {
      status: 'running',
      last_sync_at: new Date().toISOString(),
    });

    // In production, spawn Python process:
    // const syncProcess = spawn('python', [
    //   path.join(process.cwd(), 'sync', 'sync-worker.py'),
    //   '--type', dataType,
    //   '--mode', 'incremental'
    // ]);

    // For now, simulate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    updateSyncStatus(dataType, {
      status: 'success',
      last_synced_date: new Date().toISOString().split('T')[0],
      last_sync_at: new Date().toISOString(),
      records_synced: Math.floor(Math.random() * 100) + 50,
      sync_duration_ms: 1000,
    });
  } catch (error) {
    updateSyncStatus(dataType, {
      status: 'error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    runningSyncs.delete(dataType);
  }
}
