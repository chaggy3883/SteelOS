import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { PERMISSION_CATALOG, isCapabilityAllowed, toggleCapability } from '@/lib/permissionCatalog';
import { ShieldCheck, ChevronDown, ChevronRight, Lock } from 'lucide-react';

// Shared by both shop-floor workers (employees entity, driven from
// EmployeeProfileDialog.jsx) and office staff (User entity, driven from
// Users.jsx) — the two account types are otherwise unrelated (no employee_id
// link between them), but both use the same denylist shape and catalog, so
// this panel just needs to know which entity API to write through.
//
// Module-level toggles are enforced live (NavBar.jsx strips a disabled
// module from the nav on next load, for both session types). Employee
// Center's own tabs are enforced live for kiosk sessions; Human Resources'
// own tabs are enforced live for office sessions. Everywhere else, tab-level
// toggles are saved but not yet read by that page (ongoing rollout).
export default function PermissionsGridPanel({ subject, subjectType = 'employees', onUpdated }) {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState(subject.permission_overrides || []);
  const [expanded, setExpanded] = useState(new Set());
  const [savingKey, setSavingKey] = useState(null);

  const toggleExpanded = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleToggle = async (key, nextAllowed) => {
    const next = toggleCapability(overrides, key, nextAllowed);
    setOverrides(next);
    setSavingKey(key);
    try {
      const updated = await db.entities[subjectType].update(subject.id, { permission_overrides: next });
      onUpdated(updated);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="steel-card p-4">
      <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />Permissions Grid</h4>
      <p className="text-xs text-muted-foreground mb-3">
        Unchecking a module removes it from this account's navigation entirely. Employee Center's and Human Resources'
        own tabs are enforced live too — everywhere else, tab-level toggles are saved but not yet read by that page
        (ongoing rollout). Employee Center itself can't be disabled.
      </p>
      <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
        {PERMISSION_CATALOG.map((mod) => {
          const modAllowed = isCapabilityAllowed(overrides, mod.key);
          const hasTabs = mod.tabs && mod.tabs.length > 0;
          const isExpanded = expanded.has(mod.key);
          return (
            <div key={mod.key} className="border border-border/60 rounded-md">
              <div className="flex items-center gap-2 px-2 py-1.5">
                {hasTabs ? (
                  <button type="button" onClick={() => toggleExpanded(mod.key)} className="text-muted-foreground flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                ) : (
                  <span className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                <input
                  type="checkbox"
                  checked={modAllowed}
                  disabled={mod.locked || savingKey === mod.key}
                  onChange={(e) => handleToggle(mod.key, e.target.checked)}
                  className="flex-shrink-0"
                />
                <span className="text-sm flex-1">{mod.label}</span>
                {mod.locked && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0"><Lock className="w-3 h-3" />Always on</span>
                )}
              </div>
              {hasTabs && isExpanded && (
                <div className="pl-8 pb-1.5 space-y-1">
                  {mod.tabs.map((t) => {
                    const tabAllowed = isCapabilityAllowed(overrides, t.key);
                    return (
                      <label key={t.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={tabAllowed}
                          disabled={savingKey === t.key}
                          onChange={(e) => handleToggle(t.key, e.target.checked)}
                        />
                        {t.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
