'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface BucketConfig {
  id?: number;
  bucket_type: 'yield' | 'sales';
  bucket_name: string;
  component_products: string[];
  is_virtual: boolean;
  display_order: number;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'yield' | 'sales'>('yield');
  const [editingBucket, setEditingBucket] = useState<BucketConfig | null>(null);
  const [newProductInput, setNewProductInput] = useState('');

  // Fetch bucket configurations
  const { data: buckets, isLoading } = useQuery({
    queryKey: ['bucket-configs', activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/buckets?type=${activeTab}`);
      if (!res.ok) throw new Error('Failed to fetch bucket configs');
      return res.json();
    },
  });

  // Fetch available products
  const { data: availableProducts } = useQuery({
    queryKey: ['available-products', activeTab],
    queryFn: async () => {
      const endpoint = activeTab === 'yield' ? '/api/yield' : '/api/sales';
      const res = await fetch(`${endpoint}?action=products`);
      if (!res.ok) return { products: [] };
      return res.json();
    },
  });

  // Save bucket mutation
  const saveBucketMutation = useMutation({
    mutationFn: async (bucket: BucketConfig) => {
      const res = await fetch('/api/buckets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bucket),
      });
      if (!res.ok) throw new Error('Failed to save bucket');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bucket-configs'] });
      setEditingBucket(null);
    },
  });

  // Delete bucket mutation
  const deleteBucketMutation = useMutation({
    mutationFn: async (bucketId: number) => {
      const res = await fetch(`/api/buckets?id=${bucketId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete bucket');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bucket-configs'] });
    },
  });

  // Trigger sync mutation
  const triggerSyncMutation = useMutation({
    mutationFn: async (dataType: string) => {
      const res = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_type: dataType }),
      });
      if (!res.ok) throw new Error('Failed to trigger sync');
      return res.json();
    },
  });

  // Fetch sync status
  const { data: syncStatus, refetch: refetchSyncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await fetch('/api/sync/status');
      if (!res.ok) throw new Error('Failed to fetch sync status');
      return res.json();
    },
    refetchInterval: 5000, // Poll every 5 seconds
  });

  const handleAddProduct = () => {
    if (!editingBucket || !newProductInput.trim()) return;
    if (!editingBucket.component_products.includes(newProductInput.trim())) {
      setEditingBucket({
        ...editingBucket,
        component_products: [...editingBucket.component_products, newProductInput.trim()],
      });
    }
    setNewProductInput('');
  };

  const handleRemoveProduct = (product: string) => {
    if (!editingBucket) return;
    setEditingBucket({
      ...editingBucket,
      component_products: editingBucket.component_products.filter((p) => p !== product),
    });
  };

  const handleSaveBucket = () => {
    if (!editingBucket || !editingBucket.bucket_name) return;
    saveBucketMutation.mutate(editingBucket);
  };

  const startNewBucket = () => {
    setEditingBucket({
      bucket_type: activeTab,
      bucket_name: '',
      component_products: [],
      is_virtual: false,
      display_order: (buckets?.buckets?.length || 0) + 1,
    });
  };

  const startEditBucket = (bucket: BucketConfig) => {
    setEditingBucket({ ...bucket });
  };

  return (
    <div className="space-y-6">
      {/* Sync Status */}
      <Card>
        <CardHeader>
          <CardTitle>Data Sync Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {syncStatus?.status?.map((s: any) => (
              <div key={s.data_type} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="font-medium capitalize">{s.data_type} Data</h4>
                  <p className="text-sm text-gray-500">
                    Last synced: {s.last_sync_at ? new Date(s.last_sync_at).toLocaleString() : 'Never'}
                  </p>
                  {s.records_synced !== null && (
                    <p className="text-sm text-gray-500">
                      {s.records_synced.toLocaleString()} records in {s.sync_duration_ms}ms
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs ${
                    s.status === 'success' ? 'bg-green-100 text-green-800' :
                    s.status === 'running' ? 'bg-blue-100 text-blue-800' :
                    s.status === 'error' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {s.status || 'pending'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => triggerSyncMutation.mutate(s.data_type)}
                    disabled={s.status === 'running' || triggerSyncMutation.isPending}
                  >
                    Sync Now
                  </Button>
                </div>
              </div>
            ))}
            {(!syncStatus?.status || syncStatus.status.length === 0) && (
              <div className="text-center py-4 text-gray-500">
                No sync status available. Run an initial sync to populate data.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bucket Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Product Bucket Configuration</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={activeTab === 'yield' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab('yield')}
              >
                Yield Buckets
              </Button>
              <Button
                variant={activeTab === 'sales' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab('sales')}
              >
                Sales Buckets
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-4 text-center text-gray-500">Loading buckets...</div>
          ) : (
            <div className="space-y-4">
              {/* Bucket List */}
              {buckets?.buckets?.map((bucket: BucketConfig) => (
                <div key={bucket.id || bucket.bucket_name} className="p-4 border rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium flex items-center gap-2">
                        {bucket.bucket_name}
                        {bucket.is_virtual && (
                          <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                            Virtual
                          </span>
                        )}
                      </h4>
                      <p className="text-sm text-gray-500 mt-1">
                        {bucket.component_products.length} component products
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {bucket.component_products.slice(0, 5).map((p) => (
                          <span key={p} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                            {p}
                          </span>
                        ))}
                        {bucket.component_products.length > 5 && (
                          <span className="text-xs text-gray-500">
                            +{bucket.component_products.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEditBucket(bucket)}>
                        Edit
                      </Button>
                      {bucket.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => deleteBucketMutation.mutate(bucket.id!)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {(!buckets?.buckets || buckets.buckets.length === 0) && (
                <div className="py-4 text-center text-gray-500">
                  No buckets configured. Add your first bucket below.
                </div>
              )}

              {/* Add New Bucket Button */}
              {!editingBucket && (
                <Button onClick={startNewBucket} className="w-full">
                  + Add New Bucket
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bucket Editor */}
      {editingBucket && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingBucket.id ? 'Edit Bucket' : 'New Bucket'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Bucket Name */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Bucket Name
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md"
                value={editingBucket.bucket_name}
                onChange={(e) => setEditingBucket({ ...editingBucket, bucket_name: e.target.value })}
                placeholder="e.g., ULSD, LPG, Distillate"
              />
            </div>

            {/* Virtual Bucket Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_virtual"
                checked={editingBucket.is_virtual}
                onChange={(e) => setEditingBucket({ ...editingBucket, is_virtual: e.target.checked })}
              />
              <label htmlFor="is_virtual" className="text-sm">
                Virtual bucket (calculated, not aggregated)
              </label>
            </div>

            {/* Display Order */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Display Order
              </label>
              <input
                type="number"
                className="w-24 px-3 py-2 border rounded-md"
                value={editingBucket.display_order}
                onChange={(e) => setEditingBucket({ ...editingBucket, display_order: parseInt(e.target.value) || 0 })}
              />
            </div>

            {/* Component Products */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Component Products ({editingBucket.component_products.length})
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {editingBucket.component_products.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() => handleRemoveProduct(p)}
                      className="hover:text-blue-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 border rounded-md"
                  value={newProductInput}
                  onChange={(e) => setNewProductInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()}
                  placeholder="Type product name..."
                  list="available-products"
                />
                <datalist id="available-products">
                  {availableProducts?.products?.map((p: string) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <Button onClick={handleAddProduct}>Add</Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSaveBucket} disabled={saveBucketMutation.isPending}>
                {saveBucketMutation.isPending ? 'Saving...' : 'Save Bucket'}
              </Button>
              <Button variant="outline" onClick={() => setEditingBucket(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Database Info */}
      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900">Local Database</h4>
              <p className="text-sm text-gray-500 mt-1">
                SQLite with WAL mode for maximum read performance.
                Data is pre-aggregated from SQL Server for instant queries.
              </p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900">Sync Schedule</h4>
              <p className="text-sm text-gray-500 mt-1">
                Incremental: Every 15 minutes<br />
                Full refresh: Daily at 2:00 AM
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
