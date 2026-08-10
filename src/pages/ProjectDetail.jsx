import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import {
  ArrowLeft, Brain, MessageSquare, Package,
  DollarSign, Edit,
  AlertTriangle, Layers, Gavel, FileSignature, ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StatusBadge from '@/components/ui/StatusBadge';
import StatsCard from '@/components/ui/StatsCard';
import FileExplorer from '@/components/documents/FileExplorer';
import { useToast } from '@/components/ui/use-toast';
import { getStatutoryDeadline } from '@/lib/lienStatutes';

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

  useEffect(() => { if (id) loadAll(); }, [id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [proj, finds, rfiList, pieceList, subcontractList] = await Promise.all([
        db.entities.Project.get(id),
        db.entities.AIFinding.filter({ project_id: id }, '-created_date', 50),
        db.entities.RFI.filter({ project_id: id }, '-created_date', 20),
        db.entities.PieceMark.filter({ project_id: id }, 'piece_mark', 50),
        db.entities.Subcontract.filter({ project_id: id }, '-created_date', 50),
      ]);
      setProject(proj);
      setFindings(finds);
      setRfis(rfiList);
      setPieces(pieceList);
      setSubcontracts(subcontractList);
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
          <h1 className="text-2xl font-bold">{project.name}</h1>
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
          <Button className="steel-gradient text-white border-0 gap-2">
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
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.ai_explanation}</p>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}