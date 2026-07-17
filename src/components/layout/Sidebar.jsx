import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Brain, Users, ShoppingCart,
  Package, Factory, CheckSquare, Truck, DollarSign, BarChart3,
  Settings, ChevronLeft, ChevronRight, Zap, Building2,
  FileText, Shield, HardHat, MessageSquare, Layers, Calculator
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navGroups = [
  {
    label: 'CORE',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
      { icon: Calculator, label: 'Estimating', path: '/estimating' },
      { icon: FolderKanban, label: 'Projects', path: '/projects' },
      { icon: Brain, label: 'Intelligence', path: '/intelligence' },
    ]
  },
  {
    label: 'OPERATIONS',
    items: [
      { icon: Building2, label: 'CRM', path: '/crm' },
      { icon: ShoppingCart, label: 'Purchasing', path: '/purchasing' },
      { icon: Package, label: 'Inventory', path: '/inventory' },
      { icon: Factory, label: 'Production', path: '/production' },
      { icon: Truck, label: 'Shipping', path: '/shipping' },
    ]
  },
  {
    label: 'QUALITY & SAFETY',
    items: [
      { icon: CheckSquare, label: 'Quality', path: '/quality' },
      { icon: Shield, label: 'Safety', path: '/safety' },
      { icon: FileText, label: 'Documents', path: '/documents' },
      { icon: MessageSquare, label: 'RFIs', path: '/rfis' },
    ]
  },
  {
    label: 'FINANCE & REPORTS',
    items: [
      { icon: BarChart3, label: 'Cost Analytics', path: '/estimating/analytics' },
      { icon: DollarSign, label: 'Accounting', path: '/accounting' },
      { icon: BarChart3, label: 'Reports', path: '/reports' },
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { icon: Users, label: 'Users', path: '/users' },
      { icon: Settings, label: 'Settings', path: '/settings' },
    ]
  }
];

export default function Sidebar({ collapsed, setCollapsed }) {
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className={cn(
      'flex flex-col h-screen sidebar-bg border-r sidebar-border transition-all duration-300 relative z-20',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Logo */}
      <div className={cn(
        'flex items-center h-16 border-b sidebar-border px-4 flex-shrink-0',
        collapsed ? 'justify-center' : 'justify-between'
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg steel-gradient flex items-center justify-center flex-shrink-0">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-white font-bold text-lg tracking-tight">Steel</span>
              <span className="text-blue-400 font-bold text-lg tracking-tight">OS</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg steel-gradient flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" />
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-4 px-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <div className="px-2 mb-1">
                <span className="text-xs font-semibold tracking-widest text-gray-500">{group.label}</span>
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md mb-0.5 transition-all duration-150 group',
                    collapsed ? 'justify-center' : '',
                    active
                      ? 'bg-blue-500/15 text-blue-400'
                      : 'sidebar-fg sidebar-hover'
                  )}
                >
                  <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-blue-400' : '')} />
                  {!collapsed && (
                    <span className={cn('text-sm font-medium', active ? 'text-blue-400' : '')}>{item.label}</span>
                  )}
                  {active && !collapsed && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />
                  )}
                </Link>
              );
            })}
            {!collapsed && <div className="mt-3 border-t sidebar-border" />}
          </div>
        ))}
      </nav>

      {/* Collapse toggle for collapsed state */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center justify-center h-10 sidebar-fg hover:text-white transition-colors border-t sidebar-border"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* AI Indicator */}
      {!collapsed && (
        <div className="p-3 border-t sidebar-border">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/20">
            <Zap className="w-3.5 h-3.5 text-blue-400 animate-pulse-ring" />
            <span className="text-xs text-blue-400 font-medium">AI Intelligence Active</span>
          </div>
        </div>
      )}
    </aside>
  );
}