'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { getDaysAgo, getYesterday, formatNumber } from '@/lib/utils';

// Quick date range options for tank trending
const dateRanges = [
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '30 Days', days: 30 },
  { label: '60 Days', days: 60 },
];

// Product type filters
const productTypes = [
  { key: 'ALL', label: 'All Products' },
  { key: 'HC', label: 'Hydrocarbons Only' },
  { key: 'WATER', label: 'Water Only' },
];

export default function TankInventory() {
  const [selectedRange, setSelectedRange] = useState(dateRanges[1]); // 14 days default
  const [selectedProductType, setSelectedProductType] = useState<'ALL' | 'HC' | 'WATER'>('HC');
  const [selectedTanks, setSelectedTanks] = useState<string[]>([]);

  // Calculate date range
  const dateRange = useMemo(() => ({
    start: getDaysAgo(selectedRange.days || 14),
    end: getYesterday(),
  }), [selectedRange]);

  // Fetch tank list
  const { data: tankList } = useQuery({
    queryKey: ['tank-list'],
    queryFn: async () => {
      const res = await fetch('/api/tanks?action=list');
      if (!res.ok) throw new Error('Failed to fetch tank list');
      return res.json();
    },
  });

  // Fetch tank data
  const { data, isLoading, error } = useQuery({
    queryKey: ['tank-data', dateRange.start, dateRange.end, selectedProductType],
    queryFn: async () => {
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
        product_type: selectedProductType,
      });
      const res = await fetch(`/api/tanks?${params}`);
      if (!res.ok) throw new Error('Failed to fetch tank data');
      return res.json();
    },
  });

  // Get available tanks from data
  const availableTanks = useMemo(() => {
    if (!data?.data) return [];
    return [...new Set(data.data.map((d: any) => d.tank_name))].sort();
  }, [data]);

  // Auto-select first 5 tanks if none selected
  useMemo(() => {
    if (selectedTanks.length === 0 && availableTanks.length > 0) {
      setSelectedTanks(availableTanks.slice(0, 5));
    }
  }, [availableTanks, selectedTanks.length]);

  // Transform data for chart
  const chartData = useMemo(() => {
    if (!data?.data) return [];

    const tanksToShow = selectedTanks.length > 0 ? selectedTanks : availableTanks.slice(0, 5);

    // Filter by selected tanks
    const filtered = data.data.filter((d: any) =>
      tanksToShow.includes(d.tank_name)
    );

    // Group by date
    const byDate: Record<string, any> = {};
    filtered.forEach((row: any) => {
      if (!byDate[row.date]) {
        byDate[row.date] = { date: row.date };
      }
      byDate[row.date][row.tank_name] = row.volume;
    });

    return Object.values(byDate).sort((a: any, b: any) =>
      a.date.localeCompare(b.date)
    );
  }, [data, selectedTanks, availableTanks]);

  // Current tank levels (most recent date)
  const currentLevels = useMemo(() => {
    if (!data?.data || data.data.length === 0) return [];

    // Get latest date
    const dates = [...new Set(data.data.map((d: any) => d.date))].sort();
    const latestDate = dates[dates.length - 1];

    return data.data
      .filter((d: any) => d.date === latestDate)
      .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0));
  }, [data]);

  // Tank selection handler
  const toggleTank = (tankName: string) => {
    setSelectedTanks((prev) =>
      prev.includes(tankName)
        ? prev.filter((t) => t !== tankName)
        : [...prev, tankName]
    );
  };

  const tanksToDisplay = selectedTanks.length > 0 ? selectedTanks : availableTanks.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Tank Inventory Controls</CardTitle>
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

          {/* Product Type Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Product Type
            </label>
            <div className="flex flex-wrap gap-2">
              {productTypes.map((pt) => (
                <Button
                  key={pt.key}
                  variant={selectedProductType === pt.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedProductType(pt.key as 'ALL' | 'HC' | 'WATER')}
                >
                  {pt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Tank Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Tanks ({selectedTanks.length} selected)
            </label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {availableTanks.map((tank: string) => (
                <Button
                  key={tank}
                  variant={selectedTanks.includes(tank) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleTank(tank)}
                >
                  {tank}
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

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Tank Level Trend</CardTitle>
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
              seriesKeys={tanksToDisplay}
              height={400}
              showDataZoom={chartData.length > 30}
              chartType="area"
              stacked={false}
            />
          ) : (
            <div className="h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">No data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Tank Levels Table */}
      {currentLevels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Current Tank Levels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-semibold">Tank</th>
                    <th className="text-left py-2 px-3 font-semibold">Product</th>
                    <th className="text-left py-2 px-3 font-semibold">Type</th>
                    <th className="text-right py-2 px-3 font-semibold">Volume (BBL)</th>
                  </tr>
                </thead>
                <tbody>
                  {currentLevels.slice(0, 20).map((tank: any) => (
                    <tr
                      key={tank.tank_name}
                      className={`border-b hover:bg-gray-50 ${
                        selectedTanks.includes(tank.tank_name) ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="py-2 px-3 font-medium">{tank.tank_name}</td>
                      <td className="py-2 px-3">{tank.product_name || '-'}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          tank.product_type === 'HC'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {tank.product_type}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3">{formatNumber(tank.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {currentLevels.length > 20 && (
              <p className="text-sm text-gray-500 mt-2">
                Showing top 20 of {currentLevels.length} tanks
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
