import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { parseLengthFeet, formatLengthFeet } from '@/lib/ironsightCatalogRow';

// A length typed the way it's written on a drawing: 20'-6 1/2", 20' 6-1/2",
// 6 1/2" (inches), 246.5" or a plain number (feet). Shows what it read
// underneath while typing; saves on Enter / leaving the box. value and
// onCommit are decimal feet.
export default function LengthFtInInput({ value, onCommit, disabled, className, placeholder = `20'-6 1/2"`, ariaLabel = 'Length (ft-in)' }) {
  const shown = Number(value) > 0 ? formatLengthFeet(value) : '';
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (!editing) setText(shown); }, [shown, editing]);

  const parsed = text.trim() ? parseLengthFeet(text) : 0;
  const commit = () => {
    setEditing(false);
    if (parsed == null) { setText(shown); return; }
    if (Math.abs((parsed || 0) - (Number(value) || 0)) > 1e-9) onCommit?.(parsed || 0);
  };

  return (
    <div className="min-w-[110px]">
      <Input
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={() => setEditing(true)}
        onChange={(e) => { setEditing(true); setText(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setText(shown); setEditing(false); e.currentTarget.blur(); }
        }}
        className={cn('h-8 font-mono', parsed == null && 'border-destructive', className)}
      />
      {editing && text.trim() && (
        <p className={cn('text-[10px] mt-0.5 whitespace-nowrap', parsed == null ? 'text-destructive' : 'text-muted-foreground')}>
          {parsed == null ? `Can't read that — e.g. 20'-6 1/2"` : `= ${formatLengthFeet(parsed)}`}
        </p>
      )}
    </div>
  );
}
