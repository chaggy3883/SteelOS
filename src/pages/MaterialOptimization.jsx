import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { groupPiecesByMaterial } from '@/lib/materialOptimizer';
import MaterialOptimizationGroupPanel from '@/components/material-optimization/MaterialOptimizationGroupPanel';
import PageHeader from '@/components/ui/PageHeader';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Layers } from 'lucide-react';

// STAGE 5: pick a project, group its PieceMark rows by shape+grade
// (groupPiecesByMaterial — never shape alone, different grades aren't
// interchangeable stock), then drill into a group to compare stock lengths
// and build/commit a cut plan (MaterialOptimizationGroupPanel).
export default function MaterialOptimization() {
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [pieces, setPieces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingPieces, setLoadingPieces] = useState(false);
  const [expandedGroupKey, setExpandedGroupKey] = useState(null);

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selectedProjectId) loadPieces(selectedProjectId); }, [selectedProjectId]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await db.entities.Project.list('name', 500);
      setProjects(list || []);
      if (list?.length) setSelectedProjectId(list[0].id);
    } catch (e) {
      toast({ title: 'Unable to load projects', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadPieces = async (projectId) => {
    setLoadingPieces(true);
    setExpandedGroupKey(null);
    try {
      const list = await db.entities.PieceMark.filter({ project_id: projectId }, 'piece_mark', 5000);
      setPieces(list || []);
    } catch (e) {
      toast({ title: 'Unable to load pieces for this project', variant: 'destructive' });
    } finally {
      setLoadingPieces(false);
    }
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
          onChange={(event) => setSelectedProjectId(event.target.value)}
        >
          <option value="">Select a project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!selectedProjectId ? (
        <p className="text-sm text-muted-foreground">Select a project to see its material groups.</p>
      ) : loadingPieces ? (
        <p className="text-sm text-muted-foreground">Loading pieces…</p>
      ) : groups.length === 0 ? (
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
    </div>
  );
}
