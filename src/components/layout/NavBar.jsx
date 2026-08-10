import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { db } from '@/api/apiClient';
import { getUserPermissions, isModuleAllowed } from '@/components/dashboard/rbacConfig';
import { getEffectiveCompany, isImpersonating } from '@/lib/tenantContext';
import { isCapabilityAllowed } from '@/lib/permissionCatalog';
import { isErectPlan } from '@/lib/planGating';

const ERECT_PLAN_HIDDEN_PATHS = ['/shop-fabrication', '/shop-operations', '/shop-efficiency'];
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem
} from '@/components/ui/dropdown-menu';
import {
  Calculator, FolderKanban, Brain, Building2,
  ShoppingCart, Package, Factory, Truck, CheckSquare, Shield, Wrench,
  FileText, MessageSquare, BarChart3, DollarSign, Users, Settings,
  ShieldCheck, ChevronDown, Zap, House, Scale, ClipboardList, PackageCheck,
  Globe, Handshake, UserCog, Gauge, KeyRound, ShieldAlert, HardHat, FileSearch, FileEdit, FileSignature
} from 'lucide-react';

const navGroups = [
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
    label: 'Estimating',
    items: [
      { icon: Calculator, label: 'Estimating', path: '/estimating' },
      { icon: BarChart3, label: 'Historical Analytics', path: '/estimating/analytics' },
      { icon: FileSearch, label: 'Front-End Spec Review', path: '/estimating/spec-review' },
      { icon: PackageCheck, label: 'Blueprint Takeoff', path: '/estimating/blueprint-takeoff' },
      { icon: Building2, label: 'CRM', path: '/crm' },
      { icon: Users, label: 'Relationship Manager', path: '/crm/directory' },
      { icon: Brain, label: 'Intelligence', path: '/intelligence' },
      { icon: MessageSquare, label: 'RFIs', path: '/rfis' },
    ]
  },
  {
    label: 'Production & Project Management',
    items: [
      { icon: FolderKanban, label: 'Projects', path: '/projects' },
      { icon: FileEdit, label: 'Change Orders', path: '/projects/change-orders' },
      { icon: FileSignature, label: 'Subcontracts', path: '/subcontracts' },
      { icon: Factory, label: 'Production', path: '/production' },
      { icon: Truck, label: 'Shipping', path: '/shipping' },
      { icon: Wrench, label: 'Shop Fabrication', path: '/shop-fabrication' },
      { icon: Gauge, label: 'Shop Operations', path: '/shop-operations' },
      { icon: Gauge, label: 'Shop Efficiency', path: '/shop-efficiency' },
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
      { icon: Globe, label: 'Customer Portal Setup', path: '/admin', query: '?tab=integrations' },
      { icon: Handshake, label: 'Vendor Portal Setup', path: '/admin', query: '?tab=crm' },
      { icon: ShieldCheck, label: 'Portal Access Links', path: '/admin', query: '?tab=integrations' },
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
    ]
  },
];

// Sandboxed Kiosk Navigation Block — an Employee-PIN session (the local
// auth mock's synthetic session from loginViaEmployeePin, identified by employee_id)
// is a shared shop-floor terminal identity, not a real app account. Its
// 'user' role still legitimately grants /inventory and /documents for
// non-kiosk general users, so this can't be fixed in rbacConfig — it's
// hard-removed here by group label regardless of role-derived modules.
const KIOSK_SESSION_HIDDEN_GROUPS = ['Inventory', 'Quality & Safety'];

export default function NavBar() {
  const location = useLocation();
  const [allowedModules, setAllowedModules] = useState(['*']);
  const [openSection, setOpenSection] = useState(null);
  const [erectPlan, setErectPlan] = useState(false);
  const [isKioskSession, setIsKioskSession] = useState(false);
  const [isPlatformSuperAdmin, setIsPlatformSuperAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await db.auth.me();
        // A tenant-level 'admin' role's allowed_modules is the wildcard '*'
        // (see BUILTIN_ROLES in rbacConfig.jsx), which would otherwise pass
        // isModuleAllowed() for /super-admin/dashboard too — that's a nav
        // link, not real access (SuperAdminDashboard.jsx itself still gates
        // on this same roles check), but a company admin seeing a "Super
        // Admin" link at all leaks platform structure they have no business
        // knowing about. Track the session's real roles independently of
        // the derived module list so that link can be hidden unconditionally
        // for anyone who isn't an actual super_admin operator.
        setIsPlatformSuperAdmin((u?.roles || []).map((r) => String(r).toLowerCase()).includes('super_admin'));
        // Direct Teleport Route: a super_admin's own role only allows
        // /super-admin/dashboard — while impersonating a tenant they need
        // that tenant's full workspace nav, not their own operator-only
        // module list, or "Log into Instance" lands on a nav with nothing in it.
        if (isImpersonating()) {
          setAllowedModules(['*']);
        } else {
          const perms = await getUserPermissions(u.roles || ['user']);
          let modules = perms.modules;
          // Per-account Permissions Grid (permissionCatalog.js): an
          // individual account's module-level overrides narrow their role's
          // modules further. Kiosk/employee-PIN sessions store overrides on
          // the employees row (/employee-center itself is never
          // disable-able there); office sessions ARE the User row already
          // returned by me(), no separate fetch needed.
          if (u?.employee_id) {
            try {
              const emp = await db.entities.employees.get(u.employee_id);
              const overrides = emp?.permission_overrides || [];
              modules = modules.filter((path) => path === '/employee-center' || isCapabilityAllowed(overrides, `module:${path}`));
            } catch (e) {}
          } else {
            const overrides = u?.permission_overrides || [];
            modules = modules.filter((path) => isCapabilityAllowed(overrides, `module:${path}`));
          }
          setAllowedModules(modules);
        }
        setIsKioskSession(!!u?.employee_id);
      } catch (e) {
        setAllowedModules(['*']);
      }
    })();
    getEffectiveCompany().then((company) => setErectPlan(isErectPlan(company))).catch(() => setErectPlan(false));
  }, []);

  // Absolute Plan Tabs Enforcement: SteelOS_Erect is erection-only — Shop
  // Fabrication/Shop Operations are hard-removed from the nav, not just
  // permission-gated, since Field Operations already covers this plan's
  // fleet/erection workflow in their place.
  const visibleNavGroups = (erectPlan
    ? navGroups.map((group) => ({ ...group, items: group.items.filter((item) => !ERECT_PLAN_HIDDEN_PATHS.includes(item.path)) }))
    : navGroups
  ).filter((group) => !isKioskSession || !KIOSK_SESSION_HIDDEN_GROUPS.includes(group.label));

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
      {visibleNavGroups.map((group) => {
        const filteredItems = group.items.filter(item =>
          isModuleAllowed(item.path, allowedModules) &&
          (item.path !== '/super-admin/dashboard' || isPlatformSuperAdmin)
        );
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
                  <DropdownMenuItem key={item.label} asChild>
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