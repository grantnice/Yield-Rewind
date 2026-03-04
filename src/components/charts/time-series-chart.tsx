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
  autoFitKeys?: string[]; // Series that get their own hidden y-axis (auto-scaled independently)
  periodBoundaries?: PeriodBoundary[]; // Vertical lines marking period transitions
  priorPeriodKeys?: string[]; // Series keys that are prior period overlays (e.g. "Jet_prior1")
  xAxisField?: string; // Field to use for x-axis labels (default: "date")
  seriesDecimals?: Record<string, number>; // Per-series decimal precision for tooltip (key → decimals)
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
  autoFitKeys = [],
  periodBoundaries = [],
  priorPeriodKeys = [],
  xAxisField,
  seriesDecimals = {},
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
    // When using a custom x-axis field, date may not be present on all rows
    const firstDate = data[0]?.date;
    const lastDate = data[data.length - 1]?.date;
    if (!firstDate || !lastDate) return false;
    const firstYear = parseInt(firstDate.split('-')[0], 10);
    const lastYear = parseInt(lastDate.split('-')[0], 10);
    return firstYear !== lastYear;
  }, [data]);

  // Format dates for display (include year if data spans multiple years)
  // Parse as local date to avoid timezone shift (YYYY-MM-DD gets parsed as UTC)
  // Also handles sub-daily timestamps like 'YYYY-MM-DD HH:MM'
  const formatDate = useCallback((dateStr: string) => {
    // If not a YYYY-MM-DD format (e.g. position labels), return as-is
    if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}/)) return dateStr;
    // Split the date portion
    const datePart = dateStr.substring(0, 10);
    const timePart = dateStr.length > 10 ? dateStr.substring(11).trim() : '';
    const [year, month, day] = datePart.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    let label: string;
    if (spansMultipleYears) {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    } else {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (timePart) {
      label += ` ${timePart}`;
    }
    return label;
  }, [spansMultipleYears]);

  // Build chart options
  const chartOptions = useMemo((): EChartsOption => {
    if (!data || data.length === 0) return {};

    const dates = data.map((d) => (xAxisField && d[xAxisField] != null ? String(d[xAxisField]) : d.date));

    const hasSecondaryAxis = secondaryAxisKeys.length > 0;

    // Build yAxisIndex map: left=0, right=1 (if exists), then auto-fit keys get 2,3,4...
    const baseAxes = hasSecondaryAxis ? 2 : 1;
    const autoFitAxisMap: Record<string, number> = {};
    autoFitKeys.forEach((key, i) => {
      autoFitAxisMap[key] = baseAxes + i;
    });

    // Build a map of prior period keys to their "prior level" (1, 2, or 3)
    // and their base series key for color matching
    const priorKeyInfo: Record<string, { level: number; baseKey: string }> = {};
    priorPeriodKeys.forEach((pk) => {
      const match = pk.match(/^(.+)_prior(\d+)$/);
      if (match) {
        priorKeyInfo[pk] = { level: parseInt(match[2], 10), baseKey: match[1] };
      }
    });

    const series: any[] = seriesKeys.map((key, index) => {
      const seriesData = data.map((d) => {
        const value = d[key];
        return typeof value === 'number' ? value : null;
      });

      const isBar = chartType === 'bar';
      const isSecondary = secondaryAxisKeys.includes(key);

      // For prior period keys, match the color of the base (current) series
      const priorInfo = priorKeyInfo[key];
      let seriesColor: string;
      if (priorInfo) {
        const baseIndex = seriesKeys.indexOf(priorInfo.baseKey);
        seriesColor = CHART_COLORS[(baseIndex >= 0 ? baseIndex : index) % CHART_COLORS.length];
      } else {
        // For current series, only count non-prior keys for color index
        const currentKeys = seriesKeys.filter(k => !priorKeyInfo[k]);
        const currentIndex = currentKeys.indexOf(key);
        seriesColor = CHART_COLORS[(currentIndex >= 0 ? currentIndex : index) % CHART_COLORS.length];
      }

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

      // Prior period line styling
      let lineStyle: any = isBar ? undefined : { width: 2 };
      let itemOpacity = 1;
      if (priorInfo && !isBar) {
        const level = priorInfo.level;
        if (level === 1) {
          lineStyle = { width: 2, type: [4, 4] as number[], opacity: 0.7 };
          itemOpacity = 0.7;
        } else if (level === 2) {
          lineStyle = { width: 2, type: [8, 4] as number[], opacity: 0.5 };
          itemOpacity = 0.5;
        } else {
          lineStyle = { width: 1.5, type: [2, 2] as number[], opacity: 0.4 };
          itemOpacity = 0.4;
        }
      }

      return {
        name: seriesLabels[key] || key,
        type: isBar ? 'bar' : 'line',
        data: seriesData,
        smooth: isBar ? undefined : smooth,
        showSymbol: isBar ? undefined : (priorInfo ? false : data.length < 100),
        symbolSize: isBar ? undefined : 4,
        color: seriesColor,
        lineStyle,
        itemStyle: priorInfo ? { opacity: itemOpacity } : undefined,
        areaStyle: chartType === 'area' && !priorInfo ? { opacity: stacked ? 0.7 : 0.3 } : undefined,
        stack: stacked && !priorInfo ? 'total' : undefined,
        barMaxWidth: isBar ? 30 : undefined,
        yAxisIndex: autoFitAxisMap[key] != null ? autoFitAxisMap[key] : isSecondary ? 1 : 0,
        sampling: 'lttb',
        progressive: 200,
        animation: data.length < 500,
        animationDuration: 300,
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
          const xLabel = params[0]?.axisValue || '';

          // Group items: current series first, then prior periods
          const currentItems: string[] = [];
          const priorItems: string[] = [];

          params
            .filter((p: any) => p.value != null && p.value !== 0)
            .forEach((p: any) => {
              const seriesKey = seriesKeys.find(k => (seriesLabels[k] || k) === p.seriesName) || p.seriesName;
              const isSecondaryAxisSeries = secondaryAxisKeys.includes(seriesKey);

              const dec = seriesDecimals[seriesKey];
              const formatted = isSecondaryAxisSeries
                ? Math.round(p.value).toLocaleString() + ' BBL'
                : dec != null
                  ? p.value.toFixed(dec)
                  : yAxisLabel?.includes('%')
                    ? p.value.toFixed(1) + '%'
                    : Math.round(p.value).toLocaleString();

              const line = `${p.marker} ${p.seriesName}: <strong>${formatted}</strong>`;

              if (priorKeyInfo[seriesKey]) {
                priorItems.push(line);
              } else {
                currentItems.push(line);
              }
            });

          const allItems = [...currentItems, ...priorItems].join('<br/>');
          return `<strong>${xLabel}</strong><br/>${allItems}`;
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
        boundaryGap: chartType === 'bar',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          formatter: xAxisField ? undefined : formatDate,
          color: '#9ca3af',
          interval: data.length > 90 ? Math.floor(data.length / 12) : 'auto',
        },
      },
      yAxis: (() => {
        const axes: any[] = [
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
        ];
        if (hasSecondaryAxis) {
          axes.push({
            type: 'value',
            name: secondaryAxisLabel,
            position: 'right',
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
              formatter: (value: number) => value.toLocaleString(),
              color: '#9ca3af',
            },
            splitLine: { show: false },
            nameTextStyle: { color: '#6b7280' },
          });
        }
        // Hidden y-axes for auto-fit series (no labels, no lines, just auto-scale)
        autoFitKeys.forEach(() => {
          axes.push({
            type: 'value',
            show: false,
            splitLine: { show: false },
          });
        });
        return axes.length === 1 && autoFitKeys.length === 0 ? axes[0] : axes;
      })(),
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
  }, [data, seriesKeys, seriesLabels, chartType, stacked, smooth, showDataZoom, yAxisLabel, yAxisFormatter, formatDate, yAxisBounds, onYAxisBoundsChange, referenceLines, secondaryAxisKeys, secondaryAxisLabel, autoFitKeys, periodBoundaries, priorPeriodKeys, xAxisField, seriesDecimals]);

  // Track whether the chart div is in the DOM (survives early return)
  const [chartMounted, setChartMounted] = useState(false);
  const chartCallbackRef = useCallback((node: HTMLDivElement | null) => {
    (chartRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    setChartMounted(!!node);
  }, []);

  // Initialize chart — re-runs when the chart div appears in the DOM
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
      chartInstance.current = null;
    };
  }, [chartMounted]);

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
      <div ref={chartCallbackRef} style={{ height, width: '100%' }} className="relative" />

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
