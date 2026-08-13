import React from 'react';
import { Lock } from 'lucide-react';
import { packsIncludingModuleLabel } from '@/lib/modulePacks';

// Standard "not included in your pack" state — used at the route layer for
// pages/forms a company's pack doesn't grant (never a blank page, never a
// crash). Always names which pack(s) actually include the module so the
// message is actionable, not just a wall.
export default function ModuleLocked({ modulePath, title = 'Not Included In Your Pack', description }) {
  const packLabel = packsIncludingModuleLabel(modulePath);
  return (
    <div className="p-4 md:p-6">
      <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
        <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="font-semibold text-lg mb-1">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {description || 'This module isn\'t part of your company\'s current subscription.'}
          {packLabel && <> Included in the {packLabel} pack.</>}
        </p>
      </div>
    </div>
  );
}
