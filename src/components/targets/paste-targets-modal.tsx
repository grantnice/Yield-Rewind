'use client';

import { useState, useMemo, useCallback } from 'react';
import { X, ClipboardPaste, Check, AlertCircle, Calendar } from 'lucide-react';

type TabType = 'monthly' | 'yearly-bp';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_ALIASES: Record<string, number> = {
  'jan': 1, 'january': 1, '1': 1,
  'feb': 2, 'february': 2, '2': 2,
  'mar': 3, 'march': 3, '3': 3,
  'apr': 4, 'april': 4, '4': 4,
  'may': 5, '5': 5,
  'jun': 6, 'june': 6, '6': 6,
  'jul': 7, 'july': 7, '7': 7,
  'aug': 8, 'august': 8, '8': 8,
  'sep': 9, 'sept': 9, 'september': 9, '9': 9,
  'oct': 10, 'october': 10, '10': 10,
  'nov': 11, 'november': 11, '11': 11,
  'dec': 12, 'december': 12, '12': 12,
};

interface ParsedRow {
  bucketName: string;
  inputType: 'rate' | 'percent';
  p1: number | null;
  p2: number | null;
  p3: number | null;
  total: number | null;
  // Calculated complementary values
  p1Calc: number | null;
  p2Calc: number | null;
  p3Calc: number | null;
  totalCalc: number | null;
}

interface YearlyBPRow {
  bucketName: string;
  inputType: 'rate' | 'percent';
  months: (number | null)[]; // Index 0 = Jan, 11 = Dec
  monthsCalc: (number | null)[]; // Calculated complementary values
}

interface PasteTargetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  hasPeriods: boolean;
  periodCount: number;
  onSave: (data: {
    monthly: { bucket_name: string; monthly_plan_target: number | null; monthly_plan_rate: number | null }[];
    periods: { period: number; targets: { bucket_name: string; monthly_plan_target: number | null; monthly_plan_rate: number | null }[] }[];
    crudeRate: { monthly: number | null; periods: (number | null)[] };
  }) => Promise<void>;
}

// Known bucket name mappings (Excel name -> DB name)
const BUCKET_NAME_MAP: Record<string, string> = {
  'crude rate': 'Crude Rate',
  'crude': 'Crude Rate',
  'lpg': 'LPG',
  'cbob': 'CBOB',
  'ipbob': 'IPBOB',
  'pbob': 'PBOB',
  'jet': 'Jet',
  'ulsd': 'ULSD',
  'distillate': 'Distillate',
  'vgo': 'VGO',
  'vtb': 'VTB',
  'umo vgo': 'UMO VGO',
  'umovgo': 'UMO VGO',
  'base oil': 'Base Oil',
  'baseoil': 'Base Oil',
  'loss': 'Loss',
  'non-crude total': 'Non-Crude Total',
  'non crude total': 'Non-Crude Total',
  'noncrudetotal': 'Non-Crude Total',
};

function normalizeBucketName(name: string): string {
  const cleaned = name.toLowerCase().trim();
  return BUCKET_NAME_MAP[cleaned] || name.trim();
}

function parseNumber(value: string): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') return null;
  // Remove % sign and commas, handle parentheses for negatives
  let cleaned = value.replace(/[%,]/g, '').trim();
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function detectInputType(bucketName: string, firstValue: string): 'rate' | 'percent' {
  const lowerName = bucketName.toLowerCase();

  // Crude Rate is always a rate
  if (lowerName.includes('crude rate') || lowerName === 'crude') {
    return 'rate';
  }

  // UMO VGO is typically a rate
  if (lowerName.includes('umo vgo') || lowerName.includes('umovgo')) {
    return 'rate';
  }

  // If value contains % or is small (< 100), likely percent
  if (firstValue.includes('%')) {
    return 'percent';
  }

  const numValue = parseNumber(firstValue);
  if (numValue !== null && Math.abs(numValue) < 100) {
    return 'percent';
  }

  return 'rate';
}

export function PasteTargetsModal({
  open,
  onOpenChange,
  month,
  hasPeriods,
  periodCount,
  onSave,
}: PasteTargetsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('monthly');
  const [pasteText, setPasteText] = useState('');
  const [yearlyBpText, setYearlyBpText] = useState('');
  const [yearlyBpYear, setYearlyBpYear] = useState(new Date().getFullYear());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse the pasted text
  const parsedData = useMemo(() => {
    if (!pasteText.trim()) return { rows: [], crudeRates: { p1: null, p2: null, p3: null, total: null }, detectedColumns: [] as string[] };

    const lines = pasteText.trim().split('\n');
    const rows: ParsedRow[] = [];
    let crudeRates = { p1: null as number | null, p2: null as number | null, p3: null as number | null, total: null as number | null };

    // Detect column headers from the first row or data structure
    // The header row may look like: "  P1  P2  Total" (with empty first columns)
    // Or data rows look like: "Crude Rate  Rate  75000  75000  75000"
    let detectedColumns: string[] = [];
    let dataStartLine = 0;

    // Check first line for headers
    const firstLineParts = lines[0].split(/\t/).map(p => p.trim().toLowerCase());

    // Look for period headers (P1, P2, P3, Total, etc.) - just detect which ones exist
    const headerIndices: { name: string; idx: number }[] = [];
    firstLineParts.forEach((header, idx) => {
      if (header === 'p1' || header === 'period 1' || header === '1') {
        headerIndices.push({ name: 'P1', idx });
      } else if (header === 'p2' || header === 'period 2' || header === '2') {
        headerIndices.push({ name: 'P2', idx });
      } else if (header === 'p3' || header === 'period 3' || header === '3') {
        headerIndices.push({ name: 'P3', idx });
      } else if (header === 'total' || header === 'monthly' || header === 'month') {
        headerIndices.push({ name: 'Total', idx });
      }
    });

    // If we found headers, record which columns exist and skip the header row
    if (headerIndices.length > 0) {
      detectedColumns = headerIndices.map(h => h.name);
      dataStartLine = 1;
    }

    for (let lineIdx = dataStartLine; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Split by tab (Excel)
      const parts = line.split(/\t/).map(p => p.trim());
      if (parts.length < 2) continue;

      // First part is bucket name
      let bucketName = parts[0];

      // Check if second column is a type indicator (Rate, %, etc.)
      let typeColumn = '';
      let valueStartIdx = 1;
      const secondCol = parts[1]?.toLowerCase() || '';
      if (secondCol === 'rate' || secondCol === '%' || secondCol.includes('% of')) {
        typeColumn = parts[1];
        valueStartIdx = 2;
      }

      // Clean up bucket name - remove type indicators
      bucketName = bucketName
        .replace(/\s*rate\s*$/i, '')
        .replace(/\s*%\s*of\s*(crude|umo)?\s*$/i, '')
        .replace(/\s*%\s*$/i, '')
        .trim();

      const normalizedName = normalizeBucketName(bucketName);

      // Skip header-like rows
      if (normalizedName.toLowerCase() === 'bucket' ||
          normalizedName.toLowerCase() === 'product' ||
          normalizedName.toLowerCase() === 'p1' ||
          normalizedName.toLowerCase() === 'p2' ||
          normalizedName.toLowerCase() === 'p3') {
        continue;
      }

      // Get values - always use positional parsing from valueStartIdx
      // The header row told us WHICH columns exist, but data rows are always positional
      const values = parts.slice(valueStartIdx).map(parseNumber);

      let p1Val: number | null = null;
      let p2Val: number | null = null;
      let p3Val: number | null = null;
      let totalVal: number | null = null;

      if (detectedColumns.length > 0) {
        // Map values to detected columns in order
        // e.g., if detectedColumns = ['P1', 'P2', 'Total'], then values[0]=P1, values[1]=P2, values[2]=Total
        detectedColumns.forEach((col, idx) => {
          const val = values[idx] ?? null;
          if (col === 'P1') p1Val = val;
          else if (col === 'P2') p2Val = val;
          else if (col === 'P3') p3Val = val;
          else if (col === 'Total') totalVal = val;
        });
      } else {
        // No header detected - infer columns from number of values
        const numValues = values.length;

        if (numValues === 4) {
          // P1, P2, P3, Total
          [p1Val, p2Val, p3Val, totalVal] = values;
          detectedColumns = ['P1', 'P2', 'P3', 'Total'];
        } else if (numValues === 3) {
          // Assume P1, P2, Total
          [p1Val, p2Val, totalVal] = values;
          detectedColumns = ['P1', 'P2', 'Total'];
        } else if (numValues === 2) {
          // P1, P2 only
          [p1Val, p2Val] = values;
          detectedColumns = ['P1', 'P2'];
        } else if (numValues === 1) {
          // Total only
          totalVal = values[0];
          detectedColumns = ['Total'];
        }
      }

      // Determine input type
      const inputType = typeColumn.toLowerCase().includes('rate')
        ? 'rate'
        : detectInputType(bucketName, parts[valueStartIdx] || '');

      const row: ParsedRow = {
        bucketName: normalizedName,
        inputType,
        p1: p1Val,
        p2: p2Val,
        p3: p3Val,
        total: totalVal,
        p1Calc: null,
        p2Calc: null,
        p3Calc: null,
        totalCalc: null,
      };

      // Store crude rate for calculations
      if (normalizedName === 'Crude Rate') {
        crudeRates = {
          p1: row.p1,
          p2: row.p2,
          p3: row.p3,
          total: row.total,
        };
      }

      rows.push(row);
    }

    // Get UMO VGO rates for Base Oil calculation
    const umoVgoRow = rows.find(r => r.bucketName === 'UMO VGO');
    const umoVgoRates = {
      p1: umoVgoRow?.p1 ?? null,
      p2: umoVgoRow?.p2 ?? null,
      p3: umoVgoRow?.p3 ?? null,
      total: umoVgoRow?.total ?? null,
    };

    // Calculate complementary values
    for (const row of rows) {
      // Skip feedstocks - they don't need % calculated
      if (row.bucketName === 'Crude Rate' || row.bucketName === 'UMO VGO') continue;

      // Base Oil is % of UMO VGO, not Crude
      const isBaseOil = row.bucketName === 'Base Oil';
      const baseRates = isBaseOil ? umoVgoRates : crudeRates;

      if (row.inputType === 'percent') {
        // Calculate rate from percent
        row.p1Calc = row.p1 !== null && baseRates.p1 ? (row.p1 / 100) * baseRates.p1 : null;
        row.p2Calc = row.p2 !== null && baseRates.p2 ? (row.p2 / 100) * baseRates.p2 : null;
        row.p3Calc = row.p3 !== null && baseRates.p3 ? (row.p3 / 100) * baseRates.p3 : null;
        row.totalCalc = row.total !== null && baseRates.total ? (row.total / 100) * baseRates.total : null;
      } else {
        // Calculate percent from rate
        row.p1Calc = row.p1 !== null && baseRates.p1 ? (row.p1 / baseRates.p1) * 100 : null;
        row.p2Calc = row.p2 !== null && baseRates.p2 ? (row.p2 / baseRates.p2) * 100 : null;
        row.p3Calc = row.p3 !== null && baseRates.p3 ? (row.p3 / baseRates.p3) * 100 : null;
        row.totalCalc = row.total !== null && baseRates.total ? (row.total / baseRates.total) * 100 : null;
      }
    }

    return { rows, crudeRates, detectedColumns };
  }, [pasteText]);

  // Parse yearly BP data
  const yearlyBpData = useMemo(() => {
    if (!yearlyBpText.trim()) return { rows: [] as YearlyBPRow[], crudeRates: Array(12).fill(null) as (number | null)[], detectedMonths: [] as number[] };

    const lines = yearlyBpText.trim().split('\n');
    const rows: YearlyBPRow[] = [];
    const crudeRates: (number | null)[] = Array(12).fill(null);
    let detectedMonths: number[] = [];
    let monthColumnIndices: { month: number; idx: number }[] = [];
    let dataStartLine = 0;

    // Parse header row to find month columns
    const firstLineParts = lines[0].split(/\t/).map(p => p.trim().toLowerCase());

    firstLineParts.forEach((header, idx) => {
      const monthNum = MONTH_ALIASES[header];
      if (monthNum) {
        monthColumnIndices.push({ month: monthNum, idx });
      }
    });

    if (monthColumnIndices.length > 0) {
      detectedMonths = monthColumnIndices.map(m => m.month).sort((a, b) => a - b);
      dataStartLine = 1;
    } else {
      // No header - assume all 12 months starting from column 1
      for (let i = 1; i <= 12; i++) {
        monthColumnIndices.push({ month: i, idx: i });
        detectedMonths.push(i);
      }
    }

    for (let lineIdx = dataStartLine; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const parts = line.split(/\t/).map(p => p.trim());
      if (parts.length < 2) continue;

      let bucketName = parts[0];

      // Check if second column is a type indicator
      let typeColumn = '';
      let valueStartIdx = 1;
      const secondCol = parts[1]?.toLowerCase() || '';
      if (secondCol === 'rate' || secondCol === '%' || secondCol.includes('% of')) {
        typeColumn = parts[1];
        valueStartIdx = 2;
        // Adjust month column indices
        monthColumnIndices = monthColumnIndices.map(m => ({ ...m, idx: m.idx + 1 }));
      }

      // Clean up bucket name
      bucketName = bucketName
        .replace(/\s*rate\s*$/i, '')
        .replace(/\s*%\s*of\s*(crude|umo)?\s*$/i, '')
        .replace(/\s*%\s*$/i, '')
        .trim();

      const normalizedName = normalizeBucketName(bucketName);

      // Skip header-like rows
      if (normalizedName.toLowerCase() === 'bucket' || normalizedName.toLowerCase() === 'product') {
        continue;
      }

      // Extract month values
      const monthValues: (number | null)[] = Array(12).fill(null);

      if (dataStartLine === 1) {
        // Use detected month column indices
        for (const { month, idx } of monthColumnIndices) {
          if (idx < parts.length) {
            monthValues[month - 1] = parseNumber(parts[idx]);
          }
        }
      } else {
        // No header - assume positional after bucket name
        for (let i = 0; i < 12 && (valueStartIdx + i) < parts.length; i++) {
          monthValues[i] = parseNumber(parts[valueStartIdx + i]);
        }
      }

      // Determine input type
      const firstValueIdx = monthColumnIndices[0]?.idx || valueStartIdx;
      const inputType = typeColumn.toLowerCase().includes('rate')
        ? 'rate'
        : detectInputType(bucketName, parts[firstValueIdx] || '');

      const row: YearlyBPRow = {
        bucketName: normalizedName,
        inputType,
        months: monthValues,
        monthsCalc: Array(12).fill(null),
      };

      // Store crude rate for calculations
      if (normalizedName === 'Crude Rate') {
        for (let i = 0; i < 12; i++) {
          crudeRates[i] = monthValues[i];
        }
      }

      rows.push(row);
    }

    // Get UMO VGO rates for Base Oil calculation
    const umoVgoRow = rows.find(r => r.bucketName === 'UMO VGO');
    const umoVgoRates: (number | null)[] = umoVgoRow?.months || Array(12).fill(null);

    // Calculate complementary values
    for (const row of rows) {
      if (row.bucketName === 'Crude Rate' || row.bucketName === 'UMO VGO') continue;

      const isBaseOil = row.bucketName === 'Base Oil';
      const baseRates = isBaseOil ? umoVgoRates : crudeRates;

      for (let i = 0; i < 12; i++) {
        const val = row.months[i];
        const base = baseRates[i];

        if (val !== null && base !== null && base !== 0) {
          if (row.inputType === 'percent') {
            row.monthsCalc[i] = (val / 100) * base;
          } else {
            row.monthsCalc[i] = (val / base) * 100;
          }
        }
      }
    }

    return { rows, crudeRates, detectedMonths };
  }, [yearlyBpText]);

  // Save yearly BP targets
  const handleSaveYearlyBp = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    try {
      const { rows, detectedMonths } = yearlyBpData;

      if (rows.length === 0) {
        throw new Error('No data to save');
      }

      // Build the request
      const months = detectedMonths.map(monthNum => {
        const monthStr = `${yearlyBpYear}-${String(monthNum).padStart(2, '0')}`;
        const targets = rows.map(row => {
          const val = row.months[monthNum - 1];
          const calcVal = row.monthsCalc[monthNum - 1];

          return {
            bucket_name: row.bucketName,
            business_plan_target: row.inputType === 'percent' ? val : calcVal,
            business_plan_rate: row.inputType === 'rate' ? val : calcVal,
          };
        });

        return { month: monthStr, targets };
      });

      const res = await fetch('/api/targets/yearly-bp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yearlyBpYear, months }),
      });

      if (!res.ok) {
        throw new Error('Failed to save BP targets');
      }

      onOpenChange(false);
      setYearlyBpText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save targets');
    } finally {
      setIsSaving(false);
    }
  }, [yearlyBpData, yearlyBpYear, onOpenChange]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    try {
      const { rows, crudeRates, detectedColumns } = parsedData;

      // Check which periods were detected
      const hasP1 = detectedColumns.includes('P1');
      const hasP2 = detectedColumns.includes('P2');
      const hasP3 = detectedColumns.includes('P3');
      const hasTotal = detectedColumns.includes('Total');

      // Build monthly targets (from "total" column if present, or calculate from periods)
      const monthly = rows
        .filter(r => r.bucketName !== 'Crude Rate')
        .map(r => ({
          bucket_name: r.bucketName,
          monthly_plan_target: r.inputType === 'percent' ? r.total : r.totalCalc,
          monthly_plan_rate: r.inputType === 'rate' ? r.total : r.totalCalc,
        }));

      // Add crude rate to monthly
      const crudeRow = rows.find(r => r.bucketName === 'Crude Rate');
      if (crudeRow && hasTotal) {
        monthly.unshift({
          bucket_name: 'Crude Rate',
          monthly_plan_target: null,
          monthly_plan_rate: crudeRow.total,
        });
      }

      // Build period targets (only for detected periods)
      const periods: { period: number; targets: { bucket_name: string; monthly_plan_target: number | null; monthly_plan_rate: number | null }[] }[] = [];

      if (hasPeriods) {
        const periodMap = [
          { num: 1, has: hasP1, key: 'p1' as const, calcKey: 'p1Calc' as const },
          { num: 2, has: hasP2, key: 'p2' as const, calcKey: 'p2Calc' as const },
          { num: 3, has: hasP3, key: 'p3' as const, calcKey: 'p3Calc' as const },
        ];

        for (const { num, has, key, calcKey } of periodMap) {
          if (!has || num > periodCount) continue;

          const targets = rows
            .filter(r => r.bucketName !== 'Crude Rate')
            .map(r => ({
              bucket_name: r.bucketName,
              monthly_plan_target: r.inputType === 'percent' ? r[key] : r[calcKey],
              monthly_plan_rate: r.inputType === 'rate' ? r[key] : r[calcKey],
            }));

          // Add crude rate for period
          if (crudeRow) {
            targets.unshift({
              bucket_name: 'Crude Rate',
              monthly_plan_target: null,
              monthly_plan_rate: crudeRow[key],
            });
          }

          periods.push({ period: num, targets });
        }
      }

      await onSave({
        monthly: hasTotal ? monthly : [],
        periods,
        crudeRate: {
          monthly: crudeRates.total,
          periods: [crudeRates.p1, crudeRates.p2, crudeRates.p3],
        },
      });

      onOpenChange(false);
      setPasteText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save targets');
    } finally {
      setIsSaving(false);
    }
  }, [parsedData, hasPeriods, periodCount, onSave, onOpenChange]);

  const formatValue = (value: number | null, isPercent: boolean) => {
    if (value === null) return '-';
    if (isPercent) return `${value.toFixed(2)}%`;
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              {activeTab === 'monthly' ? (
                <ClipboardPaste className="h-5 w-5 text-white" />
              ) : (
                <Calendar className="h-5 w-5 text-white" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {activeTab === 'monthly' ? 'Paste Targets from Excel' : 'Yearly Business Plan Targets'}
              </h2>
              <p className="text-sm text-gray-500">
                {activeTab === 'monthly'
                  ? `${month} • Paste tab-separated data below`
                  : `Set BP targets for all months of ${yearlyBpYear}`}
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6">
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'monthly'
                ? 'border-violet-500 text-violet-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Monthly Plan
          </button>
          <button
            onClick={() => setActiveTab('yearly-bp')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'yearly-bp'
                ? 'border-violet-500 text-violet-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Yearly BP
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {activeTab === 'monthly' ? (
            <>
            {/* Monthly Plan Paste Area */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Paste Excel Data
                <span className="font-normal text-gray-500 ml-2">
                  (Copy from Excel, including headers P1, P2, P3, Total)
                </span>
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Crude Rate&#9;75,000&#9;75,000&#9;75,000&#9;75,000&#10;LPG %&#9;2.9%&#9;2.4%&#9;3.6%&#9;2.7%&#10;Jet %&#9;18.1%&#9;20.1%&#9;19.5%&#9;18.9%&#10;..."
                className="w-full h-40 px-4 py-3 text-sm font-mono border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-none"
              />
            </div>

          {/* Preview Table */}
          {parsedData.rows.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Preview
                <span className="font-normal text-gray-500 ml-2">
                  ({parsedData.rows.length} rows parsed • Columns: {parsedData.detectedColumns.join(', ') || 'auto-detected'})
                </span>
              </h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-semibold text-gray-600">Bucket</th>
                        <th className="text-center py-3 px-2 font-semibold text-gray-600">Input</th>
                        {parsedData.detectedColumns.includes('P1') && (
                          <th className="text-right py-3 px-3 font-semibold text-gray-600" colSpan={2}>P1</th>
                        )}
                        {parsedData.detectedColumns.includes('P2') && (
                          <th className="text-right py-3 px-3 font-semibold text-gray-600" colSpan={2}>P2</th>
                        )}
                        {parsedData.detectedColumns.includes('P3') && (
                          <th className="text-right py-3 px-3 font-semibold text-gray-600" colSpan={2}>P3</th>
                        )}
                        {parsedData.detectedColumns.includes('Total') && (
                          <th className="text-right py-3 px-3 font-semibold text-gray-600" colSpan={2}>Total</th>
                        )}
                      </tr>
                      <tr className="bg-gray-50/50 border-b border-gray-100 text-xs">
                        <th></th>
                        <th></th>
                        {parsedData.detectedColumns.includes('P1') && (
                          <>
                            <th className="text-right py-1 px-2 text-gray-400">Rate</th>
                            <th className="text-right py-1 px-2 text-gray-400">%</th>
                          </>
                        )}
                        {parsedData.detectedColumns.includes('P2') && (
                          <>
                            <th className="text-right py-1 px-2 text-gray-400">Rate</th>
                            <th className="text-right py-1 px-2 text-gray-400">%</th>
                          </>
                        )}
                        {parsedData.detectedColumns.includes('P3') && (
                          <>
                            <th className="text-right py-1 px-2 text-gray-400">Rate</th>
                            <th className="text-right py-1 px-2 text-gray-400">%</th>
                          </>
                        )}
                        {parsedData.detectedColumns.includes('Total') && (
                          <>
                            <th className="text-right py-1 px-2 text-gray-400">Rate</th>
                            <th className="text-right py-1 px-2 text-gray-400">%</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {parsedData.rows.map((row, idx) => {
                        const isFeedstock = row.bucketName === 'Crude Rate' || row.bucketName === 'UMO VGO';
                        const isRate = row.inputType === 'rate';

                        return (
                          <tr key={idx} className={isFeedstock ? 'bg-amber-50' : ''}>
                            <td className="py-2 px-4 font-medium text-gray-900">{row.bucketName}</td>
                            <td className="py-2 px-2 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                isRate ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                              }`}>
                                {isRate ? 'Rate' : '%'}
                              </span>
                            </td>
                            {parsedData.detectedColumns.includes('P1') && (
                              <>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${isRate ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? formatValue(row.p1, false) : formatValue(isRate ? row.p1 : row.p1Calc, false)}
                                </td>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${!isRate || isFeedstock ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? '-' : formatValue(isRate ? row.p1Calc : row.p1, true)}
                                </td>
                              </>
                            )}
                            {parsedData.detectedColumns.includes('P2') && (
                              <>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${isRate ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? formatValue(row.p2, false) : formatValue(isRate ? row.p2 : row.p2Calc, false)}
                                </td>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${!isRate || isFeedstock ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? '-' : formatValue(isRate ? row.p2Calc : row.p2, true)}
                                </td>
                              </>
                            )}
                            {parsedData.detectedColumns.includes('P3') && (
                              <>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${isRate ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? formatValue(row.p3, false) : formatValue(isRate ? row.p3 : row.p3Calc, false)}
                                </td>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${!isRate || isFeedstock ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? '-' : formatValue(isRate ? row.p3Calc : row.p3, true)}
                                </td>
                              </>
                            )}
                            {parsedData.detectedColumns.includes('Total') && (
                              <>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${isRate ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? formatValue(row.total, false) : formatValue(isRate ? row.total : row.totalCalc, false)}
                                </td>
                                <td className={`py-2 px-2 text-right font-mono text-xs ${!isRate || isFeedstock ? 'font-semibold' : 'text-gray-400'}`}>
                                  {isFeedstock ? '-' : formatValue(isRate ? row.totalCalc : row.total, true)}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-semibold">Bold</span> = input value, <span className="text-gray-400">gray</span> = auto-calculated
              </p>
            </div>
          )}

          </>
          ) : (
            <>
            {/* Yearly BP Tab Content */}
            <div className="flex items-center gap-4 mb-4">
              <label className="text-sm font-medium text-gray-700">Year:</label>
              <select
                value={yearlyBpYear}
                onChange={(e) => setYearlyBpYear(parseInt(e.target.value))}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              >
                {[2024, 2025, 2026, 2027, 2028].map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Paste Excel Data
                <span className="font-normal text-gray-500 ml-2">
                  (Columns: Bucket, Jan, Feb, Mar, ... Dec)
                </span>
              </label>
              <textarea
                value={yearlyBpText}
                onChange={(e) => setYearlyBpText(e.target.value)}
                placeholder="Bucket&#9;Jan&#9;Feb&#9;Mar&#9;Apr&#9;May&#9;Jun&#9;Jul&#9;Aug&#9;Sep&#9;Oct&#9;Nov&#9;Dec&#10;Crude Rate&#9;75000&#9;74000&#9;76000&#9;...&#10;LPG %&#9;2.9%&#9;2.8%&#9;2.7%&#9;..."
                className="w-full h-40 px-4 py-3 text-sm font-mono border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-none"
              />
            </div>

            {/* Yearly BP Preview Table */}
            {yearlyBpData.rows.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Preview
                  <span className="font-normal text-gray-500 ml-2">
                    ({yearlyBpData.rows.length} rows • Months: {yearlyBpData.detectedMonths.map(m => MONTH_NAMES[m-1]).join(', ')})
                  </span>
                </h3>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left py-3 px-4 font-semibold text-gray-600 sticky left-0 bg-gray-50">Bucket</th>
                          <th className="text-center py-3 px-2 font-semibold text-gray-600">Type</th>
                          {yearlyBpData.detectedMonths.map(m => (
                            <th key={m} className="text-right py-3 px-3 font-semibold text-gray-600">
                              {MONTH_NAMES[m-1]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {yearlyBpData.rows.map((row, idx) => {
                          const isFeedstock = row.bucketName === 'Crude Rate' || row.bucketName === 'UMO VGO';
                          const isRate = row.inputType === 'rate';

                          return (
                            <tr key={idx} className={isFeedstock ? 'bg-amber-50' : ''}>
                              <td className="py-2 px-4 font-medium text-gray-900 sticky left-0 bg-inherit">{row.bucketName}</td>
                              <td className="py-2 px-2 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  isRate ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                }`}>
                                  {isRate ? 'Rate' : '%'}
                                </span>
                              </td>
                              {yearlyBpData.detectedMonths.map(m => (
                                <td key={m} className="py-2 px-3 text-right font-mono text-xs">
                                  {isFeedstock
                                    ? formatValue(row.months[m-1], false)
                                    : formatValue(isRate ? row.months[m-1] : row.monthsCalc[m-1], false)}
                                  {!isFeedstock && (
                                    <span className="text-gray-400 ml-1">
                                      ({formatValue(isRate ? row.monthsCalc[m-1] : row.months[m-1], !isRate)})
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Primary value shown first, calculated value in parentheses
                </p>
              </div>
            )}
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-500">
            {activeTab === 'monthly' ? (
              parsedData.detectedColumns.length > 0
                ? `Will save: ${parsedData.detectedColumns.join(', ')}`
                : hasPeriods
                  ? `Will save targets for ${periodCount} periods and monthly totals`
                  : 'Will save monthly plan targets'
            ) : (
              yearlyBpData.detectedMonths.length > 0
                ? `Will save BP targets for ${yearlyBpData.detectedMonths.length} months of ${yearlyBpYear}`
                : 'Paste data to preview BP targets'
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={activeTab === 'monthly' ? handleSave : handleSaveYearlyBp}
              disabled={activeTab === 'monthly' ? (parsedData.rows.length === 0 || isSaving) : (yearlyBpData.rows.length === 0 || isSaving)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-violet-500 to-purple-600 rounded-lg hover:from-violet-600 hover:to-purple-700 transition-all shadow-lg shadow-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {activeTab === 'monthly' ? 'Save All Targets' : `Save ${yearlyBpYear} BP Targets`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
