import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { CalendarClock, ChevronLeft, ChevronRight, ShieldAlert, Clock, Users, TrendingUp, FolderKanban, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { computeOvertimeForClockOut, startOfWeek } from '@/lib/attendanceMath';
import { hasModule } from '@/lib/moduleEntitlement';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import ModuleLocked from '@/components/shared/ModuleLocked';

const ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'controller', 'project_manager', 'shop_manager'];
const ACTIVE_PROJECT_STATUSES = ['awarded', 'engineering', 'fabrication', 'erection'];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const todayStr = () => new Date().toISOString().slice(0, 10);
const dateKey = (d) => d.toISOString().slice(0, 10);
const shortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

function buildWeekDays(anchorDateStr) {
  const anchor = new Date(`${anchorDateStr}T00:00:00`);
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end = new Date(day); end.setHours(23, 59, 59, 999);
    return { date: day, key: dateKey(day), startMs: start.getTime(), endMs: end.getTime() };
  });
}

// Buckets each Clock_Out's regular/OT split (via the shared daily/weekly
// cap logic in attendanceMath.js) into whichever calendar day the clock-out
// itself falls on — same shift-attribution convention Payroll.jsx uses, no
// overnight-shift splitting since nothing else in this app models that either.
function computeWeekMinutesForEmployee(employeeId, allEmployeePunches, weekDays) {
  const perDay = weekDays.map(() => ({ regularMinutes: 0, overtimeMinutes: 0, projectMinutes: {} }));
  allEmployeePunches
    .filter((p) => p.punch_type === 'Clock_Out')
    .forEach((p) => {
      const t = new Date(p.punch_time).getTime();
      const dayIdx = weekDays.findIndex((d) => t >= d.startMs && t <= d.endMs);
      if (dayIdx === -1) return;
      const { total_regular_minutes, total_overtime_minutes } = computeOvertimeForClockOut(employeeId, p.punch_time, allEmployeePunches);
      perDay[dayIdx].regularMinutes += total_regular_minutes;
      perDay[dayIdx].overtimeMinutes += total_overtime_minutes;
      const key = p.project_id || '';
      const shiftMinutes = total_regular_minutes + total_overtime_minutes;
      perDay[dayIdx].projectMinutes[key] = (perDay[dayIdx].projectMinutes[key] || 0) + shiftMinutes;
    });
  return perDay;
}

const hoursOf = (minutes) => Math.round((minutes / 60) * 10) / 10;

export default function PayrollHours() {
  useDocumentTitle('SteelOS — Hours at a Glance');
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [allPunches, setAllPunches] = useState([]);
  const [projects, setProjects] = useState([]);
  const [equipmentLogs, setEquipmentLogs] = useState([]);
  const [fleetAssets, setFleetAssets] = useState([]);
  const [company, setCompany] = useState(null);

  const [anchorDate, setAnchorDate] = useState(todayStr());
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const gridTableRef = useRef(null);
  const scrollToGrid = () => gridTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const [showOtSeparately, setShowOtSeparately] = useState(false);

  const [selectedCell, setSelectedCell] = useState(null); // { employee, dayIdx }
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  // Independent of the role-based checkAccess effect below and of the
  // `company` state loaded by loadData() for the unrelated 'equipment'
  // add-on check — this is a coarser, earlier gate: "is /payroll/hours in
  // the company's pack at all," and must resolve regardless of role.
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((c) => setModuleAllowed(hasModule(c, '/payroll/hours')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const me = await db.auth.me();
        const roles = me?.roles || me?.user?.roles || ['user'];
        setAllowed(roles.some((r) => ALLOWED_ROLES.includes(normalizeRoleName(r))));
      } catch (e) {
        setAllowed(false);
      } finally {
        setAccessChecked(true);
      }
    };
    checkAccess();
  }, []);

  useEffect(() => {
    if (accessChecked && allowed) loadData();
  }, [accessChecked, allowed]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [emps, punches, projList, equipLogs, assets, effectiveCompany] = await Promise.all([
        db.entities.employees.filter({ is_active: true }, 'full_name', 500),
        db.entities.attendance_punches.list('-punch_time', 5000),
        db.entities.Project.filter({ is_archived: false }, 'name', 300),
        db.entities.EquipmentUsageLog.list('-usage_date', 2000),
        db.entities.erection_fleet_assets.list('asset_name', 500),
        getEffectiveCompany(),
      ]);
      setEmployees(emps);
      setAllPunches(punches);
      setProjects(projList.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status)));
      setEquipmentLogs(equipLogs);
      setFleetAssets(assets);
      setCompany(effectiveCompany);
    } catch (e) {
      console.error('Failed to load hours-at-a-glance data', e);
    } finally {
      setLoading(false);
    }
  };

  const weekDays = useMemo(() => buildWeekDays(anchorDate), [anchorDate]);
  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const assetsById = useMemo(() => Object.fromEntries(fleetAssets.map((a) => [a.id, a])), [fleetAssets]);
  const departments = useMemo(() => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(), [employees]);

  const punchesByEmployee = useMemo(() => {
    const map = {};
    allPunches.forEach((p) => {
      if (!map[p.employee_id]) map[p.employee_id] = [];
      map[p.employee_id].push(p);
    });
    return map;
  }, [allPunches]);

  const weekMinutesByEmployee = useMemo(() => {
    const map = {};
    employees.forEach((emp) => {
      map[emp.id] = computeWeekMinutesForEmployee(emp.id, punchesByEmployee[emp.id] || [], weekDays);
    });
    return map;
  }, [employees, punchesByEmployee, weekDays]);

  const filteredEmployees = employees.filter((emp) => {
    if (departmentFilter !== 'all' && emp.department !== departmentFilter) return false;
    if (projectFilter !== 'all') {
      const perDay = weekMinutesByEmployee[emp.id] || [];
      const touchedProject = perDay.some((d) => (d.projectMinutes[projectFilter] || 0) > 0);
      if (!touchedProject) return false;
    }
    return true;
  });

  const employeeWeekTotals = (emp) => {
    const perDay = weekMinutesByEmployee[emp.id] || [];
    return perDay.reduce((acc, d) => ({
      regularMinutes: acc.regularMinutes + d.regularMinutes,
      overtimeMinutes: acc.overtimeMinutes + d.overtimeMinutes,
    }), { regularMinutes: 0, overtimeMinutes: 0 });
  };

  // ============ Summary stats (scoped to the filtered employee set) ============
  const summary = useMemo(() => {
    let totalMinutes = 0;
    let otMinutes = 0;
    let employeesWithHours = 0;
    const projectMinutesTotal = {};
    filteredEmployees.forEach((emp) => {
      const { regularMinutes, overtimeMinutes } = employeeWeekTotals(emp);
      const empTotal = regularMinutes + overtimeMinutes;
      totalMinutes += empTotal;
      otMinutes += overtimeMinutes;
      if (empTotal > 0) employeesWithHours += 1;
      (weekMinutesByEmployee[emp.id] || []).forEach((d) => {
        Object.entries(d.projectMinutes).forEach(([projectId, minutes]) => {
          if (!projectId) return;
          projectMinutesTotal[projectId] = (projectMinutesTotal[projectId] || 0) + minutes;
        });
      });
    });
    const topProjects = Object.entries(projectMinutesTotal)
      .map(([projectId, minutes]) => ({ projectId, hours: hoursOf(minutes) }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);
    return { totalHours: hoursOf(totalMinutes), otHours: hoursOf(otMinutes), employeesWithHours, topProjects };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEmployees, weekMinutesByEmployee]);

  const dailyColumnTotals = weekDays.map((_, dayIdx) => {
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    filteredEmployees.forEach((emp) => {
      const d = (weekMinutesByEmployee[emp.id] || [])[dayIdx];
      if (!d) return;
      regularMinutes += d.regularMinutes;
      overtimeMinutes += d.overtimeMinutes;
    });
    return { regularMinutes, overtimeMinutes };
  });
  const grandTotalHours = hoursOf(dailyColumnTotals.reduce((s, d) => s + d.regularMinutes + d.overtimeMinutes, 0));

  const cellClass = (totalHrs) => {
    if (totalHrs > 12) return 'text-red-600 font-semibold';
    if (totalHrs > 8) return 'text-amber-600 font-semibold';
    return '';
  };

  // ============ Cell detail dialog ============
  const cellDetail = useMemo(() => {
    if (!selectedCell) return null;
    const { employee, dayIdx } = selectedCell;
    const day = weekDays[dayIdx];
    const perDay = (weekMinutesByEmployee[employee.id] || [])[dayIdx];
    const projectRows = Object.entries(perDay?.projectMinutes || {}).map(([projectId, minutes]) => ({
      label: projectId ? (projectsById[projectId] ? `${projectsById[projectId].project_number} — ${projectsById[projectId].name}` : projectId) : 'Unassigned / Overhead',
      hours: hoursOf(minutes),
    })).sort((a, b) => b.hours - a.hours);

    const dayEquipmentLogs = equipmentLogs.filter((l) => l.operator_employee_id === employee.id && l.usage_date === day.key);

    const dayPunches = (punchesByEmployee[employee.id] || [])
      .filter((p) => { const t = new Date(p.punch_time).getTime(); return t >= day.startMs && t <= day.endMs; })
      .sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());

    return { day, projectRows, dayEquipmentLogs, dayPunches };
  }, [selectedCell, weekDays, weekMinutesByEmployee, projectsById, equipmentLogs, punchesByEmployee]);

  const shiftWeek = (deltaDays) => {
    const d = new Date(`${anchorDate}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    setAnchorDate(dateKey(d));
  };

  if (!accessChecked || checkingModuleAccess) {
    return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;
  }

  // Route guard — a direct URL to /payroll/hours can't bypass the nav's
  // module-pack filtering. Strictly earlier/coarser than the role-based
  // check below.
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/payroll/hours" title="Payroll Not Included" />;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Hours at a Glance is only available to Admin, Payroll Admin, Controller, Project Manager, and Shop Manager roles.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Hours at a Glance" subtitle="Weekly attendance grid — regular/overtime hours by employee and day" icon={CalendarClock} />

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shiftWeek(-7)}><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="w-40" />
          <Button variant="outline" size="icon" onClick={() => shiftWeek(7)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <span className="text-sm text-muted-foreground">{shortDate(weekDays[0].date)} — {shortDate(weekDays[6].date)}</span>

        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm ml-auto">
          <Switch checked={showOtSeparately} onCheckedChange={setShowOtSeparately} />
          Show overtime separately
        </label>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <button type="button" onClick={scrollToGrid} className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-blue-500" /><p className="text-xs text-muted-foreground">Total Hours This Week</p></div>
          <p className="text-2xl font-bold text-blue-500">{summary.totalHours.toFixed(1)}</p>
        </button>
        <button type="button" onClick={scrollToGrid} className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow">
          <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-amber-500" /><p className="text-xs text-muted-foreground">Total OT Hours</p></div>
          <p className="text-2xl font-bold text-amber-500">{summary.otHours.toFixed(1)}</p>
        </button>
        <button type="button" onClick={scrollToGrid} className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow">
          <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-green-500" /><p className="text-xs text-muted-foreground">Employees With Hours</p></div>
          <p className="text-2xl font-bold text-green-500">{summary.employeesWithHours}</p>
        </button>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 mb-2"><FolderKanban className="w-4 h-4 text-primary" /><p className="text-xs text-muted-foreground">Top Projects (Labor Hours)</p></div>
          <div className="space-y-1">
            {summary.topProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground">No project-tagged hours.</p>
            ) : summary.topProjects.map(({ projectId, hours }) => (
              <button type="button" key={projectId} onClick={() => { setProjectFilter(projectId); scrollToGrid(); }} className="w-full flex items-center justify-between text-xs rounded px-1 -mx-1 hover:bg-muted/50">
                <span className="text-muted-foreground truncate" title={projectsById[projectId]?.name || projectId}>{projectsById[projectId]?.name || projectId}</span>
                <span className="font-mono font-semibold">{hours.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={gridTableRef} className="steel-card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-2 px-3">Employee</th>
              {weekDays.map((d, i) => (
                <th key={d.key} className="text-center py-2 px-2">{WEEKDAY_LABELS[i]}<br /><span className="normal-case font-normal">{shortDate(d.date)}</span></th>
              ))}
              <th className="text-right py-2 px-3">Week Total</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-sm text-muted-foreground">No employees match the current filters</td></tr>
            ) : filteredEmployees.map((emp) => {
              const perDay = weekMinutesByEmployee[emp.id] || [];
              const weekTotal = employeeWeekTotals(emp);
              const weekTotalHours = hoursOf(weekTotal.regularMinutes + weekTotal.overtimeMinutes);
              return (
                <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-3 font-medium whitespace-nowrap">{emp.full_name}</td>
                  {perDay.map((d, dayIdx) => {
                    const totalMinutes = d.regularMinutes + d.overtimeMinutes;
                    const totalHrs = hoursOf(totalMinutes);
                    if (totalMinutes <= 0) {
                      return <td key={dayIdx} className="text-center py-2 px-2 text-muted-foreground cursor-pointer" onClick={() => setSelectedCell({ employee: emp, dayIdx })}>—</td>;
                    }
                    return (
                      <td key={dayIdx} className={`text-center py-2 px-2 cursor-pointer ${cellClass(totalHrs)}`} onClick={() => setSelectedCell({ employee: emp, dayIdx })}>
                        {showOtSeparately ? (
                          <div>
                            <div>{hoursOf(d.regularMinutes).toFixed(1)}</div>
                            {d.overtimeMinutes > 0 && <div className="text-[11px] text-amber-600">+{hoursOf(d.overtimeMinutes).toFixed(1)} OT</div>}
                          </div>
                        ) : (
                          <span>{totalHrs.toFixed(1)}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right py-2 px-3 font-bold">{weekTotalHours.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
          {filteredEmployees.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="py-2 px-3">Daily Total</td>
                {dailyColumnTotals.map((d, i) => (
                  <td key={i} className="text-center py-2 px-2">{hoursOf(d.regularMinutes + d.overtimeMinutes).toFixed(1)}</td>
                ))}
                <td className="text-right py-2 px-3">{grandTotalHours.toFixed(1)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Dialog open={!!selectedCell} onOpenChange={(o) => { if (!o) setSelectedCell(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedCell && cellDetail && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedCell.employee.full_name} — {WEEKDAY_LABELS[selectedCell.dayIdx]} {shortDate(cellDetail.day.date)}</DialogTitle>
              </DialogHeader>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Projects Worked</p>
                {cellDetail.projectRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hours logged this day.</p>
                ) : (
                  <div className="space-y-1">
                    {cellDetail.projectRows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between text-sm">
                        <span>{row.label}</span>
                        <span className="font-mono font-medium">{row.hours.toFixed(1)} hrs</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {hasModule(company, 'equipment') && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" />Equipment Operated</p>
                  {cellDetail.dayEquipmentLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No equipment usage logged this day.</p>
                  ) : (
                    <div className="space-y-1">
                      {cellDetail.dayEquipmentLogs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between text-sm">
                          <span>{assetsById[log.asset_id]?.asset_name || log.asset_id}{projectsById[log.project_id] ? ` — ${projectsById[log.project_id].name}` : ''}</span>
                          <span className="font-mono font-medium">{Number(log.hours_used || 0).toFixed(1)} hrs</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Raw Punches</p>
                {cellDetail.dayPunches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No punches recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {cellDetail.dayPunches.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm font-mono">
                        <span className="text-muted-foreground">{p.punch_type.replace('_', ' ')}</span>
                        <span>{new Date(p.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
