'use client';

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Period {
  period_number: number;
  start_day: number;
  end_day: number;
}

interface PeriodTabsProps {
  periods: Period[];
  selectedPeriod: number | null; // null means "Full Month"
  onPeriodChange: (period: number | null) => void;
  className?: string;
}

export function PeriodTabs({
  periods,
  selectedPeriod,
  onPeriodChange,
  className,
}: PeriodTabsProps) {
  if (periods.length === 0) {
    return null;
  }

  const value = selectedPeriod === null ? 'full' : `period-${selectedPeriod}`;

  const handleValueChange = (newValue: string) => {
    if (newValue === 'full') {
      onPeriodChange(null);
    } else {
      const periodNum = parseInt(newValue.replace('period-', ''), 10);
      onPeriodChange(periodNum);
    }
  };

  return (
    <Tabs value={value} onValueChange={handleValueChange} className={className}>
      <TabsList>
        <TabsTrigger value="full">Full Month</TabsTrigger>
        {periods.map((period) => (
          <TabsTrigger key={period.period_number} value={`period-${period.period_number}`}>
            Period {period.period_number}
            <span className="ml-1 text-xs text-muted-foreground">
              ({period.start_day}-{period.end_day})
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
