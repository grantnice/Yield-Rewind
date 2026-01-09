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
];

// Volume metrics available
const volumeMetrics = [
  { key: 'vol_qty_total', label: 'Total Volume' },
  { key: 'vol_qty_tr', label: 'Truck Rack' },
  { key: 'vol_qty_pl', label: 'Pipeline' },
  { key: 'vol_qty_h2o', label: 'Marine' },
  { key: 'vol_qty_os', label: 'Other' },
];

// Default buckets to show
const defaultSelections = ['ULSD', 'Regular', 'Jet', 'Premium'];

interface BucketConfig {
  id: number;
  bucket_type: string;
  bucket_name: string;
  component_products: string[];
  is_virtual: boolean;
  display_order: number;
}

export default function SalesReport() {
  const [selectedRange, setSelectedRange] = useState(dateRanges[2]); // 90 days default
  const [selectedItems, setSelectedItems] = useState<string[]>(defaultSelections);
  const [selectedMetric, setSelectedMetric] = useState(volumeMetrics[0].key);
  const [selectedRollingAvgs, setSelectedRollingAvgs] = useState<string[]>(['raw']);
  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState(() => getDaysAgo(90));
  const [customEndDate, setCustomEndDate] = useState(() => getYesterday());

  // Calculate display date range
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

  // Calculate fetch date range (extra days for rolling averages)
  const dateRange = useMemo(() => {
    const maxRollingDays = Math.max(
      ...selectedRollingAvgs.map(key => rollingAverageOptions.find(o => o.key === key)?.days || 0)
    );
    if (maxRollingDays > 0) {
      const startDate = new Date(displayDateRange.start);
      startDate.setDate(startDate.getDate() - maxRollingDays);
      return { start: startDate.toISOString().split('T')[0], end: displayDateRange.end };
    }
    return displayDateRange;
  }, [displayDateRange, selectedRollingAvgs]);

  // Fetch bucket configs
  const { data: bucketsData } = useQuery({
    queryKey: ['buckets', 'sales'],
    queryFn: async () => {
      const res = await fetch('/api/buckets?type=sales');
      if (!res.ok) throw new Error('Failed to fetch buckets');
      return res.json();
    },
  });

  const buckets: BucketConfig[] = bucketsData?.buckets || [];

  // Fetch sales data
  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-data', dateRange.start, dateRange.end, selectedMetric],
    queryFn: async () => {
      const res = await fetch(
        `/api/sales?start_date=${dateRange.start}&end_date=${dateRange.end}&metric=${selectedMetric}&include_stats=true`
      );
      if (!res.ok) throw new Error('Failed to fetch sales data');
      return res.json();
    },
  });

  // Get unique products from data
  const availableProducts = useMemo(() => {
    if (!data?.data) return [];
    return [...new Set(data.data.map((d: any) => d.product_name))].sort() as string[];
  }, [data]);

  // Selectable buckets (non-virtual only)
  const selectableBuckets = useMemo(() => {
    return buckets
      .filter(b => !b.is_virtual)
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

  // Transform data for chart - aggregate by date and bucket/product
  const chartData = useMemo(() => {
    if (!data?.data) return [];

    // Group by date first, summing by product
    const byDate: Record<string, Record<string, number>> = {};
    data.data.forEach((row: any) => {
      if (!byDate[row.date]) {
        byDate[row.date] = {};
      }
      const currentValue = byDate[row.date][row.product_name] || 0;
      byDate[row.date][row.product_name] = currentValue + (row[selectedMetric] || 0);
    });

    // Now aggregate based on selected items (buckets or individual products)
    const result: any[] = [];
    Object.entries(byDate).forEach(([date, products]) => {
      const row: any = { date };
      selectedItems.forEach(item => {
        if (bucketMap[item]) {
          // It's a bucket - sum component products
          row[item] = bucketMap[item].reduce((sum, prod) => sum + (products[prod] || 0), 0);
        } else {
          // Individual product
          row[item] = products[item] || 0;
        }
      });
      result.push(row);
    });

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedItems, selectedMetric, bucketMap]);

  // Statistics for selected items
  const stats = useMemo(() => {
    if (!chartData.length) return [];
    return selectedItems.map(item => {
      const values = chartData.map(d => d[item] || 0).filter(v => v !== 0);
      if (values.length === 0) return null;
      const total = values.reduce((a, b) => a + b, 0);
      return {
        product_name: item,
        count: values.length,
        mean: total / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        total,
      };
    }).filter(Boolean);
  }, [chartData, selectedItems]);

  // Customer breakdown for recent period
  const customerBreakdown = useMemo(() => {
    if (!data?.data) return [];

    // Get all products that are selected (including bucket components)
    const relevantProducts = new Set<string>();
    selectedItems.forEach(item => {
      if (bucketMap[item]) {
        bucketMap[item].forEach(p => relevantProducts.add(p));
      } else {
        relevantProducts.add(item);
      }
    });

    const byCustomer: Record<string, number> = {};
    data.data.forEach((row: any) => {
      if (row.customer_name && relevantProducts.has(row.product_name)) {
        byCustomer[row.customer_name] = (byCustomer[row.customer_name] || 0) + (row[selectedMetric] || 0);
      }
    });

    return Object.entries(byCustomer)
      .map(([name, volume]) => ({ name, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);
  }, [data, selectedItems, selectedMetric, bucketMap]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Report Controls</CardTitle>
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
          </div>

          {/* Metric Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Volume Metric
            </label>
            <div className="flex flex-wrap gap-2">
              {volumeMetrics.map((metric) => (
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
          <CardTitle>Sales Trend - {volumeMetrics.find(m => m.key === selectedMetric)?.label}</CardTitle>
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
              seriesKeys={selectedItems}
              height={400}
              showDataZoom={chartData.length > 60}
              stacked={true}
              chartType="bar"
              yAxisLabel={volumeMetrics.find(m => m.key === selectedMetric)?.label}
            />
          ) : (
            <div className="h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">No data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Statistics Table */}
        {stats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Product Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-semibold">Product</th>
                      <th className="text-right py-2 px-3 font-semibold">Count</th>
                      <th className="text-right py-2 px-3 font-semibold">Avg/Day</th>
                      <th className="text-right py-2 px-3 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((stat: any) => (
                      <tr key={stat.product_name} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{stat.product_name}</td>
                        <td className="text-right py-2 px-3">{stat.count}</td>
                        <td className="text-right py-2 px-3">{formatNumber(stat.mean)}</td>
                        <td className="text-right py-2 px-3">{formatNumber(stat.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Customers */}
        {customerBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Top Customers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-semibold">Customer</th>
                      <th className="text-right py-2 px-3 font-semibold">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerBreakdown.map((customer) => (
                      <tr key={customer.name} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{customer.name}</td>
                        <td className="text-right py-2 px-3">{formatNumber(customer.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
