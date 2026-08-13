import React from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWidgetById } from '@/components/dashboard/rbacConfig';
import WidgetContent from '@/components/dashboard/widgetContent';

export default function DashboardWidget({ widgetId, customizing, size, sizeOptions = ['1x1', '2x2', '3x2'], onRemove, onResize }) {
  const widget = getWidgetById(widgetId);
  if (!widget) return <div className="p-3 text-xs text-muted-foreground">Unknown widget</div>;
  const Icon = widget.icon;
  return (
    <div className={cn(
      'relative h-full flex flex-col bg-card border rounded-lg overflow-hidden transition-shadow',
      customizing && 'ring-2 ring-primary/30',
      !customizing && widget.route && 'hover:shadow-md hover:bg-muted/10'
    )}>
      {customizing && (
        <button
          onClick={onRemove}
          title="Remove widget"
          className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1 z-50 animate-fade-in"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      <div className="flex items-center px-3 py-2 border-b border-border bg-muted/30">
        {customizing || !widget.route ? (
          <div className="flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold">{widget.name}</span>
          </div>
        ) : (
          <Link to={widget.route} className="flex items-center gap-2 hover:underline decoration-primary/50 underline-offset-2 min-h-[24px]" title={`Open ${widget.name} directory`}>
            <Icon className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold">{widget.name}</span>
          </Link>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3">
        <WidgetContent widgetId={widgetId} />
      </div>

      {customizing && (
        <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-t border-border bg-muted/30">
          <span className="text-[10px] text-muted-foreground mr-auto">Size</span>
          {sizeOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => onResize?.(opt)}
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors',
                size === opt
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border text-muted-foreground hover:border-primary hover:text-foreground'
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
