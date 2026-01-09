'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { getDaysAgo, getYesterday, getMonthStart, formatNumber } from '@/lib/utils';

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

export default function YieldReport() {
  const [selectedRange, setSelectedRange] = useState(dateRanges[2]); // 90 days default
  const [selectedItems, setSelectedItems] = useState<string[]>(defaultSelections);
  const [selectedMetric, setSelectedMetric] = useState(yieldMetrics[0].key);
  const [selectedRollingAvgs, setSelectedRollingAvgs] = useState<string[]>(['raw']); // Default to raw data
  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState(() => getDaysAgo(90));
  const [customEndDate, setCustomEndDate] = useState(() => getYesterday());

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

  // Transform data for chart (with bucket aggregation including class-based)
  const rawChartData = useMemo(() => {
    if (!data?.data) return [];

    // Group by date, storing all metrics per product
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

      // Store all metrics for this product
      byDate[row.date][row.product_name] = {
        yield_qty: row.yield_qty || 0,
        oi_qty: row.oi_qty || 0,
        ci_qty: row.ci_qty || 0,
        blend_qty: row.blend_qty || 0,
        ship_qty: row.ship_qty || 0,
        rec_qty: row.rec_qty || 0,
      };

      // Aggregate by class for all metrics
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

    // Now aggregate based on selected items and metric
    const result: any[] = [];
    Object.entries(byDate).forEach(([date, products]) => {
      const row: any = { date };
      const classData = byDateClass[date];

      // Calculate crude rate for yield_pct denominator (always use yield_qty for crude rate)
      const crudeRate = -(classData.F?.yield_qty || 0); // Negated to be positive

      selectedItems.forEach(item => {
        const bucketDef = bucketMap[item];
        let value = 0;

        if (!bucketDef) {
          // Individual product
          const productData = products[item];
          if (productData) {
            if (selectedMetric === 'yield_pct') {
              // Yield percent = (product yield / crude rate) * 100
              value = crudeRate !== 0 ? (productData.yield_qty / crudeRate) * 100 : 0;
            } else {
              value = productData[selectedMetric] || 0;
            }
          }
        } else if (bucketDef[0]?.startsWith('__CLASS:')) {
          // Class-based aggregation (Crude Rate or Non-Crude Total)
          const classCode = bucketDef[0].replace('__CLASS:', '') as 'F' | 'P';
          if (selectedMetric === 'yield_pct') {
            // For Crude Rate yield%, it's always 100%; for Non-Crude, it's sum of P yields / crude rate
            if (classCode === 'F') {
              value = 100; // Crude Rate is always 100% of itself
            } else {
              value = crudeRate !== 0 ? (classData[classCode]?.yield_qty || 0) / crudeRate * 100 : 0;
            }
          } else {
            const rawValue = classData[classCode]?.[selectedMetric] || 0;
            // Negate Crude Rate (F) so it displays as positive (feed consumption/inventory)
            value = classCode === 'F' ? -rawValue : rawValue;
          }
        } else if (bucketDef[0]?.startsWith('__CALC:')) {
          // Calculated field - Loss = Crude Rate - Non-Crude Total
          if (selectedMetric === 'yield_pct') {
            // Loss % = 100% - Non-Crude %
            const nonCrudePct = crudeRate !== 0 ? (classData.P?.yield_qty || 0) / crudeRate * 100 : 0;
            value = 100 - nonCrudePct;
          } else {
            // Loss = (-F) - P for the selected metric
            value = -(classData.F?.[selectedMetric] || 0) - (classData.P?.[selectedMetric] || 0);
          }
        } else {
          // Regular bucket - sum component products
          if (selectedMetric === 'yield_pct') {
            // Sum yield_qty of components, then calculate percentage
            const bucketYield = bucketDef.reduce((sum, prod) => sum + (products[prod]?.yield_qty || 0), 0);
            value = crudeRate !== 0 ? (bucketYield / crudeRate) * 100 : 0;
          } else {
            value = bucketDef.reduce((sum, prod) => sum + (products[prod]?.[selectedMetric] || 0), 0);
          }
        }

        row[item] = value;
      });
      result.push(row);
    });

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedItems, bucketMap, selectedMetric]);

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
      const values = rawChartData.map(r => r[item] || 0);

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
  const finalChartData = useMemo(() => {
    if (!rawChartData.length) return [];

    // Filter to display date range
    const displayStartDate = displayDateRange.start;

    return rawChartData
      .map((row, originalIdx) => {
        // Skip if before display range
        if (row.date < displayStartDate) return null;

        const newRow: any = { date: row.date };

        selectedItems.forEach(item => {
          // Add raw data if selected
          if (selectedRollingAvgs.includes('raw')) {
            newRow[item] = row[item];
          }

          // Add pre-calculated rolling averages
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
  }, [rawChartData, displayDateRange, selectedItems, selectedRollingAvgs, rollingAveragesData]);

  // Generate series keys for chart based on selections
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
    return keys;
  }, [selectedItems, selectedRollingAvgs]);

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
                  onClick={() => setSelectedMetric(metric.key)}
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

          {/* Bucket Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Buckets ({selectedItems.filter(i => bucketMap[i]).length} selected)
            </label>
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
          <CardTitle>Yield Trend - {yieldMetrics.find(m => m.key === selectedMetric)?.label}</CardTitle>
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
              data={finalChartData}
              seriesKeys={chartSeriesKeys}
              height={400}
              showDataZoom={finalChartData.length > 60}
              yAxisLabel={selectedMetric === 'yield_pct' ? 'Yield %' : yieldMetrics.find(m => m.key === selectedMetric)?.label}
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
    </div>
  );
}
