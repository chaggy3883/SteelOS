import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';
import { getDocumentRecords, pieceDocumentsKey } from '@/lib/pieceMarkDocumentStore';

// The drawing for a shop-floor piece: the PDF(s) attached to its office
// piece (Project → Pieces drag-and-drop, stored in IndexedDB by
// pieceMarkDocumentStore). Newest drawing first; a picker appears when a
// piece has more than one (e.g. a revision dropped later). Falls back to a
// legacy blueprint_file_uri link when nothing is stored. Shown in the same
// zoom/pan viewer as IRONSIGHT so it works with touch on a shop tablet.
export default function ShopPieceBlueprint({ pieceMark, fallbackUri }) {
  const [docs, setDocs] = useState(null); // null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setDocs(null);
    setSelectedId(null);
    if (!pieceMark?.id) { setDocs([]); return undefined; }
    getDocumentRecords(pieceDocumentsKey(pieceMark.id))
      .then((rows) => {
        if (cancelled) return;
        const usable = (rows || []).filter((d) => d.blob).sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));
        setDocs(usable);
        setSelectedId(usable[0]?.id || null);
      })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => { cancelled = true; };
  }, [pieceMark?.id]);

  useEffect(() => {
    const doc = docs?.find((d) => d.id === selectedId);
    if (!doc) { setUrl(null); return undefined; }
    const next = URL.createObjectURL(doc.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [docs, selectedId]);

  if (docs === null) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading the drawing…</div>;
  }

  if (!docs.length) {
    // Only a real link — a bare app path (the demo pieces' "/drawings/…")
    // would just load SteelOS itself inside the frame.
    return /^(https?:|blob:|data:)/i.test(String(fallbackUri || ''))
      ? <iframe src={fallbackUri} title="Blueprint" className="w-full h-full border-0" />
      : (
        <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground px-6 text-center gap-1">
          <p>No drawing is attached to this piece yet.</p>
          <p className="text-xs">Add one in the project's Pieces tab (drag the PDF in — a matching piece mark attaches it).</p>
        </div>
      );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {docs.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border text-sm flex-shrink-0">
          <span className="text-muted-foreground">Drawing:</span>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)}>
            {docs.map((d, i) => (
              <option key={d.id} value={d.id}>
                {d.filename}{d.uploadDate ? ` — ${new Date(d.uploadDate).toLocaleDateString()}` : ''}{i === 0 ? ' (newest)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {url ? <BlueprintCanvas source={url} fillHeight /> : null}
      </div>
    </div>
  );
}
