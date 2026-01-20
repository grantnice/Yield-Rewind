'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface FreshnessData {
  freshness: Array<{
    data_type: string;
    last_synced_date: string | null;
    last_sync_at: string | null;
    records_synced: number | null;
    status: string;
    hours_since_sync: number | null;
  }>;
  priorMonthRefresh: Array<{
    sync_reason: string;
    completed_at: string;
    records_updated: number;
    status: string;
  }>;
}

interface FreshnessBadgeProps {
  dataType?: 'yield' | 'sales' | 'tank';
  month?: string; // YYYY-MM format
  className?: string;
  showLabel?: boolean;
}

export function FreshnessBadge({
  dataType = 'yield',
  month,
  className,
  showLabel = true,
}: FreshnessBadgeProps) {
  const { data, isLoading } = useQuery<FreshnessData>({
    queryKey: ['freshness', dataType, month],
    queryFn: async () => {
      const params = new URLSearchParams({ data_type: dataType });
      if (month) params.set('month', month);
      const res = await fetch(`/api/audit/freshness?${params}`);
      if (!res.ok) throw new Error('Failed to fetch freshness');
      return res.json();
    },
    staleTime: 30000, // 30 second cache
    refetchInterval: 60000, // Refetch every minute
  });

  if (isLoading) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500',
          className
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
        {showLabel && <span>Loading...</span>}
      </span>
    );
  }

  const freshness = data?.freshness?.find((f) => f.data_type === dataType);
  if (!freshness) return null;

  const hoursSinceSync = freshness.hours_since_sync || 0;
  const isStale = hoursSinceSync > 1;
  const isVeryStale = hoursSinceSync > 24;

  // Format time display
  const timeDisplay =
    hoursSinceSync < 1
      ? 'Just synced'
      : hoursSinceSync < 24
        ? `${Math.round(hoursSinceSync)}h ago`
        : `${Math.round(hoursSinceSync / 24)}d ago`;

  // Check for prior month refresh status
  const priorMonthRefresh = data?.priorMonthRefresh || [];
  const hasDay5Refresh = priorMonthRefresh.some(
    (r) => r.sync_reason === 'day_5_refresh' && r.status === 'success'
  );
  const hasDay10Refresh = priorMonthRefresh.some(
    (r) => r.sync_reason === 'day_10_refresh' && r.status === 'success'
  );

  // Build tooltip content
  const tooltipParts = [
    `Last sync: ${freshness.last_sync_at ? new Date(freshness.last_sync_at).toLocaleString() : 'Never'}`,
    `Data through: ${freshness.last_synced_date || 'Unknown'}`,
  ];

  if (month && priorMonthRefresh.length > 0) {
    tooltipParts.push(
      `Prior month refresh: Day 5 ${hasDay5Refresh ? '✓' : '○'}, Day 10 ${hasDay10Refresh ? '✓' : '○'}`
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-help',
        isVeryStale
          ? 'bg-red-100 text-red-700'
          : isStale
            ? 'bg-amber-100 text-amber-700'
            : 'bg-emerald-100 text-emerald-700',
        className
      )}
      title={tooltipParts.join('\n')}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          isVeryStale
            ? 'bg-red-500'
            : isStale
              ? 'bg-amber-500'
              : 'bg-emerald-500'
        )}
      />
      {showLabel && <span>{timeDisplay}</span>}
    </span>
  );
}

export function PriorMonthStatus({ month }: { month: string }) {
  const { data, isLoading } = useQuery<FreshnessData>({
    queryKey: ['freshness', 'yield', month],
    queryFn: async () => {
      const params = new URLSearchParams({ data_type: 'yield', month });
      const res = await fetch(`/api/audit/freshness?${params}`);
      if (!res.ok) throw new Error('Failed to fetch freshness');
      return res.json();
    },
    staleTime: 60000,
  });

  if (isLoading || !data?.priorMonthRefresh?.length) return null;

  const hasDay5Refresh = data.priorMonthRefresh.some(
    (r) => r.sync_reason === 'day_5_refresh' && r.status === 'success'
  );
  const hasDay10Refresh = data.priorMonthRefresh.some(
    (r) => r.sync_reason === 'day_10_refresh' && r.status === 'success'
  );

  if (!hasDay5Refresh && !hasDay10Refresh) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className="font-medium">Finalized:</span>
      <span
        className={cn(
          'px-1.5 py-0.5 rounded',
          hasDay5Refresh
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-gray-100 text-gray-400'
        )}
      >
        D5 {hasDay5Refresh ? '✓' : '○'}
      </span>
      <span
        className={cn(
          'px-1.5 py-0.5 rounded',
          hasDay10Refresh
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-gray-100 text-gray-400'
        )}
      >
        D10 {hasDay10Refresh ? '✓' : '○'}
      </span>
    </span>
  );
}
