'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  TrendingUp,
  CalendarDays,
  ShoppingCart,
  Droplets,
  Table,
  Settings,
  RefreshCw,
  Shield,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Yield Report', href: '/yield', icon: TrendingUp },
  { name: 'Weekly Yield', href: '/weekly-yield', icon: CalendarDays },
  { name: 'Sales Report', href: '/sales', icon: ShoppingCart },
  { name: 'Tank Inventory', href: '/tanks', icon: Droplets },
  { name: 'Monthly Yield', href: '/monthly-yield', icon: Table },
];

const settingsNav = [
  { name: 'Data Audit', href: '/audit', icon: Shield },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapsed state
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-slate-900 transition-all duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-4">
        {!collapsed && (
          <h1 className="text-xl font-bold text-white truncate pl-2">Yield Rewind</h1>
        )}
        <button
          onClick={toggle}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors',
            collapsed && 'mx-auto'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        <div className="space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'flex items-center rounded-lg py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.name}</span>}
              </Link>
            );
          })}
        </div>

        {/* Settings Section */}
        <div className="mt-8 pt-4 border-t border-slate-700">
          {!collapsed && (
            <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Settings
            </p>
          )}
          {settingsNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'flex items-center rounded-lg py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.name}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700">
        {!collapsed && (
          <p className="text-xs text-slate-400 text-center">
            Refinery Analytics
          </p>
        )}
      </div>
    </div>
  );
}
