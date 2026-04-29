'use client';

import { useRef, useEffect, useMemo, memo } from 'react';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

echarts.use([
  BarChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CanvasRenderer,
]);

const CHART_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
];

export type BinMode = 'auto' | 'count' | 'step' | 'edges';
export type YAxisMode = 'count' | 'percent';

export interface DistributionChartProps {
  /** Map of series key → numeric values (NaN/null pre-filtered by caller is fine; we filter again defensively) */
  seriesValues: Record<string, number[]>;
  /** Order to render series in (and how they appear in legend) */
  seriesKeys: string[];
  /** Optional human-readable labels for series */
  seriesLabels?: Record<string, string>;
  /** Optional per-series colors; falls back to palette */
  seriesColors?: Record<string, string>;
  height?: number;
  binMode: BinMode;
  /** Used when binMode === 'count' */
  binCount?: number;
  /** Used when binMode === 'step'; bin width (e.g. 500, 1000) */
  binStep?: number;
  /** Used when binMode === 'edges'; ascending list of break points */
  customEdges?: number[];
  yAxisMode?: YAxisMode;
  /** Optional formatter for bin range labels */
  valueFormatter?: (v: number) => string;
}

interface BinResult {
  edges: number[];
  labels: string[];
  countsBySeries: Record<string, number[]>;
}

function freedmanDiaconisBins(values: number[]): number {
  if (values.length < 2) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;
  if (range === 0) return 1;
  if (iqr === 0) {
    return Math.min(30, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  }
  const binWidth = (2 * iqr) / Math.cbrt(values.length);
  const n = Math.ceil(range / binWidth);
  return Math.min(50, Math.max(5, n));
}

/** Round a raw bin width up to the nearest "nice" number (1, 2, 2.5, 5, 10 × 10^n). */
function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / pow10;
  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 2.5) nice = 2.5;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * pow10;
}

/** Build edges aligned to multiples of `step`, spanning [min, max] inclusively. */
function buildSteppedEdges(min: number, max: number, step: number): number[] {
  if (step <= 0 || !Number.isFinite(step)) return [min, max];
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const count = Math.max(1, Math.round((end - start) / step)) + 1;
  const edges: number[] = [];
  for (let i = 0; i < count; i++) {
    edges.push(start + i * step);
  }
  // Ensure the max value sits inside the last bin (upper bound is exclusive in our placement loop)
  if (edges[edges.length - 1] <= max) {
    edges[edges.length - 1] = max + step * 1e-9;
  }
  return edges;
}

function defaultFormat(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function computeBins(
  seriesValues: Record<string, number[]>,
  seriesKeys: string[],
  binMode: BinMode,
  binCount: number,
  binStep: number | undefined,
  customEdges: number[] | undefined,
  formatter: (v: number) => string
): BinResult | null {
  const allValues: number[] = [];
  seriesKeys.forEach(k => {
    const vs = seriesValues[k];
    if (vs) {
      vs.forEach(v => {
        if (Number.isFinite(v)) allValues.push(v);
      });
    }
  });
  if (allValues.length === 0) return null;

  let edges: number[];

  if (binMode === 'edges' && customEdges && customEdges.length >= 2) {
    edges = [...customEdges].sort((a, b) => a - b);
  } else {
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    if (min === max) {
      const pad = Math.abs(min) * 0.05 || 1;
      edges = [min - pad, min + pad];
    } else if (binMode === 'step' && binStep && binStep > 0) {
      edges = buildSteppedEdges(min, max, binStep);
    } else if (binMode === 'count') {
      // Exact count, edges follow data range without rounding
      const n = Math.max(1, Math.floor(binCount));
      const step = (max - min) / n;
      edges = Array.from({ length: n + 1 }, (_, i) => min + step * i);
      edges[edges.length - 1] = max + Math.abs(step) * 1e-9;
    } else {
      // Auto: pick a nice round step that yields ~Freedman–Diaconis many bins
      const targetBins = freedmanDiaconisBins(allValues);
      const rawStep = (max - min) / targetBins;
      const step = niceStep(rawStep);
      edges = buildSteppedEdges(min, max, step);
    }
  }

  const labels = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    return `${formatter(lo)} – ${formatter(hi)}`;
  });

  const countsBySeries: Record<string, number[]> = {};
  seriesKeys.forEach(k => {
    const counts = new Array(labels.length).fill(0);
    const vs = seriesValues[k] || [];
    vs.forEach(v => {
      if (!Number.isFinite(v)) return;
      // Find bin: lower-inclusive, upper-exclusive (last bin upper-inclusive)
      let placed = false;
      for (let i = 0; i < edges.length - 1; i++) {
        const lo = edges[i];
        const hi = edges[i + 1];
        const isLast = i === edges.length - 2;
        if (v >= lo && (isLast ? v <= hi : v < hi)) {
          counts[i]++;
          placed = true;
          break;
        }
      }
      // Out-of-range values silently dropped (only relevant for custom edges)
      void placed;
    });
    countsBySeries[k] = counts;
  });

  return { edges, labels, countsBySeries };
}

export const DistributionChart = memo(function DistributionChart({
  seriesValues,
  seriesKeys,
  seriesLabels = {},
  seriesColors = {},
  height = 360,
  binMode,
  binCount = 20,
  binStep,
  customEdges,
  yAxisMode = 'count',
  valueFormatter = defaultFormat,
}: DistributionChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const bins = useMemo(
    () => computeBins(seriesValues, seriesKeys, binMode, binCount, binStep, customEdges, valueFormatter),
    [seriesValues, seriesKeys, binMode, binCount, binStep, customEdges, valueFormatter]
  );

  const options = useMemo((): EChartsOption => {
    if (!bins) return {};

    const totalsBySeries: Record<string, number> = {};
    seriesKeys.forEach(k => {
      totalsBySeries[k] = (bins.countsBySeries[k] || []).reduce((a, b) => a + b, 0);
    });

    const series = seriesKeys.map((k, idx) => {
      const counts = bins.countsBySeries[k] || [];
      const total = totalsBySeries[k] || 0;
      const data =
        yAxisMode === 'percent' && total > 0
          ? counts.map(c => (c / total) * 100)
          : counts;

      const color = seriesColors[k] || CHART_COLORS[idx % CHART_COLORS.length];

      return {
        type: 'bar' as const,
        name: seriesLabels[k] || k,
        data,
        itemStyle: {
          color,
          opacity: seriesKeys.length > 1 ? 0.55 : 0.85,
          borderColor: color,
          borderWidth: 1,
        },
        emphasis: { focus: 'series' as const, itemStyle: { opacity: 0.9 } },
        // Overlap when there are multiple series for shape comparison
        barGap: seriesKeys.length > 1 ? '-100%' : '0%',
        barCategoryGap: '5%',
      };
    });

    return {
      grid: { left: 60, right: 24, top: 50, bottom: 70, containLabel: true },
      legend: {
        top: 8,
        type: 'scroll',
        data: seriesKeys.map(k => seriesLabels[k] || k),
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const binLabel = params[0].axisValueLabel || params[0].name;
          const lines = [`<div style="font-weight:600;margin-bottom:4px;">${binLabel}</div>`];
          params.forEach((p: any) => {
            const seriesKey = seriesKeys[p.seriesIndex];
            const counts = bins.countsBySeries[seriesKey] || [];
            const count = counts[p.dataIndex] ?? 0;
            const total = totalsBySeries[seriesKey] || 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            lines.push(
              `<div>${p.marker}${p.seriesName}: <b>${count}</b> <span style="color:#6b7280">(${pct.toFixed(1)}%)</span></div>`
            );
          });
          return lines.join('');
        },
      },
      xAxis: {
        type: 'category',
        data: bins.labels,
        axisLabel: { rotate: bins.labels.length > 8 ? 35 : 0, fontSize: 11 },
        name: 'Value',
        nameLocation: 'middle',
        nameGap: 50,
      },
      yAxis: {
        type: 'value',
        name: yAxisMode === 'percent' ? '% of values' : 'Count',
        nameLocation: 'middle',
        nameGap: 45,
        axisLabel: yAxisMode === 'percent' ? { formatter: '{value}%' } : undefined,
      },
      series,
    };
  }, [bins, seriesKeys, seriesLabels, seriesColors, yAxisMode]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(containerRef.current);
    }
    chartInstance.current.setOption(options, { notMerge: true });

    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [options]);

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  if (!bins) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center bg-gray-50 rounded-lg"
      >
        <p className="text-gray-500">No values to histogram</p>
      </div>
    );
  }

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
});
