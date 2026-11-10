import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import PagedPdfViewer from '@/components/documents/PagedPdfViewer';
import { downloadFile } from '@/lib/downloadFile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { isParsableDetailerFile, parseDetailerImportFile } from '@/lib/detailerImportParser';
import { deriveShapeFromProfile } from '@/lib/materialProfileMatch';
import { isPieceDocumentRef, getPieceDocumentBlob } from '@/lib/pieceMarkDocumentStore';

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
// A stored piece drawing (piece-doc:<pieceId>/<docId>, pieceMarkDocumentStore)
// is read from IndexedDB here and given a blob: URL owned by THIS tab, so it
// keeps working after the opener's dialog closes or this tab reloads. Any
// other source passes through untouched.
function useResolvedSource(rawSource) {
  const [state, setState] = useState(() => ({ source: isPieceDocumentRef(rawSource) ? null : rawSource, error: null }));
  useEffect(() => {
    if (!isPieceDocumentRef(rawSource)) { setState({ source: rawSource, error: null }); return undefined; }
    let cancelled = false;
    let url = null;
    setState({ source: null, error: null });
    getPieceDocumentBlob(rawSource)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) { setState({ source: null, error: 'This drawing is no longer stored in this browser. Re-attach it on the piece.' }); return; }
        url = URL.createObjectURL(blob);
        setState({ source: url, error: null });
      })
      .catch((e) => { if (!cancelled) setState({ source: null, error: e?.message || 'Could not load this drawing.' }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [rawSource]);
  return state;
}

export default function DocumentViewer() {
  const [searchParams] = useSearchParams();
  const rawSource = searchParams.get('source');
  const { source, error: sourceError } = useResolvedSource(rawSource);
  const fileName = searchParams.get('name') || 'Document';
  const isDataFile = isParsableDetailerFile(fileName);
  const kind = isDataFile ? 'data' : fileKind(fileName);

  useDocumentTitle(`SteelOS — ${fileName}`);

  const handleDownload = () => { if (source) downloadFile(source, fileName); };

  // Print the whole file (every page), not just what's on screen: hand the
  // PDF to the browser's own PDF printing in a hidden frame.
  const handlePrint = () => {
    if (!source || kind !== 'pdf') { window.print(); return; }
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.src = source;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.print(); }
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2 flex-shrink-0">
        <h1 className="text-sm font-semibold truncate min-w-0" title={fileName}>{fileName}</h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={handlePrint} disabled={!source}>
            <Printer className="w-3.5 h-3.5 mr-1.5" />Print
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="w-3.5 h-3.5 mr-1.5" />Download
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {!source ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
            {sourceError || (rawSource ? 'Loading the drawing…' : 'No document specified.')}
          </div>
        ) : kind === 'data' ? (
          <DetailerDataFileView source={source} fileName={fileName} />
        ) : kind === 'image' ? (
          <div className="h-full overflow-auto bg-neutral-600 p-4 flex items-start justify-center">
            <img src={source} alt={fileName} className="max-w-full bg-white shadow-lg" />
          </div>
        ) : kind === 'text' ? (
          <TextFileView source={source} />
        ) : kind === 'other' ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground px-4 text-center">
            <p>A browser can&apos;t show this kind of file ({extOf(fileName).toUpperCase() || 'unknown type'}).</p>
            <Button onClick={handleDownload}><Download className="w-4 h-4 mr-1.5" />Download to open it</Button>
          </div>
        ) : (
          <PagedPdfViewer source={source} />
        )}
      </div>
    </div>
  );
}

const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const TEXT_EXT = new Set(['txt', 'log', 'md', 'json', 'xml']);
const OTHER_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'dwg', 'dxf', 'zip', 'tif', 'tiff', 'msg', 'eml', 'rtf', 'nc1', 'ifc']);
// PDF unless the name says otherwise (most links name a .pdf; an unnamed one is tried as a PDF).
function fileKind(name) {
  const ext = extOf(name);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (TEXT_EXT.has(ext)) return 'text';
  if (OTHER_EXT.has(ext)) return 'other';
  return 'pdf';
}

function TextFileView({ source }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(source).then((r) => r.text()).then((t) => { if (!cancelled) setText(t); }).catch(() => { if (!cancelled) setText('Unable to load file.'); });
    return () => { cancelled = true; };
  }, [source]);
  return (
    <div className="h-full overflow-auto p-4">
      <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded-lg p-3">{text ?? 'Loading…'}</pre>
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
