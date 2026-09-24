import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { db } from '@/api/apiClient';
import { runAnniversaryRenewalCheckForEmployee } from '@/lib/ptoEngine';
import { AUTH_STORAGE_KEY, getAuthState, flagSessionSwitchedMessage } from '@/api/localData';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState({});
  // What THIS tab last confirmed itself authenticated as — updated only
  // inside checkUserAuth, never from the storage-event handler directly, so
  // it always reflects a real db.auth.me() result rather than a guess parsed
  // off a single event's oldValue/newValue.
  const lastKnownUserIdRef = useRef(null);

  useEffect(() => {
    checkAppState();
  }, []);

  // Cross-tab session guard. The native `storage` event fires only in OTHER
  // tabs when AUTH_STORAGE_KEY changes (never in the tab that made the
  // change), which is what makes this safe to key off without a polling
  // loop. Without this, a tab left open across a logout/different-user-login
  // in another tab keeps rendering with the OLD session's user/company/role
  // held in memory (React Query caches, component state, everything)
  // indefinitely — there was previously no mechanism forcing a re-check
  // until this tab's own next navigation.
  useEffect(() => {
    let debounceTimer = null;

    const reconcile = () => {
      const knownUserId = lastKnownUserIdRef.current;
      // This tab had nothing authenticated to protect — no stale state at risk.
      if (!knownUserId) return;

      const currentUserId = getAuthState()?.user?.id || null;

      if (currentUserId === knownUserId) {
        // Settled back to the SAME account — e.g. another tab logged out and
        // straight back in as itself. Refresh quietly (updated token/profile
        // fields) rather than forcing a disruptive reload.
        checkUserAuth();
        return;
      }

      // The browser's session now belongs to a different user (or none at
      // all) than what this tab last rendered. Every in-memory result here
      // was built against the OLD session and can't be trusted to still
      // reflect the right permissions/data — force a redirect to /login so
      // nothing stale stays interactive, rather than trying to patch every
      // cache and component in place.
      flagSessionSwitchedMessage(
        currentUserId
          ? 'Your session changed in another tab. Please sign in again.'
          : 'You were signed out in another tab.'
      );
      window.location.assign('/login');
    };

    const handleStorageChange = (event) => {
      if (event.key !== AUTH_STORAGE_KEY) return;
      // Debounce so a rapid logout-then-login-as-the-same-user in another tab
      // (two separate storage events) resolves against the FINAL state
      // instead of reacting to the momentary logged-out blip in between.
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(reconcile, 300);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearTimeout(debounceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs exactly once per fresh seed — before any grants exist, PtoBalance
  // rows sit at 0h for every demo employee until the anniversary check
  // catches them up (see ptoEngine.js). That check is otherwise only
  // triggered from HumanResources.jsx (current user's own company) and
  // Employee Center login (one employee at a time), so a brand-new seed
  // could sit at 0h across the board until someone happens to visit those
  // specific pages for every company. Running it here, once, for every
  // employee across every company, means the very first page anyone lands
  // on already shows real accrued balances. Guarded on PtoTransaction being
  // empty so this never re-runs (and never fights) once real usage exists —
  // subsequent renewals still flow through the per-page checks as before.
  const seedInitialPtoBalances = async () => {
    try {
      const existingTransactions = await db.entities.PtoTransaction.list('-created_date', 1);
      if (existingTransactions.length > 0) return;
      const allEmployees = await db.entities.employees.filter({ is_active: true }, 'full_name', 1000);
      for (const employee of allEmployees) {
        await runAnniversaryRenewalCheckForEmployee(employee);
      }
    } catch (error) {
      console.error('Initial PTO balance seed failed:', error);
    }
  };

  const checkAppState = async () => {
    setIsLoadingPublicSettings(true);
    setAuthError(null);

    try {
      setAppPublicSettings({ id: 'local', public_settings: {} });
      await seedInitialPtoBalances();
      await checkUserAuth();
    } catch (error) {
      console.error('App state check failed:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'Failed to load app'
      });
    } finally {
      setIsLoadingPublicSettings(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await db.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthChecked(true);
      lastKnownUserIdRef.current = currentUser?.id || null;
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsAuthenticated(false);
      setUser(null);
      setAuthChecked(true);
      setAuthError(null);
      lastKnownUserIdRef.current = null;
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    db.auth.logout(shouldRedirect ? window.location.href : '');
  };

  const navigateToLogin = () => {
    const currentPath = window.location.pathname;
    const authRoutes = ['/login', '/forgot-password', '/reset-password'];

    if (authRoutes.includes(currentPath)) {
      return;
    }

    window.location.assign('/login');
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
