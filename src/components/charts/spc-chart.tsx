'use client';

import { useRef, useEffect, useMemo, memo, useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { calculateSPC, getRuleDescription, RULE_NAMES, type SPCResult } from '@/lib/spc';

// Register ECharts components
echarts.use([
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export interface YAxisBounds {
  min: number | null;
  max: number | null;
}

export interface SPCChartProps {
  data: { date: string; value: number }[];
  seriesLabel: string;
  baselineRange?: { start: number; end: number };
  enabledRules?: number[];
  height?: number;
  yAxisFormatter?: (value: number) => string;
  yAxisBounds?: YAxisBounds;
  onYAxisBoundsChange?: (bounds: YAxisBounds) => void;
}

export const SPCChart = memo(function SPCChart({
  data,
  seriesLabel,
  baselineRange,
  enabledRules = [1, 2, 3, 4, 5, 6, 7, 8],
  height = 400,
  yAxisFormatter,
  yAxisBounds,
  onYAxisBoundsChange,
}: SPCChartProps) {
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

    const rect = chartRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;

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

  // Calculate SPC metrics
  const spcResult = useMemo((): SPCResult | null => {
    if (!data || data.length < 3) return null;

    const values = data.map(d => d.value);
    const dates = data.map(d => d.date);

    return calculateSPC(values, dates, {
      baselineStartIndex: baselineRange?.start ?? 0,
      baselineEndIndex: baselineRange?.end ?? values.length - 1,
      enabledRules,
    });
  }, [data, baselineRange, enabledRules]);

  // Format date for display (parse as local to avoid timezone shift)
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Build chart options
  const chartOptions = useMemo((): EChartsOption => {
    if (!data || data.length === 0 || !spcResult) return {};

    const { mean, stdDev, ucl3, ucl2, ucl1, lcl1, lcl2, lcl3, violationIndices, violations } = spcResult;

    // Create violation lookup by index for tooltip
    const violationsByIndex = new Map<number, string[]>();
    violations.forEach(v => {
      if (!violationsByIndex.has(v.dataIndex)) {
        violationsByIndex.set(v.dataIndex, []);
      }
      violationsByIndex.get(v.dataIndex)!.push(`Rule ${v.ruleNumber}: ${v.description}`);
    });

    const dates = data.map(d => d.date);
    const values = data.map(d => d.value);

    // Create series data with violation highlighting
    const seriesData = values.map((value, index) => ({
      value,
      itemStyle: violationIndices.has(index)
        ? { color: '#ef4444', borderColor: '#ef4444', borderWidth: 2 }
        : undefined,
      symbolSize: violationIndices.has(index) ? 10 : 4,
    }));

    return {
      animation: data.length < 500,
      grid: {
        left: '3%',
        right: '8%',
        bottom: '15%',
        top: '8%',
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#e5e7eb',
        textStyle: { color: '#374151' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const param = params[0];
          const idx = param.dataIndex;
          const date = formatDate(dates[idx]);
          const value = yAxisFormatter
            ? yAxisFormatter(param.value)
            : param.value.toLocaleString();

          let html = `<strong>${date}</strong><br/>`;
          html += `${param.marker} ${seriesLabel}: <strong>${value}</strong>`;

          // Add violation info if any
          const violationList = violationsByIndex.get(idx);
          if (violationList && violationList.length > 0) {
            html += '<br/><span style="color: #ef4444; font-weight: bold;">Violations:</span>';
            violationList.forEach(v => {
              html += `<br/><span style="color: #ef4444;">&bull; ${v}</span>`;
            });
          }

          return html;
        },
      },
      legend: {
        show: false,
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
          interval: data.length > 60 ? Math.floor(data.length / 12) : 'auto',
        },
      },
      yAxis: {
        type: 'value',
        min: yAxisBounds?.min ?? undefined,
        max: yAxisBounds?.max ?? undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          formatter: yAxisFormatter || ((value: number) => value.toLocaleString()),
          color: '#9ca3af',
        },
        splitLine: { lineStyle: { color: '#f3f4f6', type: 'solid' } },
        nameTextStyle: onYAxisBoundsChange ? { color: '#6b7280' } : undefined,
      },
      series: [
        {
          name: seriesLabel,
          type: 'line',
          data: seriesData,
          smooth: false,
          showSymbol: true,
          symbolSize: 4,
          color: '#3b82f6',
          lineStyle: { width: 2 },
          // Mark area for zones (3σ to 2σ is Zone A, 2σ to 1σ is Zone B, 1σ to mean is Zone C)
          markArea: {
            silent: true,
            data: [
              // Zone A upper (2σ to 3σ) - lightest red
              [{
                yAxis: ucl2,
                itemStyle: { color: 'rgba(254, 202, 202, 0.3)' },
              }, {
                yAxis: ucl3,
              }],
              // Zone B upper (1σ to 2σ) - light orange
              [{
                yAxis: ucl1,
                itemStyle: { color: 'rgba(254, 215, 170, 0.3)' },
              }, {
                yAxis: ucl2,
              }],
              // Zone C upper (mean to 1σ) - light green
              [{
                yAxis: mean,
                itemStyle: { color: 'rgba(187, 247, 208, 0.3)' },
              }, {
                yAxis: ucl1,
              }],
              // Zone C lower (mean to -1σ) - light green
              [{
                yAxis: lcl1,
                itemStyle: { color: 'rgba(187, 247, 208, 0.3)' },
              }, {
                yAxis: mean,
              }],
              // Zone B lower (-1σ to -2σ) - light orange
              [{
                yAxis: lcl2,
                itemStyle: { color: 'rgba(254, 215, 170, 0.3)' },
              }, {
                yAxis: lcl1,
              }],
              // Zone A lower (-2σ to -3σ) - lightest red
              [{
                yAxis: lcl3,
                itemStyle: { color: 'rgba(254, 202, 202, 0.3)' },
              }, {
                yAxis: lcl2,
              }],
            ],
          },
          // Mark lines for control limits
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              // UCL (3σ)
              {
                yAxis: ucl3,
                label: {
                  formatter: `UCL (3σ): ${yAxisFormatter ? yAxisFormatter(ucl3) : ucl3.toLocaleString()}`,
                  position: 'end',
                  color: '#dc2626',
                  fontSize: 10,
                },
                lineStyle: { color: '#dc2626', width: 2, type: 'solid' },
              },
              // 2σ upper
              {
                yAxis: ucl2,
                label: {
                  formatter: `2σ`,
                  position: 'end',
                  color: '#f97316',
                  fontSize: 9,
                },
                lineStyle: { color: '#f97316', width: 1, type: 'dashed' },
              },
              // 1σ upper
              {
                yAxis: ucl1,
                label: {
                  formatter: `1σ`,
                  position: 'end',
                  color: '#84cc16',
                  fontSize: 9,
                },
                lineStyle: { color: '#84cc16', width: 1, type: 'dotted' },
              },
              // Mean
              {
                yAxis: mean,
                label: {
                  formatter: `Mean: ${yAxisFormatter ? yAxisFormatter(mean) : mean.toLocaleString()}`,
                  position: 'end',
                  color: '#059669',
                  fontSize: 10,
                  fontWeight: 'bold',
                },
                lineStyle: { color: '#059669', width: 2, type: 'solid' },
              },
              // 1σ lower
              {
                yAxis: lcl1,
                label: {
                  formatter: `-1σ`,
                  position: 'end',
                  color: '#84cc16',
                  fontSize: 9,
                },
                lineStyle: { color: '#84cc16', width: 1, type: 'dotted' },
              },
              // 2σ lower
              {
                yAxis: lcl2,
                label: {
                  formatter: `-2σ`,
                  position: 'end',
                  color: '#f97316',
                  fontSize: 9,
                },
                lineStyle: { color: '#f97316', width: 1, type: 'dashed' },
              },
              // LCL (3σ)
              {
                yAxis: lcl3,
                label: {
                  formatter: `LCL (3σ): ${yAxisFormatter ? yAxisFormatter(lcl3) : lcl3.toLocaleString()}`,
                  position: 'end',
                  color: '#dc2626',
                  fontSize: 10,
                },
                lineStyle: { color: '#dc2626', width: 2, type: 'solid' },
              },
            ],
          },
        },
      ],
    };
  }, [data, spcResult, seriesLabel, yAxisFormatter, yAxisBounds, onYAxisBoundsChange]);

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
    container.style.cursor = 'default';

    return () => {
      container.removeEventListener('click', handleYAxisClick);
    };
  }, [handleYAxisClick, onYAxisBoundsChange]);

  // Update chart options
  useEffect(() => {
    if (!chartInstance.current || Object.keys(chartOptions).length === 0) return;
    chartInstance.current.setOption(chartOptions, { notMerge: true, lazyUpdate: true });
  }, [chartOptions]);

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

  if (!spcResult) {
    return (
      <div
        className="flex items-center justify-center bg-gray-50 rounded-lg border"
        style={{ height }}
      >
        <p className="text-gray-500">Insufficient data for SPC analysis (minimum 3 points)</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <div ref={chartRef} style={{ height, width: '100%' }} />

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
      </div>

      {/* Violations Summary */}
      {spcResult.violations.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-red-800 mb-2">
            Violations Detected: {spcResult.violations.length} point(s)
          </h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {spcResult.violations.slice(0, 20).map((v, i) => (
              <div key={`${v.dataIndex}-${v.ruleNumber}-${i}`} className="text-xs text-red-700">
                <span className="font-medium">{formatDate(v.date)}:</span>{' '}
                Rule {v.ruleNumber} ({RULE_NAMES[v.ruleNumber]}) - {v.description}
              </div>
            ))}
            {spcResult.violations.length > 20 && (
              <div className="text-xs text-red-600 font-medium mt-2">
                ... and {spcResult.violations.length - 20} more violations
              </div>
            )}
          </div>
        </div>
      )}

      {spcResult.violations.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">
            Process is in control - no violations detected with the selected rules.
          </p>
        </div>
      )}

      {/* Statistics Summary */}
      <div className="grid grid-cols-4 gap-4 text-center text-sm">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500 text-xs">Mean</div>
          <div className="font-semibold">{yAxisFormatter ? yAxisFormatter(spcResult.mean) : spcResult.mean.toLocaleString()}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500 text-xs">Std Dev</div>
          <div className="font-semibold">{spcResult.stdDev.toFixed(2)}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500 text-xs">UCL (3σ)</div>
          <div className="font-semibold text-red-600">{yAxisFormatter ? yAxisFormatter(spcResult.ucl3) : spcResult.ucl3.toLocaleString()}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500 text-xs">LCL (3σ)</div>
          <div className="font-semibold text-red-600">{yAxisFormatter ? yAxisFormatter(spcResult.lcl3) : spcResult.lcl3.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
});
