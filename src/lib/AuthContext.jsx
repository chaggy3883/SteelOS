import React, { createContext, useState, useContext, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { runAnniversaryRenewalCheckForEmployee } from '@/lib/ptoEngine';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState({});

  useEffect(() => {
    checkAppState();
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
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsAuthenticated(false);
      setUser(null);
      setAuthChecked(true);
      setAuthError(null);
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
