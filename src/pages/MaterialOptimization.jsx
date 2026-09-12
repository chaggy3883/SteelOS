import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { groupPiecesByMaterial } from '@/lib/materialOptimizer';
import MaterialOptimizationGroupPanel from '@/components/material-optimization/MaterialOptimizationGroupPanel';
import MaterialOptimizationReportPanel from '@/components/material-optimization/MaterialOptimizationReportPanel';
import PageHeader from '@/components/ui/PageHeader';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { Layers, PackageSearch, X } from 'lucide-react';

// STAGE 5: pick a project, group its PieceMark rows by shape+grade
// (groupPiecesByMaterial — never shape alone, different grades aren't
// interchangeable stock), then drill into a group to compare stock lengths
// and build/commit a cut plan (MaterialOptimizationGroupPanel).
// STAGE 12: a "Report" tab alongside the group browser — a read-only rollup
// over already-committed runs for the selected project
// (MaterialOptimizationReportPanel), never a second planning surface.
// Clicking a material row there switches back to Groups and expands that
// exact group, matching the standing drill-down rule.
//
// Detailer Import integration: arriving with ?project=&batch= (from
// BatchReviewModal.jsx's "Build Order List" button) scopes the piece list to
// just that DetailerImportBatch's committed pieces instead of the whole
// project's PieceMark pool — everything downstream (grouping, remnant
// matching, cut-plan commit) is the exact same code either way, since a
// batch-scoped piece list is still just an array of PieceMark rows.
export default function MaterialOptimization() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [pieces, setPieces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingPieces, setLoadingPieces] = useState(false);
  const [expandedGroupKey, setExpandedGroupKey] = useState(null);
  const [activeTab, setActiveTab] = useState('groups');
  const [scopedBatch, setScopedBatch] = useState(null); // DetailerImportBatch | null — null means "whole project"

  const batchParam = searchParams.get('batch');

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selectedProjectId) loadPieces(selectedProjectId, batchParam); }, [selectedProjectId, batchParam]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await db.entities.Project.list('name', 500);
      setProjects(list || []);
      const projectParam = searchParams.get('project');
      const initialProjectId = (projectParam && list?.some((p) => p.id === projectParam)) ? projectParam : list?.[0]?.id;
      if (initialProjectId) setSelectedProjectId(initialProjectId);
    } catch (e) {
      toast({ title: 'Unable to load projects', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // batchId scopes the piece list to one DetailerImportBatch: its committed
  // DetailerImportedPiece rows each carry a piece_mark_id (set at commit
  // time — see detailerImportCommit.js), so the batch's own PieceMark rows
  // are exactly { id ∈ those piece_mark_ids } within the project's full
  // list. One row per distinct piece_mark either way (never rolled up by
  // assembly — see commitBatch), so groupPiecesByMaterial below counts raw
  // material per distinct piece, not per assembly, with no extra code needed
  // for that here.
  const loadPieces = async (projectId, batchId) => {
    setLoadingPieces(true);
    setExpandedGroupKey(null);
    try {
      const list = await db.entities.PieceMark.filter({ project_id: projectId }, 'piece_mark', 5000);
      if (!batchId) {
        setPieces(list || []);
        setScopedBatch(null);
        return;
      }
      const [batch, stagedRows] = await Promise.all([
        db.entities.DetailerImportBatch.get(batchId).catch(() => null),
        db.entities.DetailerImportedPiece.filter({ batch_id: batchId, committed: true }, 'piece_mark', 2000),
      ]);
      const pieceMarkIds = new Set(stagedRows.map((r) => r.piece_mark_id).filter(Boolean));
      setPieces((list || []).filter((p) => pieceMarkIds.has(p.id)));
      setScopedBatch(batch);
    } catch (e) {
      toast({ title: 'Unable to load pieces for this project', variant: 'destructive' });
    } finally {
      setLoadingPieces(false);
    }
  };

  const clearBatchScope = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('batch');
    setSearchParams(next);
  };

  const groups = useMemo(() => groupPiecesByMaterial(pieces), [pieces]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading material optimization…</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Material Optimization"
        subtitle="Group pieces by shape and grade, compare stock length options, and commit a cut plan."
      />

      <div className="steel-card p-5 mb-6">
        <Label>Project</Label>
        <select
          className="mt-2 w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={selectedProjectId}
          onChange={(event) => {
            // Switching projects away from a batch-scoped view invalidates
            // that scope (the batch's piece_mark_ids belong to a different
            // project's PieceMark rows) — clear it rather than silently
            // showing an empty/wrong-looking group list.
            if (batchParam) clearBatchScope();
            setSelectedProjectId(event.target.value);
          }}
        >
          <option value="">Select a project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {scopedBatch && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 mb-6 text-sm">
          <p className="flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-primary flex-shrink-0" />
            Showing pieces from Detailer Import batch <span className="font-medium">{scopedBatch.detailer_name}</span> only.
          </p>
          <Button variant="ghost" size="sm" className="gap-1" onClick={clearBatchScope}>
            <X className="w-3.5 h-3.5" /> Show all project pieces
          </Button>
        </div>
      )}

      {!selectedProjectId ? (
        <p className="text-sm text-muted-foreground">Select a project to see its material groups.</p>
      ) : loadingPieces ? (
        <p className="text-sm text-muted-foreground">Loading pieces…</p>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
          </TabsList>

          <TabsContent value="groups">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pieces on this project yet.</p>
            ) : (
              <div className="steel-card overflow-hidden divide-y divide-border">
                {groups.map((group) => {
                  const expanded = expandedGroupKey === group.group_key;
                  const totalQuantity = group.pieces.reduce((sum, p) => sum + (Number(p.quantity) || 1), 0);
                  return (
                    <div key={group.group_key}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedGroupKey(expanded ? null : group.group_key)}
                        onKeyDown={(event) => { if (event.key === 'Enter') setExpandedGroupKey(expanded ? null : group.group_key); }}
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/40"
                      >
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-primary" />
                          <div>
                            <p className="text-sm font-medium">{group.material_profile || '(no profile)'} — {group.material_grade || '(no grade)'}</p>
                            <p className="text-xs text-muted-foreground">{group.pieces.length} piece mark(s), {totalQuantity} total unit(s)</p>
                          </div>
                        </div>
                        <span>{expanded ? '▾' : '▸'}</span>
                      </div>
                      {expanded && (
                        <MaterialOptimizationGroupPanel group={group} projectId={selectedProjectId} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="report">
            <MaterialOptimizationReportPanel
              projectId={selectedProjectId}
              projectName={projects.find((p) => p.id === selectedProjectId)?.name}
              pieces={pieces}
              onViewGroup={(groupKey) => { setExpandedGroupKey(groupKey); setActiveTab('groups'); }}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
