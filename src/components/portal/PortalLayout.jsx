import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPortalSession, portalLogout } from '@/lib/portalAuth';

export default function PortalLayout() {
  const navigate = useNavigate();
  const session = getPortalSession();

  const handleLogout = () => {
    portalLogout();
    navigate('/portal/login');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-sm">SteelOS External Portal</p>
              <p className="text-xs text-muted-foreground">{session?.orgName} · {session?.orgType === 'vendor' ? 'Vendor' : 'Customer'} Access</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="w-3.5 h-3.5 mr-1.5" />Log Out
          </Button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
