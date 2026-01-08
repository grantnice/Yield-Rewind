import { NextRequest, NextResponse } from 'next/server';
import { getTankData, getTankList } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const startTime = performance.now();

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const tankIdsParam = searchParams.get('tank_ids');
    const productType = searchParams.get('product_type') as 'WATER' | 'HC' | 'ALL' | null;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 }
      );
    }

    const tankIds = tankIdsParam ? tankIdsParam.split(',') : undefined;

    // Fetch data from SQLite
    const data = getTankData(startDate, endDate, tankIds, productType || 'ALL');

    const queryTimeMs = performance.now() - startTime;

    return NextResponse.json({
      data,
      meta: {
        query_time_ms: Math.round(queryTimeMs * 100) / 100,
        record_count: data.length,
        date_range: { start: startDate, end: endDate },
      },
    });
  } catch (error) {
    console.error('Error fetching tank data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tank data' },
      { status: 500 }
    );
  }
}

// Get tank list
export async function POST() {
  try {
    const tanks = getTankList();
    return NextResponse.json({ tanks });
  } catch (error) {
    console.error('Error fetching tank list:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tank list' },
      { status: 500 }
    );
  }
}
