import { NextRequest, NextResponse } from 'next/server';
import { getYieldData, getYieldProducts, getYieldStatistics } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const startTime = performance.now();

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const productsParam = searchParams.get('products');
    const includeStats = searchParams.get('include_stats') === 'true';

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 }
      );
    }

    const products = productsParam ? productsParam.split(',') : undefined;

    // Fetch data from SQLite (fast!)
    const data = getYieldData(startDate, endDate, products);

    // Optionally include statistics
    let stats = null;
    if (includeStats) {
      stats = getYieldStatistics(startDate, endDate, products);
    }

    const queryTimeMs = performance.now() - startTime;

    return NextResponse.json({
      data,
      stats,
      meta: {
        query_time_ms: Math.round(queryTimeMs * 100) / 100,
        record_count: data.length,
        date_range: { start: startDate, end: endDate },
      },
    });
  } catch (error) {
    console.error('Error fetching yield data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch yield data' },
      { status: 500 }
    );
  }
}

// Get available products
export async function POST(request: NextRequest) {
  try {
    const products = getYieldProducts();
    return NextResponse.json({ products });
  } catch (error) {
    console.error('Error fetching yield products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
