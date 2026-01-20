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
import { fileURLToPath } from 'url';

// ES Module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYNC_SCRIPT = path.join(__dirname, 'sync-worker.py');

interface SyncJob {
  name: string;
  schedule: string;
  dataType: 'yield' | 'sales' | 'tank' | 'all';
  mode: 'incremental' | 'full' | 'prior_month_refresh';
  reason?: 'scheduled' | 'day_5_refresh' | 'day_10_refresh';
}

const SYNC_JOBS: SyncJob[] = [
  {
    name: 'Morning Sync (10 AM)',
    schedule: '0 10 * * *', // 10:00 AM daily
    dataType: 'all',
    mode: 'incremental',
    reason: 'scheduled',
  },
  {
    name: 'Evening Sync (10 PM)',
    schedule: '0 22 * * *', // 10:00 PM daily
    dataType: 'all',
    mode: 'incremental',
    reason: 'scheduled',
  },
  {
    name: 'Prior Month Day 5 Refresh',
    schedule: '0 3 5 * *', // 3:00 AM on 5th of each month
    dataType: 'all',
    mode: 'prior_month_refresh',
    reason: 'day_5_refresh',
  },
  {
    name: 'Prior Month Day 10 Refresh',
    schedule: '0 3 10 * *', // 3:00 AM on 10th of each month
    dataType: 'all',
    mode: 'prior_month_refresh',
    reason: 'day_10_refresh',
  },
];

// Track running syncs to prevent overlap
const runningSyncs = new Map<string, boolean>();

/**
 * Run the Python sync worker
 */
async function runSync(
  dataType: string,
  mode: string,
  reason: string = 'scheduled'
): Promise<void> {
  const syncKey = `${dataType}-${mode}`;

  if (runningSyncs.get(syncKey)) {
    console.log(`[Scheduler] Sync ${syncKey} already running, skipping`);
    return;
  }

  runningSyncs.set(syncKey, true);
  console.log(`[Scheduler] Starting ${mode} sync for ${dataType} (reason: ${reason})`);

  // Build command arguments
  const args = [SYNC_SCRIPT, '--type', dataType, '--mode', mode, '--refresh-reason', reason];

  // Add --prior-month flag for prior month refresh mode
  if (mode === 'prior_month_refresh') {
    args.push('--prior-month');
  }

  return new Promise((resolve, reject) => {
    const syncProcess = spawn('python', args, {
      cwd: path.dirname(SYNC_SCRIPT),
      stdio: 'inherit',
    });

    syncProcess.on('close', (code) => {
      runningSyncs.delete(syncKey);
      if (code === 0) {
        console.log(`[Scheduler] Sync ${syncKey} completed successfully`);
        resolve();
      } else {
        console.error(`[Scheduler] Sync ${syncKey} failed with code ${code}`);
        reject(new Error(`Sync failed with code ${code}`));
      }
    });

    syncProcess.on('error', (err) => {
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
        await runSync(job.dataType, job.mode, job.reason || 'scheduled');
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
  mode: 'incremental' | 'full' | 'prior_month_refresh' = 'incremental',
  reason: 'manual' | 'scheduled' | 'day_5_refresh' | 'day_10_refresh' = 'manual'
): Promise<void> {
  console.log(`[Scheduler] Manual trigger: ${dataType} ${mode} (reason: ${reason})`);
  await runSync(dataType, mode, reason);
}

/**
 * Trigger prior month refresh (convenience function)
 */
export async function triggerPriorMonthRefresh(
  dataType: 'yield' | 'sales' | 'tank' | 'all' = 'all'
): Promise<void> {
  console.log(`[Scheduler] Prior month refresh triggered for ${dataType}`);
  await runSync(dataType, 'prior_month_refresh', 'manual');
}

// Run standalone if executed directly
// Check if this script is the main entry point
const scriptPath = process.argv[1];
const isMainModule = scriptPath && (scriptPath.endsWith('scheduler.ts') || scriptPath.endsWith('scheduler.js'));

if (isMainModule) {
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
