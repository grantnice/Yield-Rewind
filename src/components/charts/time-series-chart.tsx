'use client';

import { useRef, useEffect, useMemo, memo } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

// Register ECharts components (tree-shakable)
echarts.use([
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
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

export interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  seriesKeys: string[];
  seriesLabels?: Record<string, string>;
  height?: number;
  showDataZoom?: boolean;
  chartType?: 'line' | 'area';
  stacked?: boolean;
  smooth?: boolean;
  yAxisLabel?: string;
  yAxisFormatter?: (value: number) => string;
  loading?: boolean;
}

export const TimeSeriesChart = memo(function TimeSeriesChart({
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
}: TimeSeriesChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  // Format dates for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Build chart options
  const chartOptions = useMemo((): EChartsOption => {
    if (!data || data.length === 0) return {};

    const dates = data.map((d) => d.date);

    const series = seriesKeys.map((key, index) => {
      const seriesData = data.map((d) => {
        const value = d[key];
        return typeof value === 'number' ? value : null;
      });

      return {
        name: seriesLabels[key] || key,
        type: 'line' as const,
        data: seriesData,
        smooth,
        showSymbol: data.length < 100,
        symbolSize: 4,
        color: CHART_COLORS[index % CHART_COLORS.length],
        lineStyle: { width: 2 },
        areaStyle: chartType === 'area' ? { opacity: stacked ? 0.7 : 0.3 } : undefined,
        stack: stacked ? 'total' : undefined,
        sampling: 'lttb' as const,
        progressive: 200,
        animation: data.length < 500,
        animationDuration: 300,
      };
    });

    return {
      animation: data.length < 500,
      grid: {
        left: '3%',
        right: '4%',
        bottom: showDataZoom ? '15%' : '3%',
        top: '10%',
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#e5e7eb',
        textStyle: { color: '#374151' },
      },
      legend: {
        type: seriesKeys.length > 5 ? 'scroll' : 'plain',
        bottom: showDataZoom ? 40 : 0,
        textStyle: { color: '#6b7280' },
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          formatter: formatDate,
          color: '#9ca3af',
          interval: data.length > 90 ? Math.floor(data.length / 12) : 'auto',
        },
      },
      yAxis: {
        type: 'value',
        name: yAxisLabel,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          formatter: yAxisFormatter || ((value: number) => value.toLocaleString()),
          color: '#9ca3af',
        },
        splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } },
      },
      dataZoom: showDataZoom
        ? [
            { type: 'inside', start: 0, end: 100, throttle: 100 },
            { type: 'slider', start: 0, end: 100, height: 20, bottom: 10 },
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
  }, [data, seriesKeys, seriesLabels, chartType, stacked, smooth, showDataZoom, yAxisLabel, yAxisFormatter]);

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

  // Update chart options
  useEffect(() => {
    if (!chartInstance.current || Object.keys(chartOptions).length === 0) return;
    chartInstance.current.setOption(chartOptions, { notMerge: false, lazyUpdate: true });
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
    <div ref={chartRef} style={{ height, width: '100%' }} className="relative" />
  );
});
