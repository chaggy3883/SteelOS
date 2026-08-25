import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { listEmployeesForRole, assignPlatformRoles, employeeDisplayStatus } from '@/lib/employeesApi';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import { isAdminUser } from '@/lib/tenantContext';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import EmployeeAdminDialog from '@/components/admin/EmployeeAdminDialog';
import RoleMultiSelect from '@/components/admin/RoleMultiSelect';
import { ShieldAlert, UserCog } from 'lucide-react';

const STATUS_OPTIONS = ['Active', 'On Leave', 'Probation', 'Inactive', 'Terminated'];
const ALL = '__all__';
const UNASSIGNED = '__unassigned__';

const statusColor = (status) => {
  if (status === 'Active') return 'bg-green-500/10 text-green-600';
  if (status === 'Terminated') return 'bg-red-500/10 text-red-600';
  if (status === 'Inactive') return 'bg-gray-500/10 text-gray-500';
  return 'bg-amber-500/10 text-amber-600';
};

export default function AdminEmployees() {
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [departmentFilter, setDepartmentFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [quickAssigningId, setQuickAssigningId] = useState(null);
  const [detailEmployee, setDetailEmployee] = useState(null);
  const [bulkRoles, setBulkRoles] = useState([]);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    let currentRoles = ['user'];
    let me = null;
    try {
      me = await db.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
    } catch (e) {}
    const admin = isAdminUser(me);
    setIsAdmin(admin);
    if (admin) {
      await loadEmployees(currentRoles);
      getAllRoles().then((r) => setAllRoles(r.filter((role) => role.value !== 'super_admin'))).catch(() => setAllRoles([]));
    }
    setCheckingAccess(false);
  };

  const loadEmployees = async (currentRoles) => {
    setLoading(true);
    try {
      const data = await listEmployeesForRole(currentRoles, '-created_date', 500);
      setEmployees(data);
    } finally {
      setLoading(false);
    }
  };

  const departmentOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(),
    [employees]
  );

  const roleLabel = (value) => allRoles.find((r) => r.value === value)?.label || value;
  const rolesLabel = (values) => (values && values.length > 0 ? values.map(roleLabel).join(', ') : '—');

  const filtered = useMemo(() => {
    return employees
      .filter((e) => departmentFilter === ALL || e.department === departmentFilter)
      .filter((e) => statusFilter === ALL || employeeDisplayStatus(e) === statusFilter)
      .filter((e) => {
        if (roleFilter === ALL) return true;
        if (roleFilter === UNASSIGNED) return !(e.platform_roles && e.platform_roles.length);
        return (e.platform_roles || []).includes(roleFilter);
      })
      // Employees with no role yet surface first so admins see who still
      // needs assignment without having to filter for them.
      .sort((a, b) => {
        const aUnassigned = !(a.platform_roles && a.platform_roles.length);
        const bUnassigned = !(b.platform_roles && b.platform_roles.length);
        if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
  }, [employees, departmentFilter, statusFilter, roleFilter]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((e) => e.id))));
  };

  const handleQuickAssign = async (employee, roles) => {
    setQuickAssigningId(employee.id);
    try {
      const updated = await assignPlatformRoles(employee, roles);
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      toast({ title: `${updated.full_name} assigned to ${rolesLabel(roles)}` });
    } finally {
      setQuickAssigningId(null);
    }
  };

  const handleBulkApply = async () => {
    setApplyingBulk(true);
    try {
      const targets = employees.filter((e) => selectedIds.has(e.id));
      const updates = await Promise.all(targets.map((e) => assignPlatformRoles(e, bulkRoles)));
      const updatedById = Object.fromEntries(updates.map((u) => [u.id, u]));
      setEmployees((prev) => prev.map((e) => updatedById[e.id] || e));
      toast({ title: `${updates.length} employee${updates.length === 1 ? '' : 's'} assigned to ${rolesLabel(bulkRoles)}` });
      setSelectedIds(new Set());
      setConfirmBulkOpen(false);
      setBulkRoles([]);
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleDialogUpdated = (updated) => {
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setDetailEmployee(updated);
  };

  if (checkingAccess) {
    return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
        <h1 className="text-lg font-semibold">Admin Access Required</h1>
        <p className="text-sm text-muted-foreground">Only administrators can access Employee Management.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader title="Employees" subtitle="Assign roles and manage employee status — roles are the sole source of module access" />

      <div className="flex flex-wrap gap-3">
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Departments</SelectItem>
            {departmentOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Roles</SelectItem>
            <SelectItem value={UNASSIGNED}>Needs Role Assignment</SelectItem>
            {allRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedIds.size > 0 && (
        <div className="steel-card p-3 flex items-center gap-3">
          <p className="text-sm font-medium whitespace-nowrap">{selectedIds.size} selected</p>
          <RoleMultiSelect roles={allRoles} value={bulkRoles} onChange={setBulkRoles} placeholder="Change roles to…" className="w-56" />
          <Button size="sm" disabled={bulkRoles.length === 0} onClick={() => setConfirmBulkOpen(true)} className="steel-gradient text-white border-0">
            Change Roles
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear selection</Button>
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="py-3 px-4 w-8">
                  <Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll} />
                </th>
                <th className="text-left py-3 px-4">Name</th>
                <th className="text-left py-3 px-4">Department</th>
                <th className="text-left py-3 px-4">Position</th>
                <th className="text-left py-3 px-4">Role</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="py-3 px-4"><div className="h-8 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center">
                  <UserCog className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No employees match these filters</p>
                </td></tr>
              ) : (
                filtered.map((emp) => {
                  const status = employeeDisplayStatus(emp);
                  const needsRole = !(emp.platform_roles && emp.platform_roles.length);
                  return (
                    <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4">
                        <Checkbox checked={selectedIds.has(emp.id)} onCheckedChange={() => toggleSelected(emp.id)} />
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={() => setDetailEmployee(emp)} className="text-primary hover:underline font-medium">{emp.full_name}</button>
                        {needsRole && (
                          <span className="ml-2 inline-flex items-center text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">Needs Role Assignment</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{emp.department || '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground">{emp.job_title || '—'}</td>
                      <td className="py-3 px-4">
                        {needsRole ? (
                          <RoleMultiSelect
                            roles={allRoles}
                            value={emp.platform_roles || []}
                            onChange={(v) => handleQuickAssign(emp, v)}
                            disabled={quickAssigningId === emp.id}
                            placeholder="Quick assign…"
                            className="w-48"
                          />
                        ) : (
                          <span className="text-sm">{rolesLabel(emp.platform_roles)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(status)}`}>{status}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button size="sm" variant="outline" onClick={() => setDetailEmployee(emp)}>Manage</Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EmployeeAdminDialog
        employee={detailEmployee}
        open={!!detailEmployee}
        onOpenChange={(o) => !o && setDetailEmployee(null)}
        allRoles={allRoles}
        onUpdated={handleDialogUpdated}
      />

      <Dialog open={confirmBulkOpen} onOpenChange={setConfirmBulkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change roles for {selectedIds.size} employee{selectedIds.size === 1 ? '' : 's'}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This sets each selected employee's roles to <span className="font-medium text-foreground">{rolesLabel(bulkRoles)}</span>, replacing whatever roles (and linked portal login roles) they currently have.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBulkOpen(false)}>Cancel</Button>
            <Button disabled={applyingBulk} onClick={handleBulkApply} className="steel-gradient text-white border-0">
              {applyingBulk ? 'Applying…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
