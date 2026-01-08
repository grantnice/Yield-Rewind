'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';

// Get month options for the last 12 months
function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    });
  }
  return options;
}

export default function MonthlyYieldTable() {
  const monthOptions = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]);

  // Calculate date range for the selected month
  const dateRange = useMemo(() => {
    const year = selectedMonth.year;
    const month = selectedMonth.month;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;

    // Get last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Cap at yesterday if current month
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    return {
      start: startDate,
      end: endDate > yesterdayStr ? yesterdayStr : endDate,
    };
  }, [selectedMonth]);

  // Fetch yield data for the month
  const { data, isLoading, error } = useQuery({
    queryKey: ['monthly-yield', dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(
        `/api/yield?start_date=${dateRange.start}&end_date=${dateRange.end}&include_stats=true`
      );
      if (!res.ok) throw new Error('Failed to fetch yield data');
      return res.json();
    },
  });

  // Get unique products and dates
  const { products, dates } = useMemo(() => {
    if (!data?.data) return { products: [], dates: [] };

    const productSet = new Set<string>();
    const dateSet = new Set<string>();

    data.data.forEach((row: any) => {
      productSet.add(row.product_name);
      dateSet.add(row.date);
    });

    return {
      products: Array.from(productSet).sort(),
      dates: Array.from(dateSet).sort(),
    };
  }, [data]);

  // Create pivot table data: rows = products, columns = dates
  const tableData = useMemo(() => {
    if (!data?.data) return [];

    // Create lookup map
    const lookup: Record<string, Record<string, number>> = {};
    data.data.forEach((row: any) => {
      if (!lookup[row.product_name]) {
        lookup[row.product_name] = {};
      }
      lookup[row.product_name][row.date] = row.yield_qty || 0;
    });

    // Create row data with totals
    return products.map((product) => {
      const row: any = { product };
      let total = 0;
      let count = 0;

      dates.forEach((date) => {
        const value = lookup[product]?.[date] || 0;
        row[date] = value;
        total += value;
        if (value !== 0) count++;
      });

      row.total = total;
      row.average = count > 0 ? total / count : 0;

      return row;
    });
  }, [data, products, dates]);

  // Calculate column totals
  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    dates.forEach((date) => {
      totals[date] = tableData.reduce((sum, row) => sum + (row[date] || 0), 0);
    });
    totals.total = tableData.reduce((sum, row) => sum + (row.total || 0), 0);
    totals.average = tableData.reduce((sum, row) => sum + (row.average || 0), 0);
    return totals;
  }, [tableData, dates]);

  // Format date for header (just day number)
  const formatDateHeader = (dateStr: string) => {
    const day = parseInt(dateStr.split('-')[2], 10);
    return day.toString();
  };

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Yield Table</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Select Month
            </label>
            <div className="flex flex-wrap gap-2">
              {monthOptions.slice(0, 6).map((month) => (
                <Button
                  key={month.value}
                  variant={selectedMonth.value === month.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedMonth(month)}
                >
                  {month.label}
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

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Daily Yield by Product - {selectedMonth.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">Loading data...</p>
            </div>
          ) : error ? (
            <div className="h-[400px] flex items-center justify-center bg-red-50 rounded-lg">
              <p className="text-red-600">Failed to load data</p>
            </div>
          ) : tableData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-semibold sticky left-0 bg-white z-10">
                      Product
                    </th>
                    {dates.map((date) => (
                      <th key={date} className="text-right py-2 px-1 font-semibold min-w-[40px]">
                        {formatDateHeader(date)}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 font-semibold bg-gray-50">Total</th>
                    <th className="text-right py-2 px-2 font-semibold bg-gray-50">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row) => (
                    <tr key={row.product} className="border-b hover:bg-gray-50">
                      <td className="py-1.5 px-2 font-medium sticky left-0 bg-white">
                        {row.product}
                      </td>
                      {dates.map((date) => (
                        <td
                          key={date}
                          className={`text-right py-1.5 px-1 tabular-nums ${
                            row[date] === 0 ? 'text-gray-300' : ''
                          }`}
                        >
                          {row[date] === 0 ? '-' : formatNumber(row[date], 0)}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-semibold bg-gray-50 tabular-nums">
                        {formatNumber(row.total, 0)}
                      </td>
                      <td className="text-right py-1.5 px-2 font-semibold bg-gray-50 tabular-nums">
                        {formatNumber(row.average, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100">
                  <tr className="font-semibold">
                    <td className="py-2 px-2 sticky left-0 bg-gray-100">Total</td>
                    {dates.map((date) => (
                      <td key={date} className="text-right py-2 px-1 tabular-nums">
                        {formatNumber(columnTotals[date], 0)}
                      </td>
                    ))}
                    <td className="text-right py-2 px-2 bg-gray-200 tabular-nums">
                      {formatNumber(columnTotals.total, 0)}
                    </td>
                    <td className="text-right py-2 px-2 bg-gray-200 tabular-nums">
                      {formatNumber(columnTotals.average, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center bg-gray-50 rounded-lg">
              <p className="text-gray-500">No data available for selected month</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
