'use client';

import { usePathname } from 'next/navigation';
import { SyncIndicator } from '@/components/sync/sync-indicator';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/yield': 'Yield Report',
  '/sales': 'Sales Report',
  '/tanks': 'Tank Inventory',
  '/monthly-yield': 'Monthly Yield Table',
  '/trajectory': 'Month Trajectory',
  '/settings/buckets': 'Bucket Configuration',
  '/settings/sync': 'Sync Status',
};

export function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || 'Yield Rewind';

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="flex items-center gap-4">
        <SyncIndicator />
      </div>
    </header>
  );
}
