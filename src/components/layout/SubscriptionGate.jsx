import React from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isImpersonating, stopImpersonation } from '@/lib/tenantContext';

export default function SubscriptionGate({ companyName, onExitImpersonation }) {
  const impersonating = isImpersonating();

  const handleExit = () => {
    stopImpersonation();
    onExitImpersonation?.();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold">Subscription Inactive</h1>
        <p className="text-sm text-muted-foreground">
          Subscription inactive. Please contact system support or update payment methods to restore SteelOS access.
        </p>
        {companyName && <p className="text-xs text-muted-foreground font-mono">Tenant: {companyName}</p>}
        {impersonating && (
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExit}>
            <LogOut className="w-3.5 h-3.5" />Exit Impersonation
          </Button>
        )}
      </div>
    </div>
  );
}
