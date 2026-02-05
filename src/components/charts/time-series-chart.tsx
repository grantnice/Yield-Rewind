'use client';

import { useRef, useEffect, useMemo, memo, useImperativeHandle, forwardRef, useCallback, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { RotateCcw } from 'lucide-react';

// Register ECharts components (tree-shakable)
echarts.use([
  LineChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

// Professional color palette
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

export interface TimeSeriesDataPoint {
  date: string;
  [key: string]: string | number | null | undefined;
}

export interface YAxisBounds {
  min: number | null;
  max: number | null;
}

export interface ReferenceLineConfig {
  value: number;
  label: string;
  color?: string;
  seriesKey?: string; // Optional: associates this line with a specific series
  startDate?: string; // Optional: start date for segmented line (YYYY-MM-DD)
  endDate?: string;   // Optional: end date for segmented line (YYYY-MM-DD)
}

export interface PeriodBoundary {
  date: string;  // The date at which period ends (YYYY-MM-DD)
  label: string; // Label like "P1" or "Period 1"
}

export interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  seriesKeys: string[];
  seriesLabels?: Record<string, string>;
  height?: number;
  showDataZoom?: boolean;
  chartType?: 'line' | 'area' | 'bar';
  stacked?: boolean;
  smooth?: boolean;
  yAxisLabel?: string;
  yAxisFormatter?: (value: number) => string;
  loading?: boolean;
  yAxisBounds?: YAxisBounds;
  onYAxisBoundsChange?: (bounds: YAxisBounds) => void;
  referenceLines?: ReferenceLineConfig[];
  secondaryAxisKeys?: string[]; // Series to show on right y-axis
  secondaryAxisLabel?: string;
  periodBoundaries?: PeriodBoundary[]; // Vertical lines marking period transitions
}

export interface TimeSeriesChartRef {
  getChartImage: () => string | undefined;
}

export const TimeSeriesChart = memo(forwardRef<TimeSeriesChartRef, TimeSeriesChartProps>(function TimeSeriesChart({
  data,
  seriesKeys,
  seriesLabels = {},
  height = 400,
  showDataZoom = true,
  chartType = 'line',
  stacked = false,
  smooth = true,
  yAxisLabel,
  yAxisFormatter,
  loading = false,
  yAxisBounds,
  onYAxisBoundsChange,
  referenceLines = [],
  secondaryAxisKeys = [],
  secondaryAxisLabel,
  periodBoundaries = [],
}: TimeSeriesChartProps, ref) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  // Y-axis popup state
  const [showYAxisPopup, setShowYAxisPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [editMin, setEditMin] = useState<string>('');
  const [editMax, setEditMax] = useState<string>('');
  const popupRef = useRef<HTMLDivElement>(null);

  // Initialize edit values when popup opens
  useEffect(() => {
    if (showYAxisPopup) {
      setEditMin(yAxisBounds?.min?.toString() ?? '');
      setEditMax(yAxisBounds?.max?.toString() ?? '');
    }
  }, [showYAxisPopup, yAxisBounds]);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setShowYAxisPopup(false);
      }
    };

    if (showYAxisPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showYAxisPopup]);

  // Handle y-axis click
  const handleYAxisClick = useCallback((event: MouseEvent) => {
    if (!chartInstance.current || !chartRef.current || !onYAxisBoundsChange) return;

    const chart = chartInstance.current;
    const rect = chartRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Get the grid info to determine y-axis area
    const gridInfo = chart.getOption().grid as any;
    if (!gridInfo || !gridInfo[0]) return;

    // Calculate y-axis area (left side of chart)
    const containerWidth = rect.width;
    const yAxisWidth = containerWidth * 0.1; // Approximate y-axis width

    // Check if click is in y-axis area (left ~10% of chart)
    if (x < yAxisWidth) {
      setPopupPosition({ x: event.clientX, y: event.clientY });
      setShowYAxisPopup(true);
    }
  }, [onYAxisBoundsChange]);

  // Apply y-axis bounds
  const handleApplyBounds = useCallback(() => {
    if (!onYAxisBoundsChange) return;

    const min = editMin.trim() === '' ? null : parseFloat(editMin);
    const max = editMax.trim() === '' ? null : parseFloat(editMax);

    onYAxisBoundsChange({
      min: min !== null && !isNaN(min) ? min : null,
      max: max !== null && !isNaN(max) ? max : null,
    });
    setShowYAxisPopup(false);
  }, [editMin, editMax, onYAxisBoundsChange]);

  // Reset y-axis bounds
  const handleReset = useCallback(() => {
    if (!onYAxisBoundsChange) return;
    onYAxisBoundsChange({ min: null, max: null });
    setShowYAxisPopup(false);
  }, [onYAxisBoundsChange]);

  // Expose chart methods via ref
  useImperativeHandle(ref, () => ({
    getChartImage: () => {
      if (!chartInstance.current) return undefined;
      return chartInstance.current.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#fff',
      });
    },
  }), []);

  // Check if data spans multiple years
  const spansMultipleYears = useMemo(() => {
    if (!data || data.length < 2) return false;
    // Parse year directly from string to avoid timezone issues
    const firstYear = parseInt(data[0].date.split('-')[0], 10);
    const lastYear = parseInt(data[data.length - 1].date.split('-')[0], 10);
    return firstYear !== lastYear;
  }, [data]);

  // Format dates for display (include year if data spans multiple years)
  // Parse as local date to avoid timezone shift (YYYY-MM-DD gets parsed as UTC)
  const formatDate = useCallback((dateStr: string) => {
    // Split the date string to avoid UTC parsing issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    if (spansMultipleYears) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, [spansMultipleYears]);

  // Build chart options
  const chartOptions = useMemo((): EChartsOption => {
    if (!data || data.length === 0) return {};

    const dates = data.map((d) => d.date);

    const hasSecondaryAxis = secondaryAxisKeys.length > 0;

    const series: any[] = seriesKeys.map((key, index) => {
      const seriesData = data.map((d) => {
        const value = d[key];
        return typeof value === 'number' ? value : null;
      });

      const isBar = chartType === 'bar';
      const seriesColor = CHART_COLORS[index % CHART_COLORS.length];
      const isSecondary = secondaryAxisKeys.includes(key);

      // Find reference lines for this series
      const seriesRefLines = referenceLines.filter(
        (rl) => rl.seriesKey === key || (!rl.seriesKey && index === 0)
      );

      // Build markLine data
      const markLineData: any[] = [];

      // Add reference lines (horizontal)
      seriesRefLines.forEach((rl) => {
        if (rl.startDate && rl.endDate) {
          // Segmented line
          markLineData.push([
            {
              xAxis: rl.startDate,
              yAxis: rl.value,
              label: {
                formatter: `${rl.label}: ${rl.value.toFixed(1)}`,
                position: 'insideEndTop',
                color: rl.color || seriesColor,
                fontSize: 10,
              },
              lineStyle: {
                color: rl.color || seriesColor,
                type: 'dashed',
                width: 2,
              },
            },
            {
              xAxis: rl.endDate,
              yAxis: rl.value,
            },
          ]);
        } else {
          // Full-width line
          markLineData.push({
            yAxis: rl.value,
            label: {
              formatter: `${rl.label}: {c}`,
              position: 'insideEndTop',
              color: rl.color || seriesColor,
              fontSize: 10,
            },
            lineStyle: {
              color: rl.color || seriesColor,
              type: 'dashed',
              width: 2,
            },
          });
        }
      });

      // Add period boundaries (vertical lines) - only on first series
      if (index === 0 && periodBoundaries.length > 0) {
        periodBoundaries.forEach((boundary) => {
          markLineData.push({
            xAxis: boundary.date,
            label: {
              formatter: boundary.label ? `${boundary.label} end` : '',
              position: 'insideEndTop',
              color: '#9ca3af',
              fontSize: 9,
              backgroundColor: 'rgba(255,255,255,0.8)',
              padding: [2, 4],
            },
            lineStyle: {
              color: '#d1d5db',
              type: 'dashed',
              width: 1,
            },
          });
        });
      }

      return {
        name: seriesLabels[key] || key,
        type: isBar ? 'bar' : 'line',
        data: seriesData,
        smooth: isBar ? undefined : smooth,
        showSymbol: isBar ? undefined : data.length < 100,
        symbolSize: isBar ? undefined : 4,
        color: seriesColor,
        lineStyle: isBar ? undefined : { width: 2 },
        areaStyle: chartType === 'area' ? { opacity: stacked ? 0.7 : 0.3 } : undefined,
        stack: stacked ? 'total' : undefined,
        barMaxWidth: isBar ? 30 : undefined,
        yAxisIndex: isSecondary ? 1 : 0, // Secondary series go to right y-axis
        sampling: 'lttb',
        progressive: 200,
        animation: data.length < 500,
        animationDuration: 300,
        // Add markLine for reference lines and period boundaries
        markLine: markLineData.length > 0 ? {
          silent: true,
          symbol: 'none',
          data: markLineData,
        } : undefined,
      };
    });

    return {
      animation: data.length < 500,
      grid: {
        left: '3%',
        right: hasSecondaryAxis ? '8%' : '4%', // More space for secondary y-axis
        bottom: showDataZoom ? '22%' : '15%',
        top: '10%',
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#e5e7eb',
        textStyle: { color: '#374151' },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return '';
          const date = params[0]?.axisValue || '';
          const items = params
            .filter((p: any) => p.value != null && p.value !== 0)
            .map((p: any) => {
              // Check if this series is on the secondary axis (by matching series name)
              const seriesKey = seriesKeys.find(k => (seriesLabels[k] || k) === p.seriesName) || p.seriesName;
              const isSecondaryAxisSeries = secondaryAxisKeys.includes(seriesKey);

              // Secondary axis series show as BBL, primary as percentage (if yAxisLabel includes %)
              const formatted = isSecondaryAxisSeries
                ? Math.round(p.value).toLocaleString() + ' BBL'
                : yAxisLabel?.includes('%')
                  ? p.value.toFixed(1) + '%'
                  : Math.round(p.value).toLocaleString();
              return `${p.marker} ${p.seriesName}: <strong>${formatted}</strong>`;
            })
            .join('<br/>');
          return `<strong>${date}</strong><br/>${items}`;
        },
      },
      legend: {
        type: seriesKeys.length > 5 ? 'scroll' : 'plain',
        bottom: showDataZoom ? 35 : 0,
        textStyle: { color: '#6b7280' },
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: chartType === 'bar', // Bar charts need gap, line charts don't
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          formatter: formatDate,
          color: '#9ca3af',
          interval: data.length > 90 ? Math.floor(data.length / 12) : 'auto',
        },
      },
      yAxis: hasSecondaryAxis ? [
        {
          type: 'value',
          name: yAxisLabel,
          min: yAxisBounds?.min ?? undefined,
          max: yAxisBounds?.max ?? undefined,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            formatter: yAxisFormatter || ((value: number) => value.toLocaleString()),
            color: '#9ca3af',
          },
          splitLine: { lineStyle: { color: '#d1d5db', type: 'dashed' } },
          nameTextStyle: onYAxisBoundsChange ? { color: '#6b7280' } : undefined,
        },
        {
          type: 'value',
          name: secondaryAxisLabel,
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            formatter: (value: number) => value.toLocaleString(),
            color: '#9ca3af',
          },
          splitLine: { show: false }, // Don't duplicate grid lines
          nameTextStyle: { color: '#6b7280' },
        },
      ] : {
        type: 'value',
        name: yAxisLabel,
        min: yAxisBounds?.min ?? undefined,
        max: yAxisBounds?.max ?? undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          formatter: yAxisFormatter || ((value: number) => value.toLocaleString()),
          color: '#9ca3af',
        },
        splitLine: { lineStyle: { color: '#d1d5db', type: 'dashed' } },
        // Indicate clickable area with subtle style when callback exists
        nameTextStyle: onYAxisBoundsChange ? { color: '#6b7280' } : undefined,
      },
      dataZoom: showDataZoom
        ? [
            { type: 'inside', start: 0, end: 100, throttle: 100 },
            { type: 'slider', start: 0, end: 100, height: 20, bottom: 60 },
          ]
        : [],
      toolbox: {
        feature: {
          saveAsImage: { title: 'Save', pixelRatio: 2 },
        },
        right: 20,
        top: 0,
      },
      series,
    };
  }, [data, seriesKeys, seriesLabels, chartType, stacked, smooth, showDataZoom, yAxisLabel, yAxisFormatter, formatDate, yAxisBounds, onYAxisBoundsChange, referenceLines, secondaryAxisKeys, secondaryAxisLabel, periodBoundaries]);

  // Initialize chart
  useEffect(() => {
    if (!chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    const chart = echarts.init(chartRef.current, undefined, {
      renderer: 'canvas',
      useDirtyRect: true,
      devicePixelRatio: Math.min(window.devicePixelRatio, 2),
    });

    chartInstance.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, []);

  // Add click handler to chart container for y-axis clicks
  useEffect(() => {
    const container = chartRef.current;
    if (!container || !onYAxisBoundsChange) return;

    container.addEventListener('click', handleYAxisClick);
    // Add cursor style hint for y-axis area
    container.style.cursor = 'default';

    return () => {
      container.removeEventListener('click', handleYAxisClick);
    };
  }, [handleYAxisClick, onYAxisBoundsChange]);

  // Update chart options
  useEffect(() => {
    if (!chartInstance.current || Object.keys(chartOptions).length === 0) return;
    // notMerge: true ensures old series are removed when deselected
    chartInstance.current.setOption(chartOptions, { notMerge: true, lazyUpdate: true });
  }, [chartOptions]);

  // Handle loading
  useEffect(() => {
    if (!chartInstance.current) return;
    if (loading) {
      chartInstance.current.showLoading({ text: 'Loading...', color: '#3b82f6' });
    } else {
      chartInstance.current.hideLoading();
    }
  }, [loading]);

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-gray-50 rounded-lg border"
        style={{ height }}
      >
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <>
      <div ref={chartRef} style={{ height, width: '100%' }} className="relative" />

      {/* Y-Axis Bounds Popup */}
      {showYAxisPopup && (
        <div
          ref={popupRef}
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-64"
          style={{
            left: Math.min(popupPosition.x, window.innerWidth - 280),
            top: Math.min(popupPosition.y - 80, window.innerHeight - 200),
          }}
        >
          <div className="text-sm font-semibold text-gray-700 mb-3">Y-Axis Range</div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-10">Min:</label>
              <input
                type="number"
                value={editMin}
                onChange={(e) => setEditMin(e.target.value)}
                placeholder="Auto"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleApplyBounds()}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-10">Max:</label>
              <input
                type="number"
                value={editMax}
                onChange={(e) => setEditMax(e.target.value)}
                placeholder="Auto"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleApplyBounds()}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to Fit
              </button>
              <button
                onClick={handleApplyBounds}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}));
