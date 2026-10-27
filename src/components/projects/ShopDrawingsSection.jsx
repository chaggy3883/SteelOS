import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import {
  saveShopDrawingFile,
  saveShopDrawingRevisionFile,
  getShopDrawingFileUrl,
  deleteShopDrawingFile,
} from '@/lib/shopDrawingBlobStore';
import {
  APPROVAL_STATUSES,
  APPROVAL_STATUS_ORDER,
  DEFAULT_FIRST_REVISION,
  DRAWING_BADGE_CLASSES,
  allRevisionFileKeys,
  approvalStatusLabel,
  buildDrawingIndex,
  findDrawingForPiece,
  getCurrentRevision,
  getCurrentRevisionLabel,
  getDrawingRevisions,
  getPieceDrawingStatus,
  isApprovedStatus,
  isDrawingReleased,
  normalizeRevision,
  pieceNeedsDrawingWarning,
  revisionFileKey,
  suggestNextReleaseNumber,
  suggestNextRevision,
} from '@/lib/drawingReleaseStatus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { FileStack, Plus, Upload } from 'lucide-react';

// Shop Drawings section of Project Management (/projects/:id/management).
// One ShopDrawing record per sheet; its revisions[] array holds every issue of
// that sheet (newest = current), approval_status tracks where it is with the
// customer/EOR, and "Release to shop" is the gate the shop floor checks via
// src/lib/drawingReleaseStatus.js. Pulled out of ProjectManagement.jsx so the
// section's state (areas, drawings, piece marks, dialogs) lives in one place.

const STATUS_CHIP_CLASSES = {
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-sky-500/10 text-sky-700',
  good: 'bg-primary/10 text-primary',
  bad: 'bg-red-500/10 text-red-700',
  released: 'bg-green-600/15 text-green-700',
};

const statusChipClass = (status) => STATUS_CHIP_CLASSES[APPROVAL_STATUSES[status]?.tone || 'muted'];

const STATUS_DATE_FIELD = {
  sent_for_approval: 'sent_for_approval_date',
  approved: 'approved_date',
  approved_with_notes: 'approved_date',
  revise_resubmit: 'revise_resubmit_date',
};

const todayInput = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const formatDate = (value) => {
  if (!value) return '—';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleDateString();
};

const newRevisionId = () => `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const PIECE_STATUS_LABELS = {
  not_started: 'Not started',
  in_fabrication: 'In fabrication',
  fabricated: 'Fabricated',
  inspected: 'Inspected',
  painted: 'Painted',
  shipped: 'Shipped',
  erected: 'Erected',
  rejected: 'Rejected / on hold',
};

export default function ShopDrawingsSection({ project, user }) {
  const { toast } = useToast();
  const actor = user?.full_name || user?.email || 'System';
  const [loading, setLoading] = useState(true);
  const [drawings, setDrawings] = useState([]);
  const [areas, setAreas] = useState([]);
  const [pieceMarks, setPieceMarks] = useState([]);
  const [newAreaName, setNewAreaName] = useState('');
  const [uploadTarget, setUploadTarget] = useState('');
  const [firstRev, setFirstRev] = useState(DEFAULT_FIRST_REVISION);
  const [uploading, setUploading] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState(null);
  const [revisionFlow, setRevisionFlow] = useState(null); // { drawingId, step, file, rev, note, saving }
  const [statusFlow, setStatusFlow] = useState(null); // { drawingIds, status, date, note }
  const [releaseFlow, setReleaseFlow] = useState(null); // { drawingIds, releaseNumber, date, includeUnapproved, pieceChoices, saving }
  const [piecesView, setPiecesView] = useState(null); // { title, pieceIds }
  const [expandedPieceId, setExpandedPieceId] = useState(null);
  const objectUrls = useRef({});

  useEffect(() => () => {
    Object.values(objectUrls.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [drawingList, areaList, pieceList] = await Promise.all([
          db.entities.ShopDrawing.filter({ project_id: project.id }, '-created_date', 500),
          db.entities.ProjectSequenceArea.filter({ project_id: project.id }, 'sort_order', 200),
          db.entities.PieceMark.filter({ project_id: project.id }, '-created_date', 2000),
        ]);
        if (cancelled) return;
        setDrawings(drawingList || []);
        setAreas(areaList || []);
        setPieceMarks(pieceList || []);
      } catch (error) {
        console.error(error);
        if (!cancelled) toast({ title: 'Unable to load shop drawings', variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  const replaceDrawing = (updated) => setDrawings((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  const drawingById = (drawingId) => drawings.find((item) => item.id === drawingId) || null;

  // ---- piece marks <-> drawings ------------------------------------------

  const drawingIndex = useMemo(() => buildDrawingIndex(drawings), [drawings]);

  const pieceInfo = useMemo(() => {
    const byDrawingId = new Map();
    const statusByPieceId = new Map();
    pieceMarks.forEach((piece) => {
      if (piece.removal_status === 'voided') return; // voided off the job — nothing to cut
      const drawing = findDrawingForPiece(piece, drawingIndex);
      if (!drawing) return;
      const status = getPieceDrawingStatus(piece, drawingIndex);
      statusByPieceId.set(piece.id, status);
      if (!byDrawingId.has(drawing.id)) byDrawingId.set(drawing.id, []);
      byDrawingId.get(drawing.id).push(piece);
    });
    return { byDrawingId, statusByPieceId };
  }, [pieceMarks, drawingIndex]);

  const piecesFor = (drawingId) => pieceInfo.byDrawingId.get(drawingId) || [];
  const heldPieceIds = useMemo(
    () => pieceMarks.filter((piece) => pieceNeedsDrawingWarning(pieceInfo.statusByPieceId.get(piece.id))).map((piece) => piece.id),
    [pieceMarks, pieceInfo],
  );

  // ---- sequence / area ----------------------------------------------------

  const createArea = async () => {
    if (!newAreaName.trim()) return;
    const created = await db.entities.ProjectSequenceArea.create({ project_id: project.id, name: newAreaName.trim(), sort_order: areas.length });
    setAreas((current) => [...current, created]);
    setNewAreaName('');
    toast({ title: 'Sequence/Area added' });
  };

  const deleteArea = async (areaId) => {
    const affected = drawings.filter((drawing) => drawing.sequence_area_id === areaId);
    await Promise.all(affected.map((drawing) => db.entities.ShopDrawing.update(drawing.id, { sequence_area_id: null })));
    await db.entities.ProjectSequenceArea.delete(areaId);
    setAreas((current) => current.filter((item) => item.id !== areaId));
    setDrawings((current) => current.map((drawing) => (drawing.sequence_area_id === areaId ? { ...drawing, sequence_area_id: null } : drawing)));
    if (uploadTarget === areaId) setUploadTarget('');
    toast({ title: 'Sequence/Area removed' });
  };

  // ---- upload / edit / delete / view -------------------------------------

  const handleUpload = async (fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) return;
    const rev = firstRev.trim() || DEFAULT_FIRST_REVISION;
    setUploading(true);
    try {
      const created = [];
      for (const file of files) {
        const now = new Date().toISOString();
        const record = await db.entities.ShopDrawing.create({
          project_id: project.id,
          sequence_area_id: uploadTarget || null,
          drawing_number: file.name.replace(/\.pdf$/i, ''),
          description: '',
          file_name: file.name,
          file_url: '',
          uploaded_date: now,
          uploaded_by: actor,
          status: 'pending_review',
          revisions: [{ id: newRevisionId(), rev, change_note: 'First issue', revised_by: actor, revised_date: now, file_name: file.name }],
          current_revision: rev,
          approval_status: 'not_sent',
          status_history: [{ status: 'not_sent', date: now, by: actor, revision: rev, note: `Uploaded rev ${rev}` }],
        });
        await saveShopDrawingFile(record.id, file);
        created.push(record);
      }
      setDrawings((current) => [...created, ...current]);
      toast({ title: `${created.length} shop drawing${created.length === 1 ? '' : 's'} uploaded as rev ${rev}` });
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to upload shop drawings', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const updateField = async (drawingId, field, value) => {
    replaceDrawing(await db.entities.ShopDrawing.update(drawingId, { [field]: value }));
  };

  // Fixing the current rev's label (e.g. a legacy drawing that defaulted to
  // "A" but is really "0"). Only allowed while NOT released, so it can't be
  // used to quietly make an old release look current.
  const renameCurrentRevision = async (drawing, value) => {
    const revisions = getDrawingRevisions(drawing).map((revision, index, list) => (index === list.length - 1 ? { ...revision, rev: value } : revision));
    replaceDrawing(await db.entities.ShopDrawing.update(drawing.id, { revisions, current_revision: value }));
  };

  const markSuperseded = async (drawing) => {
    replaceDrawing(await db.entities.ShopDrawing.update(drawing.id, { status: drawing.status === 'superseded' ? 'pending_review' : 'superseded' }));
  };

  const deleteDrawing = async (drawing) => {
    if (!window.confirm(`Delete drawing ${drawing.drawing_number} and every revision PDF? This can't be undone.`)) return;
    const keys = allRevisionFileKeys(drawing);
    await db.entities.ShopDrawing.delete(drawing.id);
    await Promise.all(keys.map((key) => deleteShopDrawingFile(key)));
    keys.forEach((key) => {
      if (objectUrls.current[key]) { URL.revokeObjectURL(objectUrls.current[key]); delete objectUrls.current[key]; }
    });
    setDrawings((current) => current.filter((item) => item.id !== drawing.id));
    setSelectedIds((current) => { const next = new Set(current); next.delete(drawing.id); return next; });
    if (expandedId === drawing.id) setExpandedId(null);
  };

  const viewRevision = async (drawing, revision = getCurrentRevision(drawing)) => {
    const key = revisionFileKey(drawing, revision);
    let url = objectUrls.current[key];
    if (!url) {
      url = await getShopDrawingFileUrl(key);
      if (!url) { toast({ title: 'Drawing file not found', variant: 'destructive' }); return; }
      objectUrls.current[key] = url;
    }
    openDocumentViewer(url, revision?.file_name || drawing.file_name);
  };

  // ---- approval status ----------------------------------------------------

  const applyStatus = async (drawingIds, status, { date, note } = {}) => {
    const when = date || todayInput();
    const updatedList = [];
    for (const drawingId of drawingIds) {
      const drawing = drawingById(drawingId);
      if (!drawing) continue;
      const rev = getCurrentRevisionLabel(drawing);
      const payload = {
        approval_status: status,
        status_history: [...(drawing.status_history || []), { status, date: when, by: actor, revision: rev, note: note || '' }],
      };
      if (STATUS_DATE_FIELD[status]) payload[STATUS_DATE_FIELD[status]] = when;
      if (status === 'approved_with_notes') payload.approval_notes = note || '';
      if (status === 'approved') payload.approval_notes = '';
      updatedList.push(await db.entities.ShopDrawing.update(drawingId, payload));
    }
    setDrawings((current) => current.map((item) => updatedList.find((u) => u.id === item.id) || item));
    return updatedList;
  };

  const openStatusFlow = (drawingIds, status) => setStatusFlow({ drawingIds, status, date: todayInput(), note: '' });

  const confirmStatusFlow = async () => {
    if (!statusFlow) return;
    if (statusFlow.status === 'approved_with_notes' && !statusFlow.note.trim()) {
      toast({ title: 'Add the approval notes', description: 'Write down what the reviewer noted so the shop sees it.', variant: 'destructive' });
      return;
    }
    if (statusFlow.status === 'released') { setStatusFlow(null); openReleaseFlow(statusFlow.drawingIds); return; }
    const updated = await applyStatus(statusFlow.drawingIds, statusFlow.status, { date: statusFlow.date, note: statusFlow.note.trim() });
    toast({ title: `${updated.length} drawing${updated.length === 1 ? '' : 's'} marked "${approvalStatusLabel(statusFlow.status)}"` });
    setStatusFlow(null);
  };

  // ---- new revision (guided) ---------------------------------------------

  const openRevisionFlow = (drawing) => setRevisionFlow({
    drawingId: drawing.id, step: 1, file: null, rev: suggestNextRevision(getCurrentRevisionLabel(drawing)), note: '', saving: false,
  });

  const revisionFlowDrawing = revisionFlow ? drawingById(revisionFlow.drawingId) : null;
  const revisionFlowDuplicate = revisionFlowDrawing && revisionFlow?.rev
    && getDrawingRevisions(revisionFlowDrawing).some((revision) => normalizeRevision(revision.rev) === normalizeRevision(revisionFlow.rev));

  const saveRevision = async () => {
    const drawing = revisionFlowDrawing;
    if (!drawing || !revisionFlow.file || !revisionFlow.rev.trim() || !revisionFlow.note.trim() || revisionFlowDuplicate) return;
    setRevisionFlow((current) => ({ ...current, saving: true }));
    try {
      const now = new Date().toISOString();
      const rev = revisionFlow.rev.trim();
      const oldRevisions = getDrawingRevisions(drawing);
      const outgoing = oldRevisions[oldRevisions.length - 1];
      const newRevision = { id: newRevisionId(), rev, change_note: revisionFlow.note.trim(), revised_by: actor, revised_date: now, file_name: revisionFlow.file.name };
      const revisions = [...oldRevisions, newRevision];
      // Archive key for the outgoing rev, computed against the NEW list (where it's no longer current).
      const archiveKey = revisionFileKey({ ...drawing, revisions }, outgoing);
      await saveShopDrawingRevisionFile(drawing.id, archiveKey, revisionFlow.file);
      if (objectUrls.current[drawing.id]) { URL.revokeObjectURL(objectUrls.current[drawing.id]); delete objectUrls.current[drawing.id]; }

      const wasReleased = isDrawingReleased(drawing);
      const pulledNote = wasReleased
        ? `Rev ${rev} added — pulled back from the shop (rev ${outgoing.rev} was released ${formatDate(drawing.released_date)}${drawing.release_number ? `, ${drawing.release_number}` : ''})`
        : `Rev ${rev} added — needs to go out for approval`;
      const updated = await db.entities.ShopDrawing.update(drawing.id, {
        revisions,
        current_revision: rev,
        file_name: revisionFlow.file.name,
        uploaded_date: now,
        uploaded_by: actor,
        approval_status: 'not_sent',
        approval_notes: '',
        status_history: [...(drawing.status_history || []), { status: 'not_sent', date: now, by: actor, revision: rev, note: pulledNote }],
      });
      replaceDrawing(updated);
      const oldRevPieces = piecesFor(drawing.id).filter((piece) => piece.revision && normalizeRevision(piece.revision) !== normalizeRevision(rev)).length;
      toast({
        title: `${drawing.drawing_number} is now rev ${rev}`,
        description: wasReleased
          ? `No longer released to shop — send rev ${rev} for approval and release it again.${oldRevPieces ? ` ${oldRevPieces} piece${oldRevPieces === 1 ? '' : 's'} on rev ${outgoing.rev} now show "Old revision".` : ''}`
          : `Status reset to "Not sent".${oldRevPieces ? ` ${oldRevPieces} piece${oldRevPieces === 1 ? '' : 's'} on an older rev now show "Old revision".` : ''}`,
      });
      setRevisionFlow(null);
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to save the new revision', variant: 'destructive' });
      setRevisionFlow((current) => (current ? { ...current, saving: false } : current));
    }
  };

  // ---- release to shop (single + bulk) ------------------------------------

  const openReleaseFlow = (drawingIds) => {
    const pieceChoices = {};
    drawingIds.forEach((drawingId) => {
      const drawing = drawingById(drawingId);
      if (!drawing) return;
      const rev = getCurrentRevisionLabel(drawing);
      piecesFor(drawingId).forEach((piece) => {
        if (piece.revision && normalizeRevision(piece.revision) !== normalizeRevision(rev)) {
          // Default: bring not-started pieces up to the new rev; leave started
          // pieces alone until someone checks them against the new sheet.
          pieceChoices[piece.id] = !piece.status || piece.status === 'not_started';
        }
      });
    });
    setReleaseFlow({ drawingIds, releaseNumber: suggestNextReleaseNumber(drawings), date: todayInput(), includeUnapproved: false, pieceChoices, saving: false });
  };

  const releaseTargets = useMemo(() => {
    if (!releaseFlow) return { ready: [], notApproved: [], alreadyReleased: [] };
    const list = releaseFlow.drawingIds.map(drawingById).filter(Boolean);
    return {
      ready: list.filter((drawing) => !isDrawingReleased(drawing) && isApprovedStatus(drawing.approval_status)),
      notApproved: list.filter((drawing) => !isDrawingReleased(drawing) && !isApprovedStatus(drawing.approval_status)),
      alreadyReleased: list.filter((drawing) => isDrawingReleased(drawing)),
    };
  }, [releaseFlow, drawings]);

  const releaseDrawingsToRelease = releaseFlow
    ? [...releaseTargets.ready, ...(releaseFlow.includeUnapproved ? releaseTargets.notApproved : [])]
    : [];

  const confirmRelease = async () => {
    if (!releaseFlow || releaseDrawingsToRelease.length === 0 || !releaseFlow.releaseNumber.trim()) return;
    setReleaseFlow((current) => ({ ...current, saving: true }));
    try {
      const releaseNumber = releaseFlow.releaseNumber.trim();
      const when = releaseFlow.date || todayInput();
      const updatedDrawings = [];
      const updatedPieces = [];
      for (const drawing of releaseDrawingsToRelease) {
        const rev = getCurrentRevisionLabel(drawing);
        updatedDrawings.push(await db.entities.ShopDrawing.update(drawing.id, {
          approval_status: 'released',
          released_date: when,
          released_by: actor,
          release_number: releaseNumber,
          released_revision: rev,
          status_history: [...(drawing.status_history || []), { status: 'released', date: when, by: actor, revision: rev, release_number: releaseNumber, note: `Released rev ${rev} to shop (${releaseNumber})` }],
        }));
        // Keep PieceMark.revision in sync: blank -> released rev (backfill);
        // older rev -> released rev only where the PM ticked it.
        for (const piece of piecesFor(drawing.id)) {
          const blank = !String(piece.revision || '').trim();
          const chosen = releaseFlow.pieceChoices[piece.id] === true;
          if (blank || chosen) updatedPieces.push(await db.entities.PieceMark.update(piece.id, { revision: rev }));
        }
      }
      setDrawings((current) => current.map((item) => updatedDrawings.find((u) => u.id === item.id) || item));
      setPieceMarks((current) => current.map((item) => updatedPieces.find((u) => u.id === item.id) || item));
      toast({
        title: `${updatedDrawings.length} drawing${updatedDrawings.length === 1 ? '' : 's'} released to shop (${releaseNumber})`,
        description: updatedPieces.length ? `${updatedPieces.length} piece mark${updatedPieces.length === 1 ? '' : 's'} updated to the released rev.` : undefined,
      });
      setSelectedIds(new Set());
      setReleaseFlow(null);
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to release drawings', variant: 'destructive' });
      setReleaseFlow((current) => (current ? { ...current, saving: false } : current));
    }
  };

  // ---- list / selection / filters ----------------------------------------

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(APPROVAL_STATUS_ORDER.map((status) => [status, 0]));
    drawings.forEach((drawing) => { counts[effectiveStatus(drawing)] += 1; });
    return counts;
  }, [drawings]);

  const visibleDrawings = useMemo(
    () => (statusFilter ? drawings.filter((drawing) => effectiveStatus(drawing) === statusFilter) : drawings),
    [drawings, statusFilter],
  );

  const groups = useMemo(() => {
    const byArea = new Map();
    areas.forEach((area) => byArea.set(area.id, { area, drawings: [] }));
    const unassigned = [];
    visibleDrawings.forEach((drawing) => {
      if (drawing.sequence_area_id && byArea.has(drawing.sequence_area_id)) byArea.get(drawing.sequence_area_id).drawings.push(drawing);
      else unassigned.push(drawing);
    });
    const list = [...byArea.values()];
    if (unassigned.length > 0 || byArea.size === 0) list.push({ area: null, drawings: unassigned });
    return list;
  }, [areas, visibleDrawings]);

  const toggleSelected = (drawingId) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(drawingId)) next.delete(drawingId); else next.add(drawingId);
    return next;
  });

  const allVisibleSelected = visibleDrawings.length > 0 && visibleDrawings.every((drawing) => selectedIds.has(drawing.id));
  const toggleSelectAllVisible = () => setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleDrawings.map((drawing) => drawing.id)));

  const toggleGroup = (groupKey) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
    return next;
  });

  const openPieces = (title, pieces) => { setExpandedPieceId(null); setPiecesView({ title, pieceIds: pieces.map((piece) => piece.id) }); };

  const selectedList = [...selectedIds].map(drawingById).filter(Boolean);

  // Bulk approve/send never touches drawings that are released to the shop —
  // that would quietly pull them off the floor. Use "Add new revision" for that.
  const openBulkStatus = (status) => {
    const eligible = selectedList.filter((drawing) => !isDrawingReleased(drawing));
    const skipped = selectedList.length - eligible.length;
    if (eligible.length === 0) {
      toast({ title: 'Nothing to change', description: 'Every selected drawing is already released to the shop.' });
      return;
    }
    if (skipped > 0) toast({ title: `${skipped} released drawing${skipped === 1 ? '' : 's'} left alone`, description: 'Released drawings stay released.' });
    openStatusFlow(eligible.map((drawing) => drawing.id), status);
  };

  // ---- render --------------------------------------------------------------

  return (
    <div className="steel-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileStack className="w-4 h-4 text-primary" />
          <h2 className="text-lg font-semibold">Shop Drawings</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => setStatusFilter(null)} className={`rounded-full px-3 py-1 ${statusFilter ? 'bg-muted' : 'bg-primary text-primary-foreground'}`}>
            {drawings.length} drawing{drawings.length === 1 ? '' : 's'}
          </button>
          <button
            type="button"
            onClick={() => openPieces('Pieces held — drawing not released or old revision', pieceMarks.filter((piece) => heldPieceIds.includes(piece.id)))}
            className={`rounded-full px-3 py-1 ${heldPieceIds.length ? DRAWING_BADGE_CLASSES.not_released : 'bg-muted'}`}
            title="Piece marks the shop should not cut yet"
          >
            {heldPieceIds.length} piece{heldPieceIds.length === 1 ? '' : 's'} held
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {APPROVAL_STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(statusFilter === status ? null : status)}
            className={`rounded-full px-3 py-1 ${statusChipClass(status)} ${statusFilter === status ? 'ring-2 ring-primary' : ''}`}
            title={`Show only "${approvalStatusLabel(status)}" drawings`}
          >
            {approvalStatusLabel(status)}: {statusCounts[status]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <Label>Add Sequence/Area</Label>
          <Input
            value={newAreaName}
            onChange={(event) => setNewAreaName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createArea(); } }}
            placeholder="e.g. Sequence 1, Area A - North Wing"
            className="mt-2"
          />
        </div>
        <Button type="button" variant="outline" onClick={createArea} disabled={!newAreaName.trim()} className="gap-2">
          <Plus className="w-4 h-4" /> Add Sequence/Area
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3">
        <div className="flex-1 min-w-[200px]">
          <Label>Upload To</Label>
          <select className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={uploadTarget} onChange={(event) => setUploadTarget(event.target.value)}>
            <option value="">Unassigned</option>
            {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </div>
        <div className="w-28">
          <Label>First rev</Label>
          <Input value={firstRev} onChange={(event) => setFirstRev(event.target.value)} className="mt-2" placeholder="A" />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted/50">
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading…' : 'Upload new drawing(s)'}
          <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(event) => { handleUpload(event.target.files); event.target.value = ''; }} disabled={uploading} />
        </label>
        <p className="w-full text-xs text-muted-foreground">New sheets only. To replace a sheet that's already here, open it and use <span className="font-medium">Add new revision</span> so the history and shop release stay with it.</p>
      </div>

      {selectedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <span className="font-medium">{selectedList.length} selected</span>
          <Button type="button" size="sm" variant="outline" onClick={() => openBulkStatus('sent_for_approval')}>Mark sent for approval</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => openBulkStatus('approved')}>Mark approved</Button>
          <Button type="button" size="sm" onClick={() => openReleaseFlow(selectedList.map((d) => d.id))}>Release to shop…</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading drawings…</p>
      ) : (
        <div className="space-y-3">
          {visibleDrawings.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
              Select all {statusFilter ? `"${approvalStatusLabel(statusFilter)}" ` : ''}drawings shown ({visibleDrawings.length})
            </label>
          )}
          {groups.map((group) => {
            const groupKey = group.area?.id || 'unassigned';
            const collapsed = collapsedGroups.has(groupKey);
            return (
              <div key={groupKey} className="rounded-xl border border-border overflow-hidden">
                <button type="button" onClick={() => toggleGroup(groupKey)} className="flex w-full items-center justify-between px-3 py-2 bg-muted/40 text-left">
                  <span className="text-sm font-medium">{group.area?.name || 'Unassigned'}</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {group.drawings.length} drawing{group.drawings.length === 1 ? '' : 's'}
                    {group.area && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); deleteArea(group.area.id); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); deleteArea(group.area.id); } }}
                        className="text-destructive hover:underline"
                      >
                        Remove
                      </span>
                    )}
                    <span>{collapsed ? '▸' : '▾'}</span>
                  </span>
                </button>
                {!collapsed && (
                  <div className="divide-y divide-border">
                    {group.drawings.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">No drawings {statusFilter ? 'with this status ' : ''}in this {group.area ? 'sequence/area' : 'bucket'}.</p>
                    ) : group.drawings.map((drawing) => (
                      <DrawingRow
                        key={drawing.id}
                        drawing={drawing}
                        expanded={expandedId === drawing.id}
                        selected={selectedIds.has(drawing.id)}
                        pieces={piecesFor(drawing.id)}
                        statusByPieceId={pieceInfo.statusByPieceId}
                        onToggleExpanded={() => setExpandedId((current) => (current === drawing.id ? null : drawing.id))}
                        onToggleSelected={() => toggleSelected(drawing.id)}
                        onView={(revision) => viewRevision(drawing, revision)}
                        onOpenPieces={openPieces}
                        onField={(field, value) => updateField(drawing.id, field, value)}
                        onRenameRev={(value) => renameCurrentRevision(drawing, value)}
                        onStatus={(status) => (status === 'released' ? openReleaseFlow([drawing.id]) : openStatusFlow([drawing.id], status))}
                        onAddRevision={() => openRevisionFlow(drawing)}
                        onSuperseded={() => markSuperseded(drawing)}
                        onDelete={() => deleteDrawing(drawing)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Add new revision: 3 guided steps ---- */}
      <Dialog open={!!revisionFlow} onOpenChange={(open) => { if (!open && !revisionFlow?.saving) setRevisionFlow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add new revision — {revisionFlowDrawing?.drawing_number}</DialogTitle>
            <DialogDescription>
              Currently rev {getCurrentRevisionLabel(revisionFlowDrawing)} · {approvalStatusLabel(revisionFlowDrawing?.approval_status)}. Step {revisionFlow?.step || 1} of 3.
            </DialogDescription>
          </DialogHeader>
          {revisionFlow && (
            <div className="space-y-4 text-sm">
              {revisionFlow.step === 1 && (
                <div className="space-y-2">
                  <p className="font-medium">1. Pick the new PDF</p>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 hover:bg-muted/40">
                    <Upload className="w-4 h-4" />
                    <span>{revisionFlow.file ? revisionFlow.file.name : 'Choose the revised drawing PDF'}</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) setRevisionFlow((current) => ({ ...current, file, step: 2 }));
                      }}
                    />
                  </label>
                </div>
              )}
              {revisionFlow.step === 2 && (
                <div className="space-y-2">
                  <p className="font-medium">2. What rev is it?</p>
                  <Input value={revisionFlow.rev} onChange={(event) => setRevisionFlow((current) => ({ ...current, rev: event.target.value }))} autoFocus />
                  <p className="text-xs text-muted-foreground">Suggested from the current rev ({getCurrentRevisionLabel(revisionFlowDrawing)}). Change it if the detailer used something else.</p>
                  {revisionFlowDuplicate && <p className="text-xs text-red-600">Rev {revisionFlow.rev} already exists on this drawing — pick a new rev.</p>}
                </div>
              )}
              {revisionFlow.step === 3 && (
                <div className="space-y-2">
                  <p className="font-medium">3. What changed?</p>
                  <textarea
                    value={revisionFlow.note}
                    onChange={(event) => setRevisionFlow((current) => ({ ...current, note: event.target.value }))}
                    className="min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="e.g. Moved holes on B3 per RFI 12, added stiffener plates"
                    autoFocus
                  />
                  {isDrawingReleased(revisionFlowDrawing) && (
                    <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                      This drawing is released to the shop at rev {getCurrentRevisionLabel(revisionFlowDrawing)}. Saving rev {revisionFlow.rev} pulls it back out of the shop — status goes to &quot;Not sent&quot; until the new rev is approved and released.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {revisionFlow?.step > 1 && <Button type="button" variant="outline" disabled={revisionFlow?.saving} onClick={() => setRevisionFlow((current) => ({ ...current, step: current.step - 1 }))}>Back</Button>}
            {revisionFlow?.step === 2 && <Button type="button" disabled={!revisionFlow.rev.trim() || revisionFlowDuplicate} onClick={() => setRevisionFlow((current) => ({ ...current, step: 3 }))}>Next</Button>}
            {revisionFlow?.step === 3 && <Button type="button" disabled={revisionFlow.saving || !revisionFlow.note.trim()} onClick={saveRevision}>{revisionFlow.saving ? 'Saving…' : `Save rev ${revisionFlow.rev}`}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Status change (single or bulk) ---- */}
      <Dialog open={!!statusFlow} onOpenChange={(open) => { if (!open) setStatusFlow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            {/* statusFlow is cleared the moment the dialog closes, so guard the
                title — otherwise it reads "Mark undefined drawings" during the
                close animation. */}
            <DialogTitle>{statusFlow ? <>Mark {statusFlow.drawingIds.length === 1 ? drawingById(statusFlow.drawingIds[0])?.drawing_number : `${statusFlow.drawingIds.length} drawings`} &quot;{approvalStatusLabel(statusFlow.status)}&quot;</> : 'Update status'}</DialogTitle>
          </DialogHeader>
          {statusFlow && (
            <div className="space-y-3 text-sm">
              {statusFlow.drawingIds.length > 1 && (
                <p className="text-xs text-muted-foreground">{statusFlow.drawingIds.map(drawingById).filter(Boolean).map((d) => `${d.drawing_number} rev ${getCurrentRevisionLabel(d)}`).join(', ')}</p>
              )}
              <div>
                <Label>Date</Label>
                <Input type="date" value={statusFlow.date} onChange={(event) => setStatusFlow((current) => ({ ...current, date: event.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>{statusFlow.status === 'approved_with_notes' ? 'Reviewer notes (required)' : statusFlow.status === 'revise_resubmit' ? 'What needs fixing' : 'Note (optional)'}</Label>
                <textarea value={statusFlow.note} onChange={(event) => setStatusFlow((current) => ({ ...current, note: event.target.value }))} className="mt-1 min-h-[70px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStatusFlow(null)}>Cancel</Button>
            <Button type="button" onClick={confirmStatusFlow}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Release to shop (single or bulk) ---- */}
      <Dialog open={!!releaseFlow} onOpenChange={(open) => { if (!open && !releaseFlow?.saving) setReleaseFlow(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Release to shop</DialogTitle>
            <DialogDescription>Released drawings are cleared for the shop to cut. Each drawing is released at its current rev.</DialogDescription>
          </DialogHeader>
          {releaseFlow && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label>Release number</Label>
                  <Input value={releaseFlow.releaseNumber} onChange={(event) => setReleaseFlow((current) => ({ ...current, releaseNumber: event.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Release date</Label>
                  <Input type="date" value={releaseFlow.date} onChange={(event) => setReleaseFlow((current) => ({ ...current, date: event.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Released by</Label>
                  <p className="mt-2 font-medium">{actor}</p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="font-medium">Drawings to release ({releaseDrawingsToRelease.length})</p>
                {releaseTargets.ready.map((drawing) => (
                  <p key={drawing.id} className="text-xs">✓ {drawing.drawing_number} rev {getCurrentRevisionLabel(drawing)} — {approvalStatusLabel(drawing.approval_status)}</p>
                ))}
                {releaseTargets.notApproved.length > 0 && (
                  <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                    <p className="font-medium">{releaseTargets.notApproved.length} drawing{releaseTargets.notApproved.length === 1 ? " isn't" : "s aren't"} approved yet:</p>
                    {releaseTargets.notApproved.map((drawing) => <p key={drawing.id}>{drawing.drawing_number} rev {getCurrentRevisionLabel(drawing)} — {approvalStatusLabel(drawing.approval_status)}</p>)}
                    <label className="mt-1 flex items-center gap-2">
                      <input type="checkbox" checked={releaseFlow.includeUnapproved} onChange={(event) => setReleaseFlow((current) => ({ ...current, includeUnapproved: event.target.checked }))} />
                      Release them anyway
                    </label>
                  </div>
                )}
                {releaseTargets.alreadyReleased.length > 0 && (
                  <p className="text-xs text-muted-foreground">Already released, skipped: {releaseTargets.alreadyReleased.map((d) => d.drawing_number).join(', ')}</p>
                )}
              </div>

              {releaseDrawingsToRelease.map((drawing) => {
                const rev = getCurrentRevisionLabel(drawing);
                const pieces = piecesFor(drawing.id);
                const blank = pieces.filter((piece) => !String(piece.revision || '').trim());
                const other = pieces.filter((piece) => String(piece.revision || '').trim() && normalizeRevision(piece.revision) !== normalizeRevision(rev));
                if (blank.length === 0 && other.length === 0) return null;
                return (
                  <div key={drawing.id} className="rounded-lg border border-border p-3 space-y-1">
                    <p className="font-medium">Piece marks on {drawing.drawing_number}</p>
                    {blank.length > 0 && <p className="text-xs text-muted-foreground">{blank.length} piece{blank.length === 1 ? ' has' : 's have'} no rev — will be set to rev {rev}.</p>}
                    {other.length > 0 && (
                      <>
                        <p className="text-xs">These pieces are on an older rev. Tick the ones that match rev {rev} (not-started pieces are ticked for you). Unticked pieces keep showing &quot;Old revision&quot;.</p>
                        {other.map((piece) => (
                          <label key={piece.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={releaseFlow.pieceChoices[piece.id] === true}
                              onChange={(event) => setReleaseFlow((current) => ({ ...current, pieceChoices: { ...current.pieceChoices, [piece.id]: event.target.checked } }))}
                            />
                            <span className="font-mono">{piece.piece_mark}</span> rev {piece.revision} → {rev}
                            <span className="text-muted-foreground">({PIECE_STATUS_LABELS[piece.status] || piece.status || 'Not started'})</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={releaseFlow?.saving} onClick={() => setReleaseFlow(null)}>Cancel</Button>
            <Button type="button" disabled={releaseFlow?.saving || releaseDrawingsToRelease.length === 0 || !releaseFlow?.releaseNumber.trim()} onClick={confirmRelease}>
              {releaseFlow?.saving ? 'Releasing…' : `Release ${releaseDrawingsToRelease.length} drawing${releaseDrawingsToRelease.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Piece drill-down ---- */}
      <Dialog open={!!piecesView} onOpenChange={(open) => { if (!open) setPiecesView(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{piecesView?.title}</DialogTitle></DialogHeader>
          {piecesView && (
            <div className="max-h-[60vh] overflow-y-auto pr-1 text-sm">
              {piecesView.pieceIds.length === 0 ? (
                <p className="text-muted-foreground">No piece marks.</p>
              ) : piecesView.pieceIds.map((pieceId) => {
                const piece = pieceMarks.find((p) => p.id === pieceId);
                if (!piece) return null;
                const status = pieceInfo.statusByPieceId.get(piece.id);
                const open = expandedPieceId === piece.id;
                return (
                  <div key={piece.id} className="border-b border-border/60">
                    <button type="button" onClick={() => setExpandedPieceId(open ? null : piece.id)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-muted/30">
                      <span className="font-mono font-semibold text-primary">{piece.piece_mark}</span>
                      <span className="text-xs text-muted-foreground">{piece.drawing_number || '—'} · rev {piece.revision || '—'}</span>
                      <span className="text-xs text-muted-foreground">{PIECE_STATUS_LABELS[piece.status] || piece.status || 'Not started'}</span>
                      {pieceNeedsDrawingWarning(status) && (
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${DRAWING_BADGE_CLASSES[status.state]}`}>{status.label}</span>
                      )}
                    </button>
                    {open && (
                      <div className="grid gap-1 pb-3 pl-2 text-xs sm:grid-cols-2">
                        {[
                          ['Assembly', piece.assembly], ['Description', piece.description], ['Quantity', piece.quantity],
                          ['Weight (lbs)', piece.weight_lbs], ['Grade', piece.material_grade], ['Phase / Sequence', [piece.phase, piece.sequence].filter(Boolean).join(' / ')],
                          ['Fab start', formatDate(piece.fab_start_date)], ['Drawing check', status?.detail || 'Not tracked'],
                        ].map(([label, value]) => (
                          <p key={label}><span className="text-muted-foreground">{label}: </span>{value || value === 0 ? value : '—'}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPiecesView(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A released drawing whose current rev isn't the released rev (can't happen
// through the UI, but guards hand-edited data) counts as not released.
function effectiveStatus(drawing) {
  const status = APPROVAL_STATUSES[drawing.approval_status] ? drawing.approval_status : 'not_sent';
  if (status === 'released' && !isDrawingReleased(drawing)) return 'not_sent';
  return status;
}

function DrawingRow({
  drawing, expanded, selected, pieces, statusByPieceId,
  onToggleExpanded, onToggleSelected, onView, onOpenPieces, onField, onRenameRev, onStatus, onAddRevision, onSuperseded, onDelete,
}) {
  const status = effectiveStatus(drawing);
  const revisions = getDrawingRevisions(drawing);
  const current = revisions[revisions.length - 1];
  const released = isDrawingReleased(drawing);
  const oldRevPieces = pieces.filter((piece) => statusByPieceId.get(piece.id)?.state === 'old_revision');
  const superseded = drawing.status === 'superseded';
  const history = [...(drawing.status_history || [])].reverse();

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpanded}
        onKeyDown={(event) => { if (event.key === 'Enter') onToggleExpanded(); }}
        className={`flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/30 ${superseded ? 'opacity-60' : ''}`}
      >
        <input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={onToggleSelected} title="Select for bulk approve / release" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{drawing.drawing_number}{drawing.description ? ` — ${drawing.description}` : ''}{superseded ? ' (superseded)' : ''}</p>
          <button type="button" onClick={(event) => { event.stopPropagation(); onView(current); }} className="block truncate text-xs text-primary hover:underline">
            {current?.file_name || drawing.file_name}
          </button>
        </div>
        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleExpanded(); }} className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono" title={`${revisions.length} revision(s) — open history`}>
          Rev {current?.rev || '—'}
        </button>
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusChipClass(status)}`}>{approvalStatusLabel(status)}</span>
        <span className="w-28 text-right text-xs text-muted-foreground">{released ? `Released ${formatDate(drawing.released_date)}` : '—'}</span>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onOpenPieces(`Piece marks on ${drawing.drawing_number} (current rev ${current?.rev || '—'})`, pieces); }}
          className={`rounded-full px-2 py-0.5 text-xs ${oldRevPieces.length ? DRAWING_BADGE_CLASSES.old_revision : 'bg-muted'}`}
        >
          {pieces.length} pc{pieces.length === 1 ? '' : 's'}{oldRevPieces.length ? ` · ${oldRevPieces.length} old rev` : ''}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 bg-muted/20 px-3 pb-3 pt-1 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs uppercase tracking-wide">Drawing Number</Label>
              <Input value={drawing.drawing_number || ''} onChange={(event) => onField('drawing_number', event.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide">Description</Label>
              <Input value={drawing.description || ''} onChange={(event) => onField('description', event.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide">Current rev</Label>
              {released ? (
                <p className="mt-2 font-mono">{current?.rev} <span className="text-xs text-muted-foreground">(locked while released — add a new revision to change)</span></p>
              ) : (
                <Input value={current?.rev || ''} onChange={(event) => onRenameRev(event.target.value)} className="mt-1" />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Next step</p>
            {status === 'not_sent' && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Rev {current?.rev} hasn&apos;t gone out for approval.</span>
                <Button type="button" size="sm" onClick={() => onStatus('sent_for_approval')}>Send for approval</Button>
              </div>
            )}
            {status === 'sent_for_approval' && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Out for approval since {formatDate(drawing.sent_for_approval_date)}. What came back?</span>
                <Button type="button" size="sm" onClick={() => onStatus('approved')}>Approved</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onStatus('approved_with_notes')}>Approved with notes</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onStatus('revise_resubmit')}>Revise &amp; resubmit</Button>
              </div>
            )}
            {isApprovedStatus(status) && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span>Approved {formatDate(drawing.approved_date)} — not in the shop yet.</span>
                  <Button type="button" size="sm" onClick={() => onStatus('released')}>Release to shop…</Button>
                </div>
                {status === 'approved_with_notes' && drawing.approval_notes && <p className="text-xs text-amber-700">Notes: {drawing.approval_notes}</p>}
              </div>
            )}
            {status === 'revise_resubmit' && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Sent back {formatDate(drawing.revise_resubmit_date)}. Upload the fixed drawing as a new rev.</span>
                <Button type="button" size="sm" onClick={onAddRevision}>Add new revision</Button>
              </div>
            )}
            {status === 'released' && (
              <p>Released to shop {formatDate(drawing.released_date)} by {drawing.released_by || '—'} · {drawing.release_number || 'no release #'} · rev {drawing.released_revision}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onAddRevision}>Add new revision</Button>
              <select
                value=""
                onChange={(event) => { if (event.target.value) onStatus(event.target.value); }}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="">Set status manually…</option>
                {APPROVAL_STATUS_ORDER.filter((s) => s !== status).map((s) => <option key={s} value={s}>{approvalStatusLabel(s)}</option>)}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => onView(current)}>View current PDF</Button>
              <Button type="button" variant="ghost" size="sm" onClick={onSuperseded}>{superseded ? 'Un-mark superseded' : 'Mark whole sheet superseded'}</Button>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>Delete</Button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Revision history ({revisions.length})</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 pr-3">Rev</th><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">By</th><th className="py-1 pr-3">What changed</th><th className="py-1 pr-3">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {[...revisions].reverse().map((revision, index) => (
                    <tr key={revision.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1 pr-3 font-mono">{revision.rev}{index === 0 ? ' (current)' : ''}</td>
                      <td className="py-1 pr-3">{formatDate(revision.revised_date)}</td>
                      <td className="py-1 pr-3">{revision.revised_by || '—'}</td>
                      <td className="py-1 pr-3">{revision.change_note || '—'}</td>
                      <td className="py-1 pr-3"><button type="button" className="text-primary hover:underline" onClick={() => onView(revision)}>{revision.file_name || 'View'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {history.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Status history</p>
              <ul className="space-y-0.5 text-xs">
                {history.map((entry, index) => (
                  <li key={`${entry.date}-${index}`}>
                    <span className="text-muted-foreground">{formatDate(entry.date)}</span> · {approvalStatusLabel(entry.status)} · rev {entry.revision || '—'} · {entry.by || '—'}{entry.note ? ` — ${entry.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
