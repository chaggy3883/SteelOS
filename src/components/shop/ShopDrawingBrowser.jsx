import React, { useEffect, useMemo, useState } from 'react';
import { Search, FileText, Loader2, X } from 'lucide-react';
import { db } from '@/api/apiClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getDocumentRecords, documentsKeyForPiece } from '@/lib/pieceMarkDocumentStore';
import { matchesQuery } from '@/lib/globalSearchSources';
import ShopPieceBlueprint from '@/components/shop/ShopPieceBlueprint';

const PAGE = 100;

// Shop Management → Drawings: find any piece or part (mark, part #, serial,
// project, assembly, drawing #) and open the drawing attached to it in
// Project → Pieces, in the same zoom/pan viewer the shop floor uses.
export default function ShopDrawingBrowser({ projects = [] }) {
  const [pieceMarks, setPieceMarks] = useState(null);
  const [docCounts, setDocCounts] = useState({});
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [onlyWithDrawings, setOnlyWithDrawings] = useState(true);
  const [viewing, setViewing] = useState(null);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  useEffect(() => {
    let cancelled = false;
    db.entities.PieceMark.list('-created_date', 100000)
      .then(async (rows) => {
        if (cancelled) return;
        setPieceMarks(rows);
        // How many drawings each piece has (IndexedDB) — read in small
        // batches so a big job doesn't open hundreds of reads at once.
        const counts = {};
        for (let i = 0; i < rows.length; i += 25) {
          const batch = rows.slice(i, i + 25);
          const results = await Promise.all(batch.map((p) => getDocumentRecords(documentsKeyForPiece(p)).then((d) => d.filter((x) => x.blob).length).catch(() => 0)));
          batch.forEach((p, j) => { counts[p.id] = results[j]; });
          if (cancelled) return;
          setDocCounts({ ...counts });
        }
      })
      .catch(() => { if (!cancelled) setPieceMarks([]); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!pieceMarks) return [];
    return pieceMarks.filter((p) => {
      if (projectId !== 'all' && p.project_id !== projectId) return false;
      if (onlyWithDrawings && docCounts[p.id] === 0) return false;
      if (!query.trim()) return true;
      const proj = projectById.get(p.project_id);
      return matchesQuery([p.piece_mark, p.part_number, p.serial_number, p.assembly, p.drawing_number, p.description, proj?.name, proj?.project_number], query);
    });
  }, [pieceMarks, projectId, onlyWithDrawings, docCounts, query, projectById]);

  return (
    <div className="space-y-4">
      <div className="steel-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search piece mark, part #, serial, project, drawing #…" className="pl-9" aria-label="Search drawings" />
          </div>
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{[p.project_number, p.name].filter(Boolean).join(' — ')}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={onlyWithDrawings} onChange={(e) => setOnlyWithDrawings(e.target.checked)} />
            Only pieces with drawings
          </label>
        </div>
        {pieceMarks === null ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading pieces…</p>
        ) : (
          <p className="text-xs text-muted-foreground">{filtered.length} piece{filtered.length === 1 ? '' : 's'}{filtered.length > PAGE ? ` — showing the first ${PAGE}, search to narrow` : ''}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide text-left">
                <th className="py-2 px-3">Piece / Part</th>
                <th className="py-2 px-3">Serial #</th>
                <th className="py-2 px-3">Project</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3 text-right">Drawings</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, PAGE).map((p) => {
                const proj = projectById.get(p.project_id);
                const count = docCounts[p.id];
                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2 px-3 font-mono font-medium">{p.piece_mark || p.part_number}</td>
                    <td className="py-2 px-3 font-mono text-xs">{p.serial_number || '—'}</td>
                    <td className="py-2 px-3">{proj ? [proj.project_number, proj.name].filter(Boolean).join(' — ') : '—'}</td>
                    <td className="py-2 px-3 text-xs">{(p.item_type || 'Piece_Mark').replace(/_/g, ' ')}</td>
                    <td className="py-2 px-3 text-right">{count == null ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : count}</td>
                    <td className="py-2 px-3 text-right">
                      <Button size="sm" variant="outline" disabled={!count} onClick={() => setViewing(p)}>
                        <FileText className="w-3.5 h-3.5 mr-1" />View
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {pieceMarks && filtered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No pieces match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewing && (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
            <div>
              <h3 className="font-semibold">{viewing.piece_mark || viewing.part_number} — Drawing</h3>
              <p className="text-xs text-muted-foreground">{[viewing.serial_number, projectById.get(viewing.project_id)?.name].filter(Boolean).join(' • ')}</p>
            </div>
            <Button size="lg" onClick={() => setViewing(null)} className="bg-red-600 hover:bg-red-700 text-white border-0 font-bold shadow-lg">
              <X className="w-5 h-5 mr-2" />Close
            </Button>
          </div>
          <div className="flex-1 min-h-0 bg-muted/30">
            <ShopPieceBlueprint pieceMark={viewing} />
          </div>
        </div>
      )}
    </div>
  );
}
