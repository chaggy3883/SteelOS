import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import TopBar from './TopBar';
import NavBar from './NavBar';
import { base44 } from '@/api/base44Client';

export default function AppLayout() {
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('steelos-dark');
    if (saved !== null) setDarkMode(saved === 'true');
    else setDarkMode(true);
    loadUser();
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
      const me = await base44.auth.me();
      setUser(me);
    } catch (e) {}
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <TopBar darkMode={darkMode} setDarkMode={setDarkMode} user={user} />
      <NavBar />
      <main className="flex-1 overflow-y-auto scrollbar-thin min-w-0">
        <Outlet context={{ user }} />
      </main>
    </div>
  );
}