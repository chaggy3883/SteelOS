import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopBar from './TopBar';
import NavBar from './NavBar';
import SubscriptionGate from './SubscriptionGate';
import { db } from '@/api/apiClient';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { getStoredSessionLogId, startUserSession, sendHeartbeat } from '@/lib/userSessionTracking';

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export default function AppLayout() {
  const location = useLocation();
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(null);
  const [effectiveCompany, setEffectiveCompany] = useState(null);
  const sessionEnsuredRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem('steelos-dark');
    if (saved !== null) setDarkMode(saved === 'true');
    else setDarkMode(true);
    loadUser();
  }, [location.pathname]);

  // Runs once for this tab's lifetime, independent of the loadUser effect
  // above (which only re-fires on route change) — sendHeartbeat() itself
  // is a no-op until a session row actually exists, so it's safe to start
  // this before loadUser's first pass has resolved. Re-running loadUser on
  // the same tick catches a terminated employee's session even if they never
  // navigate away (e.g. a kiosk tablet sitting on one page all shift) —
  // db.auth.me() re-validates a linked employee's active status on every
  // call, so this is what makes the "still valid in localStorage but
  // terminated since" case self-correct within one heartbeat interval.
  useEffect(() => {
    const interval = setInterval(() => {
      sendHeartbeat();
      loadUser();
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('steelos-dark', darkMode);
  }, [darkMode]);

  const loadUser = async () => {
    try {
      const me = await db.auth.me();
      setUser(me);
      const company = await getEffectiveCompany();
      setEffectiveCompany(company);

      // Covers landing here already-authenticated without going through
      // Login.jsx's own startUserSession call (a direct URL, or a second
      // tab on a browser that's already logged in via shared localStorage
      // auth state) — guarded so it only ever attempts once per tab.
      if (!sessionEnsuredRef.current) {
        sessionEnsuredRef.current = true;
        if (!getStoredSessionLogId()) {
          await startUserSession(me);
        }
      }
    } catch (e) {
      // db.auth.me() throws this the moment it detects the session's linked
      // employee is no longer active (termination or is_active flip) — a
      // full-page redirect discards every piece of in-memory app state, not
      // just the auth token. Login.jsx reads and displays the message.
      if (e?.reason === 'employee_deactivated') {
        window.location.href = '/login';
      }
    }
  };

  // Super-admin dashboard must always be reachable, even while impersonating
  // a tenant whose subscription is blocked — otherwise there's no way back.
  // A super_admin viewing their own platform-operator session (not
  // impersonating anyone) has no tenant to gate; once they impersonate a
  // blocked tenant, the gate applies to them too, so support can verify
  // exactly what that customer sees.
  const gateExempt = location.pathname.startsWith('/super-admin');
  const isPlatformOperatorView = isSuperAdmin(user) && !isImpersonating();
  const isBlocked = !gateExempt && !!user && !isPlatformOperatorView && effectiveCompany
    && ['Past_Due', 'Inactive'].includes(effectiveCompany.subscription_status);

  if (isBlocked) {
    return <SubscriptionGate companyName={effectiveCompany.name} onExitImpersonation={loadUser} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background print:h-auto print:overflow-visible">
      <TopBar darkMode={darkMode} setDarkMode={setDarkMode} user={user} company={effectiveCompany} onImpersonationChange={loadUser} />
      <NavBar />
      <main className="flex-1 overflow-y-auto scrollbar-thin min-w-0 print:overflow-visible print:flex-none">
        <Outlet context={{ user }} />
      </main>
    </div>
  );
}