import React, { useState } from 'react';
import { Printer, Terminal, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { buildZplPayload } from '@/lib/zplLabels';

export default function PrintTestKiosk({ selectedLabelType, onPrintTest }) {
  const { toast } = useToast();
  const [title, setTitle] = useState('TEST-BURN-001');
  const [subtitle, setSubtitle] = useState('Hardware test burn');
  const [zplPreview, setZplPreview] = useState('');

  const qrPayload = `QR-TESTBURN-${title.replace(/\s+/g, '')}`;

  const handlePrint = () => {
    onPrintTest({ labelType: selectedLabelType, title, subtitle, qrPayload });
  };

  const handleGenerateZpl = () => {
    setZplPreview(buildZplPayload({ labelType: selectedLabelType, title, subtitle, qrPayload }));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(zplPreview);
      toast({ title: 'ZPL payload copied to clipboard' });
    } catch (e) {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <div className="steel-card p-4">
      <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <Terminal className="w-4 h-4 text-primary" />Hardware Test Burn Kiosk
      </h4>
      <p className="text-xs text-muted-foreground mb-3">
        Runs a sample label through the {selectedLabelType.replace(/_/g, ' ')} format without touching a real queue item — use it to confirm a printer or stock size before a production run.
      </p>

      <div className="grid gap-3 md:grid-cols-2 mb-3">
        <div>
          <Label className="text-xs">Test Title</Label>
          <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Test Subtitle</Label>
          <Input className="mt-1" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={handlePrint}>
          <Printer className="w-4 h-4" />Print via Browser
        </Button>
        <Button variant="outline" className="gap-2" onClick={handleGenerateZpl}>
          <Terminal className="w-4 h-4" />Generate Raw ZPL String
        </Button>
      </div>

      {zplPreview && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">Raw ZPL — send via a TCP client to printer port 9100</Label>
            <Button size="sm" variant="ghost" className="gap-1.5 h-7" onClick={handleCopy}>
              <Copy className="w-3.5 h-3.5" />Copy
            </Button>
          </div>
          <Textarea readOnly value={zplPreview} className="font-mono text-xs h-40" />
        </div>
      )}
    </div>
  );
}
