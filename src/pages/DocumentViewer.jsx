import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';
import { downloadFile } from '@/lib/downloadFile';

// Full-page, new-tab PDF viewer — replaces PdfViewerModal's in-app Dialog.
// Opened via openDocumentViewer(), which passes the document as URL query
// params since this route always renders in a fresh tab with no access to
// the opener's React state. Reuses BlueprintCanvas as-is for render/zoom/pan.
export default function DocumentViewer() {
  const [searchParams] = useSearchParams();
  const source = searchParams.get('source');
  const fileName = searchParams.get('name') || 'Document';

  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  const handleDownload = () => downloadFile(source, fileName);

  return (
    <div className="h-screen w-screen flex flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2 flex-shrink-0">
        <h1 className="text-sm font-semibold truncate min-w-0" title={fileName}>{fileName}</h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5 mr-1.5" />Print
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="w-3.5 h-3.5 mr-1.5" />Download
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {source ? (
          <BlueprintCanvas source={source} fillHeight />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No document specified.
          </div>
        )}
      </div>
    </div>
  );
}
