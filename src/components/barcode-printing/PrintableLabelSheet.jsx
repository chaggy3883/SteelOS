import React from 'react';
import { QrCode, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrintableLabelSheet({ open, onClose, onPrinted, size, title, subtitle, qrPayload }) {
  if (!open) return null;

  // `afterprint` fires whether the user completes or cancels the OS print
  // dialog, so it can't tell us a label actually came out of the printer —
  // and it doesn't fire at all in some environments. The click on "Print via
  // Browser" is the only unambiguous signal this app has, so that's what
  // marks the job Printed.
  const handlePrintClick = () => {
    onPrinted?.();
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col print:static print:inset-auto">
      <style>{`@media print { @page { size: ${size.widthIn}in ${size.heightIn}in; margin: 0; } }`}</style>

      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0 print:hidden">
        <div>
          <h3 className="font-semibold">Label Preview — {size.label}</h3>
          <p className="text-xs text-muted-foreground">Confirm the layout, then send it to the browser print dialog.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handlePrintClick} className="gap-2 steel-gradient text-white border-0">
            <Printer className="w-4 h-4" />Print via Browser
          </Button>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 print:p-0 bg-muted/30 print:bg-white">
        <div
          className="border-2 border-foreground print:border-black rounded-md flex flex-col items-center justify-center gap-2 p-4 bg-background print:bg-white"
          style={{ width: `${size.widthIn}in`, height: `${size.heightIn}in` }}
        >
          <p className="font-bold text-lg text-center leading-tight">{title}</p>
          <p className="text-xs text-center text-muted-foreground print:text-black leading-tight">{subtitle}</p>
          <QrCode className="w-16 h-16 flex-shrink-0" />
          <p className="font-mono text-[10px] text-center break-all px-2">{qrPayload}</p>
        </div>
      </div>
    </div>
  );
}
