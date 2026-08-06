import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';
import { downloadFile } from '@/lib/downloadFile';

// Universal in-app PDF viewer — wraps BlueprintCanvas (pan/zoom/page nav
// already built there) in a Dialog with Print/Download actions, so every
// PDF reference in the app gets the same inline viewing experience instead
// of each page inventing its own "open in new tab" link.
export default function PdfViewerModal({ open, onOpenChange, source, fileName }) {
  const handlePrint = () => {
    const previousTitle = document.title;
    if (fileName) document.title = fileName;
    window.print();
    document.title = previousTitle;
  };

  const handleDownload = () => downloadFile(source, fileName || 'document.pdf');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex-row items-center justify-between gap-3 pr-8 space-y-0">
          <DialogTitle className="truncate">{fileName || 'Document'}</DialogTitle>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5 mr-1.5" />Print
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download className="w-3.5 h-3.5 mr-1.5" />Download
            </Button>
          </div>
        </DialogHeader>
        {source && <BlueprintCanvas source={source} />}
      </DialogContent>
    </Dialog>
  );
}
