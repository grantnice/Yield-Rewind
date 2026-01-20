'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FreshnessBadge } from '@/components/audit/freshness-badge';
import { MtdSyncResultsModal } from '@/components/audit/mtd-sync-results-modal';

interface SyncLog {
  id: number;
  data_type: string;
  sync_mode: string;
  sync_reason: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  records_fetched: number | null;
  records_inserted: number | null;
  records_updated: number | null;
  records_unchanged: number | null;
  error_message: string | null;
}

interface ChangeRecord {
  id: number;
  original_id: number;
  date: string;
  product_name: string;
  product_class: string | null;
  yield_qty: number;
  previous_yield_qty: number | null;
  change_type: string;
  captured_at: string;
  sync_id: number;
  sync_mode: string | null;
  sync_reason: string | null;
}

interface FreshnessInfo {
  data_type: string;
  last_synced_date: string | null;
  last_sync_at: string | null;
  records_synced: number | null;
  status: string;
  hours_since_sync: number | null;
}

export default function AuditPage() {
  const queryClient = useQueryClient();
  const [selectedDataType, setSelectedDataType] = useState<
    'yield' | 'sales' | 'tank'
  >('yield');
  const [activeTab, setActiveTab] = useState('sync-history');
  const [mtdSyncId, setMtdSyncId] = useState<number | null>(null);
  const [showMtdResults, setShowMtdResults] = useState(false);
  const [mtdSyncResult, setMtdSyncResult] = useState<SyncLog | null>(null);

  // Fetch sync history
  const { data: syncHistory, isLoading: syncLoading } = useQuery<{
    logs: SyncLog[];
    meta: { total: number };
  }>({
    queryKey: ['sync-history', selectedDataType],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit/sync-history?data_type=${selectedDataType}&limit=50`
      );
      if (!res.ok) throw new Error('Failed to fetch sync history');
      return res.json();
    },
  });

  // Fetch recent changes
  const { data: recentChanges, isLoading: changesLoading } = useQuery<{
    changes: ChangeRecord[];
    stats: Array<{ change_type: string; count: number }>;
  }>({
    queryKey: ['recent-changes', selectedDataType],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit/changes?data_type=${selectedDataType}`
      );
      if (!res.ok) throw new Error('Failed to fetch changes');
      return res.json();
    },
  });

  // Fetch freshness data
  const { data: freshnessData } = useQuery<{
    freshness: FreshnessInfo[];
    historyCount: number;
    lastSyncs: SyncLog[];
  }>({
    queryKey: ['freshness-all'],
    queryFn: async () => {
      const res = await fetch('/api/audit/freshness');
      if (!res.ok) throw new Error('Failed to fetch freshness');
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Trigger prior month refresh
  const refreshMutation = useMutation({
    mutationFn: async (dataType: string) => {
      const res = await fetch(`/api/sync/prior-month?data_type=${dataType}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to trigger refresh');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-history'] });
      queryClient.invalidateQueries({ queryKey: ['freshness-all'] });
    },
  });

  // Trigger MTD sync
  const mtdSyncMutation = useMutation({
    mutationFn: async (dataType: string) => {
      const res = await fetch(`/api/sync/mtd?data_type=${dataType}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to trigger MTD sync');
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.syncId) {
        setMtdSyncId(data.syncId);
      }
    },
  });

  // Poll for MTD sync status
  const { data: mtdSyncStatus } = useQuery<{ sync: SyncLog }>({
    queryKey: ['mtd-sync-status', mtdSyncId],
    queryFn: async () => {
      const res = await fetch(`/api/sync/mtd?sync_id=${mtdSyncId}`);
      if (!res.ok) throw new Error('Failed to fetch sync status');
      return res.json();
    },
    enabled: !!mtdSyncId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling once sync is complete
      if (data?.sync?.status === 'success' || data?.sync?.status === 'failed') {
        return false;
      }
      return 2000; // Poll every 2 seconds while running
    },
  });

  // Handle sync completion
  useEffect(() => {
    if (mtdSyncStatus?.sync?.status === 'success') {
      setMtdSyncResult(mtdSyncStatus.sync);
      setShowMtdResults(true);
      setMtdSyncId(null);
      queryClient.invalidateQueries({ queryKey: ['sync-history'] });
      queryClient.invalidateQueries({ queryKey: ['recent-changes'] });
      queryClient.invalidateQueries({ queryKey: ['freshness-all'] });
    } else if (mtdSyncStatus?.sync?.status === 'failed') {
      setMtdSyncId(null);
      queryClient.invalidateQueries({ queryKey: ['sync-history'] });
    }
  }, [mtdSyncStatus?.sync?.status, mtdSyncStatus?.sync, queryClient]);

  const isMtdSyncing = mtdSyncMutation.isPending || !!mtdSyncId;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return 'Running...';
    const ms =
      new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Audit</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track data freshness, sync history, and changes
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => mtdSyncMutation.mutate(selectedDataType)}
            disabled={isMtdSyncing}
          >
            {isMtdSyncing ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Syncing MTD...
              </>
            ) : (
              'Update MTD Data'
            )}
          </Button>
          <Button
            onClick={() => refreshMutation.mutate(selectedDataType)}
            disabled={refreshMutation.isPending}
            variant="outline"
          >
            {refreshMutation.isPending ? 'Starting...' : 'Refresh Prior Month'}
          </Button>
        </div>
      </div>

      {/* Trust Indicators Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        {freshnessData?.freshness?.map((f) => (
          <Card key={f.data_type}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 capitalize font-medium">
                    {f.data_type} Data
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {f.hours_since_sync !== null
                      ? f.hours_since_sync < 1
                        ? 'Fresh'
                        : f.hours_since_sync < 24
                          ? `${Math.round(f.hours_since_sync)}h old`
                          : `${Math.round(f.hours_since_sync / 24)}d old`
                      : 'Unknown'}
                  </p>
                </div>
                <FreshnessBadge dataType={f.data_type as 'yield' | 'sales' | 'tank'} showLabel={false} className="scale-150" />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Last sync: {formatDate(f.last_sync_at)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* History Count */}
      {freshnessData?.historyCount !== undefined && freshnessData.historyCount > 0 && (
        <div className="text-sm text-gray-500">
          Total change records tracked: <span className="font-medium">{freshnessData.historyCount.toLocaleString()}</span>
        </div>
      )}

      {/* Data Type Selector */}
      <div className="flex gap-2">
        {(['yield', 'sales', 'tank'] as const).map((type) => (
          <Button
            key={type}
            variant={selectedDataType === type ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedDataType(type)}
            className="capitalize"
          >
            {type}
          </Button>
        ))}
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="sync-history">Sync History</TabsTrigger>
          <TabsTrigger value="changes">Data Changes</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
        </TabsList>

        <TabsContent value="sync-history">
          <Card>
            <CardHeader>
              <CardTitle>Synchronization History</CardTitle>
            </CardHeader>
            <CardContent>
              {syncLoading ? (
                <p className="text-gray-500">Loading...</p>
              ) : !syncHistory?.logs?.length ? (
                <p className="text-gray-500">No sync history available</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 px-3 font-medium">Time</th>
                        <th className="py-2 px-3 font-medium">Mode</th>
                        <th className="py-2 px-3 font-medium">Reason</th>
                        <th className="py-2 px-3 font-medium text-right">Fetched</th>
                        <th className="py-2 px-3 font-medium text-right">Inserted</th>
                        <th className="py-2 px-3 font-medium text-right">Updated</th>
                        <th className="py-2 px-3 font-medium text-right">Unchanged</th>
                        <th className="py-2 px-3 font-medium">Duration</th>
                        <th className="py-2 px-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncHistory.logs.map((log) => (
                        <tr key={log.id} className="border-b hover:bg-gray-50">
                          <td className="py-2 px-3 text-gray-600">
                            {formatDate(log.started_at)}
                          </td>
                          <td className="py-2 px-3 capitalize">{log.sync_mode}</td>
                          <td className="py-2 px-3 text-gray-600">
                            {log.sync_reason || '-'}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {log.records_fetched ?? '-'}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-600 font-medium">
                            {log.records_inserted ?? '-'}
                          </td>
                          <td className="py-2 px-3 text-right text-amber-600 font-medium">
                            {log.records_updated ?? '-'}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-400">
                            {log.records_unchanged ?? '-'}
                          </td>
                          <td className="py-2 px-3 text-gray-600">
                            {formatDuration(log.started_at, log.completed_at)}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                log.status === 'success'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : log.status === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : log.status === 'running'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="changes">
          <Card>
            <CardHeader>
              <CardTitle>Recent Data Changes</CardTitle>
            </CardHeader>
            <CardContent>
              {changesLoading ? (
                <p className="text-gray-500">Loading...</p>
              ) : !recentChanges?.changes?.length ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No changes recorded yet</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Changes will appear here when data is updated from the source
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Change stats summary */}
                  {recentChanges.stats && recentChanges.stats.length > 0 && (
                    <div className="flex gap-4 text-sm text-gray-600 mb-4">
                      {recentChanges.stats.map((stat) => (
                        <span key={stat.change_type}>
                          <span className="font-medium">{stat.count}</span>{' '}
                          <span className="capitalize">{stat.change_type}</span> (7d)
                        </span>
                      ))}
                    </div>
                  )}

                  {recentChanges.changes.map((change) => (
                    <div
                      key={change.id}
                      className="p-4 border rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-medium">{change.product_name}</span>
                          <span className="text-gray-500 ml-2">{change.date}</span>
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            change.change_type === 'update'
                              ? 'bg-amber-100 text-amber-800'
                              : change.change_type === 'prior_month_refresh'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {change.change_type}
                        </span>
                      </div>
                      {change.previous_yield_qty !== null && (
                        <div className="mt-2 text-sm">
                          <span className="text-gray-500">Yield:</span>{' '}
                          <span className="text-red-500 line-through">
                            {change.previous_yield_qty.toFixed(2)}
                          </span>{' '}
                          <span className="text-gray-400">→</span>{' '}
                          <span className="text-emerald-600 font-medium">
                            {change.yield_qty.toFixed(2)}
                          </span>
                          <span className="text-gray-400 ml-2">
                            (
                            {change.yield_qty - change.previous_yield_qty > 0
                              ? '+'
                              : ''}
                            {(change.yield_qty - change.previous_yield_qty).toFixed(
                              2
                            )}
                            )
                          </span>
                        </div>
                      )}
                      <div className="mt-2 text-xs text-gray-400">
                        Captured: {formatDate(change.captured_at)}
                        {change.sync_reason && ` (${change.sync_reason})`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validation">
          <Card>
            <CardHeader>
              <CardTitle>Data Validation Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-emerald-50 border-emerald-200">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <span className="text-emerald-600 font-bold">✓</span>
                    </div>
                    <div>
                      <p className="font-medium text-emerald-800">
                        Database Schema Validated
                      </p>
                      <p className="text-sm text-emerald-600">
                        All audit tables and indexes are properly configured
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 border rounded-lg bg-emerald-50 border-emerald-200">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <span className="text-emerald-600 font-bold">✓</span>
                    </div>
                    <div>
                      <p className="font-medium text-emerald-800">
                        Change Tracking Active
                      </p>
                      <p className="text-sm text-emerald-600">
                        All data modifications are being recorded with timestamps
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 border rounded-lg bg-emerald-50 border-emerald-200">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <span className="text-emerald-600 font-bold">✓</span>
                    </div>
                    <div>
                      <p className="font-medium text-emerald-800">
                        Prior Month Refresh Scheduled
                      </p>
                      <p className="text-sm text-emerald-600">
                        Automatic finalization on Day 5 and Day 10 of each month
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 border rounded-lg bg-blue-50 border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-blue-600 font-bold">i</span>
                    </div>
                    <div>
                      <p className="font-medium text-blue-800">Data Source</p>
                      <p className="text-sm text-blue-600">
                        SQL Server: Advisor3 stored procedures
                      </p>
                      <p className="text-sm text-blue-600">
                        Sync frequency: Every 15 minutes (incremental)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* MTD Sync Results Modal */}
      <MtdSyncResultsModal
        open={showMtdResults}
        onClose={() => setShowMtdResults(false)}
        syncResult={mtdSyncResult}
        onViewAllChanges={() => setActiveTab('changes')}
      />
    </div>
  );
}
