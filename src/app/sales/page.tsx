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
];

// Volume metrics available
const volumeMetrics = [
  { key: 'vol_qty_total', label: 'Total Volume' },
  { key: 'vol_qty_tr', label: 'Truck Volume' },
  { key: 'vol_qty_pl', label: 'Pipeline Volume' },
];

// Default products to show
const defaultProducts = ['ULSD', 'CBOB', 'Jet', 'Regular'];

export default function SalesReport() {
  const [selectedRange, setSelectedRange] = useState(dateRanges[2]); // 90 days default
  const [selectedProducts, setSelectedProducts] = useState<string[]>(defaultProducts);
  const [selectedMetric, setSelectedMetric] = useState(volumeMetrics[0].key);

  // Calculate date range
  const dateRange = useMemo(() => {
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
  }, [selectedRange]);

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
    return [...new Set(data.data.map((d: any) => d.product_name))].sort();
  }, [data]);

  // Transform data for chart - aggregate by date and product
  const chartData = useMemo(() => {
    if (!data?.data) return [];

    // Filter by selected products
    const filtered = data.data.filter((d: any) =>
      selectedProducts.includes(d.product_name)
    );

    // Group by date, sum volumes per product
    const byDate: Record<string, any> = {};
    filtered.forEach((row: any) => {
      if (!byDate[row.date]) {
        byDate[row.date] = { date: row.date };
      }
      const currentValue = byDate[row.date][row.product_name] || 0;
      byDate[row.date][row.product_name] = currentValue + (row[selectedMetric] || 0);
    });

    return Object.values(byDate).sort((a: any, b: any) =>
      a.date.localeCompare(b.date)
    );
  }, [data, selectedProducts, selectedMetric]);

  // Statistics for selected products
  const stats = useMemo(() => {
    if (!data?.stats) return [];
    return data.stats.filter((s: any) => selectedProducts.includes(s.product_name));
  }, [data, selectedProducts]);

  // Customer breakdown for recent period
  const customerBreakdown = useMemo(() => {
    if (!data?.data) return [];

    const byCustomer: Record<string, number> = {};
    data.data.forEach((row: any) => {
      if (row.customer_name && selectedProducts.includes(row.product_name)) {
        byCustomer[row.customer_name] = (byCustomer[row.customer_name] || 0) + (row[selectedMetric] || 0);
      }
    });

    return Object.entries(byCustomer)
      .map(([name, volume]) => ({ name, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);
  }, [data, selectedProducts, selectedMetric]);

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
            <div className="flex flex-wrap gap-2">
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

          {/* Product Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Products ({selectedProducts.length} selected)
            </label>
            <div className="flex flex-wrap gap-2">
              {availableProducts.slice(0, 15).map((product: string) => (
                <Button
                  key={product}
                  variant={selectedProducts.includes(product) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedProducts((prev) =>
                      prev.includes(product)
                        ? prev.filter((p) => p !== product)
                        : [...prev, product]
                    );
                  }}
                >
                  {product}
                </Button>
              ))}
            </div>
          </div>
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
              seriesKeys={selectedProducts}
              height={400}
              showDataZoom={chartData.length > 60}
              stacked={true}
              chartType="bar"
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
