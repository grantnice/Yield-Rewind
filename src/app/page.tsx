'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { TrendingUp, TrendingDown, BarChart3, Droplets } from 'lucide-react';
import { getDaysAgo, getYesterday, formatNumber } from '@/lib/utils';

interface QuickMetric {
  title: string;
  value: string;
  change?: number;
  icon: React.ElementType;
}

export default function Dashboard() {
  // Fetch yesterday's yield data for quick metrics
  const { data: yieldData, isLoading: yieldLoading } = useQuery({
    queryKey: ['dashboard-yield'],
    queryFn: async () => {
      const res = await fetch(
        `/api/yield?start_date=${getDaysAgo(7)}&end_date=${getYesterday()}&include_stats=true`
      );
      if (!res.ok) throw new Error('Failed to fetch yield data');
      return res.json();
    },
  });

  // Fetch recent sales data
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['dashboard-sales'],
    queryFn: async () => {
      const res = await fetch(
        `/api/sales?start_date=${getDaysAgo(7)}&end_date=${getYesterday()}&include_stats=true`
      );
      if (!res.ok) throw new Error('Failed to fetch sales data');
      return res.json();
    },
  });

  const loading = yieldLoading || salesLoading;

  // Process quick metrics
  const metrics: QuickMetric[] = [
    {
      title: 'Yield Records',
      value: loading ? '...' : formatNumber(yieldData?.meta?.record_count || 0, 0),
      icon: TrendingUp,
    },
    {
      title: 'Sales Records',
      value: loading ? '...' : formatNumber(salesData?.meta?.record_count || 0, 0),
      icon: BarChart3,
    },
    {
      title: 'Query Time (Yield)',
      value: loading ? '...' : `${yieldData?.meta?.query_time_ms || 0}ms`,
      icon: TrendingDown,
    },
    {
      title: 'Query Time (Sales)',
      value: loading ? '...' : `${salesData?.meta?.query_time_ms || 0}ms`,
      icon: Droplets,
    },
  ];

  // Prepare chart data (aggregate by date for all products)
  const chartData = yieldData?.data
    ? Object.values(
        yieldData.data.reduce((acc: Record<string, any>, row: any) => {
          if (!acc[row.date]) {
            acc[row.date] = { date: row.date, total_yield: 0 };
          }
          acc[row.date].total_yield += row.yield_qty || 0;
          return acc;
        }, {})
      ).sort((a: any, b: any) => a.date.localeCompare(b.date))
    : [];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Welcome to Yield Rewind</h1>
        <p className="text-gray-500 mt-1">
          High-performance refinery analytics dashboard
        </p>
      </div>

      {/* Quick Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Last 7 Days - Total Yield Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">Loading chart...</p>
            </div>
          ) : chartData.length > 0 ? (
            <TimeSeriesChart
              data={chartData as any[]}
              seriesKeys={['total_yield']}
              seriesLabels={{ total_yield: 'Total Yield' }}
              height={300}
              showDataZoom={false}
              chartType="area"
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">No data available. Run a sync to load data.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Notice */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-blue-100 p-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-900">Performance Optimized</h3>
              <p className="text-blue-700 text-sm mt-1">
                Data is served from a local SQLite database for instant response times.
                Background sync keeps data fresh automatically.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
