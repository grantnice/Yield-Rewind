'use client';

import { useMemo } from 'react';
import { TimeSeriesChart } from './time-series-chart';
import type { TimeSeriesDataPoint } from './time-series-chart';

const FEEDSTOCK_BUCKETS = new Set(['Crude Rate', 'UMO VGO']);

export interface MonthlyBucketData {
  actuals: (number | null)[];
  mop: (number | null)[];
  bp: (number | null)[];
}

interface MonthlyTrendChartProps {
  months: string[]; // YYYY-MM strings in chronological order
  buckets: Record<string, MonthlyBucketData>;
  selectedBuckets: string[];
  height?: number;
  loading?: boolean;
}

/**
 * Multi-month trend chart showing actuals vs MOP vs BP per bucket.
 *
 * Actuals render as solid lines. MOP renders as dashed (via priorPeriodKeys _prior1).
 * BP renders as lighter dashed (via priorPeriodKeys _prior2). This reuses the existing
 * TimeSeriesChart prior-period styling without needing new props.
 *
 * When feedstock (BBL/day) and non-feedstock (yield %) buckets are selected together,
 * feedstock series go on the secondary (right) y-axis.
 */
export function MonthlyTrendChart({
  months,
  buckets,
  selectedBuckets,
  height = 420,
  loading = false,
}: MonthlyTrendChartProps) {
  const hasFeedstock = selectedBuckets.some(b => FEEDSTOCK_BUCKETS.has(b));
  const hasNonFeedstock = selectedBuckets.some(b => !FEEDSTOCK_BUCKETS.has(b));
  const mixedUnits = hasFeedstock && hasNonFeedstock;

  const { data, seriesKeys, seriesLabels, priorPeriodKeys, secondaryAxisKeys } = useMemo(() => {
    const data: TimeSeriesDataPoint[] = months.map((month, monthIdx) => {
      const [y, m] = month.split('-').map(Number);
      // Format as "Apr '25" for x-axis labels
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
      const row: TimeSeriesDataPoint = { date: month, month_label: label };

      for (const bucket of selectedBuckets) {
        const bd = buckets[bucket];
        if (!bd) continue;
        // Actual → base key name
        // MOP    → _prior1 (dashed, 70% opacity, same color as actual)
        // BP     → _prior2 (lighter dashed, 50% opacity, same color as actual)
        row[bucket] = bd.actuals[monthIdx] ?? null;
        row[`${bucket}_prior1`] = bd.mop[monthIdx] ?? null;
        row[`${bucket}_prior2`] = bd.bp[monthIdx] ?? null;
      }
      return row;
    });

    const seriesKeys: string[] = [];
    const priorPeriodKeys: string[] = [];
    const seriesLabels: Record<string, string> = {};
    const secondaryAxisKeys: string[] = [];

    for (const bucket of selectedBuckets) {
      if (!buckets[bucket]) continue;
      seriesKeys.push(bucket, `${bucket}_prior1`, `${bucket}_prior2`);
      priorPeriodKeys.push(`${bucket}_prior1`, `${bucket}_prior2`);
      seriesLabels[bucket] = `${bucket} Actual`;
      seriesLabels[`${bucket}_prior1`] = `${bucket} MOP`;
      seriesLabels[`${bucket}_prior2`] = `${bucket} BP`;

      // When mixing units, put feedstock series on the right axis
      if (mixedUnits && FEEDSTOCK_BUCKETS.has(bucket)) {
        secondaryAxisKeys.push(bucket, `${bucket}_prior1`, `${bucket}_prior2`);
      }
    }

    return { data, seriesKeys, seriesLabels, priorPeriodKeys, secondaryAxisKeys };
  }, [months, buckets, selectedBuckets, mixedUnits]);

  const yAxisLabel = !hasNonFeedstock ? 'BBL/day' : 'Yield %';
  const yAxisFormatter = !hasNonFeedstock
    ? (v: number) => v.toLocaleString()
    : (v: number) => `${v.toFixed(1)}%`;

  return (
    <TimeSeriesChart
      data={data}
      seriesKeys={seriesKeys}
      seriesLabels={seriesLabels}
      priorPeriodKeys={priorPeriodKeys}
      secondaryAxisKeys={mixedUnits ? secondaryAxisKeys : []}
      secondaryAxisLabel={mixedUnits ? 'BBL/day' : undefined}
      height={height}
      loading={loading}
      showDataZoom={false}
      smooth={false}
      xAxisField="month_label"
      yAxisLabel={yAxisLabel}
      yAxisFormatter={yAxisFormatter}
      seriesDecimals={Object.fromEntries(
        selectedBuckets.flatMap(b => {
          const dec = FEEDSTOCK_BUCKETS.has(b) ? 0 : 2;
          return [
            [b, dec],
            [`${b}_prior1`, dec],
            [`${b}_prior2`, dec],
          ];
        })
      )}
    />
  );
}
