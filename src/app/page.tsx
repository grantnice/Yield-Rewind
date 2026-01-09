'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Fuel, Flame, AlertTriangle } from 'lucide-react';
import { getMonthStart, getYesterday, formatNumber } from '@/lib/utils';

export default function Dashboard() {
  // Get MTD date range
  const mtdStart = getMonthStart();
  const mtdEnd = getYesterday();

  // Fetch MTD yield data
  const { data: yieldData, isLoading } = useQuery({
    queryKey: ['dashboard-mtd-yield', mtdStart, mtdEnd],
    queryFn: async () => {
      const res = await fetch(
        `/api/yield?start_date=${mtdStart}&end_date=${mtdEnd}&include_stats=true`
      );
      if (!res.ok) throw new Error('Failed to fetch yield data');
      return res.json();
    },
  });

  // Fetch bucket configs for Distillate
  const { data: bucketsData } = useQuery({
    queryKey: ['buckets', 'yield'],
    queryFn: async () => {
      const res = await fetch('/api/buckets?type=yield');
      if (!res.ok) throw new Error('Failed to fetch buckets');
      return res.json();
    },
  });

  // Calculate MTD metrics (average daily values)
  const mtdMetrics = useMemo(() => {
    if (!yieldData?.data) return null;

    // Get unique dates to count days
    const uniqueDates = new Set<string>();

    // Sum by product class and date
    const dailyCrude: Record<string, number> = {};
    const dailyNonCrude: Record<string, number> = {};
    const productYields: Record<string, number> = {};

    yieldData.data.forEach((row: any) => {
      const yieldQty = row.yield_qty || 0;
      uniqueDates.add(row.date);
      productYields[row.product_name] = (productYields[row.product_name] || 0) + yieldQty;

      if (row.product_class === 'F') {
        dailyCrude[row.date] = (dailyCrude[row.date] || 0) + yieldQty;
      } else if (row.product_class === 'P') {
        dailyNonCrude[row.date] = (dailyNonCrude[row.date] || 0) + yieldQty;
      }
    });

    const numDays = uniqueDates.size || 1;

    // Calculate totals
    const crudeRateTotal = Object.values(dailyCrude).reduce((a, b) => a + b, 0);
    const nonCrudeTotal = Object.values(dailyNonCrude).reduce((a, b) => a + b, 0);

    // Negate crude rate for display (feed consumption shows positive)
    const avgCrudeRate = -crudeRateTotal / numDays;
    const avgNonCrude = nonCrudeTotal / numDays;
    const avgLoss = avgCrudeRate - avgNonCrude;

    // Calculate Distillate from bucket
    let distillateTotal = 0;
    const distillateBucket = bucketsData?.buckets?.find((b: any) => b.bucket_name === 'Distillate');
    if (distillateBucket) {
      distillateTotal = distillateBucket.component_products.reduce(
        (sum: number, prod: string) => sum + (productYields[prod] || 0),
        0
      );
    }
    const avgDistillate = distillateTotal / numDays;

    return {
      crudeRate: avgCrudeRate,
      distillate: avgDistillate,
      loss: avgLoss,
      lossPercent: avgCrudeRate !== 0 ? (avgLoss / avgCrudeRate) * 100 : 0,
      numDays,
    };
  }, [yieldData, bucketsData]);

  // Get current month name
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Welcome to Yield Rewind</h1>
        <p className="text-gray-500 mt-1">
          High-performance refinery analytics dashboard
        </p>
      </div>

      {/* MTD Summary Header */}
      <div className="text-lg font-semibold text-gray-700">
        MTD Average Daily: {currentMonth}
        {mtdMetrics && <span className="text-sm font-normal text-gray-500 ml-2">({mtdMetrics.numDays} days)</span>}
      </div>

      {/* MTD Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Avg Daily Crude Rate
            </CardTitle>
            <Fuel className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? '...' : formatNumber(mtdMetrics?.crudeRate || 0, 0)}
            </div>
            <p className="text-xs text-gray-500 mt-1">barrels/day</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Avg Daily Distillate
            </CardTitle>
            <Flame className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? '...' : formatNumber(mtdMetrics?.distillate || 0, 0)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              barrels/day
              {!isLoading && mtdMetrics?.crudeRate ? ` (${((mtdMetrics.distillate / mtdMetrics.crudeRate) * 100).toFixed(1)}%)` : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Avg Daily Loss
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? '...' : formatNumber(mtdMetrics?.loss || 0, 0)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {isLoading ? '' : `${mtdMetrics?.lossPercent?.toFixed(1)}% of crude`}
            </p>
          </CardContent>
        </Card>
      </div>

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
