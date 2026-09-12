import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';
import { downloadFile } from '@/lib/downloadFile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { isParsableDetailerFile, parseDetailerImportFile } from '@/lib/detailerImportParser';
import { deriveShapeFromProfile } from '@/lib/materialProfileMatch';

// Full-page, new-tab document viewer — replaces PdfViewerModal's in-app
// Dialog. Opened via openDocumentViewer(), which passes the document as URL
// query params since this route always renders in a fresh tab with no access
// to the opener's React state. Two render paths: BlueprintCanvas (PDF/image
// pages) for drawings, or DetailerDataFileView below for a KSS/CSV/text BOM
// file — a detailer data file was previously always routed to
// BlueprintCanvas, which silently failed to render it since it isn't a PDF.
// isParsableDetailerFile (detailerImportParser.js) is the same
// extension-based check the Detailer Imports intake uses to decide whether a
// file parses into staged rows, so a file lands here in exactly the cases it
// would otherwise fail against BlueprintCanvas.
export default function DocumentViewer() {
  const [searchParams] = useSearchParams();
  const source = searchParams.get('source');
  const fileName = searchParams.get('name') || 'Document';
  const isDataFile = isParsableDetailerFile(fileName);

  useDocumentTitle(`SteelOS — ${fileName}`);

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
        {!source ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No document specified.
          </div>
        ) : isDataFile ? (
          <DetailerDataFileView source={source} fileName={fileName} />
        ) : (
          <BlueprintCanvas source={source} fillHeight />
        )}
      </div>
    </div>
  );
}

// Renders a KSS/CSV/Tekla-BOM data file as a table using the exact same
// parser the Detailer Imports intake stages rows with (parseDetailerImportFile)
// — this is a read-only preview (nothing here writes to DetailerImportedPiece),
// so it's safe to call even on a file that's already been staged/committed
// elsewhere. Falls back to raw text (still no PDF canvas) when the content
// doesn't parse into any rows, e.g. an unrecognized layout.
function DetailerDataFileView({ source, fileName }) {
  const [state, setState] = useState({ loading: true, rows: [], fileErrors: [], rawText: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, rows: [], fileErrors: [], rawText: '' });
    fetch(source)
      .then((response) => response.text())
      .then((text) => {
        if (cancelled) return;
        const result = parseDetailerImportFile(fileName, text);
        setState({ loading: false, rows: result?.rows || [], fileErrors: result?.fileErrors || [], rawText: text });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, rows: [], fileErrors: ['Unable to load file.'], rawText: '' });
      });
    return () => { cancelled = true; };
  }, [source, fileName]);

  if (state.loading) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (state.rows.length === 0) {
    return (
      <div className="h-full overflow-auto p-4">
        {state.fileErrors.length > 0 && (
          <p className="text-xs text-muted-foreground mb-3">{state.fileErrors.join(' ')}</p>
        )}
        <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded-lg p-3">{state.rawText || 'No content.'}</pre>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border sticky top-0 bg-background">
            <th className="py-1.5 pr-3">Piece Mark</th>
            <th className="py-1.5 pr-3">Assembly</th>
            <th className="py-1.5 pr-3">Shape</th>
            <th className="py-1.5 pr-3">Material</th>
            <th className="py-1.5 pr-3">Grade</th>
            <th className="py-1.5 pr-3">Length</th>
            <th className="py-1.5 pr-3">Qty</th>
            <th className="py-1.5 pr-3">Weight</th>
            <th className="py-1.5 pr-3">Drawing / Rev</th>
            <th className="py-1.5 pr-3">Notes</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, index) => (
            <tr key={index} className="border-b border-border/50">
              <td className="py-1.5 pr-3 font-medium">{row.piece_mark || '—'}</td>
              <td className="py-1.5 pr-3">{row.assembly || '—'}</td>
              <td className="py-1.5 pr-3">{row.shape || deriveShapeFromProfile(row.material_profile) || '—'}</td>
              <td className="py-1.5 pr-3">{row.material_profile || '—'}</td>
              <td className="py-1.5 pr-3">{row.material_grade || '—'}</td>
              <td className="py-1.5 pr-3">{row.finished_length || '—'}</td>
              <td className="py-1.5 pr-3">{row.quantity ?? '—'}</td>
              <td className="py-1.5 pr-3">{row.weight ?? '—'}</td>
              <td className="py-1.5 pr-3">{row.drawing_number || '—'}{row.revision ? ` / ${row.revision}` : ''}</td>
              <td className="py-1.5 pr-3">{row.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.fileErrors.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">{state.fileErrors.join(' ')}</p>
      )}
    </div>
  );
}
