import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WIDGET_LIBRARY, isWidgetAllowed } from '@/components/dashboard/rbacConfig';
import { Plus } from 'lucide-react';

export default function AddWidgetDrawer({ open, onClose, allowedWidgets, currentWidgetIds, onAdd }) {
  const available = WIDGET_LIBRARY.filter(w =>
    (allowedWidgets.includes('*') || isWidgetAllowed(w.id, allowedWidgets)) &&
    !currentWidgetIds.includes(w.id)
  );
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-96 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Widget</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 mt-4">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No more widgets available for your role.</p>
          ) : available.map(w => {
            const Icon = w.icon;
            return (
              <button key={w.id} onClick={() => onAdd(w.id)}
                className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{w.name}</p>
                  <p className="text-xs text-muted-foreground">{w.description}</p>
                </div>
                <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-2" />
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}