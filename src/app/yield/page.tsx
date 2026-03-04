'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart, TimeSeriesChartRef, YAxisBounds } from '@/components/charts/time-series-chart';
import { SPCChart, YAxisBounds as SPCYAxisBounds } from '@/components/charts/spc-chart';
import { SPCControls, BaselineMode, MetricOption } from '@/components/charts/spc-controls';
import { getDaysAgo, getYesterday, getMonthStart, formatNumber, calculatePriorPeriods, getPositionLabel, classifyRange } from '@/lib/utils';
import type { PriorPeriodRange } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

// Quick date range options
const dateRanges = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
  { label: 'MTD', type: 'mtd' },
  { label: 'YTD', type: 'ytd' },
  { label: '1 Year', days: 365 },
  { label: 'Custom', type: 'custom' },
];

// Rolling average options
const rollingAverageOptions = [
  { key: 'raw', label: 'Daily', days: 0 },
  { key: 'ra7', label: '7-Day Avg', days: 7 },
  { key: 'ra14', label: '14-Day Avg', days: 14 },
  { key: 'ra30', label: '30-Day Avg', days: 30 },
  { key: 'mtd_avg', label: 'MTD Avg', days: 0, isMtd: true },
];

// Yield metrics available for trending (inventory options at end)
const yieldMetrics = [
  { key: 'yield_qty', label: 'Yield Value' },
  { key: 'yield_pct', label: 'Yield %' },
  { key: 'blend_qty', label: 'Blend' },
  { key: 'ship_qty', label: 'Ship' },
  { key: 'rec_qty', label: 'Receipt' },
  { key: 'oi_qty', label: 'Opening Inventory' },
  { key: 'ci_qty', label: 'Closing Inventory' },
];

// Default buckets to show (these aggregate component products)
const defaultSelections = ['Crude Rate', 'Non-Crude Total', 'Loss'];

interface BucketConfig {
  id: number;
  bucket_type: string;
  bucket_name: string;
  component_products: string[];
  is_virtual: boolean;
  display_order: number;
}

interface YieldDataRow {
  date: string;
  product_name: string;
  product_class: string | null;
  oi_qty: number | null;
  rec_qty: number | null;
  ship_qty: number | null;
  blend_qty: number | null;
  ci_qty: number | null;
  yield_qty: number | null;
}

/**
 * Aggregate raw yield data rows into bucket-level chart rows.
 * Extracted so it can be reused for both current and prior period data.
 */
function aggregateYieldData(
  rows: YieldDataRow[],
  items: string[],
  bucketMap: Record<string, string[]>,
  metric: string
): { date: string; [key: string]: number | string }[] {
  const byDate: Record<string, Record<string, Record<string, number>>> = {};
  const byDateClass: Record<string, Record<string, Record<string, number>>> = {};

  rows.forEach((row) => {
    if (!byDate[row.date]) {
      byDate[row.date] = {};
      byDateClass[row.date] = {
        F: { yield_qty: 0, oi_qty: 0, ci_qty: 0, blend_qty: 0, ship_qty: 0, rec_qty: 0 },
        P: { yield_qty: 0, oi_qty: 0, ci_qty: 0, blend_qty: 0, ship_qty: 0, rec_qty: 0 },
      };
    }

    byDate[row.date][row.product_name] = {
      yield_qty: row.yield_qty || 0,
      oi_qty: row.oi_qty || 0,
      ci_qty: row.ci_qty || 0,
      blend_qty: row.blend_qty || 0,
      ship_qty: row.ship_qty || 0,
      rec_qty: row.rec_qty || 0,
    };

    const classCode = row.product_class as 'F' | 'P';
    if (classCode && byDateClass[row.date][classCode]) {
      byDateClass[row.date][classCode].yield_qty += row.yield_qty || 0;
      byDateClass[row.date][classCode].oi_qty += row.oi_qty || 0;
      byDateClass[row.date][classCode].ci_qty += row.ci_qty || 0;
      byDateClass[row.date][classCode].blend_qty += row.blend_qty || 0;
      byDateClass[row.date][classCode].ship_qty += row.ship_qty || 0;
      byDateClass[row.date][classCode].rec_qty += row.rec_qty || 0;
    }
  });

  const result: any[] = [];
  Object.entries(byDate).forEach(([date, products]) => {
    const row: any = { date };
    const classData = byDateClass[date];
    const crudeRate = -(classData.F?.yield_qty || 0);

    items.forEach(item => {
      const bucketDef = bucketMap[item];
      let value = 0;

      if (!bucketDef) {
        const productData = products[item];
        if (productData) {
          if (metric === 'yield_pct') {
            value = crudeRate !== 0 ? (productData.yield_qty / crudeRate) * 100 : 0;
          } else {
            value = productData[metric] || 0;
          }
        }
      } else if (bucketDef[0]?.startsWith('__CLASS:')) {
        const classCode = bucketDef[0].replace('__CLASS:', '') as 'F' | 'P';
        if (metric === 'yield_pct') {
          if (classCode === 'F') {
            value = 100;
          } else {
            value = crudeRate !== 0 ? (classData[classCode]?.yield_qty || 0) / crudeRate * 100 : 0;
          }
        } else {
          const rawValue = classData[classCode]?.[metric] || 0;
          value = classCode === 'F' ? -rawValue : rawValue;
        }
      } else if (bucketDef[0]?.startsWith('__CALC:')) {
        if (metric === 'yield_pct') {
          const nonCrudePct = crudeRate !== 0 ? (classData.P?.yield_qty || 0) / crudeRate * 100 : 0;
          value = 100 - nonCrudePct;
        } else {
          value = -(classData.F?.[metric] || 0) - (classData.P?.[metric] || 0);
        }
      } else {
        if (metric === 'yield_pct') {
          const bucketYield = bucketDef.reduce((sum, prod) => sum + (products[prod]?.yield_qty || 0), 0);
          value = crudeRate !== 0 ? (bucketYield / crudeRate) * 100 : 0;
        } else {
          value = bucketDef.reduce((sum, prod) => sum + (products[prod]?.[metric] || 0), 0);
        }
      }

      row[item] = value;
    });
    result.push(row);
  });

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export default function YieldReport() {
  const [selectedRange, setSelectedRange] = useState(dateRanges[2]); // 90 days default
  const [selectedItems, setSelectedItems] = useState<string[]>(defaultSelections);
  const [selectedMetric, setSelectedMetric] = useState(yieldMetrics[0].key);
  const [selectedRollingAvgs, setSelectedRollingAvgs] = useState<string[]>(['raw']); // Default to raw data
  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState(() => getDaysAgo(90));
  const [customEndDate, setCustomEndDate] = useState(() => getYesterday());

  // Y-axis bounds state
  const [yAxisBounds, setYAxisBounds] = useState<YAxisBounds>({ min: null, max: null });

  // Prior period overlay state (0 = off, 1-3 = number of prior periods)
  const [priorPeriods, setPriorPeriods] = useState(0);

  // SPC state
  const [showSPC, setShowSPC] = useState(false);
  const [spcSeries, setSpcSeries] = useState<string>(defaultSelections[0]);
  const [spcMetric, setSpcMetric] = useState<string>('yield_qty');
  const [spcBaselineMode, setSpcBaselineMode] = useState<BaselineMode>('full');
  const [spcBaselineDays, setSpcBaselineDays] = useState(30);
  const [spcEnabledRules, setSpcEnabledRules] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8]);
  const [spcYAxisBounds, setSpcYAxisBounds] = useState<SPCYAxisBounds>({ min: null, max: null });

  // SPC metric options
  const spcMetricOptions: MetricOption[] = [
    { key: 'yield_qty', label: 'Yield Value' },
    { key: 'yield_pct', label: 'Yield %' },
    { key: 'blend_qty', label: 'Blend' },
    { key: 'ship_qty', label: 'Ship' },
    { key: 'rec_qty', label: 'Receipt' },
    { key: 'oi_qty', label: 'Opening Inventory' },
    { key: 'ci_qty', label: 'Closing Inventory' },
  ];

  // Chart ref for downloads
  const chartRef = useRef<TimeSeriesChartRef>(null);

  // Calculate display date range (what user wants to see)
  const displayDateRange = useMemo(() => {
    if (selectedRange.type === 'custom') {
      return { start: customStartDate, end: customEndDate };
    }
    if (selectedRange.type === 'mtd') {
      return { start: getMonthStart(), end: getYesterday() };
    }
    if (selectedRange.type === 'ytd') {
      const year = new Date().getFullYear();
      return { start: `${year}-01-01`, end: getYesterday() };
    }
    return {
      start: getDaysAgo(selectedRange.days || 90),
      end: getYesterday(),
    };
  }, [selectedRange, customStartDate, customEndDate]);

  // Calculate fetch date range (may need extra data for rolling averages)
  const fetchDateRange = useMemo(() => {
    const needsMtdAvg = selectedRollingAvgs.includes('mtd_avg');
    const maxRollingDays = Math.max(
      ...selectedRollingAvgs
        .map(key => rollingAverageOptions.find(o => o.key === key)?.days || 0)
    );

    let start = displayDateRange.start;

    // For MTD average, we need data from the 1st of the earliest month in the range
    if (needsMtdAvg) {
      const startDate = new Date(displayDateRange.start);
      start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
    }

    // For regular rolling averages, we need extra days before the start
    if (maxRollingDays > 0) {
      const startDate = new Date(start);
      startDate.setDate(startDate.getDate() - maxRollingDays);
      const rollingStart = startDate.toISOString().split('T')[0];
      // Use the earlier of the two
      if (rollingStart < start) {
        start = rollingStart;
      }
    }

    return { start, end: displayDateRange.end };
  }, [displayDateRange, selectedRollingAvgs]);

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

  // Fetch yield data (using extended fetch range for rolling averages)
  const { data, isLoading, error } = useQuery({
    queryKey: ['yield-data', fetchDateRange.start, fetchDateRange.end],
    queryFn: async () => {
      const res = await fetch(
        `/api/yield?start_date=${fetchDateRange.start}&end_date=${fetchDateRange.end}&include_stats=true`
      );
      if (!res.ok) throw new Error('Failed to fetch yield data');
      return res.json();
    },
  });

  // Build product class map from data (product_name -> product_class)
  const productClassMap = useMemo(() => {
    if (!data?.data) return {};
    const map: Record<string, string> = {};
    data.data.forEach((row: YieldDataRow) => {
      if (row.product_class) {
        map[row.product_name] = row.product_class;
      }
    });
    return map;
  }, [data]);

  // Get unique products from data (individual products that appear in date range)
  const availableProducts = useMemo(() => {
    if (!data?.data) return [];
    return [...new Set(data.data.map((d: YieldDataRow) => d.product_name))].sort() as string[];
  }, [data]);

  // Selectable buckets (non-virtual and the virtual Loss bucket)
  const selectableBuckets = useMemo(() => {
    return buckets
      .sort((a, b) => a.display_order - b.display_order)
      .map(b => b.bucket_name);
  }, [buckets]);

  // Individual products not covered by bucket names
  const individualProducts = useMemo(() => {
    return availableProducts.filter(p => !selectableBuckets.includes(p));
  }, [availableProducts, selectableBuckets]);

  // Map bucket names to their component products
  const bucketMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    buckets.forEach(b => {
      map[b.bucket_name] = b.component_products;
    });
    return map;
  }, [buckets]);

  // Classify the current range for prior period alignment
  const rangeType = useMemo(() => classifyRange(selectedRange), [selectedRange]);

  // Calculate prior period date ranges
  const priorPeriodRanges = useMemo((): PriorPeriodRange[] => {
    if (priorPeriods <= 0) return [];
    return calculatePriorPeriods(displayDateRange.start, displayDateRange.end, rangeType, priorPeriods);
  }, [priorPeriods, displayDateRange, rangeType]);

  // Fetch prior period data (up to 3 separate queries, conditionally enabled)
  const { data: prior1Data } = useQuery({
    queryKey: ['yield-prior', priorPeriodRanges[0]?.start, priorPeriodRanges[0]?.end],
    queryFn: async () => {
      const range = priorPeriodRanges[0];
      const res = await fetch(`/api/yield?start_date=${range.start}&end_date=${range.end}`);
      if (!res.ok) throw new Error('Failed to fetch prior period 1');
      return res.json();
    },
    enabled: priorPeriods >= 1 && priorPeriodRanges.length >= 1,
  });

  const { data: prior2Data } = useQuery({
    queryKey: ['yield-prior', priorPeriodRanges[1]?.start, priorPeriodRanges[1]?.end],
    queryFn: async () => {
      const range = priorPeriodRanges[1];
      const res = await fetch(`/api/yield?start_date=${range.start}&end_date=${range.end}`);
      if (!res.ok) throw new Error('Failed to fetch prior period 2');
      return res.json();
    },
    enabled: priorPeriods >= 2 && priorPeriodRanges.length >= 2,
  });

  const { data: prior3Data } = useQuery({
    queryKey: ['yield-prior', priorPeriodRanges[2]?.start, priorPeriodRanges[2]?.end],
    queryFn: async () => {
      const range = priorPeriodRanges[2];
      const res = await fetch(`/api/yield?start_date=${range.start}&end_date=${range.end}`);
      if (!res.ok) throw new Error('Failed to fetch prior period 3');
      return res.json();
    },
    enabled: priorPeriods >= 3 && priorPeriodRanges.length >= 3,
  });

  // Transform data for chart (using extracted aggregation function)
  const rawChartData = useMemo(() => {
    if (!data?.data) return [];
    return aggregateYieldData(data.data, selectedItems, bucketMap, selectedMetric);
  }, [data, selectedItems, bucketMap, selectedMetric]);

  // Aggregate prior period data
  const priorChartDataSets = useMemo(() => {
    const sets: { data: any[]; label: string }[] = [];
    const priorDataSources = [prior1Data, prior2Data, prior3Data];

    for (let i = 0; i < priorPeriods; i++) {
      const pData = priorDataSources[i];
      if (pData?.data) {
        sets.push({
          data: aggregateYieldData(pData.data, selectedItems, bucketMap, selectedMetric),
          label: priorPeriodRanges[i]?.label || `Prior ${i + 1}`,
        });
      }
    }
    return sets;
  }, [prior1Data, prior2Data, prior3Data, priorPeriods, selectedItems, bucketMap, selectedMetric, priorPeriodRanges]);

  // Detect complete months (months where we have data from day 1)
  const completeMonths = useMemo(() => {
    if (!rawChartData.length) return new Set<string>();

    const monthFirstDays: Record<string, string> = {};
    rawChartData.forEach(row => {
      const month = row.date.substring(0, 7);
      const day = row.date.substring(8, 10);
      if (!monthFirstDays[month] || day < monthFirstDays[month]) {
        monthFirstDays[month] = day;
      }
    });

    // A month is complete if we have data from day 01
    const complete = new Set<string>();
    Object.entries(monthFirstDays).forEach(([month, firstDay]) => {
      if (firstDay === '01') {
        complete.add(month);
      }
    });
    return complete;
  }, [rawChartData]);

  // Pre-calculate all rolling averages efficiently (O(n) per item instead of O(n*d))
  const rollingAveragesData = useMemo(() => {
    if (!rawChartData.length) return {};

    const result: Record<string, Record<string, number[]>> = {};

    selectedItems.forEach(item => {
      result[item] = {};
      const values = rawChartData.map(r => (typeof r[item] === 'number' ? r[item] : 0) as number);

      // Calculate rolling averages using sliding window (O(n) each)
      selectedRollingAvgs.forEach(raKey => {
        const raOption = rollingAverageOptions.find(o => o.key === raKey);
        if (!raOption || raKey === 'raw') return;

        if (raOption.days > 0) {
          // N-day rolling average using sliding window
          const days = raOption.days;
          const avgs: number[] = [];
          let windowSum = 0;

          for (let i = 0; i < values.length; i++) {
            windowSum += values[i];
            if (i >= days) {
              windowSum -= values[i - days];
            }
            if (i >= days - 1) {
              avgs[i] = windowSum / days;
            }
          }
          result[item][raKey] = avgs;
        } else if (raOption.isMtd) {
          // MTD average - accumulate per month
          const avgs: number[] = [];
          let currentMonth = '';
          let monthSum = 0;
          let monthCount = 0;

          rawChartData.forEach((row, i) => {
            const month = row.date.substring(0, 7);

            // Check if month changed
            if (month !== currentMonth) {
              currentMonth = month;
              monthSum = 0;
              monthCount = 0;
            }

            // Only calculate for complete months
            if (completeMonths.has(month)) {
              monthSum += values[i];
              monthCount++;
              avgs[i] = monthSum / monthCount;
            }
          });
          result[item]['mtd_avg'] = avgs;
        }
      });
    });

    return result;
  }, [rawChartData, selectedItems, selectedRollingAvgs, completeMonths]);

  // Apply rolling averages and create final chart data (now O(n) lookup)
  // When prior periods are active, align by position and merge
  const finalChartData = useMemo(() => {
    if (!rawChartData.length) return [];

    const displayStartDate = displayDateRange.start;
    const hasPrior = priorPeriods > 0 && priorChartDataSets.length > 0;

    // Filter current data to display range
    const currentFiltered = rawChartData.filter(row => row.date >= displayStartDate);

    if (!hasPrior) {
      // No prior periods — original logic with rolling averages
      return rawChartData
        .map((row, originalIdx) => {
          if (row.date < displayStartDate) return null;

          const newRow: any = { date: row.date };

          selectedItems.forEach(item => {
            if (selectedRollingAvgs.includes('raw')) {
              newRow[item] = row[item];
            }

            selectedRollingAvgs.forEach(raKey => {
              if (raKey === 'raw') return;
              const raOption = rollingAverageOptions.find(o => o.key === raKey);
              if (!raOption) return;

              const avgValue = rollingAveragesData[item]?.[raKey]?.[originalIdx];
              if (avgValue !== undefined) {
                if (raOption.isMtd) {
                  newRow[`${item}_mtd`] = avgValue;
                } else {
                  newRow[`${item}_${raKey}`] = avgValue;
                }
              }
            });
          });

          return newRow;
        })
        .filter(Boolean);
    }

    // --- Prior period alignment mode ---
    // Find the max length across all periods
    const maxLen = Math.max(
      currentFiltered.length,
      ...priorChartDataSets.map(s => s.data.length)
    );

    const merged: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      const posLabel = getPositionLabel(i, rangeType, displayDateRange.start);
      const row: any = { positionLabel: posLabel };

      // Add current period values (with rolling averages)
      if (i < currentFiltered.length) {
        row.date = currentFiltered[i].date;
        // Find original index for rolling average lookup
        const originalIdx = rawChartData.indexOf(currentFiltered[i]);

        selectedItems.forEach(item => {
          if (selectedRollingAvgs.includes('raw')) {
            row[item] = currentFiltered[i][item];
          }

          selectedRollingAvgs.forEach(raKey => {
            if (raKey === 'raw') return;
            const raOption = rollingAverageOptions.find(o => o.key === raKey);
            if (!raOption) return;

            const avgValue = rollingAveragesData[item]?.[raKey]?.[originalIdx];
            if (avgValue !== undefined) {
              if (raOption.isMtd) {
                row[`${item}_mtd`] = avgValue;
              } else {
                row[`${item}_${raKey}`] = avgValue;
              }
            }
          });
        });
      }

      // Add prior period values (raw only, no rolling averages for prior)
      priorChartDataSets.forEach((pSet, pIdx) => {
        if (i < pSet.data.length) {
          selectedItems.forEach(item => {
            row[`${item}_prior${pIdx + 1}`] = pSet.data[i][item];
          });
        }
      });

      merged.push(row);
    }

    return merged;
  }, [rawChartData, displayDateRange, selectedItems, selectedRollingAvgs, rollingAveragesData, priorPeriods, priorChartDataSets, rangeType]);

  // Generate series keys for chart based on selections (including prior period keys)
  const chartSeriesKeys = useMemo(() => {
    const keys: string[] = [];
    selectedItems.forEach(item => {
      if (selectedRollingAvgs.includes('raw')) {
        keys.push(item);
      }
      selectedRollingAvgs.forEach(raKey => {
        if (raKey !== 'raw') {
          const raOption = rollingAverageOptions.find(o => o.key === raKey);
          if (raOption?.isMtd) {
            keys.push(`${item}_mtd`);
          } else if (raOption?.days) {
            keys.push(`${item}_${raKey}`);
          }
        }
      });
    });

    // Add prior period keys
    for (let p = 0; p < priorChartDataSets.length; p++) {
      selectedItems.forEach(item => {
        keys.push(`${item}_prior${p + 1}`);
      });
    }

    return keys;
  }, [selectedItems, selectedRollingAvgs, priorChartDataSets]);

  // Collect prior period key names for chart styling
  const priorPeriodKeysList = useMemo(() => {
    const keys: string[] = [];
    for (let p = 0; p < priorChartDataSets.length; p++) {
      selectedItems.forEach(item => {
        keys.push(`${item}_prior${p + 1}`);
      });
    }
    return keys;
  }, [selectedItems, priorChartDataSets]);

  // Series labels for prior period keys (human-readable)
  const priorSeriesLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    priorChartDataSets.forEach((pSet, pIdx) => {
      selectedItems.forEach(item => {
        labels[`${item}_prior${pIdx + 1}`] = `${item} (${pSet.label})`;
      });
    });
    return labels;
  }, [priorChartDataSets, selectedItems]);

  // Statistics for selected items (using raw data for stats)
  const stats = useMemo(() => {
    if (!finalChartData.length) return [];
    return selectedItems.map(item => {
      // Use raw values for statistics
      const values = finalChartData.map(d => d[item] || 0).filter(v => v !== 0);
      if (values.length === 0) return null;
      const total = values.reduce((a, b) => a + b, 0);
      const mean = total / values.length;
      // Calculate standard deviation
      const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
      const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(avgSquaredDiff);
      return {
        product_name: item,
        count: values.length,
        mean,
        stdDev,
        min: Math.min(...values),
        max: Math.max(...values),
        total,
      };
    }).filter(Boolean);
  }, [finalChartData, selectedItems]);

  // Prepare SPC data (calculate for any product and any metric from raw API data)
  const spcData = useMemo(() => {
    if (!data?.data || !spcSeries) return [];

    // Group raw data by date
    const byDate: Record<string, Record<string, Record<string, number>>> = {};
    const byDateClass: Record<string, Record<string, Record<string, number>>> = {};

    data.data.forEach((row: YieldDataRow) => {
      if (!byDate[row.date]) {
        byDate[row.date] = {};
        byDateClass[row.date] = {
          F: { yield_qty: 0, oi_qty: 0, ci_qty: 0, blend_qty: 0, ship_qty: 0, rec_qty: 0 },
          P: { yield_qty: 0, oi_qty: 0, ci_qty: 0, blend_qty: 0, ship_qty: 0, rec_qty: 0 },
        };
      }

      byDate[row.date][row.product_name] = {
        yield_qty: row.yield_qty || 0,
        oi_qty: row.oi_qty || 0,
        ci_qty: row.ci_qty || 0,
        blend_qty: row.blend_qty || 0,
        ship_qty: row.ship_qty || 0,
        rec_qty: row.rec_qty || 0,
      };

      const classCode = row.product_class as 'F' | 'P';
      if (classCode && byDateClass[row.date][classCode]) {
        byDateClass[row.date][classCode].yield_qty += row.yield_qty || 0;
        byDateClass[row.date][classCode].oi_qty += row.oi_qty || 0;
        byDateClass[row.date][classCode].ci_qty += row.ci_qty || 0;
        byDateClass[row.date][classCode].blend_qty += row.blend_qty || 0;
        byDateClass[row.date][classCode].ship_qty += row.ship_qty || 0;
        byDateClass[row.date][classCode].rec_qty += row.rec_qty || 0;
      }
    });

    // Get bucket definition if it's a bucket
    const bucketDef = bucketMap[spcSeries];

    // Calculate value for each date
    const result: { date: string; value: number }[] = [];
    const sortedDates = Object.keys(byDate).sort();

    // Filter to display date range
    const displayStartDate = displayDateRange.start;

    sortedDates.forEach(date => {
      if (date < displayStartDate) return;

      const products = byDate[date];
      const classData = byDateClass[date];
      const crudeRate = -(classData.F?.yield_qty || 0);

      let value = 0;

      if (!bucketDef) {
        // Individual product
        const productData = products[spcSeries];
        if (productData) {
          if (spcMetric === 'yield_pct') {
            value = crudeRate !== 0 ? (productData.yield_qty / crudeRate) * 100 : 0;
          } else {
            value = productData[spcMetric] || 0;
          }
        }
      } else if (bucketDef[0]?.startsWith('__CLASS:')) {
        // Class-based aggregation
        const classCode = bucketDef[0].replace('__CLASS:', '') as 'F' | 'P';
        if (spcMetric === 'yield_pct') {
          if (classCode === 'F') {
            value = 100;
          } else {
            value = crudeRate !== 0 ? (classData[classCode]?.yield_qty || 0) / crudeRate * 100 : 0;
          }
        } else {
          const rawValue = classData[classCode]?.[spcMetric] || 0;
          value = classCode === 'F' ? -rawValue : rawValue;
        }
      } else if (bucketDef[0]?.startsWith('__CALC:')) {
        // Calculated field - Loss
        if (spcMetric === 'yield_pct') {
          const nonCrudePct = crudeRate !== 0 ? (classData.P?.yield_qty || 0) / crudeRate * 100 : 0;
          value = 100 - nonCrudePct;
        } else {
          value = -(classData.F?.[spcMetric] || 0) - (classData.P?.[spcMetric] || 0);
        }
      } else {
        // Regular bucket - sum component products
        if (spcMetric === 'yield_pct') {
          const bucketYield = bucketDef.reduce((sum, prod) => sum + (products[prod]?.yield_qty || 0), 0);
          value = crudeRate !== 0 ? (bucketYield / crudeRate) * 100 : 0;
        } else {
          value = bucketDef.reduce((sum, prod) => sum + (products[prod]?.[spcMetric] || 0), 0);
        }
      }

      if (value !== 0) {
        result.push({ date, value });
      }
    });

    return result;
  }, [data, spcSeries, spcMetric, bucketMap, displayDateRange]);

  // Calculate baseline range for SPC
  const spcBaselineRange = useMemo(() => {
    if (spcBaselineMode === 'full' || !spcData.length) {
      return undefined;
    }
    if (spcBaselineMode === 'first_n') {
      return {
        start: 0,
        end: Math.min(spcBaselineDays - 1, spcData.length - 1),
      };
    }
    return undefined;
  }, [spcBaselineMode, spcBaselineDays, spcData.length]);

  // Download chart as PNG
  const downloadChartPNG = useCallback(() => {
    const dataUrl = chartRef.current?.getChartImage();
    if (dataUrl) {
      const link = document.createElement('a');
      link.download = `yield-chart-${displayDateRange.start}-to-${displayDateRange.end}.png`;
      link.href = dataUrl;
      link.click();
    }
  }, [displayDateRange]);

  // Download data as CSV
  const downloadCSV = useCallback(() => {
    if (!finalChartData.length) return;

    // Build CSV header
    const headers = ['Date', ...selectedItems];
    const rows = [headers.join(',')];

    // Build CSV rows
    finalChartData.forEach((row: any) => {
      const values = [row.date, ...selectedItems.map(item => row[item]?.toFixed(2) ?? '')];
      rows.push(values.join(','));
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `yield-data-${displayDateRange.start}-to-${displayDateRange.end}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [finalChartData, selectedItems, displayDateRange]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Yield Report Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Date Range
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              {dateRanges.map((range) => (
                <Button
                  key={range.label}
                  variant={selectedRange.label === range.label ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedRange(range)}
                >
                  {range.label}
                </Button>
              ))}
            </div>
            {/* Custom Date Range Pickers */}
            {selectedRange.type === 'custom' && (
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">From:</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">To:</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Metric Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Metric
            </label>
            <div className="flex flex-wrap gap-2">
              {yieldMetrics.map((metric) => (
                <Button
                  key={metric.key}
                  variant={selectedMetric === metric.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedMetric(metric.key);
                    // Reset y-axis bounds when metric changes
                    setYAxisBounds({ min: null, max: null });
                  }}
                >
                  {metric.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Rolling Average Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Display Options
              <span className="ml-2 text-xs text-gray-500 font-normal">
                (select multiple to overlay)
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {rollingAverageOptions.map((option) => (
                <Button
                  key={option.key}
                  variant={selectedRollingAvgs.includes(option.key) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedRollingAvgs((prev) => {
                      if (prev.includes(option.key)) {
                        // Don't allow deselecting if it's the last one
                        if (prev.length === 1) return prev;
                        return prev.filter((k) => k !== option.key);
                      }
                      return [...prev, option.key];
                    });
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {selectedRollingAvgs.includes('mtd_avg') && completeMonths.size > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                MTD Avg showing for complete months: {Array.from(completeMonths).sort().join(', ')}
              </p>
            )}
          </div>

          {/* Prior Period Overlay Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Prior Periods
              <span className="ml-2 text-xs text-gray-500 font-normal">
                (overlay previous periods for comparison)
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((n) => (
                <Button
                  key={n}
                  variant={priorPeriods === n ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPriorPeriods(n)}
                >
                  {n === 0 ? 'None' : n}
                </Button>
              ))}
            </div>
            {priorPeriodRanges.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Overlaying: {priorPeriodRanges.map(p => p.label).join(', ')}
              </p>
            )}
          </div>

          {/* Bucket Selector */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm font-medium text-gray-700">
                Buckets ({selectedItems.filter(i => bucketMap[i]).length} selected)
              </label>
              {selectedItems.length > 0 && (
                <button
                  onClick={() => setSelectedItems([])}
                  className="text-xs text-gray-500 hover:text-red-600 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectableBuckets.map((item: string) => (
                <Button
                  key={item}
                  variant={selectedItems.includes(item) ? 'default' : 'outline'}
                  size="sm"
                  className="font-semibold"
                  onClick={() => {
                    setSelectedItems((prev) =>
                      prev.includes(item)
                        ? prev.filter((p) => p !== item)
                        : [...prev, item]
                    );
                  }}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>

          {/* Collapsible Individual Products */}
          {individualProducts.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900 select-none">
                Individual Products ({individualProducts.length} available, {selectedItems.filter(i => !bucketMap[i]).length} selected)
              </summary>
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200">
                {individualProducts.map((item: string) => (
                  <Button
                    key={item}
                    variant={selectedItems.includes(item) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedItems((prev) =>
                        prev.includes(item)
                          ? prev.filter((p) => p !== item)
                          : [...prev, item]
                      );
                    }}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Performance Indicator */}
      {data?.meta && (
        <div className="text-sm text-gray-500">
          Query completed in <strong>{data.meta.query_time_ms}ms</strong> •{' '}
          {formatNumber(data.meta.record_count, 0)} records
        </div>
      )}

      {/* Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Yield Trend - {yieldMetrics.find(m => m.key === selectedMetric)?.label}</CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                Click on the Y-axis to set custom min/max values
                {(yAxisBounds.min !== null || yAxisBounds.max !== null) && (
                  <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                    Y: {yAxisBounds.min ?? 'auto'} - {yAxisBounds.max ?? 'auto'}
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadChartPNG} disabled={!finalChartData.length}>
                Download Chart
              </Button>
              <Button variant="outline" size="sm" onClick={downloadCSV} disabled={!finalChartData.length}>
                Download CSV
              </Button>
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
          ) : finalChartData.length > 0 ? (
            <TimeSeriesChart
              ref={chartRef}
              data={finalChartData}
              seriesKeys={chartSeriesKeys}
              seriesLabels={priorPeriods > 0 ? priorSeriesLabels : undefined}
              height={400}
              showDataZoom={finalChartData.length > 60}
              yAxisLabel={selectedMetric === 'yield_pct' ? 'Yield %' : yieldMetrics.find(m => m.key === selectedMetric)?.label}
              yAxisBounds={yAxisBounds}
              onYAxisBoundsChange={setYAxisBounds}
              priorPeriodKeys={priorPeriodKeysList.length > 0 ? priorPeriodKeysList : undefined}
              xAxisField={priorPeriods > 0 && priorChartDataSets.length > 0 ? 'positionLabel' : undefined}
            />
          ) : (
            <div className="h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">No data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics Table */}
      {stats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-semibold">Product</th>
                    <th className="text-right py-2 px-3 font-semibold">Count</th>
                    <th className="text-right py-2 px-3 font-semibold">Mean</th>
                    <th className="text-right py-2 px-3 font-semibold">Std Dev</th>
                    <th className="text-right py-2 px-3 font-semibold">Min</th>
                    <th className="text-right py-2 px-3 font-semibold">Max</th>
                    <th className="text-right py-2 px-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((stat: any) => (
                    <tr key={stat.product_name} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium">{stat.product_name}</td>
                      <td className="text-right py-2 px-3">{stat.count}</td>
                      <td className="text-right py-2 px-3">{formatNumber(stat.mean)}</td>
                      <td className="text-right py-2 px-3">{stat.stdDev.toFixed(1)}</td>
                      <td className="text-right py-2 px-3">{formatNumber(stat.min)}</td>
                      <td className="text-right py-2 px-3">{formatNumber(stat.max)}</td>
                      <td className="text-right py-2 px-3">{formatNumber(stat.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SPC Section */}
      {finalChartData.length > 0 && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setShowSPC(!showSPC)}
              className="flex items-center gap-2 w-full text-left"
            >
              {showSPC ? (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronRight className="h-5 w-5 text-gray-500" />
              )}
              <CardTitle>Statistical Process Control (SPC)</CardTitle>
              {!showSPC ? (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  Click to expand
                </span>
              ) : (spcYAxisBounds.min !== null || spcYAxisBounds.max !== null) && (
                <span className="text-xs font-normal px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded ml-2">
                  Y: {spcYAxisBounds.min ?? 'auto'} - {spcYAxisBounds.max ?? 'auto'}
                </span>
              )}
            </button>
          </CardHeader>
          {showSPC && (
            <CardContent className="space-y-4">
              <SPCControls
                availableBuckets={selectableBuckets}
                availableProducts={individualProducts}
                selectedSeries={spcSeries}
                onSeriesChange={(s) => setSpcSeries(s)}
                availableMetrics={spcMetricOptions}
                selectedMetric={spcMetric}
                onMetricChange={(m) => {
                  setSpcMetric(m);
                  setSpcYAxisBounds({ min: null, max: null });
                }}
                baselineMode={spcBaselineMode}
                onBaselineModeChange={setSpcBaselineMode}
                baselineDays={spcBaselineDays}
                onBaselineDaysChange={setSpcBaselineDays}
                enabledRules={spcEnabledRules}
                onEnabledRulesChange={setSpcEnabledRules}
              />

              {spcData.length > 0 ? (
                <SPCChart
                  data={spcData}
                  seriesLabel={`${spcSeries} - ${spcMetricOptions.find(m => m.key === spcMetric)?.label || spcMetric}`}
                  baselineRange={spcBaselineRange}
                  enabledRules={spcEnabledRules}
                  height={400}
                  yAxisFormatter={spcMetric === 'yield_pct' ? (v) => `${v.toFixed(1)}%` : undefined}
                  yAxisBounds={spcYAxisBounds}
                  onYAxisBoundsChange={setSpcYAxisBounds}
                />
              ) : (
                <div className="h-[200px] flex items-center justify-center bg-gray-50 rounded-lg">
                  <p className="text-gray-500">Select a series with data to view SPC analysis</p>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
