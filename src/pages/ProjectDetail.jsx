import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import {
  ArrowLeft, Brain, MessageSquare, Package,
  DollarSign, Edit, Plus,
  AlertTriangle, Layers, Gavel, FileSignature, ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import StatusBadge from '@/components/ui/StatusBadge';
import StatsCard from '@/components/ui/StatsCard';
import FileExplorer from '@/components/documents/FileExplorer';
import { useToast } from '@/components/ui/use-toast';
import { getStatutoryDeadline } from '@/lib/lienStatutes';

const PART_ITEM_TYPES = ['Loose_Part', 'Bolt', 'Embed', 'Misc_Metal'];
const emptyPartForm = () => ({
  item_type: 'Loose_Part', part_number: '', description: '', quantity: '1', phase: '', sequence: '',
  bolt_size: '', bolt_grade: '', stock_material_description: '', parts_per_stock: '', stock_qty_required: '',
});

const HealthRing = ({ score }) => {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <div className="text-center">
        <p className="text-xl font-bold" style={{ color }}>{score}%</p>
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Health</p>
      </div>
    </div>
  );
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState(null);
  const [findings, setFindings] = useState([]);
  const [rfis, setRfis] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [subcontracts, setSubcontracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingAwarded, setMarkingAwarded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const [showPartForm, setShowPartForm] = useState(false);
  const [partForm, setPartForm] = useState(emptyPartForm());
  const [stockQtyTouched, setStockQtyTouched] = useState(false);
  const [savingPart, setSavingPart] = useState(false);
  const [viewingPart, setViewingPart] = useState(null);

  // Phasing tab — shopPieces is the shop-floor `pieces` entity (bridged back
  // to a PieceMark via piece_mark_id), used only to derive % Shipped per
  // phase from field_status, same bridge JobsiteReceiving.jsx already reads.
  const [shopPieces, setShopPieces] = useState([]);
  const [savingPhaseMode, setSavingPhaseMode] = useState(false);
  const [selectedPieceIds, setSelectedPieceIds] = useState(new Set());
  const [bulkPhaseTarget, setBulkPhaseTarget] = useState('');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [viewingPhasePiece, setViewingPhasePiece] = useState(null);

  useEffect(() => { if (id) loadAll(); }, [id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [proj, finds, rfiList, pieceList, subcontractList, shopPieceList] = await Promise.all([
        db.entities.Project.get(id),
        db.entities.AIFinding.filter({ project_id: id }, '-created_date', 50),
        db.entities.RFI.filter({ project_id: id }, '-created_date', 20),
        db.entities.PieceMark.filter({ project_id: id }, 'piece_mark', 500),
        db.entities.Subcontract.filter({ project_id: id }, '-created_date', 50),
        db.entities.pieces.filter({ project_id: id }, '-created_date', 500),
      ]);
      setProject(proj);
      setFindings(finds);
      setRfis(rfiList);
      setPieces(pieceList);
      setSubcontracts(subcontractList);
      setShopPieces(shopPieceList);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAwarded = async () => {
    setMarkingAwarded(true);
    try {
      const updated = await db.entities.Project.update(id, { status: 'awarded' });
      setProject(updated);

      const workStartDate = updated.award_date || updated.start_date || new Date().toISOString().slice(0, 10);
      const { days, notice_type, deadlineDate } = getStatutoryDeadline(updated.state, workStartDate);
      const notice = await db.entities.StatutoryNotice.create({
        project_id: id,
        state: updated.state || '',
        notice_type,
        statutory_deadline_days: days,
        work_start_date: workStartDate,
        deadline_date: deadlineDate,
      });
      await db.entities.LegalAuditEvent.create({
        project_id: id,
        event_type: 'statutory_notice_created',
        related_entity_type: 'StatutoryNotice',
        related_entity_id: notice.id,
        description: `${notice_type.replace(/_/g, ' ')} deadline set to ${deadlineDate} (${days} days) based on job site state ${updated.state || 'unknown'}.`,
      });

      toast({ title: 'Project marked Awarded', description: `Statutory notice deadline: ${deadlineDate}` });
    } catch (e) {
      toast({ title: 'Unable to mark project awarded', variant: 'destructive' });
    } finally {
      setMarkingAwarded(false);
    }
  };

  const openEdit = () => {
    setEditForm({
      is_prevailing_wage: project.is_prevailing_wage || false,
      wage_determination_number: project.wage_determination_number || '',
      prevailing_wage_jurisdiction: project.prevailing_wage_jurisdiction || '',
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    setSavingEdit(true);
    try {
      const updated = await db.entities.Project.update(id, editForm);
      setProject(updated);
      setEditOpen(false);
      toast({ title: 'Project updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const openAddPart = () => {
    setPartForm(emptyPartForm());
    setStockQtyTouched(false);
    setShowPartForm(true);
  };

  // parts_per_stock and quantity are the only drivers of the auto-computed
  // stock_qty_required — the moment the operator types directly into that
  // field, stockQtyTouched locks it so further quantity/parts_per_stock
  // edits stop clobbering their override.
  const recomputeStockQty = (quantity, partsPerStock) => {
    const pps = Number(partsPerStock) || 0;
    const qty = Number(quantity) || 0;
    return pps > 0 ? String(Math.ceil(qty / pps)) : '';
  };

  const handleQuantityChange = (value) => {
    setPartForm((f) => {
      const next = { ...f, quantity: value };
      if (!stockQtyTouched && Number(f.parts_per_stock) > 0) {
        next.stock_qty_required = recomputeStockQty(value, f.parts_per_stock);
      }
      return next;
    });
  };

  const handlePartsPerStockChange = (value) => {
    setPartForm((f) => {
      const next = { ...f, parts_per_stock: value };
      if (!stockQtyTouched && Number(value) > 0) {
        next.stock_qty_required = recomputeStockQty(f.quantity, value);
      }
      return next;
    });
  };

  const handleStockQtyOverride = (value) => {
    setStockQtyTouched(true);
    setPartForm((f) => ({ ...f, stock_qty_required: value }));
  };

  const handleSavePart = async () => {
    if (!partForm.part_number.trim()) {
      toast({ title: 'Part number is required', variant: 'destructive' });
      return;
    }
    setSavingPart(true);
    try {
      const isBolt = partForm.item_type === 'Bolt';
      const created = await db.entities.PieceMark.create({
        project_id: id,
        piece_mark: partForm.part_number.trim(),
        item_type: partForm.item_type,
        part_number: partForm.part_number.trim(),
        description: partForm.description.trim(),
        quantity: Number(partForm.quantity) || 1,
        phase: partForm.phase,
        sequence: partForm.sequence,
        bolt_size: isBolt ? partForm.bolt_size : '',
        bolt_grade: isBolt ? partForm.bolt_grade : '',
        stock_material_description: isBolt ? '' : partForm.stock_material_description,
        parts_per_stock: isBolt ? 0 : (Number(partForm.parts_per_stock) || 0),
        stock_qty_required: Number(partForm.stock_qty_required) || 0,
        status: 'not_started',
      });
      setPieces((prev) => [...prev, created]);
      setShowPartForm(false);
      setPartForm(emptyPartForm());
      setStockQtyTouched(false);
      toast({ title: 'Part/hardware added' });
    } catch (e) {
      toast({ title: 'Unable to add part', variant: 'destructive' });
    } finally {
      setSavingPart(false);
    }
  };

  const handleSetPhasingMode = async (mode) => {
    setSavingPhaseMode(true);
    try {
      const updated = await db.entities.Project.update(id, { project_phasing_mode: mode });
      setProject(updated);
    } catch (e) {
      toast({ title: 'Unable to update phasing mode', variant: 'destructive' });
    } finally {
      setSavingPhaseMode(false);
    }
  };

  const handlePhaseFieldUpdate = async (piece, field, value) => {
    try {
      const updated = await db.entities.PieceMark.update(piece.id, { [field]: value });
      setPieces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      toast({ title: 'Unable to save change', variant: 'destructive' });
    }
  };

  const toggleSelectPiece = (pieceId) => {
    setSelectedPieceIds((prev) => {
      const next = new Set(prev);
      if (next.has(pieceId)) next.delete(pieceId); else next.add(pieceId);
      return next;
    });
  };

  const toggleSelectAllInPhase = (phaseRows, checked) => {
    setSelectedPieceIds((prev) => {
      const next = new Set(prev);
      phaseRows.forEach((r) => { if (checked) next.add(r.id); else next.delete(r.id); });
      return next;
    });
  };

  const handleBulkAssignPhase = async () => {
    const targetPhase = bulkPhaseTarget.trim();
    if (!targetPhase || selectedPieceIds.size === 0) return;
    setBulkAssigning(true);
    try {
      const ids = Array.from(selectedPieceIds);
      const updated = await Promise.all(ids.map((pid) => db.entities.PieceMark.update(pid, { phase: targetPhase })));
      setPieces((prev) => prev.map((p) => updated.find((u) => u.id === p.id) || p));
      setSelectedPieceIds(new Set());
      setBulkPhaseTarget('');
      toast({ title: `${ids.length} piece${ids.length === 1 ? '' : 's'} assigned to "${targetPhase}"` });
    } catch (e) {
      toast({ title: 'Unable to bulk-assign phase', variant: 'destructive' });
    } finally {
      setBulkAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-muted-foreground">Project not found.</p>
        <Link to="/projects"><Button className="mt-4">Back to Projects</Button></Link>
      </div>
    );
  }

  const pendingFindings = findings.filter(f => f.review_status === 'pending');
  const failFindings = findings.filter(f => f.status === 'fail');
  const warnFindings = findings.filter(f => f.status === 'warning');

  const parts = pieces.filter((p) => (p.item_type || 'Piece_Mark') !== 'Piece_Mark');
  const partCountByType = parts.reduce((acc, p) => {
    const type = p.item_type || 'Loose_Part';
    acc[type] = (acc[type] || 0) + (Number(p.quantity) || 0);
    return acc;
  }, {});
  const stockLengthsByMaterial = parts.reduce((acc, p) => {
    if (!p.stock_material_description) return acc;
    acc[p.stock_material_description] = (acc[p.stock_material_description] || 0) + (Number(p.stock_qty_required) || 0);
    return acc;
  }, {});

  // % Shipped is read off the shop-floor `pieces` bridge (field_status ===
  // 'On_Site'), the same signal JobsiteReceiving.jsx uses for jobsite
  // check-in — piece_mark_id is the primary join, piece_mark string is the
  // fallback for shop rows created before that bridge was populated.
  const phasingMode = project.project_phasing_mode || 'sequence';
  const shopStatusByPieceMarkId = new Map();
  const shopStatusByPieceMarkString = new Map();
  shopPieces.forEach((sp) => {
    if (sp.piece_mark_id) shopStatusByPieceMarkId.set(sp.piece_mark_id, sp.field_status);
    else if (sp.piece_mark) shopStatusByPieceMarkString.set(sp.piece_mark, sp.field_status);
  });
  const isShippedPiece = (pm) => {
    const status = shopStatusByPieceMarkId.get(pm.id) ?? shopStatusByPieceMarkString.get(pm.piece_mark);
    return status === 'On_Site';
  };

  const piecePhaseKey = (p) => (p.phase || '').trim() || 'Unassigned';
  const phaseMap = new Map();
  pieces.forEach((p) => {
    const key = piecePhaseKey(p);
    if (!phaseMap.has(key)) phaseMap.set(key, []);
    phaseMap.get(key).push(p);
  });
  const phaseEntries = Array.from(phaseMap.entries()).sort(([a], [b]) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const phaseStats = (rows) => {
    const totalWeight = rows.reduce((s, p) => s + (Number(p.weight_lbs) || 0), 0);
    const fabricatedCount = rows.filter((p) => p.status !== 'not_started').length;
    const shippedCount = rows.filter(isShippedPiece).length;
    return {
      tons: totalWeight / 2000,
      pctFabricated: rows.length ? Math.round((fabricatedCount / rows.length) * 100) : 0,
      pctShipped: rows.length ? Math.round((shippedCount / rows.length) * 100) : 0,
    };
  };

  return (
    <div className="p-6 animate-fade-in">
      {/* Back + Header */}
      <div className="flex items-start gap-4 mb-6">
        <Link to="/projects">
          <Button variant="ghost" size="icon" className="rounded-lg mt-1">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-muted-foreground font-mono">{project.project_number}</span>
            <StatusBadge status={project.status} />
            <StatusBadge status={project.risk_level || 'low'} />
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {project.name}
            {project.is_prevailing_wage && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-600 border border-purple-500/20">Prevailing Wage</span>
            )}
          </h1>
          <p className="text-muted-foreground">{project.customer_name || 'No customer assigned'}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${id}/management`}>
            <Button variant="outline" className="gap-2">
              <Package className="w-4 h-4" /> Lifecycle
            </Button>
          </Link>
          <Link to={`/intelligence?project=${id}`}>
            <Button variant="outline" className="gap-2">
              <Brain className="w-4 h-4" /> AI Analysis
            </Button>
          </Link>
          {['lead', 'estimating'].includes(project.status) && (
            <Button variant="outline" className="gap-2 text-green-600 border-green-500/30 hover:bg-green-500/10" onClick={handleMarkAwarded} disabled={markingAwarded}>
              <Gavel className="w-4 h-4" /> {markingAwarded ? 'Marking…' : 'Mark Awarded'}
            </Button>
          )}
          <Button className="steel-gradient text-white border-0 gap-2" onClick={openEdit}>
            <Edit className="w-4 h-4" /> Edit
          </Button>
        </div>
      </div>

      {/* Project Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="steel-card p-4 flex items-center justify-center lg:col-span-1">
          <HealthRing score={project.health_score || 100} />
        </div>
        <StatsCard title="Contract Value" value={project.contract_value ? `$${(project.contract_value/1000).toFixed(0)}K` : '—'} icon={DollarSign} color="green" />
        <StatsCard title="Estimated Tons" value={project.estimated_tons ? `${project.estimated_tons}T` : '—'} icon={Layers} color="blue" />
        <StatsCard title="AI Findings" value={findings.length} subtitle={`${pendingFindings.length} pending review`} icon={Brain} color="orange" />
        <StatsCard title="Open RFIs" value={rfis.filter(r => !['answered','closed'].includes(r.status)).length} icon={MessageSquare} color={rfis.filter(r => !['answered','closed'].includes(r.status)).length > 0 ? 'red' : 'green'} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="findings">
            AI Findings {findings.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded">{findings.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="rfis">
            RFIs {rfis.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded">{rfis.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="pieces">
            Pieces {pieces.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded">{pieces.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="phasing">
            Phasing {phaseEntries.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded">{phaseEntries.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 steel-card p-5">
              <h3 className="font-semibold mb-4">Project Details</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Project Type', value: project.project_type },
                  { label: 'Bid Date', value: project.bid_date || '—' },
                  { label: 'Start Date', value: project.start_date || '—' },
                  { label: 'Completion Date', value: project.completion_date || '—' },
                  { label: 'Address', value: project.address || '—' },
                  { label: 'City / State', value: project.city ? `${project.city}, ${project.state}` : '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                ))}
              </div>
              {project.description && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm">{project.description}</p>
                </div>
              )}
            </div>

            {/* Risk Summary */}
            <div className="steel-card p-5">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" /> Risk Summary
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Contract Risk', value: project.contract_risk || 0 },
                  { label: 'Schedule Risk', value: project.schedule_risk || 0 },
                  { label: 'Quality Risk', value: project.quality_risk || 0 },
                  { label: 'Financial Risk', value: project.financial_risk || 0 },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${value >= 70 ? 'bg-red-500' : value >= 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">AI Findings</span>
                  <div className="flex gap-2">
                    <span className="text-red-500 font-medium">{failFindings.length} fail</span>
                    <span className="text-yellow-500 font-medium">{warnFindings.length} warn</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Subcontracts */}
            <div className="lg:col-span-3 steel-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <FileSignature className="w-4 h-4 text-primary" /> Subcontracts
                </h3>
                <Link to={`/subcontracts?project=${id}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                  View Subcontracts <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Active Subcontracts</p>
                  <p className="text-lg font-bold">{subcontracts.filter((s) => s.status === 'active').length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Total Committed Value</p>
                  <p className="text-lg font-bold">
                    ${subcontracts.filter((s) => s.status !== 'terminated').reduce((sum, s) => sum + (s.contract_value || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <div className="steel-card p-5">
            <FileExplorer
              projectId={id}
              onUpload={(path) => navigate(`/intelligence?project=${id}&path=${encodeURIComponent(path)}`)}
            />
          </div>
        </TabsContent>

        {/* Findings */}
        <TabsContent value="findings">
          <div className="steel-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">AI Findings</h3>
              <div className="flex gap-2 text-xs">
                <span className="text-red-500">{failFindings.length} fail</span>
                <span className="text-yellow-500">{warnFindings.length} warning</span>
                <span className="text-muted-foreground">{findings.filter(f=>f.status==='pass').length} pass</span>
              </div>
            </div>
            {findings.length === 0 ? (
              <div className="text-center py-12">
                <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No AI findings yet — upload documents to analyze</p>
              </div>
            ) : (
              <div className="space-y-3">
                {findings.map(f => (
                  <div key={f.id} className="p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <StatusBadge status={f.status} />
                          <span className="text-xs text-muted-foreground">{f.review_package} • {f.category}</span>
                        </div>
                        <p className="text-sm font-medium">{f.title}</p>
                        {f.ai_explanation && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2" title={f.ai_explanation}>{f.ai_explanation}</p>
                        )}
                      </div>
                      <StatusBadge status={f.review_status} label={f.review_status?.replace('_',' ')} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* RFIs */}
        <TabsContent value="rfis">
          <div className="steel-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Request for Information</h3>
              <Button size="sm"><MessageSquare className="w-4 h-4 mr-2" /> New RFI</Button>
            </div>
            {rfis.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No RFIs yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rfis.map(rfi => (
                  <div key={rfi.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                    <div>
                      <p className="text-sm font-medium">{rfi.rfi_number} — {rfi.subject}</p>
                      <p className="text-xs text-muted-foreground">Priority: {rfi.priority} • Due: {rfi.date_required || '—'}</p>
                    </div>
                    <StatusBadge status={rfi.status} label={rfi.status?.replace('_',' ')} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Pieces */}
        <TabsContent value="pieces">
          <div className="steel-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Piece Marks</h3>
              <Button size="sm"><Package className="w-4 h-4 mr-2" /> Add Pieces</Button>
            </div>
            {pieces.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No pieces yet — import from Tekla or add manually</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 px-3">Piece Mark</th>
                      <th className="text-left py-2 px-3">Assembly</th>
                      <th className="text-left py-2 px-3">Grade</th>
                      <th className="text-right py-2 px-3">Weight</th>
                      <th className="text-left py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pieces.map(p => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono font-medium">{p.piece_mark}</td>
                        <td className="py-2 px-3 text-muted-foreground">{p.assembly || '—'}</td>
                        <td className="py-2 px-3">{p.material_grade || '—'}</td>
                        <td className="py-2 px-3 text-right">{p.weight_lbs ? `${p.weight_lbs} lbs` : '—'}</td>
                        <td className="py-2 px-3"><StatusBadge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="steel-card p-5 mt-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Parts &amp; Hardware</h3>
              <Button size="sm" variant="outline" className="gap-2" onClick={openAddPart}>
                <Plus className="w-4 h-4" /> Add Part / Hardware
              </Button>
            </div>

            {showPartForm && (
              <div className="rounded-lg border border-border p-4 mb-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Item Type</Label>
                    <Select value={partForm.item_type} onValueChange={(v) => setPartForm((f) => ({ ...f, item_type: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PART_ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Part Number</Label>
                    <Input value={partForm.part_number} onChange={(e) => setPartForm((f) => ({ ...f, part_number: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Input value={partForm.description} onChange={(e) => setPartForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Quantity</Label>
                    <Input type="number" value={partForm.quantity} onChange={(e) => handleQuantityChange(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Phase</Label>
                    <Input value={partForm.phase} onChange={(e) => setPartForm((f) => ({ ...f, phase: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Sequence</Label>
                    <Input value={partForm.sequence} onChange={(e) => setPartForm((f) => ({ ...f, sequence: e.target.value }))} className="mt-1" />
                  </div>

                  {partForm.item_type === 'Bolt' ? (
                    <>
                      <div>
                        <Label className="text-xs">Bolt Size</Label>
                        <Input value={partForm.bolt_size} onChange={(e) => setPartForm((f) => ({ ...f, bolt_size: e.target.value }))} className="mt-1" placeholder='3/4 x 2-1/2' />
                      </div>
                      <div>
                        <Label className="text-xs">Bolt Grade</Label>
                        <Input value={partForm.bolt_grade} onChange={(e) => setPartForm((f) => ({ ...f, bolt_grade: e.target.value }))} className="mt-1" placeholder="A325" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <Label className="text-xs">Stock Material Description</Label>
                        <Input value={partForm.stock_material_description} onChange={(e) => setPartForm((f) => ({ ...f, stock_material_description: e.target.value }))} className="mt-1" placeholder={`L4x4x1/4 x 20'-0"`} />
                      </div>
                      <div>
                        <Label className="text-xs">Parts per Stock Length</Label>
                        <Input type="number" value={partForm.parts_per_stock} onChange={(e) => handlePartsPerStockChange(e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">Stock Qty Required{!stockQtyTouched && Number(partForm.parts_per_stock) > 0 ? ' (auto)' : ''}</Label>
                        <Input type="number" value={partForm.stock_qty_required} onChange={(e) => handleStockQtyOverride(e.target.value)} className="mt-1" />
                      </div>
                    </>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowPartForm(false)}>Cancel</Button>
                  <Button onClick={handleSavePart} disabled={savingPart} className="steel-gradient text-white border-0">
                    {savingPart ? 'Saving…' : 'Add'}
                  </Button>
                </div>
              </div>
            )}

            {parts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No parts or hardware added yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left py-2 px-3">Type</th>
                        <th className="text-left py-2 px-3">Part #</th>
                        <th className="text-left py-2 px-3">Description</th>
                        <th className="text-right py-2 px-3">Qty</th>
                        <th className="text-left py-2 px-3">Stock / Bolt Spec</th>
                        <th className="text-right py-2 px-3">Parts/Stock</th>
                        <th className="text-right py-2 px-3">Stock Qty Req'd</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parts.map((p) => (
                        <tr key={p.id} onClick={() => setViewingPart(p)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                          <td className="py-2 px-3">{(p.item_type || 'Loose_Part').replace(/_/g, ' ')}</td>
                          <td className="py-2 px-3 font-mono font-medium">{p.part_number || '—'}</td>
                          <td className="py-2 px-3 text-muted-foreground">{p.description || '—'}</td>
                          <td className="py-2 px-3 text-right">{p.quantity || 0}</td>
                          <td className="py-2 px-3 text-xs">
                            {p.item_type === 'Bolt' ? `${p.bolt_size || '—'} ${p.bolt_grade || ''}`.trim() : (p.stock_material_description || '—')}
                          </td>
                          <td className="py-2 px-3 text-right">{p.parts_per_stock || '—'}</td>
                          <td className="py-2 px-3 text-right font-mono">{p.stock_qty_required || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Total Parts by Type</p>
                    <div className="space-y-1">
                      {Object.entries(partCountByType).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-sm">
                          <span>{type.replace(/_/g, ' ')}</span>
                          <span className="font-mono font-medium">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Stock Lengths Required</p>
                    <div className="space-y-1">
                      {Object.keys(stockLengthsByMaterial).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No stock material requirements.</p>
                      ) : Object.entries(stockLengthsByMaterial).map(([material, qty]) => (
                        <div key={material} className="flex items-center justify-between text-sm gap-2">
                          <span className="truncate">{material}</span>
                          <span className="font-mono font-medium flex-shrink-0">{qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* Phasing */}
        <TabsContent value="phasing">
          <div className="steel-card p-5 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-semibold">Phasing Mode</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sequence orders pieces by numbered erection sequence. Area groups pieces into named zones.
                </p>
              </div>
              <Select value={phasingMode} onValueChange={handleSetPhasingMode} disabled={savingPhaseMode}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequence">Sequence</SelectItem>
                  <SelectItem value="area">Area</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {pieces.length === 0 ? (
            <div className="steel-card p-12 text-center">
              <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No pieces yet — add pieces on the Pieces tab first.</p>
            </div>
          ) : (
            <>
              {selectedPieceIds.size > 0 && (
                <div className="steel-card p-3 mb-4 flex items-center gap-3 flex-wrap border-primary/40 bg-primary/5">
                  <span className="text-sm font-medium">{selectedPieceIds.size} selected</span>
                  <Input
                    value={bulkPhaseTarget}
                    onChange={(e) => setBulkPhaseTarget(e.target.value)}
                    placeholder={phasingMode === 'area' ? 'Zone name…' : 'Sequence / phase name…'}
                    className="h-8 w-56"
                  />
                  <Button size="sm" onClick={handleBulkAssignPhase} disabled={!bulkPhaseTarget.trim() || bulkAssigning}>
                    {bulkAssigning ? 'Assigning…' : 'Assign Phase'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedPieceIds(new Set())}>Clear</Button>
                </div>
              )}

              <div className="space-y-4">
                {phaseEntries.map(([phaseKey, rows]) => {
                  const stats = phaseStats(rows);
                  const allSelected = rows.every((r) => selectedPieceIds.has(r.id));
                  return (
                    <div key={phaseKey} className="steel-card overflow-hidden">
                      <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{phaseKey}</h4>
                          <span className="text-xs text-muted-foreground">{rows.length} piece{rows.length === 1 ? '' : 's'} · {stats.tons.toFixed(2)}T</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Fabricated</span>
                            <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${stats.pctFabricated}%` }} />
                            </div>
                            <span className="font-medium w-8 text-right">{stats.pctFabricated}%</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Shipped</span>
                            <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-green-500" style={{ width: `${stats.pctShipped}%` }} />
                            </div>
                            <span className="font-medium w-8 text-right">{stats.pctShipped}%</span>
                          </div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                              <th className="py-2 px-3 w-8">
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  onChange={(e) => toggleSelectAllInPhase(rows, e.target.checked)}
                                />
                              </th>
                              <th className="text-left py-2 px-3">Piece Mark</th>
                              <th className="text-left py-2 px-3">Assembly</th>
                              <th className="text-right py-2 px-3">Weight</th>
                              <th className="text-left py-2 px-3">Phase</th>
                              <th className="text-left py-2 px-3">Sequence</th>
                              <th className="text-left py-2 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((p) => (
                              <tr key={p.id} onClick={() => setViewingPhasePiece(p)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                                <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                                  <input type="checkbox" checked={selectedPieceIds.has(p.id)} onChange={() => toggleSelectPiece(p.id)} />
                                </td>
                                <td className="py-2 px-3 font-mono font-medium">{p.piece_mark}</td>
                                <td className="py-2 px-3 text-muted-foreground">{p.assembly || '—'}</td>
                                <td className="py-2 px-3 text-right">{p.weight_lbs ? `${p.weight_lbs.toLocaleString()} lbs` : '—'}</td>
                                <td className="py-2 px-3">
                                  <Input
                                    defaultValue={p.phase || ''}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) => handlePhaseFieldUpdate(p, 'phase', e.target.value)}
                                    className="h-7 w-32"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <Input
                                    defaultValue={p.sequence || ''}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) => handlePhaseFieldUpdate(p, 'sequence', e.target.value)}
                                    className="h-7 w-24"
                                  />
                                </td>
                                <td className="py-2 px-3"><StatusBadge status={p.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Project — Prevailing Wage</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Prevailing Wage Project</p>
                <p className="text-xs text-muted-foreground">Requires certified payroll (WH-347) from erection subcontractors</p>
              </div>
              <Switch checked={editForm.is_prevailing_wage} onCheckedChange={(c) => setEditForm((f) => ({ ...f, is_prevailing_wage: c }))} />
            </div>
            {editForm.is_prevailing_wage && (
              <>
                <div>
                  <Label>Wage Determination Number</Label>
                  <Input value={editForm.wage_determination_number} onChange={(e) => setEditForm((f) => ({ ...f, wage_determination_number: e.target.value }))} className="mt-1" placeholder="e.g. OH-2024-001" />
                </div>
                <div>
                  <Label>Jurisdiction</Label>
                  <Input value={editForm.prevailing_wage_jurisdiction} onChange={(e) => setEditForm((f) => ({ ...f, prevailing_wage_jurisdiction: e.target.value }))} className="mt-1" placeholder="e.g. Ohio" />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={savingEdit} className="steel-gradient text-white border-0">
                {savingEdit ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingPart} onOpenChange={(o) => !o && setViewingPart(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{viewingPart?.part_number || viewingPart?.piece_mark}</DialogTitle></DialogHeader>
          {viewingPart && (
            <div className="space-y-2">
              {[
                ['Item Type', (viewingPart.item_type || 'Loose_Part').replace(/_/g, ' ')],
                ['Part Number', viewingPart.part_number],
                ['Description', viewingPart.description],
                ['Quantity', viewingPart.quantity],
                ['Phase', viewingPart.phase],
                ['Sequence', viewingPart.sequence],
                ...(viewingPart.item_type === 'Bolt' ? [
                  ['Bolt Size', viewingPart.bolt_size],
                  ['Bolt Grade', viewingPart.bolt_grade],
                ] : [
                  ['Stock Material Description', viewingPart.stock_material_description],
                  ['Parts per Stock Length', viewingPart.parts_per_stock],
                ]),
                ['Stock Qty Required', viewingPart.stock_qty_required],
                ['Actual Parts Yielded', viewingPart.actual_parts_yielded],
                ['Scrap Qty', viewingPart.scrap_qty],
                ['Status', viewingPart.status],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="col-span-2 font-medium">{value || value === 0 ? value : '—'}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingPart(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingPhasePiece} onOpenChange={(o) => !o && setViewingPhasePiece(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{viewingPhasePiece?.piece_mark}</DialogTitle></DialogHeader>
          {viewingPhasePiece && (
            <div className="space-y-2">
              {[
                ['Piece Mark', viewingPhasePiece.piece_mark],
                ['Assembly', viewingPhasePiece.assembly],
                ['Description', viewingPhasePiece.description],
                ['Material Grade', viewingPhasePiece.material_grade],
                ['Weight', viewingPhasePiece.weight_lbs ? `${viewingPhasePiece.weight_lbs.toLocaleString()} lbs` : null],
                ['Quantity', viewingPhasePiece.quantity],
                ['Phase', viewingPhasePiece.phase],
                ['Sequence', viewingPhasePiece.sequence],
                ['Status', viewingPhasePiece.status],
                ['Warehouse Zone', viewingPhasePiece.warehouse_zone],
                ['Drawing Number', viewingPhasePiece.drawing_number],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="col-span-2 font-medium">{value || value === 0 ? value : '—'}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingPhasePiece(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}