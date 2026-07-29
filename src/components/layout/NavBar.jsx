import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { getUserPermissions, isModuleAllowed } from '@/components/dashboard/rbacConfig';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem
} from '@/components/ui/dropdown-menu';
import {
  Calculator, FolderKanban, Brain, Building2,
  ShoppingCart, Package, Factory, Truck, CheckSquare, Shield, Wrench,
  FileText, MessageSquare, BarChart3, DollarSign, Users, Settings,
  ShieldCheck, ChevronDown, Zap, House, Scale, ClipboardList, PackageCheck,
  Globe, Handshake, UserCog, Gauge, KeyRound, ShieldAlert, HardHat
} from 'lucide-react';

const navGroups = [
  {
    label: 'Estimating',
    items: [
      { icon: Calculator, label: 'Estimating', path: '/estimating' },
      { icon: BarChart3, label: 'Historical Analytics', path: '/estimating/analytics' },
      { icon: Building2, label: 'CRM', path: '/crm' },
      { icon: Brain, label: 'Intelligence', path: '/intelligence' },
    ]
  },
  {
    label: 'Core',
    items: [
      { icon: ShieldCheck, label: 'Admin Panel', path: '/admin' },
      { icon: Users, label: 'Users', path: '/users' },
      { icon: UserCog, label: 'Human Resources', path: '/human-resources' },
      { icon: KeyRound, label: 'Employee Center', path: '/employee-center' },
      { icon: Settings, label: 'Settings', path: '/settings' },
      { icon: ShieldAlert, label: 'Super Admin', path: '/super-admin/dashboard' },
      { icon: Zap, label: 'System Integrations', path: '/system-integrations' },
    ]
  },
  {
    label: 'Production & Project Management',
    items: [
      { icon: FolderKanban, label: 'Projects', path: '/projects' },
      { icon: Factory, label: 'Production', path: '/production' },
      { icon: Truck, label: 'Shipping', path: '/shipping' },
      { icon: Wrench, label: 'Shop Fabrication', path: '/shop-fabrication' },
      { icon: Gauge, label: 'Shop Operations', path: '/shop-operations' },
      { icon: HardHat, label: 'Field Operations', path: '/field-operations' },
    ]
  },
  {
    label: 'Purchasing & Procurement',
    items: [
      { icon: ShoppingCart, label: 'Purchasing', path: '/purchasing' },
      { icon: ClipboardList, label: 'Procurement Module', path: '/purchasing/module' },
      { icon: PackageCheck, label: 'Receiving Kiosk', path: '/purchasing/receiving-kiosk' },
    ]
  },
  {
    label: 'Accounting & Job Costing',
    items: [
      { icon: DollarSign, label: 'Accounting', path: '/accounting' },
      { icon: Scale, label: 'Legal & Contracts', path: '/legal' },
      { icon: BarChart3, label: 'Reports', path: '/reports' },
      { icon: Gauge, label: 'Executive Analytics', path: '/executive-analytics' },
    ]
  },
  {
    label: 'External Gateways',
    items: [
      { icon: Globe, label: 'Customer Portal', path: '/portal/login', query: '?type=customer' },
      { icon: Handshake, label: 'Vendor Portal', path: '/portal/login', query: '?type=vendor' },
    ]
  },
  {
    label: 'Inventory',
    items: [
      { icon: Package, label: 'Inventory', path: '/inventory' },
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
];

export default function NavBar() {
  const location = useLocation();
  const [allowedModules, setAllowedModules] = useState(['*']);
  const [openSection, setOpenSection] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await base44.auth.me();
        const perms = await getUserPermissions(u.roles || ['user']);
        setAllowedModules(perms.modules);
      } catch (e) {
        setAllowedModules(['*']);
      }
    })();
  }, []);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const hasActiveInGroup = (items) => items.some(item => isActive(item.path));

  return (
    <nav className="h-12 bg-card border-b border-border flex items-center px-2 sm:px-4 gap-1 overflow-x-auto scrollbar-thin flex-shrink-0 print:hidden">
      <Link to="/" className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
        isActive('/')
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}>
        <House className="w-4 h-4" />
        Home
      </Link>
      {navGroups.map((group) => {
        const filteredItems = group.items.filter(item => isModuleAllowed(item.path, allowedModules));
        if (filteredItems.length === 0) return null;
        const hasActive = hasActiveInGroup(filteredItems);
        return (
          <DropdownMenu key={group.label} onOpenChange={(open) => setOpenSection(open ? group.label : null)}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  hasActive ? 'bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
                style={hasActive ? { color: 'var(--tenant-brand-color, hsl(var(--primary)))' } : undefined}
              >
                {group.label}
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', openSection === group.label && 'rotate-180')} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {filteredItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <DropdownMenuItem key={item.path + (item.query || '')} asChild>
                    <Link
                      to={item.path + (item.query || '')}
                      className={cn('flex items-center gap-2.5 cursor-pointer', active && 'font-medium')}
                      style={active ? { color: 'var(--tenant-brand-color, hsl(var(--primary)))' } : undefined}
                    >
                      <Icon className={cn('w-4 h-4', !active && 'text-muted-foreground')} style={active ? { color: 'var(--tenant-brand-color, hsl(var(--primary)))' } : undefined} />
                      <span>{item.label}</span>
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