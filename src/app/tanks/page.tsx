'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { getDaysAgo, getYesterday, getMonthStart, formatNumber } from '@/lib/utils';

// Quick date range options for tank trending
const dateRanges = [
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
  { label: 'MTD', type: 'mtd' },
  { label: 'YTD', type: 'ytd' },
  { label: '6 Months', days: 180 },
  { label: '1 Year', days: 365 },
  { label: 'Custom', type: 'custom' },
];

// Volume type filters
const volumeTypes = [
  { key: 'ALL', label: 'Total Volume' },
  { key: 'HC', label: 'Hydrocarbon' },
  { key: 'WATER', label: 'Water' },
];

export default function TankInventory() {
  const [selectedRange, setSelectedRange] = useState(dateRanges[3]); // 90 days default
  const [selectedVolumeType, setSelectedVolumeType] = useState<'ALL' | 'HC' | 'WATER'>('ALL');
  const [selectedTanks, setSelectedTanks] = useState<string[]>(['503']); // Default to tank 503
  const [isStacked, setIsStacked] = useState(false);
  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState(() => getDaysAgo(90));
  const [customEndDate, setCustomEndDate] = useState(() => getYesterday());

  // Calculate date range
  const dateRange = useMemo(() => {
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
    queryKey: ['tank-data', dateRange.start, dateRange.end, selectedVolumeType],
    queryFn: async () => {
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
        volume_type: selectedVolumeType,
      });
      const res = await fetch(`/api/tanks?${params}`);
      if (!res.ok) throw new Error('Failed to fetch tank data');
      return res.json();
    },
  });

  // Get available tanks from data
  const availableTanks = useMemo((): string[] => {
    if (!data?.data) return [];
    return ([...new Set(data.data.map((d: any) => d.tank_name as string))] as string[]).sort();
  }, [data]);

  // No auto-select - keep user's selection or default

  // Get the volume field based on selected type
  const getVolume = (row: any) => {
    if (selectedVolumeType === 'HC') return row.hc_volume || 0;
    if (selectedVolumeType === 'WATER') return row.h2o_volume || 0;
    return row.total_volume || 0;
  };

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
      byDate[row.date][row.tank_name] = getVolume(row);
    });

    return Object.values(byDate).sort((a: any, b: any) =>
      a.date.localeCompare(b.date)
    );
  }, [data, selectedTanks, availableTanks, selectedVolumeType]);

  // Current tank levels (most recent date)
  const currentLevels = useMemo(() => {
    if (!data?.data || data.data.length === 0) return [];

    // Get latest date
    const dates = [...new Set(data.data.map((d: any) => d.date))].sort();
    const latestDate = dates[dates.length - 1];

    return data.data
      .filter((d: any) => d.date === latestDate)
      .map((d: any) => ({
        ...d,
        display_volume: getVolume(d),
      }))
      .sort((a: any, b: any) => (b.display_volume || 0) - (a.display_volume || 0));
  }, [data, selectedVolumeType]);

  // Tank selection handler
  const toggleTank = (tankName: string) => {
    setSelectedTanks((prev) =>
      prev.includes(tankName)
        ? prev.filter((t) => t !== tankName)
        : [...prev, tankName]
    );
  };

  const tanksToDisplay = selectedTanks;

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

          {/* Volume Type Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Volume Type
            </label>
            <div className="flex flex-wrap gap-2">
              {volumeTypes.map((vt) => (
                <Button
                  key={vt.key}
                  variant={selectedVolumeType === vt.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedVolumeType(vt.key as 'ALL' | 'HC' | 'WATER')}
                >
                  {vt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Tank Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                Tanks ({selectedTanks.length} selected)
              </label>
              <Button
                variant={isStacked ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIsStacked(!isStacked)}
              >
                {isStacked ? 'Stacked' : 'Stack Volumes'}
              </Button>
            </div>
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
              stacked={isStacked}
              yAxisLabel={`${volumeTypes.find(v => v.key === selectedVolumeType)?.label || 'Volume'} (BBL)`}
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
                    <th className="text-right py-2 px-3 font-semibold">HC (BBL)</th>
                    <th className="text-right py-2 px-3 font-semibold">Water (BBL)</th>
                    <th className="text-right py-2 px-3 font-semibold">Total (BBL)</th>
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
                      <td className="text-right py-2 px-3">
                        <span className={tank.hc_volume > 0 ? 'text-green-700' : 'text-gray-400'}>
                          {formatNumber(tank.hc_volume || 0)}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3">
                        <span className={tank.h2o_volume > 0 ? 'text-blue-700' : 'text-gray-400'}>
                          {formatNumber(tank.h2o_volume || 0)}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3 font-medium">
                        {formatNumber(tank.total_volume || 0)}
                      </td>
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
