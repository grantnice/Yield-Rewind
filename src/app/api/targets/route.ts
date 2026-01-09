import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export interface YieldTarget {
  id: number;
  bucket_name: string;
  month: string;
  monthly_plan_target: number | null;
  business_plan_target: number | null;
  monthly_plan_rate: number | null;
  business_plan_rate: number | null;
}

// GET - Fetch targets for a specific month or all months
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    let query = `
      SELECT id, bucket_name, month, monthly_plan_target, business_plan_target, monthly_plan_rate, business_plan_rate
      FROM yield_targets
    `;
    const params: string[] = [];

    if (month) {
      query += ' WHERE month = ?';
      params.push(month);
    }

    query += ' ORDER BY bucket_name, month';

    const stmt = db.prepare(query);
    const targets = stmt.all(...params) as YieldTarget[];

    return NextResponse.json({
      targets,
      meta: {
        count: targets.length,
      },
    });
  } catch (error) {
    console.error('Error fetching yield targets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch yield targets' },
      { status: 500 }
    );
  }
}

// POST - Save or update a target
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bucket_name, month, monthly_plan_target, business_plan_target, monthly_plan_rate, business_plan_rate } = body;

    if (!bucket_name || !month) {
      return NextResponse.json(
        { error: 'bucket_name and month are required' },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      INSERT INTO yield_targets (bucket_name, month, monthly_plan_target, business_plan_target, monthly_plan_rate, business_plan_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(bucket_name, month) DO UPDATE SET
        monthly_plan_target = excluded.monthly_plan_target,
        business_plan_target = excluded.business_plan_target,
        monthly_plan_rate = excluded.monthly_plan_rate,
        business_plan_rate = excluded.business_plan_rate,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      bucket_name,
      month,
      monthly_plan_target ?? null,
      business_plan_target ?? null,
      monthly_plan_rate ?? null,
      business_plan_rate ?? null
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving yield target:', error);
    return NextResponse.json(
      { error: 'Failed to save yield target' },
      { status: 500 }
    );
  }
}

// PUT - Bulk update targets for a month
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, targets } = body as { month: string; targets: Partial<YieldTarget>[] };

    if (!month || !targets || !Array.isArray(targets)) {
      return NextResponse.json(
        { error: 'month and targets array are required' },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      INSERT INTO yield_targets (bucket_name, month, monthly_plan_target, business_plan_target, monthly_plan_rate, business_plan_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(bucket_name, month) DO UPDATE SET
        monthly_plan_target = excluded.monthly_plan_target,
        business_plan_target = excluded.business_plan_target,
        monthly_plan_rate = excluded.monthly_plan_rate,
        business_plan_rate = excluded.business_plan_rate,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertMany = db.transaction((items: Partial<YieldTarget>[]) => {
      for (const item of items) {
        if (item.bucket_name) {
          stmt.run(
            item.bucket_name,
            month,
            item.monthly_plan_target ?? null,
            item.business_plan_target ?? null,
            item.monthly_plan_rate ?? null,
            item.business_plan_rate ?? null
          );
        }
      }
    });

    insertMany(targets);

    return NextResponse.json({ success: true, count: targets.length });
  } catch (error) {
    console.error('Error bulk updating yield targets:', error);
    return NextResponse.json(
      { error: 'Failed to bulk update yield targets' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a target
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const bucket_name = searchParams.get('bucket_name');
    const month = searchParams.get('month');

    if (id) {
      const stmt = db.prepare('DELETE FROM yield_targets WHERE id = ?');
      stmt.run(parseInt(id, 10));
    } else if (bucket_name && month) {
      const stmt = db.prepare('DELETE FROM yield_targets WHERE bucket_name = ? AND month = ?');
      stmt.run(bucket_name, month);
    } else {
      return NextResponse.json(
        { error: 'id or (bucket_name and month) are required' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting yield target:', error);
    return NextResponse.json(
      { error: 'Failed to delete yield target' },
      { status: 500 }
    );
  }
}
