import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export interface PeriodTarget {
  id: number;
  bucket_name: string;
  month: string;
  period_number: number;
  monthly_plan_target: number | null;
  business_plan_target: number | null;
  monthly_plan_rate: number | null;
  business_plan_rate: number | null;
}

// GET - Fetch targets for a specific period or all periods of a month
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const period = searchParams.get('period');

    if (!month) {
      return NextResponse.json(
        { error: 'month parameter is required (format: YYYY-MM)' },
        { status: 400 }
      );
    }

    let query = `
      SELECT id, bucket_name, month, period_number, monthly_plan_target, business_plan_target, monthly_plan_rate, business_plan_rate
      FROM period_targets
      WHERE month = ?
    `;
    const params: (string | number)[] = [month];

    if (period) {
      query += ' AND period_number = ?';
      params.push(parseInt(period, 10));
    }

    query += ' ORDER BY period_number, bucket_name';

    const stmt = db.prepare(query);
    const targets = stmt.all(...params) as PeriodTarget[];

    return NextResponse.json({
      targets,
      meta: {
        month,
        period: period ? parseInt(period, 10) : null,
        count: targets.length,
      },
    });
  } catch (error) {
    console.error('Error fetching period targets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch period targets' },
      { status: 500 }
    );
  }
}

// PUT - Bulk update targets for a specific period
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, period_number, targets } = body as {
      month: string;
      period_number: number;
      targets: Partial<PeriodTarget>[];
    };

    if (!month || !period_number || !targets || !Array.isArray(targets)) {
      return NextResponse.json(
        { error: 'month, period_number, and targets array are required' },
        { status: 400 }
      );
    }

    // Verify the period exists
    const periodStmt = db.prepare(
      'SELECT id FROM monthly_periods WHERE month = ? AND period_number = ?'
    );
    const periodExists = periodStmt.get(month, period_number);

    if (!periodExists) {
      return NextResponse.json(
        { error: `Period ${period_number} does not exist for month ${month}. Create periods first.` },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      INSERT INTO period_targets (bucket_name, month, period_number, monthly_plan_target, business_plan_target, monthly_plan_rate, business_plan_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(bucket_name, month, period_number) DO UPDATE SET
        monthly_plan_target = excluded.monthly_plan_target,
        business_plan_target = excluded.business_plan_target,
        monthly_plan_rate = excluded.monthly_plan_rate,
        business_plan_rate = excluded.business_plan_rate,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertMany = db.transaction((items: Partial<PeriodTarget>[]) => {
      for (const item of items) {
        if (item.bucket_name) {
          stmt.run(
            item.bucket_name,
            month,
            period_number,
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
    console.error('Error bulk updating period targets:', error);
    return NextResponse.json(
      { error: 'Failed to bulk update period targets' },
      { status: 500 }
    );
  }
}

// DELETE - Remove targets for a period
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const period = searchParams.get('period');
    const bucket_name = searchParams.get('bucket_name');

    if (!month) {
      return NextResponse.json(
        { error: 'month parameter is required' },
        { status: 400 }
      );
    }

    if (period && bucket_name) {
      // Delete specific bucket target for a period
      const stmt = db.prepare(
        'DELETE FROM period_targets WHERE month = ? AND period_number = ? AND bucket_name = ?'
      );
      stmt.run(month, parseInt(period, 10), bucket_name);
    } else if (period) {
      // Delete all targets for a period
      const stmt = db.prepare('DELETE FROM period_targets WHERE month = ? AND period_number = ?');
      stmt.run(month, parseInt(period, 10));
    } else {
      // Delete all targets for a month
      const stmt = db.prepare('DELETE FROM period_targets WHERE month = ?');
      stmt.run(month);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting period targets:', error);
    return NextResponse.json(
      { error: 'Failed to delete period targets' },
      { status: 500 }
    );
  }
}
