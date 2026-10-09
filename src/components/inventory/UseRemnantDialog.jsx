import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Briefcase, Wrench } from 'lucide-react';

// "Use this Drop" — the one place (besides a whole-piece Detailer Import
// match, which happens automatically) where a logged drop is deliberately
// consumed. Two mutually exclusive paths, picked up by the caller's onConfirm
// payload ({ mode, projectId, pieceMarkId, note }):
//  - 'project': assigns the drop to a project (optionally a specific piece
//    mark within it) — the physical label/QR stays exactly as printed, only
//    which record "owns" it changes, same posture as the automatic
//    whole-piece-match transfer in detailerImportCommit.js.
//  - 'other': an internal-use reason (shop repair, internal use, etc.) with
//    no project involved — the note is required since there's nothing else
//    to explain why this drop left inventory.
// Either way the caller sets status:'consumed' so the drop invariantly drops
// out of every match search (see findMatchingRemnants/findInventoryMatches) —
// this dialog only collects the input, it never writes to the database
// itself.
export default function UseRemnantDialog({ remnant, open, onOpenChange, projects = [], onConfirm }) {
  const [mode, setMode] = useState('project');
  const [projectId, setProjectId] = useState('');
  const [pieceMarks, setPieceMarks] = useState([]);
  const [pieceMarkId, setPieceMarkId] = useState('');
  const [loadingPieceMarks, setLoadingPieceMarks] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('project');
    setProjectId('');
    setPieceMarks([]);
    setPieceMarkId('');
    setNote('');
    setError('');
  }, [open, remnant?.id]);

  useEffect(() => {
    if (mode !== 'project' || !projectId) { setPieceMarks([]); setPieceMarkId(''); return; }
    setLoadingPieceMarks(true);
    db.entities.PieceMark.filter({ project_id: projectId }, 'piece_mark', 2000)
      .then(setPieceMarks)
      .catch(() => setPieceMarks([]))
      .finally(() => setLoadingPieceMarks(false));
  }, [mode, projectId]);

  if (!remnant) return null;

  const handleConfirm = async () => {
    if (mode === 'project' && !projectId) {
      setError('Select a project.');
      return;
    }
    if (mode === 'other' && !note.trim()) {
      setError('A note is required when using a drop outside a project.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onConfirm(
        mode === 'project'
          ? { mode, projectId, pieceMarkId: pieceMarkId || '', note: note.trim() }
          : { mode, note: note.trim() }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Use {remnant.material_shape} {remnant.material_grade}</DialogTitle></DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === 'project' ? 'default' : 'outline'}
            className={mode === 'project' ? 'gap-1.5 steel-gradient text-white border-0' : 'gap-1.5'}
            onClick={() => setMode('project')}
          >
            <Briefcase className="w-4 h-4" />Assign to a Project
          </Button>
          <Button
            type="button"
            variant={mode === 'other' ? 'default' : 'outline'}
            className={mode === 'other' ? 'gap-1.5 steel-gradient text-white border-0' : 'gap-1.5'}
            onClick={() => setMode('other')}
          >
            <Wrench className="w-4 h-4" />Other
          </Button>
        </div>

        {mode === 'project' ? (
          <div className="space-y-3">
            <div>
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Piece Mark (optional)</Label>
              <Select value={pieceMarkId} onValueChange={setPieceMarkId} disabled={!projectId || loadingPieceMarks}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={loadingPieceMarks ? 'Loading…' : 'Select a piece mark'} /></SelectTrigger>
                <SelectContent>
                  {pieceMarks.map((pm) => <SelectItem key={pm.id} value={pm.id}>{pm.piece_mark}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" />
            </div>
          </div>
        ) : (
          <div>
            <Label>Reason (required)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1" placeholder="e.g. used for a shop repair, internal use" />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={saving} className="steel-gradient text-white border-0">
            {saving ? 'Saving…' : 'Mark Used'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
