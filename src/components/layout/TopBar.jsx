import React, { useState, useEffect } from 'react';
import { Bell, Sun, Moon, ChevronDown, LogOut, Settings, Layers, ShieldAlert, Menu } from 'lucide-react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import GlobalSearchPalette from '@/components/search/GlobalSearchPalette';
import { isImpersonating, stopImpersonation } from '@/lib/tenantContext';
import { endUserSession } from '@/lib/userSessionTracking';

export default function TopBar({ darkMode, setDarkMode, user, company, onImpersonationChange, mobileNavOpen, onOpenMobileNav }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  // Depends on user?.id (not []) — AppLayout's own db.auth.me() call resolves
  // asynchronously, so on first mount `user` is still null. Firing this once
  // with an empty deps array would filter on user_id: undefined forever
  // (matching only legacy notifications that predate the user_id column).
  useEffect(() => {
    if (user?.id) loadNotifications();
  }, [user?.id]);

  // Co-branded chrome: the effective tenant's own logo/color, passed down
  // from AppLayout (which already resolves it per-route) rather than this
  // component fetching "whichever Company row happens to be first" — that
  // broke the moment a second tenant existed.
  useEffect(() => {
    if (company?.brand_color_hex) {
      document.documentElement.style.setProperty('--tenant-brand-color', company.brand_color_hex);
    }
  }, [company?.brand_color_hex]);

  const handleExitImpersonation = () => {
    stopImpersonation();
    onImpersonationChange?.();
    navigate('/super-admin/dashboard');
  };

  const loadNotifications = async () => {
    try {
      const items = await db.entities.Notification.filter(
        { user_id: user?.id, is_read: false }, '-created_date', 10
      );
      setNotifications(items);
      setUnreadCount(items.length);
    } catch (e) {}
  };

  const handleNotificationClick = async (notification) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await db.entities.Notification.update(notification.id, { is_read: true, read_date: new Date().toISOString() });
    } catch (e) {}
    if (notification.link) navigate(notification.link);
  };

  const handleLogout = async () => {
    // Must happen before logout() clears the auth token — db.auth.logout
    // navigates away synchronously right after, so this has to be awaited
    // here rather than left to race the redirect.
    await endUserSession();
    db.auth.logout('/login');
  };

  // Dynamic Brand Scale Injection — the saved logo_scale_pct drives the
  // header frame's own size (bounded to the header's real estate), separate
  // from logo_url's baked pixel dimensions: the image is already scaled at
  // the source, this just lets a bigger saved scale also render bigger here
  // instead of every tenant's logo looking identical in the header regardless
  // of what they picked in the Super-Admin dashboard. The CSS min() keeps
  // the same bound against the (now slimmer) header height.
  const logoScalePct = company?.logo_scale_pct || 100;
  const headerLogoSizePx = Math.min(60, Math.max(24, Math.round(40 * (logoScalePct / 100))));
  const headerLogoMaxHeight = `min(${headerLogoSizePx}px, calc(var(--header-height) - 0.75rem))`;

  return (
    <header className="h-header bg-card border-b border-border flex items-center gap-2 sm:gap-3 px-2 sm:px-4 flex-shrink-0 print:hidden">
      {/* Small screens: opens the navigation drawer */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenMobileNav}
        className="lg:hidden h-8 w-8"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={!!mobileNavOpen}
      >
        <Menu className="w-4 h-4" />
      </Button>

      {/* Logo */}
      <div className="flex items-center gap-2.5 flex-shrink-0 min-w-0">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <Layers className="w-4 h-4 text-primary-foreground" />
        </div>
        <div className="hidden sm:block leading-none">
          <span className="font-semibold text-[15px] tracking-tight text-foreground">Steel</span>
          <span className="font-semibold text-[15px] tracking-tight text-primary">OS</span>
        </div>
        {company?.logo_url && (
          <>
            <div className="hidden sm:block h-6 w-px bg-border flex-shrink-0" aria-hidden="true" />
            <div
              className="flex items-center justify-center p-0.5 rounded-md max-w-[240px] overflow-hidden flex-shrink-0"
              style={{ maxHeight: headerLogoMaxHeight }}
            >
              <img
                src={company.logo_url}
                alt={`${company.name} logo`}
                className="max-w-[240px] w-auto h-auto object-contain"
                style={{ maxHeight: headerLogoMaxHeight }}
              />
            </div>
          </>
        )}
      </div>

      {/* Global Search — Command Palette */}
      <div className="hidden sm:flex items-center flex-1 min-w-0 max-w-md ml-2 lg:ml-6">
        <GlobalSearchPalette />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1 ml-auto">
        {isImpersonating() && (
          <div className="hidden md:flex items-center gap-2 h-8 px-2.5 mr-1 rounded-md bg-warning/10 border border-warning/30 text-xs font-medium text-warning max-w-[18rem]">
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">Impersonating {company?.name || 'tenant'}</span>
            <button
              type="button"
              onClick={handleExitImpersonation}
              className="flex-shrink-0 underline underline-offset-2 hover:no-underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Exit
            </button>
          </div>
        )}

        {/* Dark mode */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDarkMode(!darkMode)}
          className="h-8 w-8"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 py-0 flex items-center justify-center text-[10px] leading-none bg-destructive text-destructive-foreground border-0 shadow-none hover:bg-destructive">
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[calc(100vw-16px)] sm:w-80">
            <div className="px-3 py-2 font-semibold text-sm border-b border-border">Notifications</div>
            {notifications.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">No new notifications</div>
            ) : (
              notifications.slice(0, 5).map((n) => (
                <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1 py-2.5 cursor-pointer" onClick={() => handleNotificationClick(n)}>
                  <span className="font-medium text-sm">{n.title}</span>
                  <span className="text-xs text-muted-foreground">{n.message}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 h-8 px-1.5 sm:px-2" aria-label={`Account menu for ${user?.full_name || 'User'}`}>
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-semibold" aria-hidden="true">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <span className="text-sm font-medium hidden md:block max-w-[10rem] truncate">{user?.full_name || 'User'}</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[calc(100vw-16px)] sm:w-56">
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate">{user?.full_name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="w-4 h-4 mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
