'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Search, Plus, Loader2 } from 'lucide-react';

interface PIPoint {
  name: string;
  web_id: string;
  point_type: string;
  engineering_units: string;
  descriptor: string;
}

interface TagAddConfig {
  tag_name: string;
  web_id: string;
  display_name: string;
  retrieval_mode: 'recorded' | 'interpolated' | 'summary';
  unit: string;
  y_axis: 'left' | 'right';
  tag_group: string;
}

interface TagSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTagAdded: () => void;
  existingTagNames: string[];
}

export function TagSearchDialog({ open, onOpenChange, onTagAdded, existingTagNames }: TagSearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PIPoint[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Inline config state for the point being added
  const [addingPoint, setAddingPoint] = useState<PIPoint | null>(null);
  const [addConfig, setAddConfig] = useState<TagAddConfig>({
    tag_name: '',
    web_id: '',
    display_name: '',
    retrieval_mode: 'summary',
    unit: '',
    y_axis: 'left',
    tag_group: 'default',
  });
  const [saving, setSaving] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setAddingPoint(null);

    try {
      const resp = await fetch(`/api/pi/search?q=${encodeURIComponent(searchQuery)}&max_count=100`);
      const data = await resp.json();

      if (!resp.ok) {
        setSearchError(data.error || 'Search failed');
        setResults([]);
        return;
      }

      setResults(data.points || []);
      if ((data.points || []).length === 0) {
        setSearchError('No tags found matching that pattern');
      }
    } catch (err) {
      setSearchError('Failed to connect to PI server');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const startAdding = (point: PIPoint) => {
    // Auto-suggest retrieval mode based on point type
    const isFloat = point.point_type === 'Float32' || point.point_type === 'Float64' || point.point_type === 'Int32';
    const suggestedMode: 'summary' | 'recorded' = isFloat ? 'summary' : 'recorded';

    setAddingPoint(point);
    setAddConfig({
      tag_name: point.name,
      web_id: point.web_id,
      display_name: point.name,
      retrieval_mode: suggestedMode,
      unit: point.engineering_units || '',
      y_axis: 'left',
      tag_group: 'default',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch('/api/pi/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addConfig),
      });

      if (!resp.ok) {
        const data = await resp.json();
        setSearchError(data.error || 'Failed to save tag');
        return;
      }

      setAddingPoint(null);
      onTagAdded();
    } catch {
      setSearchError('Failed to save tag configuration');
    } finally {
      setSaving(false);
    }
  };

  const alreadyAdded = (name: string) => existingTagNames.includes(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Search PI Tags</DialogTitle>
          <DialogDescription>
            Search the PI server for tags to add to your historian trend. Use wildcards like FCC* or *TEMP*.
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Tag name pattern (e.g. FCC*, *REACTOR*)"
            className="flex-1 px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()} size="sm">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-1">Search</span>
          </Button>
        </div>

        {/* Error */}
        {searchError && (
          <p className="text-sm text-red-600">{searchError}</p>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {results.map((point) => (
            <div key={point.web_id} className="border rounded-md p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium truncate">{point.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{point.point_type}</span>
                    {point.engineering_units && (
                      <span className="text-xs text-gray-500">{point.engineering_units}</span>
                    )}
                  </div>
                  {point.descriptor && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{point.descriptor}</p>
                  )}
                </div>
                {alreadyAdded(point.name) ? (
                  <span className="text-xs text-green-600 font-medium px-2">Added</span>
                ) : addingPoint?.web_id === point.web_id ? null : (
                  <Button size="sm" variant="outline" onClick={() => startAdding(point)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                )}
              </div>

              {/* Inline config form when adding this point */}
              {addingPoint?.web_id === point.web_id && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">Display Name</label>
                      <input
                        type="text"
                        value={addConfig.display_name}
                        onChange={(e) => setAddConfig({ ...addConfig, display_name: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Unit</label>
                      <input
                        type="text"
                        value={addConfig.unit}
                        onChange={(e) => setAddConfig({ ...addConfig, unit: e.target.value })}
                        placeholder="e.g. degF, PSI, BBL"
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">Retrieval Mode</label>
                      <select
                        value={addConfig.retrieval_mode}
                        onChange={(e) => setAddConfig({ ...addConfig, retrieval_mode: e.target.value as any })}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="summary">Summary (Daily Avg)</option>
                        <option value="interpolated">Interpolated</option>
                        <option value="recorded">Recorded (Raw)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Y-Axis</label>
                      <select
                        value={addConfig.y_axis}
                        onChange={(e) => setAddConfig({ ...addConfig, y_axis: e.target.value as 'left' | 'right' })}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Group</label>
                      <input
                        type="text"
                        value={addConfig.tag_group}
                        onChange={(e) => setAddConfig({ ...addConfig, tag_group: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddingPoint(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save Tag
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
