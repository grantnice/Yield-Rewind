import { NextRequest, NextResponse } from 'next/server';
import { getSalesData, getSalesProducts, getSalesCustomers, getSalesStatistics } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const startTime = performance.now();

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const productsParam = searchParams.get('products');
    const customersParam = searchParams.get('customers');
    const metric = searchParams.get('metric') || 'vol_qty_total';
    const includeStats = searchParams.get('include_stats') === 'true';

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 }
      );
    }

    const products = productsParam ? productsParam.split(',') : undefined;
    const customers = customersParam ? customersParam.split(',') : undefined;

    // Fetch data from SQLite
    const data = getSalesData(startDate, endDate, products, customers);

    // Optionally include statistics
    let stats = null;
    if (includeStats) {
      stats = getSalesStatistics(startDate, endDate, metric, products);
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
    console.error('Error fetching sales data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sales data' },
      { status: 500 }
    );
  }
}

// Get available products and customers
export async function POST(request: NextRequest) {
  try {
    const products = getSalesProducts();
    const customers = getSalesCustomers();
    return NextResponse.json({ products, customers });
  } catch (error) {
    console.error('Error fetching sales metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metadata' },
      { status: 500 }
    );
  }
}
