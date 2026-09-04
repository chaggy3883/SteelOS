import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/tenantContext';
import { exportRowsToCsv } from '@/lib/csvExport';
import { ShieldCheck, Loader2, Search, ChevronLeft, ChevronRight, Download, ScrollText, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const PAGE_SIZE = 25;
const LOAD_LIMIT = 5000;

// Entity types whose changes count toward the "Payroll changes this cycle"
// breakdown — kept as an explicit list rather than a naming-convention guess,
// since payroll-adjacent entities don't share a common prefix.
const PAYROLL_ENTITY_TYPES = new Set([
  'PayrollRun', 'PayrollLine', 'PayrollLineTax', 'PayrollLineDeduction', 'PayrollAdjustment', 'PayrollRegisterLine', 'EmployeePayRate',
  'PayrollLiability', 'PayrollJournal', 'TimeEntry', 'Timecard', 'JobLaborAllocation',
  'CertifiedPayrollSubmission', 'CertifiedPayrollReport', 'PayPeriod',
]);

const ACTION_LABELS = { create: 'Created', update: 'Updated', delete: 'Deleted' };

const truncate = (str, len = 60) => {
  if (str === null || str === undefined) return '—';
  const s = String(str);
  return s.length > len ? `${s.slice(0, len)}…` : s;
};

const formatTimestamp = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export default function AuditTrail() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const isAdmin = isAdminUser(currentUser);

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [logs, setLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [payPeriods, setPayPeriods] = useState([]);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityIdSearch, setEntityIdSearch] = useState('');
  const [page, setPage] = useState(0);
  const [detailLog, setDetailLog] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [softDeleting, setSoftDeleting] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    if (!isAdmin) {
      setCheckingAccess(false);
      db.entities.FailedAccessLog.create({
        attempted_identifier: currentUser.email || currentUser.full_name || currentUser.id,
        reason: 'permission_denied',
        context: 'audit_trail_access',
        user_id: currentUser.id,
        company_id: currentUser.company_id || null,
      }).catch(() => {});
      return;
    }
    setCheckingAccess(false);
    loadData();
  }, [currentUser]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [logRows, employeeRows, periodRows] = await Promise.all([
        db.entities.AuditLog.list('-created_date', LOAD_LIMIT),
        db.entities.employees.list('full_name', 1000),
        db.entities.PayPeriod.list('-period_start', 50),
      ]);
      setLogs(logRows.filter((l) => !l.is_deleted));
      setEmployees(employeeRows);
      setPayPeriods(periodRows);
    } catch (e) {
      toast({ title: 'Unable to load audit trail', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const entityTypeOptions = useMemo(
    () => Array.from(new Set(logs.map((l) => l.entity_type).filter(Boolean))).sort(),
    [logs]
  );
  const userOptions = useMemo(() => {
    const map = new Map();
    logs.forEach((l) => {
      if (l.user_id && !map.has(l.user_id)) map.set(l.user_id, l.user_name || l.user_email || l.user_id);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [logs]);

  const [payrollOnlyFilter, setPayrollOnlyFilter] = useState(false);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (dateFrom && log.created_date < dateFrom) return false;
      if (dateTo && log.created_date > `${dateTo}T23:59:59.999Z`) return false;
      if (entityTypeFilter !== 'all' && log.entity_type !== entityTypeFilter) return false;
      if (userFilter !== 'all' && log.user_id !== userFilter) return false;
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (entityIdSearch && !String(log.entity_id || '').toLowerCase().includes(entityIdSearch.toLowerCase())) return false;
      if (payrollOnlyFilter && !PAYROLL_ENTITY_TYPES.has(log.entity_type)) return false;
      return true;
    });
  }, [logs, dateFrom, dateTo, entityTypeFilter, userFilter, actionFilter, entityIdSearch, payrollOnlyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageLogs = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const resetFilters = () => {
    setDateFrom(''); setDateTo(''); setEntityTypeFilter('all'); setUserFilter('all'); setActionFilter('all'); setEntityIdSearch(''); setPayrollOnlyFilter(false); setPage(0);
  };

  const applyDrilldown = (patch) => {
    resetFilters();
    Object.entries(patch).forEach(([key, value]) => {
      if (key === 'entityType') setEntityTypeFilter(value);
      if (key === 'userId') setUserFilter(value);
      if (key === 'entityId') setEntityIdSearch(value);
      if (key === 'action') setActionFilter(value);
      if (key === 'dateFrom') setDateFrom(value);
      if (key === 'dateTo') setDateTo(value);
      if (key === 'payrollOnly') setPayrollOnlyFilter(value);
    });
  };

  // Breakdowns — computed over whatever the active date-range/filters already
  // narrowed `filtered` down to, so they reflect the same window the table
  // shows rather than the full unfiltered history.
  const mostChangedRecords = useMemo(() => {
    const counts = new Map();
    filtered.forEach((l) => {
      if (!l.entity_id) return;
      const key = `${l.entity_type}::${l.entity_id}`;
      counts.set(key, (counts.get(key) || { entity_type: l.entity_type, entity_id: l.entity_id, count: 0 }));
      counts.get(key).count += 1;
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filtered]);

  const topChangersThisMonth = useMemo(() => {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counts = new Map();
    logs.forEach((l) => {
      if (!l.user_id || !String(l.created_date || '').startsWith(monthPrefix)) return;
      const key = l.user_id;
      counts.set(key, counts.get(key) || { user_id: key, user_name: l.user_name || l.user_email || key, count: 0 });
      counts.get(key).count += 1;
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [logs]);

  const deletionsByType = useMemo(() => {
    const counts = new Map();
    filtered.forEach((l) => {
      if (l.action !== 'delete') return;
      counts.set(l.entity_type, (counts.get(l.entity_type) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([entity_type, count]) => ({ entity_type, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filtered]);

  const currentPayPeriod = useMemo(
    () => payPeriods.find((p) => p.status === 'open' || p.status === 'processing') || null,
    [payPeriods]
  );
  const payrollChangesThisCycle = useMemo(() => {
    if (!currentPayPeriod) return null;
    const count = logs.filter((l) =>
      PAYROLL_ENTITY_TYPES.has(l.entity_type) &&
      l.created_date >= currentPayPeriod.period_start &&
      l.created_date <= `${currentPayPeriod.period_end}T23:59:59.999Z`
    ).length;
    return { count, period: currentPayPeriod };
  }, [logs, currentPayPeriod]);

  const handleExportCsv = () => {
    exportRowsToCsv({
      filename: `audit-trail-${dateFrom || 'all'}-to-${dateTo || 'present'}`,
      columns: ['Timestamp', 'User', 'User Email', 'Entity Type', 'Entity ID', 'Action', 'Field Changed', 'Old Value', 'New Value', 'Change Summary'],
      rows: filtered.map((l) => [
        l.created_date, l.user_name || '', l.user_email || '', l.entity_type || '', l.entity_id || '',
        l.action || l.action_type || '', l.field_name || '', l.old_value || '', l.new_value || '', l.change_summary || '',
      ]),
    });
  };

  const employeeNameFor = (id) => employees.find((e) => e.id === id)?.full_name;

  const handleSoftDelete = async () => {
    if (!detailLog || !deleteReason.trim()) return;
    setSoftDeleting(true);
    try {
      await db.entities.AuditLog.update(detailLog.id, { is_deleted: true, delete_reason: deleteReason.trim() });
      setLogs((prev) => prev.filter((l) => l.id !== detailLog.id));
      toast({ title: 'Audit entry soft-deleted' });
      setDetailLog(null);
      setDeleteReason('');
    } catch (e) {
      toast({ title: 'Unable to soft-delete entry', variant: 'destructive' });
    } finally {
      setSoftDeleting(false);
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">The Audit Trail is restricted to Admin and Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Audit Trail"
        subtitle="Immutable, field-level record of who created, edited, or deleted any record. Retained for 1 year."
        actions={<Button variant="outline" onClick={handleExportCsv}><Download className="w-4 h-4" />Export CSV</Button>}
      />

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="steel-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Most Changed Records</p>
          {mostChangedRecords.length === 0 ? <p className="text-xs text-muted-foreground">No data in range.</p> : mostChangedRecords.map((r) => (
            <button key={`${r.entity_type}-${r.entity_id}`} onClick={() => applyDrilldown({ entityType: r.entity_type, entityId: r.entity_id })}
              className="flex items-center justify-between w-full text-left text-xs py-1 hover:underline">
              <span className="truncate">{r.entity_type} / {r.entity_id}</span>
              <span className="font-mono text-muted-foreground ml-2">{r.count}</span>
            </button>
          ))}
        </div>
        <div className="steel-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Top Changers This Month</p>
          {topChangersThisMonth.length === 0 ? <p className="text-xs text-muted-foreground">No data this month.</p> : topChangersThisMonth.map((u) => (
            <button key={u.user_id} onClick={() => applyDrilldown({ userId: u.user_id })}
              className="flex items-center justify-between w-full text-left text-xs py-1 hover:underline">
              <span className="truncate">{u.user_name}</span>
              <span className="font-mono text-muted-foreground ml-2">{u.count}</span>
            </button>
          ))}
        </div>
        <div className="steel-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Deletions Made</p>
          {deletionsByType.length === 0 ? <p className="text-xs text-muted-foreground">No deletions in range.</p> : deletionsByType.map((d) => (
            <button key={d.entity_type} onClick={() => applyDrilldown({ entityType: d.entity_type, action: 'delete' })}
              className="flex items-center justify-between w-full text-left text-xs py-1 hover:underline">
              <span className="truncate">{d.entity_type}</span>
              <span className="font-mono text-muted-foreground ml-2">{d.count}</span>
            </button>
          ))}
        </div>
        <div className="steel-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Payroll Changes This Cycle</p>
          {payrollChangesThisCycle ? (
            <button
              type="button"
              onClick={() => applyDrilldown({ dateFrom: payrollChangesThisCycle.period.period_start, dateTo: payrollChangesThisCycle.period.period_end, payrollOnly: true })}
              className="text-left hover:underline"
            >
              <span className="text-2xl font-bold">{payrollChangesThisCycle.count}</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {payrollChangesThisCycle.period.period_start} → {payrollChangesThisCycle.period.period_end} ({payrollChangesThisCycle.period.status})
              </p>
            </button>
          ) : <p className="text-xs text-muted-foreground">No open or processing pay period on file.</p>}
        </div>
      </div>

      {/* Filters */}
      <div className="steel-card p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-3">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Entity Type</Label>
          <Select value={entityTypeFilter} onValueChange={(v) => { setEntityTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entity Types</SelectItem>
              {entityTypeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">User</Label>
          <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); setPage(0); }}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {userOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Action</Label>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Entity ID</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={entityIdSearch} onChange={(e) => { setEntityIdSearch(e.target.value); setPage(0); }} placeholder="Search…" className="pl-7" />
          </div>
        </div>
        {(dateFrom || dateTo || entityTypeFilter !== 'all' || userFilter !== 'all' || actionFilter !== 'all' || entityIdSearch) && (
          <div className="col-span-2 md:col-span-6">
            <Button variant="ghost" size="sm" onClick={resetFilters}><X className="w-3.5 h-3.5" />Clear filters</Button>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Timestamp</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">User</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Entity Type</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Entity ID</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Action</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Field Changed</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Old → New</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : pageLogs.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-muted-foreground"><ScrollText className="w-8 h-8 mx-auto mb-2 opacity-40" />No audit entries match these filters.</td></tr>
            ) : pageLogs.map((log) => (
              <tr key={log.id} onClick={() => setDetailLog(log)} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer">
                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(log.created_date)}</td>
                <td className="px-3 py-2.5 text-xs">
                  <p className="font-medium">{log.user_name || 'Unknown'}</p>
                  <p className="text-[10px] text-muted-foreground">{log.user_email || ''}</p>
                </td>
                <td className="px-3 py-2.5 text-xs">{log.entity_type || '—'}</td>
                <td className="px-3 py-2.5 text-xs font-mono">{truncate(log.entity_id, 16)}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${log.action === 'delete' ? 'bg-red-500/10 text-red-500' : log.action === 'create' ? 'bg-green-500/10 text-green-600' : 'bg-primary/10 text-primary'}`}>
                    {ACTION_LABELS[log.action] || log.action_type || '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs">{log.field_name || '—'}</td>
                <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">
                  {log.action === 'delete' ? 'record removed' : `${truncate(log.old_value, 24)} → ${truncate(log.new_value, 24)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-muted-foreground">Page {page + 1} of {totalPages} • {filtered.length} matching entries</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Detail drill-down */}
      <Dialog open={!!detailLog} onOpenChange={(o) => { if (!o) { setDetailLog(null); setDeleteReason(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Audit Entry Detail</DialogTitle></DialogHeader>
          {detailLog && (
            <div className="space-y-2 text-sm py-2">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-muted-foreground">Timestamp</p><p>{formatTimestamp(detailLog.created_date)}</p></div>
                <div><p className="text-xs text-muted-foreground">Action</p><p>{ACTION_LABELS[detailLog.action] || detailLog.action_type || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">User</p><p>{detailLog.user_name || 'Unknown'} {detailLog.user_email ? `(${detailLog.user_email})` : ''}</p></div>
                <div><p className="text-xs text-muted-foreground">Entity</p><p>{detailLog.entity_type} / {detailLog.entity_id}{detailLog.entity_type === 'employees' && employeeNameFor(detailLog.entity_id) ? ` — ${employeeNameFor(detailLog.entity_id)}` : ''}</p></div>
              </div>
              {detailLog.field_name && <div><p className="text-xs text-muted-foreground">Field Changed</p><p className="font-mono">{detailLog.field_name}</p></div>}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Old Value</p>
                <pre className="text-xs bg-muted/40 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">{detailLog.old_value ?? '—'}</pre>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">New Value</p>
                <pre className="text-xs bg-muted/40 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">{detailLog.new_value ?? '—'}</pre>
              </div>
              {detailLog.change_summary && <div><p className="text-xs text-muted-foreground">Summary</p><p>{detailLog.change_summary}</p></div>}

              <div className="pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Soft-delete this entry (reason required — the underlying record is never edited or hard-deleted)</p>
                <div className="flex gap-2">
                  <Input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Reason…" className="text-xs" />
                  <Button variant="outline" size="sm" disabled={!deleteReason.trim() || softDeleting} onClick={handleSoftDelete} className="text-destructive shrink-0">
                    {softDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDetailLog(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
