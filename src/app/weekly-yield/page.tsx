'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart, TimeSeriesDataPoint, ReferenceLineConfig, YAxisBounds } from '@/components/charts/time-series-chart';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

// Chart color palette (matching time-series-chart.tsx)
const CHART_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
];

// Default buckets to show
const defaultSelections = ['Jet', 'ULSD', 'Distillate', 'Loss'];

interface BucketConfig {
  id: number;
  bucket_type: string;
  bucket_name: string;
  component_products: string[];
  is_virtual: boolean;
  display_order: number;
}

interface WeeklyData {
  data: {
    dates: string[];
    buckets: Record<string, {
      daily_pct: (number | null)[];
      daily_rate: (number | null)[];
      target_pct: number | null;
      target_rate: number | null;
    }>;
  };
  meta: {
    start_date: string;
    end_date: string;
    month: string;
    query_time_ms: number;
  };
}

// Format date for display
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startStr} - ${endStr}`;
}

export default function WeeklyYieldPage() {
  const [endDate, setEndDate] = useState<string | null>(null);
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>(defaultSelections);
  const [yAxisBounds, setYAxisBounds] = useState<YAxisBounds>({ min: null, max: null });

  // Fetch bucket configs
  const { data: bucketsData } = useQuery({
    queryKey: ['buckets', 'yield'],
    queryFn: async () => {
      const res = await fetch('/api/buckets?type=yield');
      if (!res.ok) throw new Error('Failed to fetch buckets');
      return res.json();
    },
  });

  const buckets: BucketConfig[] = bucketsData?.buckets || [];
  const selectableBuckets = useMemo(() => {
    return buckets
      .filter(b => b.display_order < 99) // Exclude hidden buckets
      .sort((a, b) => a.display_order - b.display_order)
      .map(b => b.bucket_name);
  }, [buckets]);

  // Fetch weekly data
  const { data, isLoading, error } = useQuery<WeeklyData>({
    queryKey: ['weekly-yield', endDate],
    queryFn: async () => {
      const url = endDate
        ? `/api/yield/weekly?end_date=${endDate}`
        : '/api/yield/weekly';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch weekly yield data');
      return res.json();
    },
  });

  // Set initial endDate from fetched data
  const effectiveEndDate = endDate || data?.meta?.end_date || null;

  // Date navigation
  const navigateDate = useCallback((days: number) => {
    if (!effectiveEndDate) return;
    const date = new Date(effectiveEndDate);
    date.setDate(date.getDate() + days);
    setEndDate(date.toISOString().split('T')[0]);
    // Reset y-axis bounds on date change
    setYAxisBounds({ min: null, max: null });
  }, [effectiveEndDate]);

  const goToLatest = useCallback(() => {
    setEndDate(null);
    setYAxisBounds({ min: null, max: null });
  }, []);

  // Transform data for chart
  const chartData = useMemo((): TimeSeriesDataPoint[] => {
    if (!data?.data?.dates) return [];

    return data.data.dates.map((date, idx) => {
      const row: TimeSeriesDataPoint = { date };
      selectedBuckets.forEach(bucket => {
        const bucketData = data.data.buckets[bucket];
        if (bucketData) {
          row[bucket] = bucketData.daily_pct[idx];
        }
      });
      return row;
    });
  }, [data, selectedBuckets]);

  // Build reference lines for MOP targets
  const referenceLines = useMemo((): ReferenceLineConfig[] => {
    if (!data?.data?.buckets) return [];

    const lines: ReferenceLineConfig[] = [];
    selectedBuckets.forEach((bucket, idx) => {
      const bucketData = data.data.buckets[bucket];
      if (bucketData?.target_pct != null) {
        lines.push({
          value: bucketData.target_pct,
          label: `${bucket} MOP`,
          color: CHART_COLORS[idx % CHART_COLORS.length],
          seriesKey: bucket,
        });
      }
    });
    return lines;
  }, [data, selectedBuckets]);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    if (!data?.data?.buckets) return [];

    return selectedBuckets.map((bucket, idx) => {
      const bucketData = data.data.buckets[bucket];
      if (!bucketData) return null;

      const validPcts = bucketData.daily_pct.filter((v): v is number => v !== null);
      if (validPcts.length === 0) return null;

      const avg = validPcts.reduce((a, b) => a + b, 0) / validPcts.length;
      const target = bucketData.target_pct;
      const variance = target != null ? avg - target : null;

      return {
        bucket,
        avg,
        target,
        variance,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      };
    }).filter(Boolean) as Array<{
      bucket: string;
      avg: number;
      target: number | null;
      variance: number | null;
      color: string;
    }>;
  }, [data, selectedBuckets]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Yield Look Back</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Navigation */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Week Ending
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateDate(-7)}
                disabled={!effectiveEndDate}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateDate(-1)}
                disabled={!effectiveEndDate}
              >
                <ChevronLeft className="h-4 w-4" />
                Day
              </Button>

              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <input
                  type="date"
                  value={effectiveEndDate || ''}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setYAxisBounds({ min: null, max: null });
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateDate(1)}
                disabled={!effectiveEndDate}
              >
                Day
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateDate(7)}
                disabled={!effectiveEndDate}
              >
                Next Week
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={goToLatest}
              >
                Latest
              </Button>
            </div>
            {data?.meta && (
              <p className="text-sm text-gray-500 mt-2">
                Showing: <strong>{formatDateRange(data.meta.start_date, data.meta.end_date)}</strong>
                <span className="mx-2">|</span>
                MOP targets from: <strong>{data.meta.month}</strong>
              </p>
            )}
          </div>

          {/* Bucket Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Buckets ({selectedBuckets.length} selected)
            </label>
            <div className="flex flex-wrap gap-2">
              {selectableBuckets.map((bucket) => (
                <Button
                  key={bucket}
                  variant={selectedBuckets.includes(bucket) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedBuckets(prev =>
                      prev.includes(bucket)
                        ? prev.filter(b => b !== bucket)
                        : [...prev, bucket]
                    );
                  }}
                >
                  {bucket}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Indicator */}
      {data?.meta && (
        <div className="text-sm text-gray-500">
          Query completed in <strong>{data.meta.query_time_ms}ms</strong>
        </div>
      )}

      {/* Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Daily Yield % vs MOP Target</CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                Dashed lines show MOP (Monthly Plan) targets for each bucket
                {(yAxisBounds.min !== null || yAxisBounds.max !== null) && (
                  <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                    Y: {yAxisBounds.min ?? 'auto'} - {yAxisBounds.max ?? 'auto'}
                  </span>
                )}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">Loading chart...</p>
            </div>
          ) : error ? (
            <div className="h-[400px] flex items-center justify-center bg-red-50 rounded-lg">
              <p className="text-red-600">Failed to load data</p>
            </div>
          ) : chartData.length > 0 ? (
            <TimeSeriesChart
              data={chartData}
              seriesKeys={selectedBuckets}
              height={400}
              showDataZoom={false}
              chartType="bar"
              yAxisLabel="Yield %"
              yAxisBounds={yAxisBounds}
              onYAxisBoundsChange={setYAxisBounds}
              referenceLines={referenceLines}
            />
          ) : (
            <div className="h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">No data available for selected week</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Table */}
      {summaryStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Weekly Summary vs MOP</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-semibold">Bucket</th>
                    <th className="text-right py-2 px-3 font-semibold">Weekly Avg %</th>
                    <th className="text-right py-2 px-3 font-semibold">MOP Target %</th>
                    <th className="text-right py-2 px-3 font-semibold">Variance</th>
                    <th className="text-center py-2 px-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryStats.map((stat) => {
                    const isLoss = stat.bucket === 'Loss';
                    const isGood = stat.variance != null
                      ? (isLoss ? stat.variance <= 0 : stat.variance >= 0)
                      : null;
                    const isWarning = stat.variance != null && Math.abs(stat.variance) < 1;

                    return (
                      <tr key={stat.bucket} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-3">
                          <span className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: stat.color }}
                            />
                            <span className="font-medium">{stat.bucket}</span>
                          </span>
                        </td>
                        <td className="text-right py-2 px-3">{stat.avg.toFixed(2)}%</td>
                        <td className="text-right py-2 px-3">
                          {stat.target != null ? `${stat.target.toFixed(2)}%` : '-'}
                        </td>
                        <td className="text-right py-2 px-3">
                          {stat.variance != null ? (
                            <span className={
                              isGood
                                ? 'text-green-600'
                                : isWarning
                                  ? 'text-yellow-600'
                                  : 'text-red-600'
                            }>
                              {stat.variance >= 0 ? '+' : ''}{stat.variance.toFixed(2)} pp
                            </span>
                          ) : '-'}
                        </td>
                        <td className="text-center py-2 px-3">
                          {stat.variance != null && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              isGood
                                ? 'bg-green-100 text-green-800'
                                : isWarning
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                            }`}>
                              {isGood ? 'Good' : isWarning ? 'Warning' : 'Below'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
