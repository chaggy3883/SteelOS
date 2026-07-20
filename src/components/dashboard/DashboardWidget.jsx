import React from 'react';
import { X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWidgetById } from '@/components/dashboard/rbacConfig';
import WidgetContent from '@/components/dashboard/widgetContent';

export default function DashboardWidget({ widgetId, customizing, onRemove }) {
  const widget = getWidgetById(widgetId);
  if (!widget) return <div className="p-3 text-xs text-muted-foreground">Unknown widget</div>;
  const Icon = widget.icon;
  return (
    <div className={cn('h-full flex flex-col bg-card border rounded-lg overflow-hidden', customizing && 'ring-2 ring-primary/30')}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          {customizing && <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab" />}
          <Icon className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold">{widget.name}</span>
        </div>
        {customizing && (
          <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded hover:bg-destructive/10">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">
        <WidgetContent widgetId={widgetId} />
      </div>
    </div>
  );
}