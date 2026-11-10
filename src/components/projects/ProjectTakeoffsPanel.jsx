import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Crosshair, Loader2, Plus, FolderOpen } from 'lucide-react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Project → Takeoffs: every IRONSIGHT takeoff for this job — ones linked to
// the project itself and ones started on the bid it was won from — most
// recently worked on first. Open continues it in IRONSIGHT where it was
// left; New takeoff starts one already linked to this project.
export default function ProjectTakeoffsPanel({ project }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!project?.id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [own, bids] = await Promise.all([
          db.entities.blueprint_takeoffs.filter({ project_id: project.id }, '-created_date', 1000),
          Promise.all([
            db.entities.Bid.filter({ project_id: project.id }, '-created_date', 100).catch(() => []),
            db.entities.Bid.filter({ won_project_id: project.id }, '-created_date', 100).catch(() => []),
          ]).then(([a, b]) => [...new Map([...a, ...b].map((x) => [x.id, x])).values()]),
        ]);
        const fromBids = (await Promise.all(bids.map((b) => db.entities.blueprint_takeoffs.filter({ bid_id: b.id }, '-created_date', 1000)
          .then((list) => list.map((t) => ({ ...t, _bid: b })))
          .catch(() => [])))).flat();
        const byId = new Map();
        [...own, ...fromBids].forEach((t) => { if (!byId.has(t.id)) byId.set(t.id, t); });
        const list = [...byId.values()].sort((a, b) => String(b.last_opened_at || b.updated_date || '').localeCompare(String(a.last_opened_at || a.updated_date || '')));
        if (!cancelled) setRows(list);
      } catch (e) {
        console.error(e);
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  const open = (t) => navigate(`/estimating/blueprint-takeoff?takeoff=${encodeURIComponent(t.id)}`);

  return (
    <div className="steel-card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Crosshair className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">IRONSIGHT Takeoffs</h3>
        <Button size="sm" className="ml-auto" onClick={() => navigate(`/estimating/blueprint-takeoff?project=${encodeURIComponent(project.id)}`)}>
          <Plus className="w-4 h-4 mr-1.5" />New takeoff for this project
        </Button>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading takeoffs…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No IRONSIGHT takeoffs for this project yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {rows.map((t) => {
            const items = (t.accepted_items || []).length;
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate" title={t.takeoff_name || t.file_name}>{t.takeoff_name || t.file_name || 'Untitled takeoff'}</p>
                  <p className="text-xs text-muted-foreground">
                    {items} item{items === 1 ? '' : 's'} · {t.sheet_count || 1} sheet{(t.sheet_count || 1) === 1 ? '' : 's'}
                    {t._bid ? ` · from bid ${[t._bid.bid_number, t._bid.job_name].filter(Boolean).join(' ')}` : ''}
                    {' · '}worked on {t.last_opened_at ? formatDistanceToNow(new Date(t.last_opened_at), { addSuffix: true }) : 'never'}
                  </p>
                </div>
                {!t.has_stored_pdf && <Badge variant="outline" className="text-amber-600 border-amber-300">Drawing not in this browser</Badge>}
                <Button size="sm" variant="outline" onClick={() => open(t)}>
                  <FolderOpen className="w-4 h-4 mr-1.5" />Open
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
