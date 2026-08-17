import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { EQUIPMENT_TYPES, SERVICE_LEVELS, equipmentTypeLabel } from '@/lib/serviceScheduleEngine';
import { ShieldCheck, Plus, Trash2, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const LEVEL_ORDER = { A: 0, B: 1, C: 2, D: 3 };

export default function ServiceScheduleAdmin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.auth.me().then((u) => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => { loadSchedules(); }, []);

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const list = await db.entities.ServiceSchedule.list('-created_date', 500);
      setSchedules(list);
    } catch (e) {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (schedule) => {
    try {
      const updated = await db.entities.ServiceSchedule.update(schedule.id, { is_active: !schedule.is_active });
      setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? updated : s)));
    } catch (e) {
      toast({ title: 'Failed to update schedule', variant: 'destructive' });
    }
  };

  const handleDelete = async (schedule) => {
    if (!confirm(`Delete the ${equipmentTypeLabel(schedule.equipment_type)} Level ${schedule.service_level} schedule? This cannot be undone.`)) return;
    try {
      await db.entities.ServiceSchedule.delete(schedule.id);
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      toast({ title: 'Schedule deleted' });
    } catch (e) {
      toast({ title: 'Failed to delete schedule', variant: 'destructive' });
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need administrator privileges to manage service schedules.</p>
      </div>
    );
  }

  const groups = EQUIPMENT_TYPES.map((type) => ({
    type,
    rows: schedules
      .filter((s) => s.equipment_type === type.value)
      .sort((a, b) => LEVEL_ORDER[a.service_level] - LEVEL_ORDER[b.service_level]),
  })).filter((g) => g.rows.length > 0 || true);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Equipment Service Schedules"
        subtitle="Baseline A/B/C/D service intervals and checklists per equipment type — composed cumulatively on the Equipment Service form."
        actions={
          <Button onClick={() => navigate('/admin/service-schedules/new')} className="steel-gradient text-white border-0">
            <Plus className="w-4 h-4" />Add Schedule
          </Button>
        }
      />

      <div className="mb-6 flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p>These are baseline intervals — the manufacturer service manual for a specific asset always governs. Nothing here is hardcoded in the app; edit or deactivate any row and the Equipment Service form reflects it immediately.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ type, rows }) => (
            <div key={type.value} className="steel-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="font-semibold text-sm">{type.label}</h3>
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6 text-center">No schedules yet for this equipment type.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Level</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Interval</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Checklist Items</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Active?</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SERVICE_LEVELS.map((level) => {
                      const schedule = rows.find((s) => s.service_level === level);
                      if (!schedule) return null;
                      return (
                        <tr key={schedule.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/admin/service-schedules/${schedule.id}`)}>
                          <td className="px-4 py-3 font-semibold">Level {level}</td>
                          <td className="px-4 py-3 text-muted-foreground">{schedule.interval_label || `${schedule.interval_value} ${schedule.interval_unit}`}</td>
                          <td className="px-4 py-3 text-muted-foreground">{(schedule.checklist_items || []).length} items</td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <Switch checked={!!schedule.is_active} onCheckedChange={() => toggleActive(schedule)} />
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(schedule)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
