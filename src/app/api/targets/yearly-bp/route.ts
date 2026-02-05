import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

interface BPTargetInput {
  bucket_name: string;
  business_plan_target: number | null;
  business_plan_rate: number | null;
}

interface MonthlyBPData {
  month: string; // Format: "2026-01", "2026-02", etc.
  targets: BPTargetInput[];
}

interface YearlyBPSaveRequest {
  year: number;
  months: MonthlyBPData[];
}

export async function POST(request: NextRequest) {
  try {
    const body: YearlyBPSaveRequest = await request.json();
    const { year, months } = body;

    if (!year || !months || months.length === 0) {
      return NextResponse.json({ error: 'Year and months data are required' }, { status: 400 });
    }

    const saveStmt = db.prepare(`
      INSERT INTO yield_targets (bucket_name, month, business_plan_target, business_plan_rate)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_name, month) DO UPDATE SET
        business_plan_target = COALESCE(excluded.business_plan_target, yield_targets.business_plan_target),
        business_plan_rate = COALESCE(excluded.business_plan_rate, yield_targets.business_plan_rate)
    `);

    let totalSaved = 0;
    const monthsSaved: string[] = [];

    for (const monthData of months) {
      const { month, targets } = monthData;

      // Validate month format and year
      if (!month.startsWith(`${year}-`)) {
        continue; // Skip months that don't match the year
      }

      for (const target of targets) {
        saveStmt.run(
          target.bucket_name,
          month,
          target.business_plan_target,
          target.business_plan_rate
        );
        totalSaved++;
      }

      if (!monthsSaved.includes(month)) {
        monthsSaved.push(month);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Saved BP targets for ${monthsSaved.length} months (${totalSaved} total entries)`,
      stats: {
        months_saved: monthsSaved.length,
        total_entries: totalSaved,
        months: monthsSaved.sort(),
      },
    });
  } catch (error) {
    console.error('Error saving yearly BP targets:', error);
    return NextResponse.json(
      { error: 'Failed to save BP targets' },
      { status: 500 }
    );
  }
}
