'use client';

import { getRuleDescription, RULE_NAMES } from '@/lib/spc';

export type BaselineMode = 'full' | 'first_n' | 'custom';

export interface MetricOption {
  key: string;
  label: string;
}

export interface SPCControlsProps {
  // Series selection (buckets)
  availableBuckets: string[];
  // Series selection (individual products)
  availableProducts: string[];
  selectedSeries: string;
  onSeriesChange: (series: string) => void;

  // Metric selection
  availableMetrics: MetricOption[];
  selectedMetric: string;
  onMetricChange: (metric: string) => void;

  // Baseline configuration
  baselineMode: BaselineMode;
  onBaselineModeChange: (mode: BaselineMode) => void;
  baselineDays: number;
  onBaselineDaysChange: (days: number) => void;

  // Rule toggles
  enabledRules: number[];
  onEnabledRulesChange: (rules: number[]) => void;
}

// All 8 Western Electric rules
const ALL_RULES = [1, 2, 3, 4, 5, 6, 7, 8];

export function SPCControls({
  availableBuckets,
  availableProducts,
  selectedSeries,
  onSeriesChange,
  availableMetrics,
  selectedMetric,
  onMetricChange,
  baselineMode,
  onBaselineModeChange,
  baselineDays,
  onBaselineDaysChange,
  enabledRules,
  onEnabledRulesChange,
}: SPCControlsProps) {
  // Toggle a single rule
  const toggleRule = (ruleNum: number) => {
    if (enabledRules.includes(ruleNum)) {
      // Don't allow disabling all rules
      if (enabledRules.length > 1) {
        onEnabledRulesChange(enabledRules.filter(r => r !== ruleNum));
      }
    } else {
      onEnabledRulesChange([...enabledRules, ruleNum].sort((a, b) => a - b));
    }
  };

  // Quick presets
  const selectAllRules = () => onEnabledRulesChange([...ALL_RULES]);
  const selectBasicRules = () => onEnabledRulesChange([1, 2, 3]);
  const selectZoneRules = () => onEnabledRulesChange([1, 5, 6]);

  return (
    <div className="space-y-4">
      {/* Top row: Series, Metric, and Baseline */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Series Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Product:</label>
          <select
            value={selectedSeries}
            onChange={(e) => onSeriesChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 max-w-[200px]"
          >
            <optgroup label="Buckets">
              {availableBuckets.map(series => (
                <option key={series} value={series}>{series}</option>
              ))}
            </optgroup>
            {availableProducts.length > 0 && (
              <optgroup label="Individual Products">
                {availableProducts.map(series => (
                  <option key={series} value={series}>{series}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Metric Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Metric:</label>
          <select
            value={selectedMetric}
            onChange={(e) => onMetricChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {availableMetrics.map(metric => (
              <option key={metric.key} value={metric.key}>{metric.label}</option>
            ))}
          </select>
        </div>

        {/* Baseline Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Baseline:</label>
          <select
            value={baselineMode}
            onChange={(e) => onBaselineModeChange(e.target.value as BaselineMode)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="full">Full Range</option>
            <option value="first_n">First N Days</option>
          </select>

          {baselineMode === 'first_n' && (
            <input
              type="number"
              value={baselineDays}
              onChange={(e) => onBaselineDaysChange(Math.max(3, parseInt(e.target.value) || 30))}
              min={3}
              max={365}
              className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          )}
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-500">Presets:</span>
          <button
            onClick={selectAllRules}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              enabledRules.length === 8
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Rules
          </button>
          <button
            onClick={selectBasicRules}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              enabledRules.length === 3 && enabledRules.includes(1) && enabledRules.includes(2) && enabledRules.includes(3)
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Basic (1-3)
          </button>
          <button
            onClick={selectZoneRules}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              enabledRules.length === 3 && enabledRules.includes(1) && enabledRules.includes(5) && enabledRules.includes(6)
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Zone Rules
          </button>
        </div>
      </div>

      {/* Rule Toggles */}
      <div className="border-t border-gray-200 pt-3">
        <div className="text-xs font-medium text-gray-500 mb-2">Western Electric Rules:</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {ALL_RULES.map(ruleNum => (
            <label
              key={ruleNum}
              className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
                enabledRules.includes(ruleNum)
                  ? 'bg-blue-50 border-blue-300'
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <input
                type="checkbox"
                checked={enabledRules.includes(ruleNum)}
                onChange={() => toggleRule(ruleNum)}
                className="mt-0.5"
              />
              <div className="text-xs">
                <div className="font-medium text-gray-800">
                  Rule {ruleNum}: {RULE_NAMES[ruleNum]}
                </div>
                <div className="text-gray-500 mt-0.5">
                  {getRuleDescription(ruleNum)}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
