import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { AlertTriangle, ArrowUpFromLine, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { isCraneDispatchBlocked } from '@/lib/craneDispatchGuard';
import { getPayrollRateScalesCents } from '@/lib/burdenedLabor';
import { computeMultiScaleGrossPayCents, LABOR_SCALES } from '@/lib/attendanceMath';

export default function HookProductionTerminal({ cranes, pieces, projects, inspections, hookLogs, onReload }) {
  const { toast } = useToast();
  const [craneId, setCraneId] = useState('');
  const [pieceId, setPieceId] = useState('');
  const [rateScale, setRateScale] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { getPayrollRateScalesCents().then(setRateScale).catch(() => setRateScale(null)); }, []);

  const openHooks = useMemo(() => hookLogs.filter((h) => !h.bolted_complete_at), [hookLogs]);
  const completedHooks = useMemo(
    () => hookLogs.filter((h) => h.bolted_complete_at).sort((a, b) => new Date(b.bolted_complete_at) - new Date(a.bolted_complete_at)),
    [hookLogs]
  );
  const hookedPieceIds = new Set(openHooks.map((h) => h.piece_mark_id));
  const availablePieces = pieces.filter((p) => p.field_status === 'On_Site' && !hookedPieceIds.has(p.id));

  const pieceMark = (id) => pieces.find((p) => p.id === id)?.piece_mark || id;
  const craneName = (id) => cranes.find((c) => c.id === id)?.asset_name || id;
  const projectName = (id) => projects.find((p) => p.id === id)?.name || id;

  const handleHook = async () => {
    if (!craneId || !pieceId) return;
    if (isCraneDispatchBlocked(craneId, inspections)) {
      toast({ title: 'Crane blocked from dispatch', description: 'This crane’s annual inspection is expired.', variant: 'destructive' });
      return;
    }
    const piece = pieces.find((p) => p.id === pieceId);
    await db.entities.field_hook_logs.create({
      project_id: piece?.project_id || '',
      crane_asset_id: craneId,
      piece_mark_id: pieceId,
      hooked_at: new Date().toISOString(),
    });
    await onReload();
    setPieceId('');
    toast({ title: `${piece?.piece_mark || 'Piece'} hooked` });
  };

  const handleBoltedComplete = async (hook) => {
    setBusyId(hook.id);
    try {
      const boltedAt = new Date();
      const elapsedMinutes = Math.max(0, Math.round((boltedAt.getTime() - new Date(hook.hooked_at).getTime()) / 60000));
      await db.entities.field_hook_logs.update(hook.id, {
        bolted_complete_at: boltedAt.toISOString(),
        elapsed_minutes: elapsedMinutes,
      });
      await onReload();
      toast({ title: `${pieceMark(hook.piece_mark_id)} bolted complete`, description: `${elapsedMinutes} min on the hook` });
    } finally {
      setBusyId(null);
    }
  };

  const estCostFor = (elapsedMinutes) => {
    if (!rateScale) return null;
    const { totalGrossPayCents } = computeMultiScaleGrossPayCents({
      laborScale: LABOR_SCALES.Field_Erection,
      regularMinutes: elapsedMinutes,
      overtimeMinutes: 0,
      ...rateScale,
    });
    return (totalGrossPayCents / 100).toFixed(2);
  };

  const selectedCraneBlocked = craneId && isCraneDispatchBlocked(craneId, inspections);

  return (
    <div className="space-y-4">
      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3">Log a Hook</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Crane</Label>
            <Select value={craneId} onValueChange={setCraneId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a crane" /></SelectTrigger>
              <SelectContent>
                {cranes.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={isCraneDispatchBlocked(c.id, inspections)}>
                    {c.asset_name}{isCraneDispatchBlocked(c.id, inspections) ? ' — inspection expired' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Piece Mark (On-Site)</Label>
            <Select value={pieceId} onValueChange={setPieceId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a piece" /></SelectTrigger>
              <SelectContent>
                {availablePieces.map((p) => <SelectItem key={p.id} value={p.id}>{p.piece_mark}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full gap-2 steel-gradient text-white border-0" disabled={!craneId || !pieceId || selectedCraneBlocked} onClick={handleHook}>
              <ArrowUpFromLine className="w-4 h-4" />Hook Piece
            </Button>
          </div>
        </div>
        {selectedCraneBlocked && (
          <p className="text-xs text-red-600 flex items-center gap-1.5 mt-2"><AlertTriangle className="w-3.5 h-3.5" />This crane cannot be dispatched — its Crane_Annual inspection is expired.</p>
        )}
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />On the Hook ({openHooks.length})</h4>
        {openHooks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No pieces currently on the hook.</p>
        ) : openHooks.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm mb-2">
            <div>
              <p className="font-medium">{pieceMark(h.piece_mark_id)} — {projectName(h.project_id)}</p>
              <p className="text-xs text-muted-foreground">{craneName(h.crane_asset_id)} • hooked {new Date(h.hooked_at).toLocaleTimeString()}</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busyId === h.id} onClick={() => handleBoltedComplete(h)}>
              <CheckCircle2 className="w-3.5 h-3.5" />Bolted Complete
            </Button>
          </div>
        ))}
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3">Completed Picks</h4>
        {completedHooks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No completed picks yet.</p>
        ) : completedHooks.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm mb-2">
            <div>
              <p className="font-medium">{pieceMark(h.piece_mark_id)} — {projectName(h.project_id)}</p>
              <p className="text-xs text-muted-foreground">{craneName(h.crane_asset_id)} • {h.elapsed_minutes} min on hook</p>
            </div>
            {estCostFor(h.elapsed_minutes) && (
              <p className="text-xs font-mono text-muted-foreground">~${estCostFor(h.elapsed_minutes)} field labor</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
