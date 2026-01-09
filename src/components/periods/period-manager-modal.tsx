'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, AlertCircle } from 'lucide-react';

interface Period {
  period_number: number;
  start_day: number;
  end_day: number;
}

interface PeriodManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  onPeriodsChanged?: () => void;
}

function getDaysInMonth(month: string): number {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(year, monthNum, 0).getDate();
}

function getMonthName(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(year, monthNum - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function PeriodManagerModal({
  open,
  onOpenChange,
  month,
  onPeriodsChanged,
}: PeriodManagerModalProps) {
  const queryClient = useQueryClient();
  const daysInMonth = getDaysInMonth(month);
  const monthName = getMonthName(month);

  const [useMultiplePeriods, setUseMultiplePeriods] = React.useState(false);
  const [periods, setPeriods] = React.useState<Period[]>([
    { period_number: 1, start_day: 1, end_day: daysInMonth },
  ]);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  // Fetch existing periods
  const { data: existingPeriods } = useQuery({
    queryKey: ['periods', month],
    queryFn: async () => {
      const response = await fetch(`/api/periods?month=${month}`);
      if (!response.ok) throw new Error('Failed to fetch periods');
      return response.json();
    },
    enabled: open,
  });

  // Initialize state when modal opens or data loads
  React.useEffect(() => {
    if (existingPeriods?.periods?.length > 0) {
      setPeriods(existingPeriods.periods);
      setUseMultiplePeriods(existingPeriods.periods.length > 1);
    } else {
      setPeriods([{ period_number: 1, start_day: 1, end_day: daysInMonth }]);
      setUseMultiplePeriods(false);
    }
    setValidationErrors([]);
  }, [existingPeriods, daysInMonth, open]);

  // Save periods mutation
  const saveMutation = useMutation({
    mutationFn: async (periodsToSave: Period[]) => {
      const response = await fetch('/api/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, periods: periodsToSave }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details?.join(', ') || error.error || 'Failed to save periods');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods', month] });
      queryClient.invalidateQueries({ queryKey: ['yield-mtd', month] });
      onPeriodsChanged?.();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setValidationErrors([error.message]);
    },
  });

  // Delete periods mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/periods?month=${month}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete periods');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods', month] });
      queryClient.invalidateQueries({ queryKey: ['yield-mtd', month] });
      onPeriodsChanged?.();
      onOpenChange(false);
    },
  });

  const validatePeriods = (periodsToValidate: Period[]): string[] => {
    const errors: string[] = [];
    const sorted = [...periodsToValidate].sort((a, b) => a.period_number - b.period_number);

    if (sorted[0]?.start_day !== 1) {
      errors.push('First period must start on day 1');
    }

    if (sorted[sorted.length - 1]?.end_day !== daysInMonth) {
      errors.push(`Last period must end on day ${daysInMonth}`);
    }

    sorted.forEach((p) => {
      if (p.start_day > p.end_day) {
        errors.push(`Period ${p.period_number}: start day cannot be after end day`);
      }
    });

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.start_day !== prev.end_day + 1) {
        errors.push(`Gap or overlap between period ${prev.period_number} and ${curr.period_number}`);
      }
    }

    return errors;
  };

  const handleAddPeriod = () => {
    if (periods.length >= 3) return;

    const lastPeriod = periods[periods.length - 1];
    const midPoint = Math.floor((lastPeriod.start_day + lastPeriod.end_day) / 2);

    const updatedPeriods = [
      ...periods.slice(0, -1),
      { ...lastPeriod, end_day: midPoint },
      { period_number: periods.length + 1, start_day: midPoint + 1, end_day: lastPeriod.end_day },
    ];

    setPeriods(updatedPeriods);
    setValidationErrors(validatePeriods(updatedPeriods));
  };

  const handleRemovePeriod = (index: number) => {
    if (periods.length <= 1) return;

    const newPeriods = periods.filter((_, i) => i !== index);

    // Renumber periods and adjust boundaries
    const adjusted = newPeriods.map((p, i) => ({
      ...p,
      period_number: i + 1,
    }));

    // If removing a middle period, extend the previous one to cover the gap
    if (index > 0 && index < periods.length - 1) {
      adjusted[index - 1].end_day = periods[index].end_day;
    } else if (index === periods.length - 1 && adjusted.length > 0) {
      // If removing last period, extend the new last one to month end
      adjusted[adjusted.length - 1].end_day = daysInMonth;
    } else if (index === 0 && adjusted.length > 0) {
      // If removing first period, start the new first one from day 1
      adjusted[0].start_day = 1;
    }

    setPeriods(adjusted);
    setValidationErrors(validatePeriods(adjusted));
  };

  const handlePeriodChange = (index: number, field: 'start_day' | 'end_day', value: number) => {
    const updated = [...periods];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-adjust adjacent periods to maintain continuity
    if (field === 'end_day' && index < periods.length - 1) {
      updated[index + 1] = { ...updated[index + 1], start_day: value + 1 };
    } else if (field === 'start_day' && index > 0) {
      updated[index - 1] = { ...updated[index - 1], end_day: value - 1 };
    }

    setPeriods(updated);
    setValidationErrors(validatePeriods(updated));
  };

  const handleSave = () => {
    if (useMultiplePeriods) {
      const errors = validatePeriods(periods);
      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }
      saveMutation.mutate(periods);
    } else {
      // If single period mode, delete any existing periods
      if (existingPeriods?.periods?.length > 0) {
        deleteMutation.mutate();
      } else {
        onOpenChange(false);
      }
    }
  };

  const handleModeChange = (multiple: boolean) => {
    setUseMultiplePeriods(multiple);
    if (!multiple) {
      setPeriods([{ period_number: 1, start_day: 1, end_day: daysInMonth }]);
      setValidationErrors([]);
    }
  };

  // Calculate visual coverage bar segments
  const coverageSegments = periods.map((p) => ({
    start: ((p.start_day - 1) / daysInMonth) * 100,
    width: ((p.end_day - p.start_day + 1) / daysInMonth) * 100,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Configure Periods for {monthName}</DialogTitle>
          <DialogDescription>
            Define sub-monthly periods with different yield targets. Periods must cover the entire month.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Mode selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="periodMode"
                checked={!useMultiplePeriods}
                onChange={() => handleModeChange(false)}
                className="w-4 h-4"
              />
              <span className="text-sm">Single Period (no sub-monthly targets)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="periodMode"
                checked={useMultiplePeriods}
                onChange={() => handleModeChange(true)}
                className="w-4 h-4"
              />
              <span className="text-sm">Multiple Periods</span>
            </label>
          </div>

          {/* Period configuration */}
          {useMultiplePeriods && (
            <div className="space-y-3">
              {periods.map((period, index) => (
                <div key={period.period_number} className="flex items-center gap-2">
                  <span className="text-sm font-medium w-16">Period {period.period_number}:</span>
                  <span className="text-sm text-muted-foreground">Day</span>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={period.start_day}
                    onChange={(e) => handlePeriodChange(index, 'start_day', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-sm border rounded"
                    disabled={index === 0}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={period.end_day}
                    onChange={(e) => handlePeriodChange(index, 'end_day', parseInt(e.target.value) || daysInMonth)}
                    className="w-16 px-2 py-1 text-sm border rounded"
                    disabled={index === periods.length - 1}
                  />
                  <span className="text-xs text-muted-foreground">
                    ({period.end_day - period.start_day + 1} days)
                  </span>
                  {periods.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRemovePeriod(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}

              {periods.length < 3 && (
                <Button variant="outline" size="sm" onClick={handleAddPeriod}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Period
                </Button>
              )}

              {/* Coverage visualization */}
              <div className="mt-4">
                <div className="text-xs text-muted-foreground mb-1">Coverage</div>
                <div className="h-4 bg-muted rounded relative overflow-hidden">
                  {coverageSegments.map((segment, i) => (
                    <div
                      key={i}
                      className="absolute h-full bg-primary/70"
                      style={{
                        left: `${segment.start}%`,
                        width: `${segment.width}%`,
                        opacity: 0.5 + (i * 0.2),
                      }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1</span>
                  <span>{daysInMonth}</span>
                </div>
              </div>
            </div>
          )}

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                {validationErrors.map((error, i) => (
                  <div key={i}>{error}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || deleteMutation.isPending}
          >
            {saveMutation.isPending || deleteMutation.isPending ? 'Saving...' : 'Save Periods'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
