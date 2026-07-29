import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopBar from './TopBar';
import NavBar from './NavBar';
import SubscriptionGate from './SubscriptionGate';
import { base44 } from '@/api/base44Client';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';

export default function AppLayout() {
  const location = useLocation();
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(null);
  const [effectiveCompany, setEffectiveCompany] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('steelos-dark');
    if (saved !== null) setDarkMode(saved === 'true');
    else setDarkMode(true);
    loadUser();
  }, [location.pathname]);

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
      const me = await base44.auth.me();
      setUser(me);
      const company = await getEffectiveCompany();
      setEffectiveCompany(company);
    } catch (e) {}
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