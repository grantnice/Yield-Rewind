'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SyncResult {
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
}

interface MtdSyncResultsModalProps {
  open: boolean;
  onClose: () => void;
  syncResult: SyncResult | null;
  onViewAllChanges: () => void;
}

export function MtdSyncResultsModal({
  open,
  onClose,
  syncResult,
  onViewAllChanges,
}: MtdSyncResultsModalProps) {
  // Fetch changes for this specific sync
  const { data: changesData } = useQuery<{
    changes: ChangeRecord[];
  }>({
    queryKey: ['sync-changes', syncResult?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit/changes?data_type=yield&sync_id=${syncResult?.id}&limit=5`
      );
      if (!res.ok) throw new Error('Failed to fetch changes');
      return res.json();
    },
    enabled: open && !!syncResult?.id,
  });

  if (!syncResult) return null;

  const inserted = syncResult.records_inserted ?? 0;
  const updated = syncResult.records_updated ?? 0;
  const unchanged = syncResult.records_unchanged ?? 0;
  const hasChanges = inserted > 0 || updated > 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>MTD Sync Complete</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
              <div className="text-2xl font-bold text-emerald-600">
                {inserted}
              </div>
              <div className="text-xs text-emerald-700 font-medium">
                New Records
              </div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-center">
              <div className="text-2xl font-bold text-amber-600">{updated}</div>
              <div className="text-xs text-amber-700 font-medium">Updated</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-center">
              <div className="text-2xl font-bold text-gray-500">{unchanged}</div>
              <div className="text-xs text-gray-600 font-medium">Unchanged</div>
            </div>
          </div>

          {/* Date Range */}
          {syncResult.date_range_start && syncResult.date_range_end && (
            <div className="text-sm text-gray-500 text-center">
              Synced data from {syncResult.date_range_start} to{' '}
              {syncResult.date_range_end}
            </div>
          )}

          {/* Preview of Changes */}
          {hasChanges && changesData?.changes && changesData.changes.length > 0 && (
            <div className="border rounded-lg p-3 space-y-2">
              <div className="text-sm font-medium text-gray-700">
                Recent Changes
              </div>
              {changesData.changes.map((change) => (
                <div
                  key={change.id}
                  className="text-sm py-2 border-b last:border-b-0"
                >
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-gray-800">
                      {change.product_name}
                    </span>
                    <span className="text-gray-500 text-xs">{change.date}</span>
                  </div>
                  {change.previous_yield_qty !== null ? (
                    <div className="text-xs mt-1">
                      <span className="text-red-500 line-through">
                        {change.previous_yield_qty.toFixed(2)}
                      </span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className="text-emerald-600 font-medium">
                        {change.yield_qty.toFixed(2)}
                      </span>
                      <span className="text-gray-400 ml-1">
                        (
                        {change.yield_qty - change.previous_yield_qty > 0
                          ? '+'
                          : ''}
                        {(
                          change.yield_qty - change.previous_yield_qty
                        ).toFixed(2)}
                        )
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs mt-1 text-emerald-600">
                      New: {change.yield_qty.toFixed(2)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* No Changes Message */}
          {!hasChanges && (
            <div className="text-center py-4 text-gray-500">
              No data changes detected. All records were unchanged.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasChanges && (
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                onViewAllChanges();
              }}
            >
              View All Changes
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
