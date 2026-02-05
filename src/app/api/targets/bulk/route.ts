import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

interface TargetInput {
  bucket_name: string;
  monthly_plan_target: number | null;
  monthly_plan_rate: number | null;
}

interface BulkSaveRequest {
  month: string;
  monthly: TargetInput[];
  periods: {
    period: number;
    targets: TargetInput[];
  }[];
}

export async function POST(request: NextRequest) {
  try {
    const body: BulkSaveRequest = await request.json();
    const { month, monthly, periods } = body;

    if (!month) {
      return NextResponse.json({ error: 'Month is required' }, { status: 400 });
    }

    // Begin transaction
    const saveMonthlyStmt = db.prepare(`
      INSERT INTO yield_targets (bucket_name, month, monthly_plan_target, monthly_plan_rate)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_name, month) DO UPDATE SET
        monthly_plan_target = COALESCE(excluded.monthly_plan_target, yield_targets.monthly_plan_target),
        monthly_plan_rate = COALESCE(excluded.monthly_plan_rate, yield_targets.monthly_plan_rate)
    `);

    const savePeriodStmt = db.prepare(`
      INSERT INTO period_targets (bucket_name, month, period_number, monthly_plan_target, monthly_plan_rate)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(bucket_name, month, period_number) DO UPDATE SET
        monthly_plan_target = COALESCE(excluded.monthly_plan_target, period_targets.monthly_plan_target),
        monthly_plan_rate = COALESCE(excluded.monthly_plan_rate, period_targets.monthly_plan_rate)
    `);

    let monthlySaved = 0;
    let periodsSaved = 0;

    // Save monthly targets
    if (monthly && monthly.length > 0) {
      for (const target of monthly) {
        saveMonthlyStmt.run(
          target.bucket_name,
          month,
          target.monthly_plan_target,
          target.monthly_plan_rate
        );
        monthlySaved++;
      }
    }

    // Save period targets
    if (periods && periods.length > 0) {
      for (const period of periods) {
        for (const target of period.targets) {
          savePeriodStmt.run(
            target.bucket_name,
            month,
            period.period,
            target.monthly_plan_target,
            target.monthly_plan_rate
          );
          periodsSaved++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Saved ${monthlySaved} monthly targets and ${periodsSaved} period targets`,
      stats: {
        monthly_saved: monthlySaved,
        periods_saved: periodsSaved,
      },
    });
  } catch (error) {
    console.error('Error saving bulk targets:', error);
    return NextResponse.json(
      { error: 'Failed to save targets' },
      { status: 500 }
    );
  }
}
