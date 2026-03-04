'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart, YAxisBounds } from '@/components/charts/time-series-chart';
import { TagSearchDialog } from '@/components/historian/tag-search-dialog';
import { getDaysAgo, getYesterday, getMonthStart } from '@/lib/utils';
import { X, Plus, Settings2, Loader2, Activity, RefreshCw, Zap, Clock, Database, Trash2, Download, AlertTriangle } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface PITagConfig {
  id: number;
  tag_name: string;
  web_id: string;
  display_name: string | null;
  tag_group: string;
  retrieval_mode: 'recorded' | 'interpolated' | 'summary';
  interval: string;
  summary_type: string;
  unit: string | null;
  y_axis: 'left' | 'right' | 'auto';
  color: string | null;
  display_order: number;
  is_active: number;
  decimals: number | null;
}

interface PIDataTag {
  name: string;
  web_id: string;
  items: { timestamp: string; value: number; good: boolean }[];
}

interface BucketConfig {
  id: number;
  bucket_type: string;
  bucket_name: string;
  component_products: string[];
  is_virtual: boolean;
  display_order: number;
}

// ─── Constants ──────────────────────────────────────────────

const dateRanges = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'MTD', type: 'mtd' as const },
  { label: 'YTD', type: 'ytd' as const },
  { label: '1yr', days: 365 },
  { label: 'Custom', type: 'custom' as const },
];

const rollingAverageOptions = [
  { key: 'raw', label: 'Raw', days: 0 },
  { key: 'ra7', label: '7d', days: 7 },
  { key: 'ra14', label: '14d', days: 14 },
  { key: 'ra30', label: '30d', days: 30 },
];

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

// Test tags for quick-start seeding
const SEED_TAGS = [
  'LAB_T801URG_RVP',
  'LAB_T802URG_RVP',
  'LAB_T801URG_E10RM2',
  'LAB_T802URG_E10RM2',
];

const FETCH_COOLDOWN_MS = 5000; // Match server-side rate limit

// Data size warning thresholds
const WARN_POINT_THRESHOLD = 50_000; // Show warning above this many estimated points

/** Parse an interval string like "1d", "4h", "1h" into hours. */
function parseIntervalHours(interval: string): number {
  const match = interval.match(/^(\d+)(h|d|w)$/);
  if (!match) return 24; // default 1d
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  if (unit === 'h') return n;
  if (unit === 'd') return n * 24;
  if (unit === 'w') return n * 168;
  return 24;
}

/** Estimate total data points for a fetch. */
function estimateFetchSize(
  tags: { retrieval_mode: string; interval: string }[],
  startDate: string,
  endDate: string,
): { total: number; recordedTags: number; recordedDays: number } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

  let total = 0;
  let recordedTags = 0;

  tags.forEach(tag => {
    if (tag.retrieval_mode === 'recorded') {
      // Recorded: PI sends ALL raw values. Assume ~6/min (10s scan) as worst case.
      // pi_query.py aggregates to daily, but the server still transmits everything.
      total += days * 8640; // 6/min * 60 * 24
      recordedTags++;
    } else {
      // Summary/Interpolated: server returns exactly (days / interval) points
      const intervalHours = parseIntervalHours(tag.interval);
      total += Math.ceil(days * 24 / intervalHours);
    }
  });

  return { total, recordedTags, recordedDays: days };
}

// ─── Rolling average helper ─────────────────────────────────

function computeRollingAverage(values: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) {
      sum += values[i]!;
      count++;
    }
    if (i >= window) {
      if (values[i - window] !== null) {
        sum -= values[i - window]!;
        count--;
      }
    }
    if (i >= window - 1 && count > 0) {
      result[i] = sum / count;
    }
  }
  return result;
}

function formatTimeSince(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// ─── Component ──────────────────────────────────────────────

export default function HistorianPage() {
  const queryClient = useQueryClient();

  // ─── Date range state ─────────────────────────────────────
  const [selectedRange, setSelectedRange] = useState(dateRanges[2]); // 90d default
  const [customStartDate, setCustomStartDate] = useState(() => getDaysAgo(90));
  const [customEndDate, setCustomEndDate] = useState(() => getYesterday());

  // ─── Tag/chart state ──────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [selectedRollingAvgs, setSelectedRollingAvgs] = useState<string[]>(['raw']);
  const [yAxisBounds, setYAxisBounds] = useState<YAxisBounds>({ min: null, max: null });

  // ─── Yield overlay state ──────────────────────────────────
  const [overlayYield, setOverlayYield] = useState(false);
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [yieldMetric, setYieldMetric] = useState('yield_qty');

  // ─── Manual PI fetch state ────────────────────────────────
  // PI data is fetched ONLY when user clicks "Fetch Data".
  // Cache-first: checks SQLite cache, then queries PI only for missing dates.
  const [piManualData, setPiManualData] = useState<Record<string, PIDataTag>>({});
  const [piFetching, setPiFetching] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number>(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSource, setFetchSource] = useState<'cache' | 'pi' | 'mixed' | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [fetchWarning, setFetchWarning] = useState<{ message: string; estimate: number } | null>(null);

  // ─── Compute display date range ───────────────────────────
  const dateRange = useMemo(() => {
    if (selectedRange.type === 'custom') {
      return { start: customStartDate, end: customEndDate };
    }
    if (selectedRange.type === 'mtd') {
      return { start: getMonthStart(), end: getYesterday() };
    }
    if (selectedRange.type === 'ytd') {
      const year = new Date().getFullYear();
      return { start: `${year}-01-01`, end: getYesterday() };
    }
    return {
      start: getDaysAgo((selectedRange as { days: number }).days || 90),
      end: getYesterday(),
    };
  }, [selectedRange, customStartDate, customEndDate]);

  // ─── Fetch saved tag configs (local DB — auto-fetch OK) ───
  const { data: tagsData, isLoading: tagsLoading } = useQuery({
    queryKey: ['pi-tags'],
    queryFn: async () => {
      const res = await fetch('/api/pi/tags');
      if (!res.ok) throw new Error('Failed to fetch PI tag configs');
      return res.json();
    },
  });

  const tags: PITagConfig[] = tagsData?.tags || [];
  const existingTagNames = tags.map(t => t.tag_name);

  // ─── PI data — derived from manual fetch state ───────────
  const piData: Record<string, PIDataTag> = piManualData;
  const hasPiData = Object.keys(piData).length > 0;

  // Cooldown check — auto re-enables button after cooldown expires
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  useEffect(() => {
    if (lastFetchTime === 0) return;
    setIsCoolingDown(true);
    const remaining = FETCH_COOLDOWN_MS - (Date.now() - lastFetchTime);
    if (remaining <= 0) { setIsCoolingDown(false); return; }
    const timer = setTimeout(() => setIsCoolingDown(false), remaining);
    return () => clearTimeout(timer);
  }, [lastFetchTime]);

  // ─── Fetch buckets for overlay (local DB — auto-fetch OK) ─
  const { data: bucketsData } = useQuery({
    queryKey: ['buckets', 'yield'],
    queryFn: async () => {
      const res = await fetch('/api/buckets?type=yield');
      if (!res.ok) throw new Error('Failed to fetch buckets');
      return res.json();
    },
    enabled: overlayYield,
  });

  const buckets: BucketConfig[] = bucketsData?.buckets || [];

  // ─── Fetch yield overlay data (local DB — auto-fetch OK) ──
  const { data: yieldData, isLoading: yieldLoading } = useQuery({
    queryKey: ['yield-overlay', dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(`/api/yield?start_date=${dateRange.start}&end_date=${dateRange.end}`);
      if (!res.ok) throw new Error('Failed to fetch yield data');
      return res.json();
    },
    enabled: overlayYield && selectedBuckets.length > 0,
  });

  // ─── Merge all data into chart format ─────────────────────
  const { chartData, seriesKeys, seriesLabels, secondaryAxisKeys, autoFitKeys, seriesDecimals } = useMemo(() => {
    const dateSet = new Set<string>();
    const seriesMap: Record<string, Record<string, number | null>> = {};

    // Track which series use daily vs sub-daily timestamps
    const dailySeries = new Set<string>();
    const dailyValues: Record<string, Record<string, number>> = {}; // seriesKey → { YYYY-MM-DD → value }
    let hasSubDaily = false;

    // 1. PI tag series
    tags.forEach(tag => {
      const stream = piData[tag.web_id];
      if (!stream) return;
      const seriesKey = `pi_${tag.tag_name}`;
      const isSubDaily = stream.items.some(item => item.timestamp.length > 10);

      if (isSubDaily) {
        hasSubDaily = true;
      } else {
        dailySeries.add(seriesKey);
        dailyValues[seriesKey] = {};
      }

      stream.items.forEach(item => {
        dateSet.add(item.timestamp);
        if (!seriesMap[item.timestamp]) seriesMap[item.timestamp] = {};
        seriesMap[item.timestamp][seriesKey] = item.value;
        if (!isSubDaily) {
          dailyValues[seriesKey][item.timestamp] = item.value;
        }
      });
    });

    // 2. Yield overlay series
    const bucketProductMap: Record<string, string[]> = {};
    buckets.forEach(b => { bucketProductMap[b.bucket_name] = b.component_products; });

    if (overlayYield && yieldData?.data && selectedBuckets.length > 0) {
      const yieldByDate: Record<string, Record<string, number>> = {};
      (yieldData.data as any[]).forEach((row: any) => {
        if (!yieldByDate[row.date]) yieldByDate[row.date] = {};
        yieldByDate[row.date][row.product_name] = row[yieldMetric] || 0;
      });

      Object.entries(yieldByDate).forEach(([date, products]) => {
        dateSet.add(date);
        if (!seriesMap[date]) seriesMap[date] = {};

        selectedBuckets.forEach(bucketName => {
          const components = bucketProductMap[bucketName];
          const seriesKey = `yield_${bucketName}`;
          dailySeries.add(seriesKey);
          if (!dailyValues[seriesKey]) dailyValues[seriesKey] = {};
          if (components) {
            const val = components.reduce((sum, prod) => sum + (products[prod] || 0), 0);
            seriesMap[date][seriesKey] = val;
            dailyValues[seriesKey][date] = val;
          } else {
            const val = products[bucketName] || 0;
            seriesMap[date][seriesKey] = val;
            dailyValues[seriesKey][date] = val;
          }
        });
      });
    }

    const sortedDates = Array.from(dateSet).sort();

    // 3. When mixing sub-daily and daily data, forward-fill daily values into sub-daily slots
    if (hasSubDaily && dailySeries.size > 0) {
      sortedDates.forEach(ts => {
        if (ts.length <= 10) return; // skip pure daily entries
        const dateOnly = ts.substring(0, 10);
        if (!seriesMap[ts]) seriesMap[ts] = {};
        dailySeries.forEach(seriesKey => {
          if (seriesMap[ts][seriesKey] == null) {
            const dailyVal = dailyValues[seriesKey]?.[dateOnly];
            if (dailyVal != null) {
              seriesMap[ts][seriesKey] = dailyVal;
            }
          }
        });
      });
    }

    const keys: string[] = [];
    const labels: Record<string, string> = {};
    const secondary: string[] = [];
    const autoFit: string[] = [];
    const decimalsMap: Record<string, number> = {};

    tags.forEach(tag => {
      const key = `pi_${tag.tag_name}`;
      keys.push(key);
      const unit = tag.unit ? ` (${tag.unit})` : '';
      labels[key] = (tag.display_name || tag.tag_name) + unit;
      if (tag.y_axis === 'right') secondary.push(key);
      else if (tag.y_axis === 'auto') autoFit.push(key);
      if (tag.decimals != null) decimalsMap[key] = tag.decimals;
    });

    if (overlayYield && selectedBuckets.length > 0) {
      selectedBuckets.forEach(b => {
        const key = `yield_${b}`;
        keys.push(key);
        labels[key] = `${b} (Yield)`;
        secondary.push(key);
      });
    }

    const rawData = sortedDates.map(date => {
      const row: Record<string, string | number | null> = { date };
      keys.forEach(key => {
        row[key] = seriesMap[date]?.[key] ?? null;
      });
      return row;
    });

    // Compute rolling averages
    const allKeys = [...keys];
    const extraRAs = selectedRollingAvgs.filter(ra => ra !== 'raw');

    if (extraRAs.length > 0) {
      keys.forEach(baseKey => {
        const baseValues = rawData.map(r => {
          const v = r[baseKey];
          return typeof v === 'number' ? v : null;
        });

        extraRAs.forEach(raKey => {
          const opt = rollingAverageOptions.find(o => o.key === raKey);
          if (!opt || opt.days <= 0) return;

          const avgKey = `${baseKey}_${raKey}`;
          allKeys.push(avgKey);
          labels[avgKey] = `${labels[baseKey]} ${opt.label} Avg`;
          if (secondary.includes(baseKey)) secondary.push(avgKey);
          if (autoFit.includes(baseKey)) autoFit.push(avgKey);
          if (baseKey in decimalsMap) decimalsMap[avgKey] = decimalsMap[baseKey];

          const avgs = computeRollingAverage(baseValues, opt.days);
          rawData.forEach((row, i) => {
            row[avgKey] = avgs[i];
          });
        });
      });
    }

    const finalKeys = selectedRollingAvgs.includes('raw')
      ? allKeys
      : allKeys.filter(k => !keys.includes(k));

    return {
      chartData: rawData,
      seriesKeys: finalKeys,
      seriesLabels: labels,
      secondaryAxisKeys: secondary.filter(k => finalKeys.includes(k)),
      autoFitKeys: autoFit.filter(k => finalKeys.includes(k)),
      seriesDecimals: decimalsMap,
    };
  }, [tags, piData, overlayYield, yieldData, selectedBuckets, yieldMetric, buckets, selectedRollingAvgs]);

  // ─── Handlers ─────────────────────────────────────────────

  const handleFetchData = useCallback(async () => {
    if (tags.length === 0 || piFetching) return;
    setFetchError(null);
    setFetchSource(null);
    setFetchWarning(null);
    setLastFetchTime(Date.now());
    setPiFetching(true);

    try {
      const results: Record<string, PIDataTag> = {};
      let usedCache = false;
      let usedPi = false;

      // Group tags by retrieval mode
      const groups: Record<string, PITagConfig[]> = {};
      tags.forEach(tag => {
        const key = `${tag.retrieval_mode}|${tag.interval}|${tag.summary_type}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(tag);
      });

      const groupEntries = Object.entries(groups);

      for (const [key, groupTags] of groupEntries) {
        const [mode, interval, summaryType] = key.split('|');
        const intervalIsSubDaily = interval.endsWith('h') && parseInt(interval) < 24;

        // Step 1: Check cache for existing data (daily intervals only — sub-daily bypasses cache)
        if (!intervalIsSubDaily) {
          const tagNames = groupTags.map(t => t.tag_name);
          const cacheParams = new URLSearchParams({
            tag_names: tagNames.join(','),
            start_date: dateRange.start,
            end_date: dateRange.end,
            mode,
          });
          const cacheRes = await fetch(`/api/pi/cache?${cacheParams}`);
          const cacheData = cacheRes.ok ? await cacheRes.json() : { cached: [], allCached: false, missingDates: null };

          // Build results from cache
          const cachedByTag: Record<string, { timestamp: string; value: number; good: boolean }[]> = {};
          (cacheData.cached || []).forEach((row: { tag_name: string; date: string; value: number; good: number }) => {
            if (!cachedByTag[row.tag_name]) cachedByTag[row.tag_name] = [];
            cachedByTag[row.tag_name].push({ timestamp: row.date, value: row.value, good: !!row.good });
          });

          // Always store cached data in results first (PI data will overwrite if fetched)
          if (Object.keys(cachedByTag).length > 0) {
            usedCache = true;
            groupTags.forEach(tag => {
              results[tag.web_id] = {
                name: tag.tag_name,
                web_id: tag.web_id,
                items: cachedByTag[tag.tag_name] || [],
              };
            });
          }

          // Step 2: If all data is cached, skip PI request
          if (cacheData.allCached) {
            continue;
          }
        }

        // Step 3: Query PI for data
        const webids = groupTags.map(t => t.web_id).join(',');
        const piParams = new URLSearchParams({
          webids,
          start_time: dateRange.start,
          end_time: dateRange.end,
          mode,
          interval,
          summary_type: summaryType,
        });

        const res = await fetch(`/api/pi/data?${piParams}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          const msg = err.error || `PI data request failed (${res.status})`;
          // On rate limit or other failure, keep whatever we have (cached or prior groups)
          if (Object.keys(results).length > 0) {
            setFetchError(`Some tags skipped: ${msg}`);
            continue;
          }
          throw new Error(msg);
        }
        const data = await res.json();
        usedPi = true;

        // Step 4: Store PI results and cache them
        const cacheRows: { tag_name: string; date: string; value: number; good: number; retrieval_mode: string }[] = [];

        if (data.tags) {
          Object.entries(data.tags).forEach(([wid, tagData]) => {
            const piTag = tagData as PIDataTag;
            results[wid] = piTag;

            // Collect rows for caching
            const tagConfig = groupTags.find(t => t.web_id === wid);
            if (tagConfig && piTag.items) {
              piTag.items.forEach(item => {
                cacheRows.push({
                  tag_name: tagConfig.tag_name,
                  date: item.timestamp,
                  value: item.value,
                  good: item.good ? 1 : 0,
                  retrieval_mode: mode,
                });
              });
            }
          });
        }

        // Step 5: Write to cache (fire-and-forget, respects size limit server-side)
        // Skip cache writes for sub-daily data (cache uses daily date-based keys)
        if (!intervalIsSubDaily && cacheRows.length > 0) {
          fetch('/api/pi/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: cacheRows }),
          }).catch(() => {}); // Don't fail the fetch if caching fails
        }

        // Delay between group requests must exceed the server-side rate limit (5s)
        if (groupEntries.length > 1) {
          await new Promise(r => setTimeout(r, FETCH_COOLDOWN_MS + 500));
        }
      }

      setPiManualData(results);
      setDataUpdatedAt(Date.now());
      setFetchSource(usedCache && usedPi ? 'mixed' : usedCache ? 'cache' : 'pi');
      // Refresh cache stats after storing new data
      queryClient.invalidateQueries({ queryKey: ['pi-cache-stats'] });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setPiFetching(false);
    }
  }, [tags, piFetching, dateRange, queryClient]);

  // Pre-check: estimate data size and warn if too large
  const handleFetchClick = useCallback(() => {
    if (tags.length === 0 || piFetching) return;
    setFetchWarning(null);

    const est = estimateFetchSize(tags, dateRange.start, dateRange.end);

    if (est.total > WARN_POINT_THRESHOLD) {
      const parts: string[] = [];
      if (est.recordedTags > 0) {
        parts.push(
          `${est.recordedTags} tag${est.recordedTags > 1 ? 's' : ''} in Recorded mode over ${est.recordedDays} days — ` +
          `PI must transmit all raw values before aggregating to daily. Consider switching to Summary mode.`
        );
      }
      parts.push(`Estimated ~${est.total.toLocaleString()} raw data points from the PI server.`);
      setFetchWarning({ message: parts.join(' '), estimate: est.total });
      return;
    }

    handleFetchData();
  }, [tags, piFetching, dateRange, handleFetchData]);

  const handleSeedTags = useCallback(async () => {
    setSeeding(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/pi/tags/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_names: SEED_TAGS }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.error || 'Failed to seed tags');
        return;
      }
      if (data.errors?.length > 0) {
        setFetchError(`Added ${data.saved?.length || 0} tags. Failed: ${data.errors.map((e: any) => e.name).join(', ')}`);
      }
      queryClient.invalidateQueries({ queryKey: ['pi-tags'] });
    } catch {
      setFetchError('Failed to connect to PI server for tag seed');
    } finally {
      setSeeding(false);
    }
  }, [queryClient]);

  const handleRemoveTag = useCallback(async (id: number) => {
    await fetch(`/api/pi/tags?id=${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['pi-tags'] });
  }, [queryClient]);

  const handleUpdateTag = useCallback(async (id: number, updates: Record<string, unknown>) => {
    await fetch('/api/pi/tags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    queryClient.invalidateQueries({ queryKey: ['pi-tags'] });
    setEditingTagId(null);
  }, [queryClient]);

  const handleTagAdded = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pi-tags'] });
  }, [queryClient]);

  const handleClearCache = useCallback(async () => {
    await fetch('/api/pi/cache', { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['pi-cache-stats'] });
  }, [queryClient]);

  const handleDownloadCsv = useCallback(() => {
    if (chartData.length === 0 || seriesKeys.length === 0) return;
    const header = ['Date', ...seriesKeys.map(k => seriesLabels[k] || k)];
    const rows = chartData.map(row => {
      const date = (row as Record<string, unknown>).date as string;
      const values = seriesKeys.map(k => {
        const v = (row as Record<string, unknown>)[k];
        return v != null ? String(v) : '';
      });
      return [date, ...values];
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historian_${dateRange.start}_${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chartData, seriesKeys, seriesLabels, dateRange]);

  const toggleBucket = useCallback((bucketName: string) => {
    setSelectedBuckets(prev =>
      prev.includes(bucketName)
        ? prev.filter(b => b !== bucketName)
        : [...prev, bucketName]
    );
  }, []);

  const toggleRollingAvg = useCallback((key: string) => {
    setSelectedRollingAvgs(prev => {
      if (prev.includes(key)) {
        const next = prev.filter(k => k !== key);
        return next.length === 0 ? ['raw'] : next;
      }
      return [...prev, key];
    });
  }, []);

  const isLoading = piFetching || (overlayYield && yieldLoading);

  // ─── Cache stats (lightweight, auto-fetch OK) ─────────────
  const { data: cacheStats } = useQuery({
    queryKey: ['pi-cache-stats'],
    queryFn: async () => {
      const res = await fetch('/api/pi/cache?stats=true');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Historian Trends</h1>
        </div>

        {/* Fetch Data button + status */}
        <div className="flex items-center gap-3">
          {/* Cache indicator */}
          {cacheStats?.rowCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-400" title={`${cacheStats.rowCount.toLocaleString()} / ${cacheStats.maxRows.toLocaleString()} rows cached (${cacheStats.tagCount} tags)`}>
              <Database className="h-3 w-3" />
              {cacheStats.rowCount >= cacheStats.maxRows ? 'Cache full' : `${Math.round(cacheStats.rowCount / cacheStats.maxRows * 100)}%`}
              <button onClick={handleClearCache} className="ml-0.5 text-gray-300 hover:text-red-400" title="Clear cache">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          )}

          {/* Last updated + source indicator */}
          {dataUpdatedAt > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              {formatTimeSince(dataUpdatedAt)}
              {fetchSource === 'cache' && <span className="text-green-500" title="Served entirely from cache">(cached)</span>}
              {fetchSource === 'mixed' && <span className="text-blue-500" title="Partially from cache">(partial cache)</span>}
            </span>
          )}

          <Button
            onClick={handleFetchClick}
            disabled={tags.length === 0 || piFetching || isCoolingDown}
            size="sm"
            className="gap-1.5"
          >
            {piFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {piFetching ? 'Fetching...' : hasPiData ? 'Refresh PI Data' : 'Fetch PI Data'}
          </Button>

          {chartData.length > 0 && (
            <Button onClick={handleDownloadCsv} variant="outline" size="sm" className="gap-1.5" title="Download trend data as CSV">
              <Download className="h-4 w-4" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {/* Data size warning banner */}
      {fetchWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-md px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-medium">Large data request</p>
              <p className="mt-1 text-xs text-amber-700">{fetchWarning.message}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
                  onClick={() => { setFetchWarning(null); handleFetchData(); }}
                >
                  Proceed Anyway
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setFetchWarning(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fetch error banner */}
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{fetchError}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-100"
              disabled={piFetching || isCoolingDown}
              onClick={() => { setFetchError(null); handleFetchClick(); }}
            >
              {isCoolingDown ? 'Wait...' : 'Retry'}
            </Button>
            <button onClick={() => setFetchError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Controls Card */}
      <Card>
        <CardContent className="py-4 space-y-4">
          {/* Row 1: Date range + rolling averages */}
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Date Range</label>
              <div className="flex gap-1">
                {dateRanges.map(range => (
                  <button
                    key={range.label}
                    onClick={() => setSelectedRange(range)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      selectedRange.label === range.label
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedRange.type === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2 py-1.5 text-xs border rounded-md"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2 py-1.5 text-xs border rounded-md"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Rolling Avg</label>
              <div className="flex gap-1">
                {rollingAverageOptions.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => toggleRollingAvg(opt.key)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      selectedRollingAvgs.includes(opt.key)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: PI Tags */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">PI Tags</label>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((tag, i) => (
                <div key={tag.id} className="relative group">
                  <div
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border"
                    style={{
                      borderColor: tag.color || CHART_COLORS[i % CHART_COLORS.length],
                      backgroundColor: `${tag.color || CHART_COLORS[i % CHART_COLORS.length]}15`,
                    }}
                  >
                    <span>{tag.display_name || tag.tag_name}</span>
                    <span className="text-gray-400 text-[10px]">
                      {tag.retrieval_mode === 'summary' ? 'avg' : tag.retrieval_mode === 'recorded' ? 'raw' : 'interp'}
                      {tag.retrieval_mode !== 'recorded' && tag.interval !== '1d' ? `/${tag.interval}` : ''}
                    </span>
                    {tag.y_axis === 'right' && (
                      <span className="text-[10px] text-gray-400">R</span>
                    )}
                    <button
                      onClick={() => setEditingTagId(editingTagId === tag.id ? null : tag.id)}
                      className="ml-0.5 text-gray-400 hover:text-gray-600"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleRemoveTag(tag.id)}
                      className="ml-0.5 text-gray-400 hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {editingTagId === tag.id && (
                    <div className="absolute top-full left-0 mt-1 z-20 bg-white border rounded-lg shadow-lg p-3 w-64 space-y-2">
                      <div>
                        <label className="text-xs text-gray-500">Display Name</label>
                        <input
                          type="text"
                          defaultValue={tag.display_name || tag.tag_name}
                          onBlur={(e) => handleUpdateTag(tag.id, { display_name: e.target.value })}
                          className="w-full px-2 py-1 text-sm border rounded"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Mode</label>
                          <select
                            defaultValue={tag.retrieval_mode}
                            onChange={(e) => handleUpdateTag(tag.id, { retrieval_mode: e.target.value })}
                            className="w-full px-2 py-1 text-xs border rounded"
                          >
                            <option value="summary">Summary (Avg)</option>
                            <option value="interpolated">Interpolated</option>
                            <option value="recorded">Recorded (Raw)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Interval</label>
                          <select
                            defaultValue={tag.interval}
                            onChange={(e) => handleUpdateTag(tag.id, { interval: e.target.value })}
                            className="w-full px-2 py-1 text-xs border rounded"
                            disabled={tag.retrieval_mode === 'recorded'}
                            title={tag.retrieval_mode === 'recorded' ? 'Recorded mode returns raw values (no interval)' : ''}
                          >
                            <option value="1h">1 hour</option>
                            <option value="4h">4 hours</option>
                            <option value="8h">8 hours</option>
                            <option value="1d">1 day</option>
                            <option value="7d">1 week</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Y-Axis</label>
                          <select
                            defaultValue={tag.y_axis}
                            onChange={(e) => handleUpdateTag(tag.id, { y_axis: e.target.value })}
                            className="w-full px-2 py-1 text-xs border rounded"
                          >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="auto">Auto-fit</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Decimals</label>
                          <select
                            defaultValue={tag.decimals ?? ''}
                            onChange={(e) => handleUpdateTag(tag.id, { decimals: e.target.value === '' ? null : Number(e.target.value) })}
                            className="w-full px-2 py-1 text-xs border rounded"
                          >
                            <option value="">Auto</option>
                            <option value="0">0</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                          </select>
                        </div>
                      </div>
                      {tag.retrieval_mode === 'recorded' && (
                        <p className="text-[10px] text-amber-600">
                          Recorded mode pulls all raw values from PI. Use Summary for continuous tags.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchOpen(true)}
                className="h-8"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Tag
              </Button>
            </div>

            {/* Quick-start prompt when no tags exist */}
            {tags.length === 0 && !tagsLoading && (
              <div className="mt-2 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                <Zap className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <span className="text-xs text-blue-700">
                  No tags configured.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSeedTags}
                  disabled={seeding}
                  className="h-7 text-xs ml-auto"
                >
                  {seeding ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Searching PI...</>
                  ) : (
                    <>Quick Start: Add Lab Tags</>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Row 3: Yield Overlay */}
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Yield Overlay</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOverlayYield(!overlayYield)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    overlayYield ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      overlayYield ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <span className="text-xs text-gray-600">{overlayYield ? 'On' : 'Off'}</span>
              </div>
            </div>

            {overlayYield && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Metric</label>
                  <select
                    value={yieldMetric}
                    onChange={(e) => setYieldMetric(e.target.value)}
                    className="px-2 py-1.5 text-xs border rounded-md"
                  >
                    <option value="yield_qty">Yield</option>
                    <option value="blend_qty">Blend</option>
                    <option value="ship_qty">Ship</option>
                    <option value="rec_qty">Receipt</option>
                    <option value="oi_qty">Opening Inventory</option>
                    <option value="ci_qty">Closing Inventory</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Buckets</label>
                  <div className="flex flex-wrap gap-1">
                    {buckets.map(bucket => (
                      <button
                        key={bucket.bucket_name}
                        onClick={() => toggleBucket(bucket.bucket_name)}
                        className={`px-2 py-1 text-xs rounded-md transition-colors ${
                          selectedBuckets.includes(bucket.bucket_name)
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {bucket.bucket_name}
                      </button>
                    ))}
                    {buckets.length === 0 && (
                      <span className="text-xs text-gray-400">Loading buckets...</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Trend Chart
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tags.length === 0 && !overlayYield ? (
            <div className="flex flex-col items-center justify-center h-[400px] text-gray-400">
              <Activity className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm">Add PI tags or enable yield overlay to see trends</p>
            </div>
          ) : tags.length > 0 && !hasPiData && !piFetching ? (
            <div className="flex flex-col items-center justify-center h-[400px] text-gray-400">
              <RefreshCw className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm">Click &quot;Fetch PI Data&quot; to load tag data from the PI server</p>
              <p className="text-xs mt-1 text-gray-300">
                {tags.length} tag{tags.length !== 1 ? 's' : ''} configured &middot; {dateRange.start} to {dateRange.end}
              </p>
            </div>
          ) : piFetching && !hasPiData ? (
            <div className="flex flex-col items-center justify-center h-[400px] text-gray-400">
              <Loader2 className="h-12 w-12 mb-3 animate-spin text-blue-500" />
              <p className="text-sm">Fetching PI data...</p>
              <p className="text-xs mt-1 text-gray-300">
                {tags.length} tag{tags.length !== 1 ? 's' : ''} &middot; {dateRange.start} to {dateRange.end}
              </p>
            </div>
          ) : (
            <TimeSeriesChart
              data={chartData as any[]}
              seriesKeys={seriesKeys}
              seriesLabels={seriesLabels}
              seriesDecimals={seriesDecimals}
              height={500}
              showDataZoom={true}
              yAxisLabel={tags.length > 0 ? (tags[0].unit || 'Value') : 'Value'}
              secondaryAxisKeys={secondaryAxisKeys}
              secondaryAxisLabel={overlayYield && selectedBuckets.length > 0 ? 'Yield (BBL)' : undefined}
              autoFitKeys={autoFitKeys}
              loading={piFetching}
              yAxisBounds={yAxisBounds}
              onYAxisBoundsChange={setYAxisBounds}
            />
          )}
        </CardContent>
      </Card>

      {/* Tag Search Dialog */}
      <TagSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onTagAdded={handleTagAdded}
        existingTagNames={existingTagNames}
      />
    </div>
  );
}
