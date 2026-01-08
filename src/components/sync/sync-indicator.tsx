'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SyncStatus {
  yield: { status: string; last_sync_at: string | null };
  sales: { status: string; last_sync_at: string | null };
  tank: { status: string; last_sync_at: string | null };
}

export function SyncIndicator() {
  const { data: syncStatus, isLoading } = useQuery<SyncStatus>({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await fetch('/api/sync/status');
      if (!res.ok) throw new Error('Failed to fetch sync status');
      return res.json();
    },
    refetchInterval: 60000, // Check every minute
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>Checking...</span>
      </div>
    );
  }

  // Determine overall status
  const statuses = syncStatus
    ? [syncStatus.yield?.status, syncStatus.sales?.status, syncStatus.tank?.status]
    : [];
  const hasError = statuses.some((s) => s === 'failed');
  const allSuccess = statuses.every((s) => s === 'success');

  // Get most recent sync time
  const syncTimes = syncStatus
    ? [
        syncStatus.yield?.last_sync_at,
        syncStatus.sales?.last_sync_at,
        syncStatus.tank?.last_sync_at,
      ].filter(Boolean)
    : [];
  const mostRecent = syncTimes.length > 0
    ? new Date(Math.max(...syncTimes.map((t) => new Date(t!).getTime())))
    : null;

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-1 text-sm',
        hasError
          ? 'bg-red-50 text-red-700'
          : allSuccess
            ? 'bg-green-50 text-green-700'
            : 'bg-gray-50 text-gray-600'
      )}
    >
      {hasError ? (
        <AlertCircle className="h-4 w-4" />
      ) : allSuccess ? (
        <CheckCircle className="h-4 w-4" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      <span>
        {hasError
          ? 'Sync Error'
          : mostRecent
            ? `Synced ${formatTime(mostRecent)}`
            : 'Not synced'}
      </span>
    </div>
  );
}
