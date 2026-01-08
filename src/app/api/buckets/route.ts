import { NextRequest, NextResponse } from 'next/server';
import { getBucketConfigs, saveBucketConfig } from '@/lib/queries';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bucketType = searchParams.get('type') as 'yield' | 'sales' | undefined;

    const buckets = getBucketConfigs(bucketType);

    return NextResponse.json({
      buckets,
      meta: {
        count: buckets.length,
      },
    });
  } catch (error) {
    console.error('Error fetching bucket configs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bucket configurations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { bucket_type, bucket_name, component_products, is_virtual, display_order } = body;

    if (!bucket_type || !bucket_name) {
      return NextResponse.json(
        { error: 'bucket_type and bucket_name are required' },
        { status: 400 }
      );
    }

    saveBucketConfig({
      bucket_type,
      bucket_name,
      component_products: component_products || [],
      is_virtual: is_virtual || false,
      display_order: display_order || 0,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving bucket config:', error);
    return NextResponse.json(
      { error: 'Failed to save bucket configuration' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    const stmt = db.prepare('DELETE FROM bucket_config WHERE id = ?');
    stmt.run(parseInt(id, 10));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting bucket config:', error);
    return NextResponse.json(
      { error: 'Failed to delete bucket configuration' },
      { status: 500 }
    );
  }
}
