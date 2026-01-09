'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Get month options for the last 12 months
function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      shortLabel: date.toLocaleDateString('en-US', { month: 'short' }),
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    });
  }
  return options;
}

interface BucketMTD {
  bucket_name: string;
  display_order: number;
  mtd_daily_avg: number;
  is_virtual: boolean;
}

interface YieldTarget {
  bucket_name: string;
  month: string;
  monthly_plan_target: number | null;
  business_plan_target: number | null;
  monthly_plan_rate: number | null;
  business_plan_rate: number | null;
}

interface EditableTarget {
  bucket_name: string;
  monthly_plan_target: string;
  business_plan_target: string;
  monthly_plan_rate: string;
  business_plan_rate: string;
}

// Status thresholds (percentage points from target)
const STATUS_THRESHOLDS = {
  good: 0,
  warning: 1, // Within 1 percentage point
  bad: 2,     // More than 2 percentage points off
};

// Direction preference for each bucket
// 'higher' = above target is good (green), below is bad (red)
// 'lower' = below target is good (green), above is bad (red)
// 'near' = close to target is good, far from target is bad
type DirectionPreference = 'higher' | 'lower' | 'near';

const BUCKET_DIRECTION: Record<string, DirectionPreference> = {
  'Crude Rate': 'higher',
  'Jet': 'higher',
  'ULSD': 'higher',
  'Distillate': 'higher',
  'VGO': 'higher',
  'Base Oil': 'higher',
  'UMO VGO': 'higher',
  'PBOB': 'higher',
  'Loss': 'lower',
  'LPG': 'lower',
  'VTB': 'lower',
  'CBOB': 'near',
};

function getStatus(variance: number | null, bucketName: string): 'good' | 'warning' | 'bad' | 'none' {
  if (variance === null) return 'none';

  const direction = BUCKET_DIRECTION[bucketName] || 'higher'; // Default to higher is better
  const absVariance = Math.abs(variance);

  if (direction === 'higher') {
    // Above target = good, below = bad
    if (variance >= STATUS_THRESHOLDS.good) return 'good';
    if (variance >= -STATUS_THRESHOLDS.warning) return 'warning';
    return 'bad';
  } else if (direction === 'lower') {
    // Below target = good, above = bad
    if (variance <= STATUS_THRESHOLDS.good) return 'good';
    if (variance <= STATUS_THRESHOLDS.warning) return 'warning';
    return 'bad';
  } else {
    // Near target = good, far = bad (either direction)
    if (absVariance <= STATUS_THRESHOLDS.good) return 'good';
    if (absVariance <= STATUS_THRESHOLDS.warning) return 'warning';
    return 'bad';
  }
}

function getVariancePct(actualPct: number | null, targetPct: number | null): number | null {
  if (actualPct === null || targetPct === null || targetPct === 0) return null;
  return actualPct - targetPct;
}

function getVarianceRate(actualRate: number | null, targetRate: number | null, crudeRate: number): number | null {
  if (actualRate === null || targetRate === null || targetRate === 0 || crudeRate === 0) return null;
  // Convert rate variance to percentage points for consistent comparison
  const actualPct = (actualRate / crudeRate) * 100;
  const targetPct = (targetRate / crudeRate) * 100;
  return actualPct - targetPct;
}

// Format number with commas
function formatNumber(num: number, decimals: number = 0): string {
  return Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Status Bar Component with variance visualization
function StatusBar({ status, variance }: { status: 'good' | 'warning' | 'bad' | 'none'; variance: number | null }) {
  if (status === 'none' || variance === null) {
    return <div className="h-2 w-full bg-gray-200 rounded-full" />;
  }

  const colors = {
    good: 'from-emerald-500 to-emerald-400',
    warning: 'from-amber-500 to-amber-400',
    bad: 'from-rose-500 to-rose-400',
  };

  const shadowColors = {
    good: 'shadow-emerald-500/30',
    warning: 'shadow-amber-500/30',
    bad: 'shadow-rose-500/30',
  };

  // Clamp variance to -5 to +5 for visualization
  const clampedVariance = Math.max(-5, Math.min(5, variance));
  const width = Math.abs(clampedVariance) * 20; // 20% per percentage point

  return (
    <div className="relative h-2 w-full bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`absolute top-0 h-full bg-gradient-to-r ${colors[status]} rounded-full shadow-md ${shadowColors[status]} transition-all duration-500`}
        style={{
          width: `${Math.max(8, width)}%`,
          left: variance >= 0 ? '50%' : `${50 - width}%`,
        }}
      />
      <div className="absolute top-0 left-1/2 w-px h-full bg-gray-400" />
    </div>
  );
}

export default function MonthlyYieldTable() {
  const queryClient = useQueryClient();
  const monthOptions = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]);
  const [isEditing, setIsEditing] = useState(false);
  const [editTargets, setEditTargets] = useState<EditableTarget[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Fetch MTD data
  const { data: mtdData, isLoading: mtdLoading } = useQuery({
    queryKey: ['yield-mtd', selectedMonth.value],
    queryFn: async () => {
      const res = await fetch(`/api/yield/mtd?month=${selectedMonth.value}`);
      if (!res.ok) throw new Error('Failed to fetch MTD data');
      return res.json();
    },
  });

  // Fetch targets for selected month
  const { data: targetsData, isLoading: targetsLoading } = useQuery({
    queryKey: ['yield-targets', selectedMonth.value],
    queryFn: async () => {
      const res = await fetch(`/api/targets?month=${selectedMonth.value}`);
      if (!res.ok) throw new Error('Failed to fetch targets');
      return res.json();
    },
  });

  // Save targets mutation
  const saveTargetsMutation = useMutation({
    mutationFn: async (targets: Partial<YieldTarget>[]) => {
      const res = await fetch('/api/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth.value, targets }),
      });
      if (!res.ok) throw new Error('Failed to save targets');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yield-targets', selectedMonth.value] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: () => {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
  });

  // Create lookup for targets
  const targetsLookup = useMemo(() => {
    const lookup: Record<string, YieldTarget> = {};
    if (targetsData?.targets) {
      targetsData.targets.forEach((t: YieldTarget) => {
        lookup[t.bucket_name] = t;
      });
    }
    return lookup;
  }, [targetsData]);

  // Get crude rate daily average for percentage calculations (use absolute value)
  const crudeRateDailyAvg = Math.abs(mtdData?.meta?.crude_rate_daily_avg || 0);
  const dayCount = mtdData?.meta?.day_count || 0;

  // Get crude rate targets for auto-calculation
  const crudeRateTarget = targetsLookup['Crude Rate'];
  const crudeRatePlanRate = crudeRateTarget?.monthly_plan_rate || null;
  const crudeRateBpRate = crudeRateTarget?.business_plan_rate || null;

  // Combine MTD data with targets
  const tableData = useMemo(() => {
    if (!mtdData?.data) return [];

    return mtdData.data.map((bucket: BucketMTD) => {
      const target = targetsLookup[bucket.bucket_name];
      const isCrudeRate = bucket.bucket_name === 'Crude Rate';

      // Use absolute value for display (crude can be negative in some accounting)
      const displayValue = Math.abs(bucket.mtd_daily_avg);

      // Calculate actual yield percentage (bucket daily avg / crude rate daily avg)
      const actualPct = isCrudeRate ? null : crudeRateDailyAvg > 0
        ? (Math.abs(bucket.mtd_daily_avg) / crudeRateDailyAvg) * 100
        : null;

      // Get raw target values
      const rawMonthlyPlanPct = isCrudeRate ? null : target?.monthly_plan_target || null;
      const rawBusinessPlanPct = isCrudeRate ? null : target?.business_plan_target || null;
      const rawMonthlyPlanRate = target?.monthly_plan_rate || null;
      const rawBusinessPlanRate = target?.business_plan_rate || null;

      // Auto-calculate missing values based on crude rate targets
      let monthlyPlanPct = rawMonthlyPlanPct;
      let monthlyPlanRate = rawMonthlyPlanRate;
      let businessPlanPct = rawBusinessPlanPct;
      let businessPlanRate = rawBusinessPlanRate;

      if (!isCrudeRate) {
        // Monthly Plan: auto-calculate % from rate or rate from %
        if (monthlyPlanRate !== null && monthlyPlanPct === null && crudeRatePlanRate) {
          monthlyPlanPct = (monthlyPlanRate / crudeRatePlanRate) * 100;
        } else if (monthlyPlanPct !== null && monthlyPlanRate === null && crudeRatePlanRate) {
          monthlyPlanRate = (monthlyPlanPct / 100) * crudeRatePlanRate;
        }

        // Business Plan: auto-calculate % from rate or rate from %
        if (businessPlanRate !== null && businessPlanPct === null && crudeRateBpRate) {
          businessPlanPct = (businessPlanRate / crudeRateBpRate) * 100;
        } else if (businessPlanPct !== null && businessPlanRate === null && crudeRateBpRate) {
          businessPlanRate = (businessPlanPct / 100) * crudeRateBpRate;
        }
      }

      // Determine variance - prefer percentage target, fallback to rate-based calculation
      let variance: number | null = null;
      if (isCrudeRate) {
        // For crude rate, calculate variance as percentage difference from plan
        if (monthlyPlanRate !== null && monthlyPlanRate > 0) {
          variance = ((displayValue - monthlyPlanRate) / monthlyPlanRate) * 100;
        }
      } else {
        // First try percentage-based variance
        variance = getVariancePct(actualPct, monthlyPlanPct);
        // If no percentage target, calculate from rate targets
        if (variance === null && monthlyPlanRate !== null) {
          variance = getVarianceRate(displayValue, monthlyPlanRate, crudeRateDailyAvg);
        }
      }
      const status = getStatus(variance, bucket.bucket_name);

      return {
        bucket_name: bucket.bucket_name,
        display_order: bucket.display_order,
        mtd_daily_avg: displayValue,
        actual_pct: actualPct,
        monthly_plan_pct: monthlyPlanPct,
        business_plan_pct: businessPlanPct,
        monthly_plan_rate: monthlyPlanRate,
        business_plan_rate: businessPlanRate,
        status,
        variance,
        is_crude_rate: isCrudeRate,
      };
    });
  }, [mtdData, targetsLookup, crudeRateDailyAvg, crudeRatePlanRate, crudeRateBpRate]);

  // Initialize edit targets when entering edit mode
  useEffect(() => {
    if (isEditing && mtdData?.data) {
      setEditTargets(
        mtdData.data
          .map((bucket: BucketMTD) => {
            const target = targetsLookup[bucket.bucket_name];
            return {
              bucket_name: bucket.bucket_name,
              monthly_plan_target: target?.monthly_plan_target?.toString() || '',
              business_plan_target: target?.business_plan_target?.toString() || '',
              monthly_plan_rate: target?.monthly_plan_rate?.toString() || '',
              business_plan_rate: target?.business_plan_rate?.toString() || '',
            };
          })
      );
    }
  }, [isEditing, mtdData, targetsLookup]);

  // Handle target input change
  const handleTargetChange = useCallback((
    bucketName: string,
    field: 'monthly_plan_target' | 'business_plan_target' | 'monthly_plan_rate' | 'business_plan_rate',
    value: string
  ) => {
    setEditTargets(prev =>
      prev.map(t =>
        t.bucket_name === bucketName ? { ...t, [field]: value } : t
      )
    );
  }, []);

  // Save targets
  const handleSave = useCallback(() => {
    setSaveStatus('saving');
    const targets = editTargets.map(t => ({
      bucket_name: t.bucket_name,
      monthly_plan_target: t.monthly_plan_target ? parseFloat(t.monthly_plan_target) : null,
      business_plan_target: t.business_plan_target ? parseFloat(t.business_plan_target) : null,
      monthly_plan_rate: t.monthly_plan_rate ? parseFloat(t.monthly_plan_rate) : null,
      business_plan_rate: t.business_plan_rate ? parseFloat(t.business_plan_rate) : null,
    }));
    saveTargetsMutation.mutate(targets);
    setIsEditing(false);
  }, [editTargets, saveTargetsMutation]);

  // Cancel editing
  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditTargets([]);
  }, []);

  const isLoading = mtdLoading || targetsLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 text-gray-900 p-6 font-sans">
      {/* CSS for custom styling */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');

        .font-mono-data {
          font-family: 'JetBrains Mono', monospace;
          font-feature-settings: 'tnum' on, 'lnum' on;
        }

        .yield-input {
          background: white;
          border: 1px solid #d1d5db;
          color: #111827;
          font-family: 'JetBrains Mono', monospace;
          transition: all 0.2s ease;
        }

        .yield-input:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
        }

        .yield-input::placeholder {
          color: #9ca3af;
        }

        .table-row-hover:hover {
          background: rgba(249, 250, 251, 0.8);
        }

        .pulse-save {
          animation: pulse-glow 2s ease-out;
        }

        @keyframes pulse-glow {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
      `}</style>

      {/* Header Section */}
      <div className="max-w-7xl mx-auto">
        {/* Title Bar */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-2 h-8 bg-gradient-to-b from-amber-500 to-amber-600 rounded-full shadow-lg shadow-amber-500/30" />
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                Yield Performance
              </h1>
            </div>
            <p className="text-gray-500 text-sm ml-5">
              MTD Daily Averages vs Plan Targets
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {saveStatus === 'saving' && (
              <span className="text-sm text-gray-500 flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-sm text-emerald-600 flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-rose-600">Error saving</span>
            )}

            {isEditing ? (
              <>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-amber-600 rounded-lg hover:from-amber-600 hover:to-amber-700 transition-all shadow-lg shadow-amber-500/25"
                >
                  Save Targets
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm"
              >
                Edit Targets
              </button>
            )}
          </div>
        </div>

        {/* Month Selector */}
        <div className="mb-6">
          <div className="inline-flex bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
            {monthOptions.slice(0, 6).map((month, idx) => (
              <button
                key={month.value}
                onClick={() => setSelectedMonth(month)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  selectedMonth.value === month.value
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/25'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {month.shortLabel}
                {idx === 0 && (
                  <span className={`ml-1.5 text-[10px] uppercase tracking-wider ${
                    selectedMonth.value === month.value ? 'opacity-80' : 'opacity-50'
                  }`}>
                    {month.year}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Meta Info */}
        {mtdData?.meta && (
          <div className="flex items-center gap-6 mb-6 text-xs text-gray-500 font-mono-data uppercase tracking-wide">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              Data through {mtdData.meta.end_date}
            </span>
            <span>{dayCount} operating days</span>
            <span>{mtdData.meta.query_time_ms}ms</span>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-8 mb-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-md shadow-emerald-500/30" />
            <span className="text-gray-600">Above Target</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-md shadow-amber-500/30" />
            <span className="text-gray-600">Near Target (±1%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 shadow-md shadow-rose-500/30" />
            <span className="text-gray-600">Below Target</span>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xl shadow-gray-200/50">
          {isLoading ? (
            <div className="h-[500px] flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                <p className="text-gray-500 text-sm">Loading yield data...</p>
              </div>
            </div>
          ) : tableData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80">
                    <th className="text-left py-4 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Product Bucket
                    </th>
                    <th className="text-right py-4 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <div>Plan</div>
                      <div className="text-[10px] text-gray-400 font-normal mt-0.5">BBL / %</div>
                    </th>
                    <th className="text-right py-4 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <div>BP</div>
                      <div className="text-[10px] text-gray-400 font-normal mt-0.5">BBL / %</div>
                    </th>
                    <th className="text-right py-4 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Daily Avg <span className="text-gray-400 font-normal">(BBL)</span>
                    </th>
                    <th className="text-right py-4 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Actual %
                    </th>
                    <th className="py-4 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">
                      Variance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tableData.map((row: any, idx: number) => {
                    const editRow = editTargets.find(t => t.bucket_name === row.bucket_name);

                    return (
                      <tr
                        key={row.bucket_name}
                        className={`table-row-hover transition-colors ${
                          row.is_crude_rate
                            ? 'bg-gradient-to-r from-amber-50 to-transparent border-l-2 border-l-amber-500'
                            : ''
                        }`}
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            {row.is_crude_rate ? (
                              <div className="w-2 h-2 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-gray-300" />
                            )}
                            <span className={`font-medium ${row.is_crude_rate ? 'text-amber-700' : 'text-gray-900'}`}>
                              {row.bucket_name}
                            </span>
                          </div>
                        </td>
                        {/* Plan Column */}
                        <td className="text-right py-3 px-6 font-mono-data">
                          {isEditing ? (
                            row.is_crude_rate ? (
                              <input
                                type="number"
                                step="100"
                                className="yield-input w-20 px-2 py-1 text-right text-xs rounded"
                                value={editRow?.monthly_plan_rate || ''}
                                onChange={(e) =>
                                  handleTargetChange(row.bucket_name, 'monthly_plan_rate', e.target.value)
                                }
                                placeholder="BBL"
                              />
                            ) : (
                              <div className="flex flex-col gap-1.5 items-end">
                                <input
                                  type="number"
                                  step="100"
                                  className="yield-input w-20 px-2 py-1 text-right text-xs rounded"
                                  value={editRow?.monthly_plan_rate || ''}
                                  onChange={(e) =>
                                    handleTargetChange(row.bucket_name, 'monthly_plan_rate', e.target.value)
                                  }
                                  placeholder="BBL"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  className="yield-input w-20 px-2 py-1 text-right text-xs rounded"
                                  value={editRow?.monthly_plan_target || ''}
                                  onChange={(e) =>
                                    handleTargetChange(row.bucket_name, 'monthly_plan_target', e.target.value)
                                  }
                                  placeholder="%"
                                />
                              </div>
                            )
                          ) : row.is_crude_rate ? (
                            row.monthly_plan_rate !== null ? (
                              <span className="text-amber-700 text-sm font-medium">
                                {formatNumber(row.monthly_plan_rate, 0)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )
                          ) : (row.monthly_plan_rate !== null || row.monthly_plan_pct !== null) ? (
                            <div className="flex flex-col">
                              <span className="text-gray-700 text-sm">
                                {row.monthly_plan_rate !== null ? formatNumber(row.monthly_plan_rate, 0) : '—'}
                              </span>
                              <span className="text-gray-500 text-xs">
                                {row.monthly_plan_pct !== null ? `${row.monthly_plan_pct.toFixed(2)}%` : '—'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="text-right py-3 px-6 font-mono-data">
                          {isEditing ? (
                            row.is_crude_rate ? (
                              <input
                                type="number"
                                step="100"
                                className="yield-input w-20 px-2 py-1 text-right text-xs rounded"
                                value={editRow?.business_plan_rate || ''}
                                onChange={(e) =>
                                  handleTargetChange(row.bucket_name, 'business_plan_rate', e.target.value)
                                }
                                placeholder="BBL"
                              />
                            ) : (
                              <div className="flex flex-col gap-1.5 items-end">
                                <input
                                  type="number"
                                  step="100"
                                  className="yield-input w-20 px-2 py-1 text-right text-xs rounded"
                                  value={editRow?.business_plan_rate || ''}
                                  onChange={(e) =>
                                    handleTargetChange(row.bucket_name, 'business_plan_rate', e.target.value)
                                  }
                                  placeholder="BBL"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  className="yield-input w-20 px-2 py-1 text-right text-xs rounded"
                                  value={editRow?.business_plan_target || ''}
                                  onChange={(e) =>
                                    handleTargetChange(row.bucket_name, 'business_plan_target', e.target.value)
                                  }
                                  placeholder="%"
                                />
                              </div>
                            )
                          ) : row.is_crude_rate ? (
                            row.business_plan_rate !== null ? (
                              <span className="text-amber-600 text-sm">
                                {formatNumber(row.business_plan_rate, 0)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )
                          ) : (row.business_plan_rate !== null || row.business_plan_pct !== null) ? (
                            <div className="flex flex-col">
                              <span className="text-gray-600 text-sm">
                                {row.business_plan_rate !== null ? formatNumber(row.business_plan_rate, 0) : '—'}
                              </span>
                              <span className="text-gray-400 text-xs">
                                {row.business_plan_pct !== null ? `${row.business_plan_pct.toFixed(2)}%` : '—'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        {/* Daily Avg Column */}
                        <td className="text-right py-4 px-6 font-mono-data">
                          <span className={`font-semibold ${
                            row.is_crude_rate ? (
                              row.status === 'good' ? 'text-emerald-600' :
                              row.status === 'warning' ? 'text-amber-600' :
                              row.status === 'bad' ? 'text-rose-600' : 'text-gray-900'
                            ) : 'text-gray-900'
                          }`}>
                            {formatNumber(row.mtd_daily_avg, 0)}
                          </span>
                        </td>
                        {/* Actual % Column */}
                        <td className="text-right py-4 px-6 font-mono-data">
                          {row.actual_pct !== null ? (
                            <span className={`font-semibold ${
                              row.status === 'good' ? 'text-emerald-600' :
                              row.status === 'warning' ? 'text-amber-600' :
                              row.status === 'bad' ? 'text-rose-600' : 'text-gray-900'
                            }`}>
                              {row.actual_pct.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        {/* Variance Column */}
                        <td className="py-4 px-6">
                          {row.variance !== null ? (
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <StatusBar status={row.status} variance={row.variance} />
                              </div>
                              <span className={`font-mono-data text-xs min-w-[50px] text-right font-semibold ${
                                row.variance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {row.variance >= 0 ? '+' : ''}{row.variance.toFixed(2)}%
                              </span>
                            </div>
                          ) : (
                            <div className="h-2" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <p className="text-gray-500">No yield data available for {selectedMonth.label}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="mt-6 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-6">
            <span>
              <strong className="text-gray-700">Yield %</strong> = Daily Avg / Crude Rate × 100
            </span>
            <span>
              <strong className="text-gray-700">Variance</strong> = Actual % − Plan %
            </span>
          </div>
          <span className="font-mono-data">
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}
