import React from 'react';
import { Ruler } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LABEL_STOCK_SIZES } from '@/lib/zplLabels';

const LABEL_TYPES = ['Piece_Mark', 'Material_Stock', 'Shipping_Manifest'];

export default function ThermalFormatDesigner({ selectedLabelType, onSelectLabelType }) {
  return (
    <div className="steel-card p-4">
      <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <Ruler className="w-4 h-4 text-primary" />Thermal Label Format
      </h4>
      <div className="grid gap-3 md:grid-cols-3">
        {LABEL_TYPES.map((type) => {
          const size = LABEL_STOCK_SIZES[type];
          const active = selectedLabelType === type;
          return (
            <button
              key={type}
              onClick={() => onSelectLabelType(type)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
              )}
            >
              <p className="text-sm font-medium">{type.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{size.label}</p>
              <div
                className="mt-2 border border-dashed border-muted-foreground/40 rounded"
                style={{ width: '100%', aspectRatio: `${size.widthIn} / ${size.heightIn}`, maxHeight: 48 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
