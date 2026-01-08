/**
 * Sync Scheduler for Yield-Rewind
 *
 * Manages background data synchronization from SQL Server to SQLite.
 *
 * Schedule:
 * - Incremental sync: Every 15 minutes
 * - Full sync: Daily at 2:00 AM
 *
 * Usage:
 * - Import and call startScheduler() from your app initialization
 * - Or run standalone: npx ts-node sync/scheduler.ts
 */

import * as schedule from 'node-schedule';
import { spawn } from 'child_process';
import path from 'path';

const SYNC_SCRIPT = path.join(__dirname, 'sync-worker.py');

interface SyncJob {
  name: string;
  schedule: string;
  dataType: 'yield' | 'sales' | 'tank' | 'all';
  mode: 'incremental' | 'full';
}

const SYNC_JOBS: SyncJob[] = [
  {
    name: 'Incremental Yield Sync',
    schedule: '*/15 * * * *', // Every 15 minutes
    dataType: 'yield',
    mode: 'incremental',
  },
  {
    name: 'Incremental Sales Sync',
    schedule: '5,20,35,50 * * * *', // Every 15 minutes, offset by 5
    dataType: 'sales',
    mode: 'incremental',
  },
  {
    name: 'Incremental Tank Sync',
    schedule: '10,25,40,55 * * * *', // Every 15 minutes, offset by 10
    dataType: 'tank',
    mode: 'incremental',
  },
  {
    name: 'Daily Full Sync',
    schedule: '0 2 * * *', // 2:00 AM daily
    dataType: 'all',
    mode: 'full',
  },
];

// Track running syncs to prevent overlap
const runningSyncs = new Map<string, boolean>();

/**
 * Run the Python sync worker
 */
async function runSync(dataType: string, mode: string): Promise<void> {
  const syncKey = `${dataType}-${mode}`;

  if (runningSyncs.get(syncKey)) {
    console.log(`[Scheduler] Sync ${syncKey} already running, skipping`);
    return;
  }

  runningSyncs.set(syncKey, true);
  console.log(`[Scheduler] Starting ${mode} sync for ${dataType}`);

  return new Promise((resolve, reject) => {
    const process = spawn('python', [SYNC_SCRIPT, '--type', dataType, '--mode', mode], {
      cwd: path.dirname(SYNC_SCRIPT),
      stdio: 'inherit',
    });

    process.on('close', (code) => {
      runningSyncs.delete(syncKey);
      if (code === 0) {
        console.log(`[Scheduler] Sync ${syncKey} completed successfully`);
        resolve();
      } else {
        console.error(`[Scheduler] Sync ${syncKey} failed with code ${code}`);
        reject(new Error(`Sync failed with code ${code}`));
      }
    });

    process.on('error', (err) => {
      runningSyncs.delete(syncKey);
      console.error(`[Scheduler] Sync ${syncKey} error:`, err);
      reject(err);
    });
  });
}

/**
 * Start all scheduled sync jobs
 */
export function startScheduler(): void {
  console.log('[Scheduler] Starting sync scheduler...');

  for (const job of SYNC_JOBS) {
    schedule.scheduleJob(job.schedule, async () => {
      console.log(`[Scheduler] Running job: ${job.name}`);
      try {
        await runSync(job.dataType, job.mode);
      } catch (error) {
        console.error(`[Scheduler] Job ${job.name} failed:`, error);
      }
    });

    console.log(`[Scheduler] Scheduled: ${job.name} (${job.schedule})`);
  }

  console.log('[Scheduler] All jobs scheduled');
}

/**
 * Stop all scheduled jobs
 */
export function stopScheduler(): void {
  console.log('[Scheduler] Stopping scheduler...');
  schedule.gracefulShutdown();
}

/**
 * Run an immediate sync (for manual triggers)
 */
export async function triggerSync(
  dataType: 'yield' | 'sales' | 'tank' | 'all',
  mode: 'incremental' | 'full' = 'incremental'
): Promise<void> {
  console.log(`[Scheduler] Manual trigger: ${dataType} ${mode}`);
  await runSync(dataType, mode);
}

// Run standalone if executed directly
if (require.main === module) {
  console.log('Starting Yield-Rewind Sync Scheduler');
  console.log('Press Ctrl+C to exit\n');

  startScheduler();

  // Run initial incremental sync on startup
  console.log('[Scheduler] Running initial sync...');
  runSync('all', 'incremental').catch(console.error);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n[Scheduler] Shutting down...');
    stopScheduler();
    process.exit(0);
  });
}
