import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { getUserPermissions, isModuleAllowed } from '@/components/dashboard/rbacConfig';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, Calculator, FolderKanban, Brain, Building2,
  ShoppingCart, Package, Factory, Truck, CheckSquare, Shield, Wrench,
  FileText, MessageSquare, BarChart3, DollarSign, Users, Settings,
  ShieldCheck, ChevronDown, Zap
} from 'lucide-react';

const navGroups = [
  {
    label: 'Core',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
      { icon: Calculator, label: 'Estimating', path: '/estimating' },
      { icon: FolderKanban, label: 'Projects', path: '/projects' },
      { icon: Brain, label: 'Intelligence', path: '/intelligence' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { icon: Building2, label: 'CRM', path: '/crm' },
      { icon: ShoppingCart, label: 'Purchasing', path: '/purchasing' },
      { icon: Package, label: 'Inventory', path: '/inventory' },
      { icon: Factory, label: 'Production', path: '/production' },
      { icon: Wrench, label: 'Shop Fabrication', path: '/shop-fabrication' },
      { icon: Truck, label: 'Shipping', path: '/shipping' },
    ]
  },
  {
    label: 'Quality & Safety',
    items: [
      { icon: CheckSquare, label: 'Quality', path: '/quality' },
      { icon: Shield, label: 'Safety', path: '/safety' },
      { icon: FileText, label: 'Documents', path: '/documents' },
      { icon: MessageSquare, label: 'RFIs', path: '/rfis' },
    ]
  },
  {
    label: 'Finance & Reports',
    items: [
      { icon: BarChart3, label: 'Cost Analytics', path: '/estimating/analytics' },
      { icon: DollarSign, label: 'Accounting', path: '/accounting' },
      { icon: BarChart3, label: 'Reports', path: '/reports' },
    ]
  },
  {
    label: 'System',
    items: [
      { icon: Users, label: 'Users', path: '/users' },
      { icon: Settings, label: 'Settings', path: '/settings' },
      { icon: ShieldCheck, label: 'Admin Panel', path: '/admin' },
    ]
  }
];

export default function NavBar() {
  const location = useLocation();
  const [allowedModules, setAllowedModules] = useState(['*']);
  const [openSection, setOpenSection] = useState(null);

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      const perms = await getUserPermissions(u.role || 'user');
      setAllowedModules(perms.modules);
    }).catch(() => {});
  }, []);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const hasActiveInGroup = (items) => items.some(item => isActive(item.path));

  return (
    <nav className="h-12 bg-card border-b border-border flex items-center px-2 sm:px-4 gap-1 overflow-x-auto scrollbar-thin flex-shrink-0">
      {navGroups.map((group) => {
        const filteredItems = group.items.filter(item => isModuleAllowed(item.path, allowedModules));
        if (filteredItems.length === 0) return null;
        const hasActive = hasActiveInGroup(filteredItems);
        return (
          <DropdownMenu key={group.label} onOpenChange={(open) => setOpenSection(open ? group.label : null)}>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                hasActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}>
                {group.label}
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', openSection === group.label && 'rotate-180')} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {filteredItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path} className={cn(
                      'flex items-center gap-2.5 cursor-pointer',
                      active && 'font-medium'
                    )}>
                      <Icon className={cn('w-4 h-4', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span className={cn(active ? 'text-primary' : '')}>{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
      <div className="ml-auto flex items-center gap-2 px-3 flex-shrink-0">
        <Zap className="w-3.5 h-3.5 text-blue-500 animate-pulse-ring" />
        <span className="text-xs text-blue-500 font-medium hidden sm:block">AI Active</span>
      </div>
    </nav>
  );
}