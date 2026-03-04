import { NextRequest, NextResponse } from 'next/server';
import { getPICachedData, insertPICacheData, getPICacheStats, clearPICache } from '@/lib/queries';

/**
 * GET /api/pi/cache?tag_names=A,B&start_date=2025-01-01&end_date=2025-03-01&mode=summary
 * Returns cached PI data for the given tags/date range.
 * Also returns which dates are missing so the client knows what to fetch from PI.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Stats-only mode
  if (searchParams.get('stats') === 'true') {
    return NextResponse.json(getPICacheStats());
  }

  const tagNames = searchParams.get('tag_names')?.split(',').filter(Boolean) || [];
  const startDate = searchParams.get('start_date') || '';
  const endDate = searchParams.get('end_date') || '';
  const mode = searchParams.get('mode') || 'summary';

  if (tagNames.length === 0 || !startDate || !endDate) {
    return NextResponse.json({ error: 'tag_names, start_date, end_date required' }, { status: 400 });
  }

  const cached = getPICachedData(tagNames, startDate, endDate, mode);

  // Build a set of cached dates per tag
  const cachedDates: Record<string, Set<string>> = {};
  tagNames.forEach(t => { cachedDates[t] = new Set(); });
  cached.forEach(row => {
    if (!cachedDates[row.tag_name]) cachedDates[row.tag_name] = new Set();
    cachedDates[row.tag_name].add(row.date);
  });

  // Generate all dates in range to find gaps
  const allDates: string[] = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    allDates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  // Find missing dates per tag
  const missingDates: Record<string, string[]> = {};
  let hasMissing = false;
  tagNames.forEach(t => {
    const missing = allDates.filter(date => !cachedDates[t].has(date));
    if (missing.length > 0) {
      missingDates[t] = missing;
      hasMissing = true;
    }
  });

  return NextResponse.json({
    cached,
    missingDates: hasMissing ? missingDates : null,
    allCached: !hasMissing,
  });
}

/**
 * POST /api/pi/cache
 * Body: { rows: [{ tag_name, date, value, good, retrieval_mode }] }
 * Stores PI data in cache (respects max row limit).
 */
export async function POST(request: NextRequest) {
  try {
    const { rows } = await request.json();
    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'rows array required' }, { status: 400 });
    }
    const inserted = insertPICacheData(rows);
    return NextResponse.json({ inserted, total: rows.length });
  } catch (error) {
    console.error('Error inserting PI cache data:', error);
    return NextResponse.json({ error: 'Failed to cache PI data' }, { status: 500 });
  }
}

/**
 * DELETE /api/pi/cache
 * Clears all cached PI data.
 */
export async function DELETE() {
  clearPICache();
  return NextResponse.json({ cleared: true });
}
