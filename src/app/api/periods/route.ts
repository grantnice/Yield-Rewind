import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export interface MonthlyPeriod {
  id: number;
  month: string;
  period_number: number;
  start_day: number;
  end_day: number;
}

interface PeriodInput {
  period_number: number;
  start_day: number;
  end_day: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Get the number of days in a month
function getDaysInMonth(month: string): number {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(year, monthNum, 0).getDate();
}

// Validate period configuration
function validatePeriods(periods: PeriodInput[], daysInMonth: number): ValidationResult {
  const errors: string[] = [];

  if (periods.length === 0) {
    errors.push('At least one period is required');
    return { valid: false, errors };
  }

  if (periods.length > 3) {
    errors.push('Maximum of 3 periods allowed per month');
    return { valid: false, errors };
  }

  // Sort by period number
  const sorted = [...periods].sort((a, b) => a.period_number - b.period_number);

  // Check period numbers are sequential starting from 1
  sorted.forEach((p, idx) => {
    if (p.period_number !== idx + 1) {
      errors.push('Period numbers must be sequential starting from 1');
    }
  });

  // Check first period starts at day 1
  if (sorted[0]?.start_day !== 1) {
    errors.push('First period must start on day 1');
  }

  // Check last period ends at last day of month
  if (sorted[sorted.length - 1]?.end_day !== daysInMonth) {
    errors.push(`Last period must end on day ${daysInMonth}`);
  }

  // Check each period's start <= end
  sorted.forEach((p) => {
    if (p.start_day > p.end_day) {
      errors.push(`Period ${p.period_number}: start day cannot be after end day`);
    }
    if (p.start_day < 1 || p.end_day > daysInMonth) {
      errors.push(`Period ${p.period_number}: days must be between 1 and ${daysInMonth}`);
    }
  });

  // Check no gaps between periods
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.start_day !== prev.end_day + 1) {
      errors.push(`Gap or overlap detected between period ${prev.period_number} and ${curr.period_number}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// GET - Fetch periods for a specific month
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json(
        { error: 'month parameter is required (format: YYYY-MM)' },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      SELECT id, month, period_number, start_day, end_day
      FROM monthly_periods
      WHERE month = ?
      ORDER BY period_number
    `);
    const periods = stmt.all(month) as MonthlyPeriod[];

    return NextResponse.json({
      periods,
      meta: {
        month,
        count: periods.length,
        days_in_month: getDaysInMonth(month),
      },
    });
  } catch (error) {
    console.error('Error fetching periods:', error);
    return NextResponse.json(
      { error: 'Failed to fetch periods' },
      { status: 500 }
    );
  }
}

// POST - Create or update periods for a month
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, periods } = body as { month: string; periods: PeriodInput[] };

    if (!month) {
      return NextResponse.json(
        { error: 'month is required (format: YYYY-MM)' },
        { status: 400 }
      );
    }

    if (!periods || !Array.isArray(periods)) {
      return NextResponse.json(
        { error: 'periods array is required' },
        { status: 400 }
      );
    }

    const daysInMonth = getDaysInMonth(month);
    const validation = validatePeriods(periods, daysInMonth);

    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Invalid period configuration', details: validation.errors },
        { status: 400 }
      );
    }

    // Delete existing periods for this month
    const deleteStmt = db.prepare('DELETE FROM monthly_periods WHERE month = ?');

    // Insert new periods
    const insertStmt = db.prepare(`
      INSERT INTO monthly_periods (month, period_number, start_day, end_day, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const transaction = db.transaction(() => {
      deleteStmt.run(month);
      for (const period of periods) {
        insertStmt.run(month, period.period_number, period.start_day, period.end_day);
      }
    });

    transaction();

    return NextResponse.json({
      success: true,
      count: periods.length,
    });
  } catch (error) {
    console.error('Error saving periods:', error);
    return NextResponse.json(
      { error: 'Failed to save periods' },
      { status: 500 }
    );
  }
}

// DELETE - Remove all periods for a month (reverts to single-period mode)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json(
        { error: 'month parameter is required' },
        { status: 400 }
      );
    }

    // Delete periods
    const deletePeriodsStmt = db.prepare('DELETE FROM monthly_periods WHERE month = ?');
    deletePeriodsStmt.run(month);

    // Also delete associated period targets
    const deleteTargetsStmt = db.prepare('DELETE FROM period_targets WHERE month = ?');
    deleteTargetsStmt.run(month);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting periods:', error);
    return NextResponse.json(
      { error: 'Failed to delete periods' },
      { status: 500 }
    );
  }
}
