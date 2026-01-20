/**
 * Statistical Process Control (SPC) utilities
 * Implements the 8 Western Electric / Deming rules for detecting out-of-control processes
 */

export interface SPCRuleViolation {
  ruleNumber: number;
  ruleName: string;
  dataIndex: number;
  date: string;
  value: number;
  description: string;
}

export interface SPCResult {
  mean: number;
  stdDev: number;
  ucl3: number;  // Upper Control Limit (3σ)
  ucl2: number;  // Upper Warning (2σ)
  ucl1: number;  // Upper Zone C (1σ)
  lcl1: number;  // Lower Zone C (1σ)
  lcl2: number;  // Lower Warning (2σ)
  lcl3: number;  // Lower Control Limit (3σ)
  violations: SPCRuleViolation[];
  violationIndices: Set<number>;
}

export interface SPCOptions {
  baselineStartIndex?: number;
  baselineEndIndex?: number;
  enabledRules?: number[];
}

// Rule names for display
const RULE_NAMES: Record<number, string> = {
  1: 'Beyond 3σ',
  2: 'Run of 9',
  3: 'Trend of 6',
  4: 'Alternating 14',
  5: 'Zone A (2 of 3)',
  6: 'Zone B (4 of 5)',
  7: 'Stratification',
  8: 'Mixture',
};

/**
 * Calculate mean from an array of values
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation from an array of values
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Rule 1: One point beyond 3 standard deviations from centerline
 */
function checkRule1(
  values: number[],
  dates: string[],
  mean: number,
  ucl3: number,
  lcl3: number
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];

  values.forEach((value, i) => {
    if (value > ucl3 || value < lcl3) {
      violations.push({
        ruleNumber: 1,
        ruleName: RULE_NAMES[1],
        dataIndex: i,
        date: dates[i],
        value,
        description: value > ucl3
          ? `Point above UCL (${value.toLocaleString()} > ${ucl3.toLocaleString()})`
          : `Point below LCL (${value.toLocaleString()} < ${lcl3.toLocaleString()})`,
      });
    }
  });

  return violations;
}

/**
 * Rule 2: Nine consecutive points on same side of centerline
 */
function checkRule2(
  values: number[],
  dates: string[],
  mean: number
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];
  const RUN_LENGTH = 9;

  for (let i = RUN_LENGTH - 1; i < values.length; i++) {
    let allAbove = true;
    let allBelow = true;

    for (let j = i - RUN_LENGTH + 1; j <= i; j++) {
      if (values[j] <= mean) allAbove = false;
      if (values[j] >= mean) allBelow = false;
    }

    if (allAbove || allBelow) {
      // Only add violation at the end of the run to avoid duplicates
      const existing = violations.find(v => v.dataIndex === i);
      if (!existing) {
        violations.push({
          ruleNumber: 2,
          ruleName: RULE_NAMES[2],
          dataIndex: i,
          date: dates[i],
          value: values[i],
          description: allAbove
            ? `9 consecutive points above mean`
            : `9 consecutive points below mean`,
        });
      }
    }
  }

  return violations;
}

/**
 * Rule 3: Six consecutive points steadily increasing or decreasing
 */
function checkRule3(
  values: number[],
  dates: string[]
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];
  const TREND_LENGTH = 6;

  for (let i = TREND_LENGTH - 1; i < values.length; i++) {
    let increasing = true;
    let decreasing = true;

    for (let j = i - TREND_LENGTH + 2; j <= i; j++) {
      if (values[j] <= values[j - 1]) increasing = false;
      if (values[j] >= values[j - 1]) decreasing = false;
    }

    if (increasing || decreasing) {
      violations.push({
        ruleNumber: 3,
        ruleName: RULE_NAMES[3],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: increasing
          ? `6 consecutive points increasing`
          : `6 consecutive points decreasing`,
      });
    }
  }

  return violations;
}

/**
 * Rule 4: Fourteen consecutive points alternating up and down
 */
function checkRule4(
  values: number[],
  dates: string[]
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];
  const ALT_LENGTH = 14;

  for (let i = ALT_LENGTH - 1; i < values.length; i++) {
    let alternating = true;

    for (let j = i - ALT_LENGTH + 2; j <= i; j++) {
      const prevDiff = values[j - 1] - values[j - 2];
      const currDiff = values[j] - values[j - 1];
      // Check if direction changed (one positive, one negative)
      if (prevDiff * currDiff >= 0) {
        alternating = false;
        break;
      }
    }

    if (alternating) {
      violations.push({
        ruleNumber: 4,
        ruleName: RULE_NAMES[4],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `14 points alternating up and down`,
      });
    }
  }

  return violations;
}

/**
 * Rule 5: Two of three consecutive points > 2σ from centerline (same side)
 */
function checkRule5(
  values: number[],
  dates: string[],
  mean: number,
  ucl2: number,
  lcl2: number
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];

  for (let i = 2; i < values.length; i++) {
    const window = [values[i - 2], values[i - 1], values[i]];

    // Check upper zone A
    const aboveUcl2 = window.filter(v => v > ucl2).length;
    if (aboveUcl2 >= 2) {
      violations.push({
        ruleNumber: 5,
        ruleName: RULE_NAMES[5],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `${aboveUcl2} of 3 points above 2σ`,
      });
      continue;
    }

    // Check lower zone A
    const belowLcl2 = window.filter(v => v < lcl2).length;
    if (belowLcl2 >= 2) {
      violations.push({
        ruleNumber: 5,
        ruleName: RULE_NAMES[5],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `${belowLcl2} of 3 points below 2σ`,
      });
    }
  }

  return violations;
}

/**
 * Rule 6: Four of five consecutive points > 1σ from centerline (same side)
 */
function checkRule6(
  values: number[],
  dates: string[],
  mean: number,
  ucl1: number,
  lcl1: number
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];

  for (let i = 4; i < values.length; i++) {
    const window = [values[i - 4], values[i - 3], values[i - 2], values[i - 1], values[i]];

    // Check upper zone B
    const aboveUcl1 = window.filter(v => v > ucl1).length;
    if (aboveUcl1 >= 4) {
      violations.push({
        ruleNumber: 6,
        ruleName: RULE_NAMES[6],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `${aboveUcl1} of 5 points above 1σ`,
      });
      continue;
    }

    // Check lower zone B
    const belowLcl1 = window.filter(v => v < lcl1).length;
    if (belowLcl1 >= 4) {
      violations.push({
        ruleNumber: 6,
        ruleName: RULE_NAMES[6],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `${belowLcl1} of 5 points below 1σ`,
      });
    }
  }

  return violations;
}

/**
 * Rule 7: Fifteen consecutive points within 1σ of centerline (stratification)
 */
function checkRule7(
  values: number[],
  dates: string[],
  ucl1: number,
  lcl1: number
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];
  const STRAT_LENGTH = 15;

  for (let i = STRAT_LENGTH - 1; i < values.length; i++) {
    let allWithin1Sigma = true;

    for (let j = i - STRAT_LENGTH + 1; j <= i; j++) {
      if (values[j] > ucl1 || values[j] < lcl1) {
        allWithin1Sigma = false;
        break;
      }
    }

    if (allWithin1Sigma) {
      violations.push({
        ruleNumber: 7,
        ruleName: RULE_NAMES[7],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `15 consecutive points within 1σ (stratification)`,
      });
    }
  }

  return violations;
}

/**
 * Rule 8: Eight consecutive points > 1σ from centerline (either side) - mixture
 */
function checkRule8(
  values: number[],
  dates: string[],
  ucl1: number,
  lcl1: number
): SPCRuleViolation[] {
  const violations: SPCRuleViolation[] = [];
  const MIX_LENGTH = 8;

  for (let i = MIX_LENGTH - 1; i < values.length; i++) {
    let allOutside1Sigma = true;

    for (let j = i - MIX_LENGTH + 1; j <= i; j++) {
      if (values[j] <= ucl1 && values[j] >= lcl1) {
        allOutside1Sigma = false;
        break;
      }
    }

    if (allOutside1Sigma) {
      violations.push({
        ruleNumber: 8,
        ruleName: RULE_NAMES[8],
        dataIndex: i,
        date: dates[i],
        value: values[i],
        description: `8 consecutive points outside 1σ (mixture)`,
      });
    }
  }

  return violations;
}

/**
 * Main SPC calculation function
 * Calculates control limits and detects violations based on enabled rules
 */
export function calculateSPC(
  values: number[],
  dates: string[],
  options: SPCOptions = {}
): SPCResult {
  const {
    baselineStartIndex = 0,
    baselineEndIndex = values.length - 1,
    enabledRules = [1, 2, 3, 4, 5, 6, 7, 8],
  } = options;

  // Calculate baseline statistics
  const baselineValues = values.slice(baselineStartIndex, baselineEndIndex + 1);
  const mean = calculateMean(baselineValues);
  const stdDev = calculateStdDev(baselineValues, mean);

  // Calculate control limits
  const ucl3 = mean + 3 * stdDev;
  const ucl2 = mean + 2 * stdDev;
  const ucl1 = mean + 1 * stdDev;
  const lcl1 = mean - 1 * stdDev;
  const lcl2 = mean - 2 * stdDev;
  const lcl3 = mean - 3 * stdDev;

  // Collect violations from enabled rules
  const allViolations: SPCRuleViolation[] = [];

  if (enabledRules.includes(1)) {
    allViolations.push(...checkRule1(values, dates, mean, ucl3, lcl3));
  }
  if (enabledRules.includes(2)) {
    allViolations.push(...checkRule2(values, dates, mean));
  }
  if (enabledRules.includes(3)) {
    allViolations.push(...checkRule3(values, dates));
  }
  if (enabledRules.includes(4)) {
    allViolations.push(...checkRule4(values, dates));
  }
  if (enabledRules.includes(5)) {
    allViolations.push(...checkRule5(values, dates, mean, ucl2, lcl2));
  }
  if (enabledRules.includes(6)) {
    allViolations.push(...checkRule6(values, dates, mean, ucl1, lcl1));
  }
  if (enabledRules.includes(7)) {
    allViolations.push(...checkRule7(values, dates, ucl1, lcl1));
  }
  if (enabledRules.includes(8)) {
    allViolations.push(...checkRule8(values, dates, ucl1, lcl1));
  }

  // Sort violations by date/index
  allViolations.sort((a, b) => a.dataIndex - b.dataIndex);

  // Create set of violation indices for quick lookup
  const violationIndices = new Set(allViolations.map(v => v.dataIndex));

  return {
    mean,
    stdDev,
    ucl3,
    ucl2,
    ucl1,
    lcl1,
    lcl2,
    lcl3,
    violations: allViolations,
    violationIndices,
  };
}

/**
 * Get readable rule description
 */
export function getRuleDescription(ruleNumber: number): string {
  const descriptions: Record<number, string> = {
    1: 'One point beyond 3σ from centerline',
    2: 'Nine consecutive points on same side of centerline',
    3: 'Six consecutive points steadily increasing or decreasing',
    4: 'Fourteen consecutive points alternating up and down',
    5: 'Two of three consecutive points > 2σ from centerline (same side)',
    6: 'Four of five consecutive points > 1σ from centerline (same side)',
    7: 'Fifteen consecutive points within 1σ of centerline (stratification)',
    8: 'Eight consecutive points > 1σ from centerline, either side (mixture)',
  };
  return descriptions[ruleNumber] || 'Unknown rule';
}

export { RULE_NAMES };
