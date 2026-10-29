import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/api/apiClient';
import { getUserPermissions, isModuleAllowed } from '@/components/dashboard/rbacConfig';
import { getEffectiveCompany, getImpersonatingCompanyId, isAdminUser, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { hasSalesmanRateAccess } from '@/lib/commissionAccess';
import { hasMaterialCatalogAccess } from '@/lib/materialCatalogAccess';
import { hasBidWorksheetRateAccess } from '@/lib/bidWorksheetRateAccess';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { HOME_ITEM, NAV_GROUPS, KIOSK_SESSION_HIDDEN_GROUPS, itemHref, itemKey } from './navConfig';
import { resolveActiveKey } from './navMatching';

const BRAND_INDICATOR = 'var(--tenant-brand-color, hsl(var(--primary)))';

const rolesOf = (u) => u?.roles || u?.user?.roles || ['user'];

// Mirrors TmLaborRatesAdmin.jsx's own ADMIN_ROLES guard.
const TM_LABOR_RATE_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin'];

// Page-level guards for items that set `access` in navConfig.js — each one
// calls the same helper the destination page uses, so a link never shows
// for a session the page would turn away. These only narrow the
// role/pack filters below; they never widen them.
const ITEM_ACCESS_CHECKS = {
  admin: (u) => isAdminUser(u),
  salesmanRates: (u) => hasSalesmanRateAccess(rolesOf(u)),
  tmLaborRates: (u) => {
    const roles = (u?.roles || u?.user?.roles || []).map((r) => String(r).toLowerCase());
    return isAdminUser(u) || TM_LABOR_RATE_ROLES.some((r) => roles.includes(r));
  },
  materialCatalog: (u) => hasMaterialCatalogAccess(rolesOf(u)),
  bidWorksheetRates: (u) => hasBidWorksheetRateAccess(rolesOf(u)),
};

// Same visibility inputs the old NavBar resolved: role modules (or '*'
// while impersonating), the company's module pack, the real-super_admin
// flag and the kiosk PIN flag. Re-resolved when the signed-in user or the
// impersonated tenant changes, so starting/stopping impersonation updates
// the nav without a reload. Nothing renders until the first pass resolves,
// so a limited role never sees a flash of every link.
function useNavVisibility(user) {
  const [access, setAccess] = useState(null);
  const [company, setCompany] = useState(null);
  const impersonatingId = getImpersonatingCompanyId();
  const refreshKey = `${user?.id || ''}|${(user?.roles || []).join(',')}|${impersonatingId || ''}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next;
      try {
        const u = await db.auth.me();
        // A tenant-level 'admin' role's allowed_modules is the wildcard '*',
        // which would otherwise pass isModuleAllowed() for
        // /super-admin/dashboard too — a company admin seeing a "Super Admin"
        // link at all leaks platform structure. Track the session's real
        // roles independently so that link is hidden for anyone who isn't an
        // actual super_admin operator.
        const isPlatformSuperAdmin = (u?.roles || []).map((r) => String(r).toLowerCase()).includes('super_admin');
        let allowedModules;
        // Direct Teleport Route: while impersonating a tenant a super_admin
        // needs that tenant's full workspace nav, not their own
        // operator-only module list.
        if (isImpersonating()) {
          allowedModules = ['*'];
        } else {
          // Roles are the sole source of truth for module access.
          const perms = await getUserPermissions(u.roles || ['user']);
          allowedModules = perms.modules;
        }
        // is_kiosk_pin_session (not employee_id alone) is the shared-terminal
        // signal: a portal (email/password) login can also carry employee_id
        // and must keep its real role's nav.
        next = { me: u, allowedModules, isPlatformSuperAdmin, isKioskSession: !!u?.is_kiosk_pin_session };
      } catch (e) {
        next = { me: null, allowedModules: ['*'], isPlatformSuperAdmin: false, isKioskSession: false };
      }
      let nextCompany = null;
      try {
        nextCompany = await getEffectiveCompany();
      } catch (e) {
        nextCompany = null;
      }
      if (!cancelled) {
        setCompany(nextCompany);
        setAccess(next);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return useMemo(() => {
    if (!access) return { ready: false, groups: [] };
    // Module pack enforcement: a nav item never renders as a link to a
    // module the company's pack doesn't grant (modulePacks.js is the one
    // place that mapping lives).
    const groups = NAV_GROUPS
      .filter((group) => !access.isKioskSession || !KIOSK_SESSION_HIDDEN_GROUPS.includes(group.label))
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          isModuleAllowed(item.path, access.allowedModules) &&
          (!item.superAdminOnly || access.isPlatformSuperAdmin) &&
          hasModule(company, item.moduleKey || item.path) &&
          (!item.access || ITEM_ACCESS_CHECKS[item.access]?.(access.me) === true)
        ),
      }))
      .filter((group) => group.items.length > 0);
    return { ready: true, groups };
  }, [access, company]);
}

function NavItemLink({ item, active, onNavigate }) {
  const Icon = item.icon;
  return (
    <Link
      to={itemHref(item)}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 h-8 pl-3 pr-2 rounded-md text-[13px] leading-none transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active
          ? 'bg-sidebar-active-bg text-sidebar-active font-medium'
          : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-foreground'
      )}
    >
      {active && (
        <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm" style={{ background: BRAND_INDICATOR }} />
      )}
      <Icon className={cn('w-4 h-4 shrink-0', !active && 'text-sidebar-muted')} aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

// Expanded tree: Home, then collapsible groups (with optional sub-section
// headings). Used by the desktop sidebar and the mobile drawer alike.
function ExpandedNav({ groups, activeKey, openGroups, onToggleGroup, onNavigate, idPrefix }) {
  return (
    <ul className="space-y-0.5" role="list">
      <li>
        <NavItemLink item={HOME_ITEM} active={activeKey === itemKey(null, HOME_ITEM)} onNavigate={onNavigate} />
      </li>
      {groups.map((group) => {
        const open = openGroups.has(group.id);
        const containsActive = group.items.some((item) => itemKey(group, item) === activeKey);
        const listId = `${idPrefix}-group-${group.id}`;
        let lastSection = null;
        return (
          <li key={group.id} className="pt-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => onToggleGroup(group.id)}
              className={cn(
                'group/toggle w-full flex items-center gap-1.5 h-7 px-2 rounded-md text-left text-xs font-semibold transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                containsActive && !open ? 'text-sidebar-active' : 'text-sidebar-muted hover:text-foreground'
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className={cn('w-3.5 h-3.5 shrink-0 transition-transform duration-fast', open && 'rotate-90')}
              />
              <span className="truncate" title={group.label}>{group.label}</span>
            </button>
            {open && (
              <ul id={listId} role="list" className="mt-0.5 space-y-0.5">
                {group.items.map((item) => {
                  const key = itemKey(group, item);
                  const showSection = item.section && item.section !== lastSection;
                  lastSection = item.section || null;
                  return (
                    <React.Fragment key={key}>
                      {showSection && (
                        <li role="presentation" className="pt-2 pb-1 pl-3 text-2xs font-semibold uppercase tracking-wider text-sidebar-muted">
                          {item.section}
                        </li>
                      )}
                      <li>
                        <NavItemLink item={item} active={activeKey === key} onNavigate={onNavigate} />
                      </li>
                    </React.Fragment>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Icon rail: Home plus one button per group; each opens a flyout menu of
// that group's links. Labels are exposed through tooltips and aria-labels.
function CollapsedNav({ groups, activeKey }) {
  const homeActive = activeKey === itemKey(null, HOME_ITEM);
  const railButton = (active) => cn(
    'relative flex items-center justify-center w-9 h-9 mx-auto rounded-md transition-colors duration-fast',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'bg-sidebar-active-bg text-sidebar-active' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-foreground'
  );
  const indicator = (
    <span aria-hidden="true" className="absolute -left-[0.625rem] top-2 bottom-2 w-[3px] rounded-r-sm" style={{ background: BRAND_INDICATOR }} />
  );
  const HomeIcon = HOME_ITEM.icon;
  return (
    <ul className="space-y-1" role="list">
      <li>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={itemHref(HOME_ITEM)}
              aria-label={HOME_ITEM.label}
              aria-current={homeActive ? 'page' : undefined}
              className={railButton(homeActive)}
            >
              {homeActive && indicator}
              <HomeIcon className="w-4 h-4" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{HOME_ITEM.label}</TooltipContent>
        </Tooltip>
      </li>
      {groups.map((group) => {
        const GroupIcon = group.icon;
        const containsActive = group.items.some((item) => itemKey(group, item) === activeKey);
        let lastSection = null;
        return (
          <li key={group.id}>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={group.label} className={railButton(containsActive)}>
                      {containsActive && indicator}
                      <GroupIcon className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">{group.label}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" className="w-60">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
                {group.items.map((item) => {
                  const key = itemKey(group, item);
                  const active = key === activeKey;
                  const Icon = item.icon;
                  const showSection = item.section && item.section !== lastSection;
                  lastSection = item.section || null;
                  return (
                    <React.Fragment key={key}>
                      {showSection && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-2xs uppercase tracking-wider text-muted-foreground">{item.section}</DropdownMenuLabel>
                        </>
                      )}
                      <DropdownMenuItem asChild>
                        <Link
                          to={itemHref(item)}
                          aria-current={active ? 'page' : undefined}
                          className={cn('flex items-center gap-2.5 cursor-pointer', active && 'font-semibold')}
                        >
                          <Icon className="w-4 h-4" aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    </React.Fragment>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}

export default function AppSidebar({ user, collapsed, onToggleCollapsed, mobileOpen, onMobileOpenChange }) {
  const location = useLocation();
  const { ready, groups } = useNavVisibility(user);
  const [openGroups, setOpenGroups] = useState(() => new Set());

  const activeKey = useMemo(() => {
    const entries = [{ key: itemKey(null, HOME_ITEM), item: HOME_ITEM }];
    groups.forEach((group) => group.items.forEach((item) => entries.push({ key: itemKey(group, item), item })));
    return resolveActiveKey(entries, location.pathname, location.search);
  }, [groups, location.pathname, location.search]);

  const activeGroupId = useMemo(
    () => groups.find((group) => group.items.some((item) => itemKey(group, item) === activeKey))?.id || null,
    [groups, activeKey]
  );

  // The group holding the current route opens on load, refresh, direct URL
  // and every navigation; groups the user opened stay open.
  useEffect(() => {
    if (!activeGroupId) return;
    setOpenGroups((prev) => (prev.has(activeGroupId) ? prev : new Set(prev).add(activeGroupId)));
  }, [activeGroupId]);

  // The mobile drawer closes on any navigation (including back/forward).
  useEffect(() => {
    onMobileOpenChange?.(false);
  }, [location.pathname, location.search]);

  const toggleGroup = (id) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* Desktop: in-flow column (not fixed), so it never covers content
          and IRONSIGHT's fixed workspace still layers above it. */}
      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        className={cn(
          'hidden lg:flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border print:hidden',
          'transition-[width] duration-base ease-standard',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
        )}
      >
        <nav aria-label="Primary" aria-busy={!ready} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin py-3 px-2">
          {ready && (collapsed
            ? <CollapsedNav groups={groups} activeKey={activeKey} />
            : <ExpandedNav groups={groups} activeKey={activeKey} openGroups={openGroups} onToggleGroup={toggleGroup} idPrefix="sidebar" />
          )}
        </nav>
        <div className="border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex items-center gap-2 h-8 rounded-md text-xs text-sidebar-muted hover:bg-sidebar-hover hover:text-foreground transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed ? 'w-9 mx-auto justify-center' : 'w-full px-2.5'
            )}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" aria-hidden="true" /> : <PanelLeftClose className="w-4 h-4" aria-hidden="true" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Small screens: off-canvas drawer opened from the top bar's menu
          button. Radix Dialog underneath gives focus trap, Esc and
          scroll lock. */}
      <Sheet open={!!mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="max-w-[85vw] sm:max-w-[85vw] p-0 flex flex-col gap-0 border-sidebar-border lg:hidden"
          style={{ width: 'var(--sidebar-width)', backgroundColor: 'hsl(var(--sidebar-bg))' }}
        >
          <div className="h-header flex items-center px-4 border-b border-sidebar-border shrink-0">
            <SheetTitle className="text-sm font-semibold">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main navigation for SteelOS</SheetDescription>
          </div>
          <nav aria-label="Primary" aria-busy={!ready} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin py-3 px-2">
            {ready && (
              <ExpandedNav
                groups={groups}
                activeKey={activeKey}
                openGroups={openGroups}
                onToggleGroup={toggleGroup}
                onNavigate={() => onMobileOpenChange?.(false)}
                idPrefix="drawer"
              />
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
