import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals = 1): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateShort(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0); // Noon to avoid timezone issues
  return yesterday.toISOString().split('T')[0];
}

export function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString().split('T')[0];
}

export function getMonthStart(date?: Date): string {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function getYearStart(date?: Date): string {
  const d = date || new Date();
  return `${d.getFullYear()}-01-01`;
}

// --- Prior Period Helpers ---

export interface PriorPeriodRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string; // e.g. "Jan 2025" or "Dec 15 - Dec 21"
}

type RangeType = 'mtd' | 'ytd' | '7days' | '30days' | '90days' | '1year' | 'custom';

/**
 * Classify a selectedRange config into a RangeType for alignment purposes.
 */
export function classifyRange(range: { label: string; days?: number; type?: string }): RangeType {
  if (range.type === 'mtd') return 'mtd';
  if (range.type === 'ytd') return 'ytd';
  if (range.days === 7) return '7days';
  if (range.days === 30) return '30days';
  if (range.days === 90) return '90days';
  if (range.days === 365) return '1year';
  return 'custom';
}

/**
 * Calculate date ranges for N prior periods based on the current range.
 */
export function calculatePriorPeriods(
  start: string,
  end: string,
  rangeType: RangeType,
  count: number
): PriorPeriodRange[] {
  const periods: PriorPeriodRange[] = [];
  if (count <= 0) return periods;

  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);

  for (let i = 1; i <= count; i++) {
    let pStart: Date;
    let pEnd: Date;

    switch (rangeType) {
      case 'mtd': {
        // Shift back i months
        pStart = new Date(startDate.getFullYear(), startDate.getMonth() - i, 1);
        // End = last day of that month
        pEnd = new Date(pStart.getFullYear(), pStart.getMonth() + 1, 0);
        break;
      }
      case 'ytd':
      case '1year': {
        // Shift back i years
        pStart = new Date(startDate.getFullYear() - i, startDate.getMonth(), startDate.getDate());
        pEnd = new Date(endDate.getFullYear() - i, endDate.getMonth(), endDate.getDate());
        break;
      }
      case '7days': {
        // Shift back i * 7 days
        pStart = new Date(startDate);
        pStart.setDate(pStart.getDate() - i * 7);
        pEnd = new Date(endDate);
        pEnd.setDate(pEnd.getDate() - i * 7);
        break;
      }
      default: {
        // 30days, 90days, custom: shift back by the range span * i
        const spanDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        pStart = new Date(startDate);
        pStart.setDate(pStart.getDate() - (spanDays + 1) * i);
        pEnd = new Date(endDate);
        pEnd.setDate(pEnd.getDate() - (spanDays + 1) * i);
        break;
      }
    }

    periods.push({
      start: toDateString(pStart),
      end: toDateString(pEnd),
      label: formatPeriodLabel(pStart, pEnd, rangeType),
    });
  }

  return periods;
}

/**
 * Generate a position-based x-axis label for day index.
 */
export function getPositionLabel(dayIndex: number, rangeType: RangeType, startDate?: string): string {
  switch (rangeType) {
    case 'mtd':
      return `Day ${dayIndex + 1}`;
    case '7days': {
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      if (startDate) {
        const d = parseLocalDate(startDate);
        d.setDate(d.getDate() + dayIndex);
        return weekdays[d.getDay()];
      }
      return `Day ${dayIndex + 1}`;
    }
    case 'ytd':
    case '1year': {
      // Show month abbreviation + day
      if (startDate) {
        const d = parseLocalDate(startDate);
        d.setDate(d.getDate() + dayIndex);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      return `Day ${dayIndex + 1}`;
    }
    default:
      return `Day ${dayIndex + 1}`;
  }
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPeriodLabel(start: Date, end: Date, rangeType: RangeType): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (rangeType === 'mtd') {
    return `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (rangeType === 'ytd' || rangeType === '1year') {
    return `${start.getFullYear()}`;
  }
  // For other ranges, show start - end
  return `${monthNames[start.getMonth()]} ${start.getDate()} - ${monthNames[end.getMonth()]} ${end.getDate()}`;
}
