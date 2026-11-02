import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// A displayed number you can click to see how it was computed (the project's
// drill-down rule): the value renders as a dotted-underline button and the
// popover lists the math lines, top to bottom, the way they were worked out.
export default function MathDrill({ value, title, lines = [], className, align = 'end' }) {
  const shown = (lines || []).filter((l) => l != null && l !== '');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('font-mono underline decoration-dotted underline-offset-2 hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm', className)}
          title="Show how this was calculated"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-96 max-w-[90vw] p-3">
        {title && <p className="text-xs font-semibold mb-1.5">{title}</p>}
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">No calculation for this value.</p>
        ) : (
          <ol className="space-y-1">
            {shown.map((line, i) => (
              <li key={i} className="text-[11px] font-mono leading-snug break-words">{line}</li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
