import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess, TERMINATION_REASONS, terminationReasonLabel } from '@/lib/employeesApi';
import { computeTerminationPtoSettlementPreview, computeUnpaidWagesPreview, processTerminationSettlement, listPtoTransactionsForEmployee } from '@/lib/ptoEngine';
import { logStatusChange } from '@/lib/statusHistory';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';
import IssuedAssetDialog from '@/components/hr/IssuedAssetDialog';
import { assetTypeLabel } from '@/lib/issuedAssetsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { UserX, UserCheck, Loader2, ShieldAlert, History, CheckSquare, Square } from 'lucide-react';

const todayDateOnly = () => new Date().toISOString().slice(0, 10);
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// HR's termination checklist — the offboarding checklist further down is
// informational only (not enforced); everything above it (PTO settlement,
// unpaid wages, access revocation) IS enforced, at confirm time.
export default function TerminationPanel({ employee, roles = [], onUpdated }) {
  const { toast } = useToast();
  const canTerminate = hasFullEmployeeAccess(roles);
  const [currentUser, setCurrentUser] = useState(null);
  const [terminationDate, setTerminationDate] = useState(todayDateOnly());
  const [reason, setReason] = useState('');
  const [reasonOther, setReasonOther] = useState('');
  const [finalNotes, setFinalNotes] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [ptoPreview, setPtoPreview] = useState(null);
  const [wagesPreview, setWagesPreview] = useState(null);
  const [pastSettlement, setPastSettlement] = useState([]);
  const [finalCheckLine, setFinalCheckLine] = useState(null);
  const [issuedAssets, setIssuedAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewingPolicy, setViewingPolicy] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmReinstateOpen, setConfirmReinstateOpen] = useState(false);
  const [reinstating, setReinstating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [returningAsset, setReturningAsset] = useState(null);

  useEffect(() => { db.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null)); }, []);
  useEffect(() => { load(); }, [employee?.id, employee?.termination_date, terminationDate]);

  const load = async () => {
    setLoading(true);
    try {
      const assets = await db.entities.issued_assets.filter({ employee_id: employee.id }, '-issued_date', 50);
      setIssuedAssets(assets);
      if (employee.termination_date) {
        const [txns, lines] = await Promise.all([
          listPtoTransactionsForEmployee(employee.id),
          db.entities.PayrollLine.filter({ employee_id: employee.id }, '-created_date', 50),
        ]);
        setPastSettlement(txns.filter((t) => t.source_type === 'termination'));
        let finalLine = null;
        for (const line of lines) {
          const run = await db.entities.PayrollRun.get(line.payroll_run_id);
          if (run?.run_type === 'final_check') { finalLine = line; break; }
        }
        setFinalCheckLine(finalLine);
      } else {
        const [pto, wages] = await Promise.all([
          computeTerminationPtoSettlementPreview(employee, terminationDate),
          computeUnpaidWagesPreview(employee),
        ]);
        setPtoPreview(pto);
        setWagesPreview(wages);
      }
    } finally {
      setLoading(false);
    }
  };

  const identity = () => currentUser?.full_name || currentUser?.email || 'Unknown';

  const reasonLabel = (value, other) => {
    if (value === 'other') return other?.trim() || 'Other';
    return TERMINATION_REASONS.find((r) => r.value === value)?.label || value;
  };

  const validationError = () => {
    if (!terminationDate) return 'Termination date is required.';
    if (terminationDate > todayDateOnly()) return 'Termination date cannot be in the future.';
    if (!reason) return 'Termination reason is required.';
    if (reason === 'other' && !reasonOther.trim()) return 'A description is required when reason is "Other".';
    return null;
  };

  const handleOpenConfirm = () => {
    const error = validationError();
    if (error) {
      toast({ title: 'Unable to continue', description: error, variant: 'destructive' });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    const error = validationError();
    if (error) {
      toast({ title: 'Unable to complete termination', description: error, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const settlement = await processTerminationSettlement({
        employee, terminationDate, createdBy: identity(),
        adjustmentAmount: Number(adjustmentAmount) || 0,
        adjustmentReason: adjustmentReason.trim(),
      });
      const updated = await db.entities.employees.update(employee.id, {
        termination_date: terminationDate,
        is_active: false,
        termination_reason: reason,
        termination_reason_other: reason === 'other' ? reasonOther.trim() : '',
        final_notes: finalNotes.trim(),
      });
      // Every access-affecting flip on this record gets a StatusHistoryEntry
      // so there's an audit trail of when/why login access changed — this is
      // the one write path for that (see also handleReinstate below). Kiosk
      // PIN login, the Employee Center manual PIN card, and any linked
      // portal User account all key off is_active/termination_date directly
      // (isEmployeeActive in employeeAuth.js), so this update alone already
      // revokes access everywhere; the entry below is the paper trail, not
      // an additional enforcement step.
      await logStatusChange({
        entityType: 'employees',
        entityId: employee.id,
        fieldName: 'access_status',
        fromValue: 'Active',
        toValue: 'Access Revoked',
        changedBy: identity(),
        note: `Terminated effective ${terminationDate}.`,
      });
      // Separate from access_status — this is the employment-event record
      // reason/notes reports and the employee list read from (see
      // terminationReasonLabel in employeesApi.js).
      await logStatusChange({
        entityType: 'employees',
        entityId: employee.id,
        fieldName: 'employment_status',
        fromValue: 'Active',
        toValue: `Terminated: ${reasonLabel(reason, reasonOther)}`,
        changedBy: identity(),
        note: finalNotes.trim(),
      });
      onUpdated?.(updated);
      setConfirmOpen(false);
      toast({
        title: settlement.totalGross > 0
          ? `Terminated — final check totals ${money(settlement.totalGross)}`
          : 'Terminated — no final check owed',
      });
    } catch (e) {
      toast({ title: 'Unable to complete termination', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Rehire path — there was previously no way to undo a termination from
  // this panel at all. Clearing both fields (not just one) matters because
  // isEmployeeActive() treats EITHER is_active === false OR a past-or-today
  // termination_date as terminated — leaving termination_date set would
  // immediately re-lock the account out again on the next login check.
  const handleReinstate = async () => {
    setReinstating(true);
    try {
      const updated = await db.entities.employees.update(employee.id, {
        termination_date: '', is_active: true, termination_reason: '', termination_reason_other: '', final_notes: '',
      });
      await logStatusChange({
        entityType: 'employees',
        entityId: employee.id,
        fieldName: 'access_status',
        fromValue: 'Access Revoked',
        toValue: 'Access Restored',
        changedBy: identity(),
        note: 'Rehired — termination reversed.',
      });
      onUpdated?.(updated);
      setConfirmReinstateOpen(false);
      toast({ title: `${employee.full_name} reinstated`, description: 'Login access restored across kiosk, Employee Center, and portal.' });
    } catch (e) {
      toast({ title: 'Unable to reinstate employee', description: e.message, variant: 'destructive' });
    } finally {
      setReinstating(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!canTerminate) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
        <ShieldAlert className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">HR Admin, Payroll Admin, or Admin access is required to terminate an employee.</p>
      </div>
    );
  }

  if (employee.termination_date) {
    const equipmentOutstanding = issuedAssets.filter((a) => !a.returned_date);
    const ptoPaidOut = pastSettlement.some((t) => t.transaction_type === 'payout');
    const ptoTouched = pastSettlement.length > 0;
    const checklist = [
      {
        label: 'Final payroll run created',
        checked: !!finalCheckLine,
        note: finalCheckLine ? `Net ${money(finalCheckLine.net_pay)}` : 'No final-check payroll line on file',
      },
      {
        label: 'PTO balance paid out (if applicable per policy)',
        checked: ptoPaidOut || !ptoTouched,
        note: ptoPaidOut ? 'Paid out per policy' : ptoTouched ? 'Forfeited per policy — no payout owed' : 'No PTO/Sick/Bereavement balance on file',
      },
      {
        label: 'Equipment return confirmed (issued assets reviewed)',
        checked: equipmentOutstanding.length === 0,
        note: issuedAssets.length === 0 ? 'No assets on file' : `${issuedAssets.length - equipmentOutstanding.length} of ${issuedAssets.length} returned`,
      },
      {
        label: 'Access revoked',
        checked: true,
        note: 'Kiosk, Employee Center, and linked portal login revoked automatically',
      },
      {
        label: 'Handbook sign-off filed',
        checked: false,
        note: 'Not tracked automatically — confirm with HR files',
      },
      {
        label: 'Exit interview conducted',
        checked: false,
        note: 'Not tracked automatically — confirm with HR files',
      },
    ];

    return (
      <div className="space-y-4">
        <div className="steel-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Terminated {employee.termination_date} — {terminationReasonLabel(employee)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Employment status: {employee.is_active ? 'Active' : 'Inactive'} — all kiosk, Employee Center, and linked portal login are revoked.</p>
              {employee.final_notes && <p className="text-xs text-muted-foreground mt-1.5"><span className="font-medium">Final notes: </span>{employee.final_notes}</p>}
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={() => setHistoryOpen(true)}>
              <History className="w-3.5 h-3.5" />Access History
            </Button>
          </div>
          <Button className="gap-2 mt-3 bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => setConfirmReinstateOpen(true)}>
            <UserCheck className="w-4 h-4" />Reinstate Employee
          </Button>
        </div>

        <div className="steel-card p-4">
          <h4 className="font-semibold text-sm mb-3">Offboarding Checklist</h4>
          <p className="text-xs text-muted-foreground mb-3">Status indicators only — nothing here blocks or is enforced by this screen.</p>
          <div className="space-y-2">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-start gap-2.5">
                {item.checked ? <CheckSquare className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="steel-card p-4">
          <h4 className="font-semibold text-sm mb-1">Equipment Return</h4>
          <p className="text-xs text-muted-foreground mb-3">
            {issuedAssets.length === 0
              ? 'No equipment on file for this employee.'
              : equipmentOutstanding.length === 0
                ? 'All issued equipment has been returned.'
                : `${equipmentOutstanding.length} item${equipmentOutstanding.length === 1 ? '' : 's'} outstanding — click to record its return.`}
          </p>
          {equipmentOutstanding.length > 0 && (
            <div className="space-y-2">
              {equipmentOutstanding.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setReturningAsset(asset)}
                  className="w-full flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <Square className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{assetTypeLabel(asset.asset_type)}{asset.asset_tag ? ` — ${asset.asset_tag}` : ''}</p>
                    <p className="text-xs text-muted-foreground">Issued {asset.issued_date || '—'} — not yet returned</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="steel-card p-4">
          <h4 className="font-semibold text-sm mb-3">Final Check Settlement</h4>
          {finalCheckLine ? (
            <div className="grid grid-cols-2 gap-3 text-sm mb-3">
              <div><span className="text-muted-foreground">Regular/OT/DT hours: </span>{finalCheckLine.regular_hours.toFixed(1)}/{finalCheckLine.ot_hours.toFixed(1)}/{finalCheckLine.double_time_hours.toFixed(1)}</div>
              <div><span className="text-muted-foreground">PTO payout hours: </span>{finalCheckLine.pto_payout_hours.toFixed(1)}</div>
              <div><span className="text-muted-foreground">Gross: </span>{money(finalCheckLine.gross_pay)}</div>
              <div><span className="text-muted-foreground">Net: </span>{money(finalCheckLine.net_pay)}</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-3">No final-check payroll run was created — nothing was owed at termination.</p>
          )}
          {pastSettlement.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PTO settlement transactions on file for this termination.</p>
          ) : (
            <div className="space-y-1.5">
              {pastSettlement.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
                  <div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold mr-2 ${t.transaction_type === 'payout' ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}`}>
                      {t.transaction_type === 'payout' ? 'Paid Out' : 'Forfeited'}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.leave_type} • {t.reason}</span>
                  </div>
                  <span className="font-mono text-sm font-semibold flex-shrink-0">{Math.abs(t.hours).toFixed(1)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Dialog open={confirmReinstateOpen} onOpenChange={setConfirmReinstateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Reinstate {employee.full_name}?</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Clears the termination date/reason, marks this employee active again, and immediately restores kiosk, Employee Center, and any linked portal login.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmReinstateOpen(false)}>Cancel</Button>
              <Button className="bg-green-600 hover:bg-green-700 text-white border-0" disabled={reinstating} onClick={handleReinstate}>{reinstating ? 'Processing…' : 'Confirm Reinstatement'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <StatusHistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          entityType="employees"
          entityId={employee.id}
          fieldName="access_status"
          title={`${employee.full_name} — Access History`}
        />

        <IssuedAssetDialog
          open={!!returningAsset}
          onOpenChange={(o) => !o && setReturningAsset(null)}
          employeeId={employee.id}
          asset={returningAsset}
          onSaved={() => { setReturningAsset(null); load(); }}
        />
      </div>
    );
  }

  const totalPtoPayout = (ptoPreview?.lines || []).reduce((sum, l) => sum + (l.willPayOut ? l.amount : 0), 0);
  const wagesGross = wagesPreview?.totalGross || 0;
  const adjustment = Number(adjustmentAmount) || 0;
  const estimatedTotal = totalPtoPayout + wagesGross + adjustment;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setHistoryOpen(true)}>
          <History className="w-3.5 h-3.5" />Access History
        </Button>
      </div>

      <div className="steel-card p-4 space-y-3">
        <h4 className="font-semibold text-sm">Termination Details</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Termination Date</Label>
            <Input type="date" max={todayDateOnly()} value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Termination Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a reason…" /></SelectTrigger>
              <SelectContent>
                {TERMINATION_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {reason === 'other' && (
          <div>
            <Label className="text-xs">Describe reason (required)</Label>
            <Input value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Reason for termination" className="mt-1" />
          </div>
        )}
        <div>
          <Label className="text-xs">Final Notes (optional)</Label>
          <Textarea value={finalNotes} onChange={(e) => setFinalNotes(e.target.value)} rows={2} placeholder="Any additional context for the record" className="mt-1" />
        </div>
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-1">Final Check — Unpaid Wages</h4>
        <p className="text-xs text-muted-foreground mb-3">Approved timecards not yet included in a payroll run, as of today.</p>
        {(wagesPreview?.lines || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No unpaid approved wages on file.</p>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{wagesPreview.totalRegularHours.toFixed(1)}h regular + {wagesPreview.totalOtHours.toFixed(1)}h OT</p>
            <p className="text-sm font-semibold">{money(wagesPreview.totalGross)}</p>
          </div>
        )}
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-1">Final Check — PTO Settlement Preview</h4>
        <p className="text-xs text-muted-foreground mb-3">Based on {employee.full_name}'s balances and each leave type's governing policy as of {terminationDate}.</p>
        <div className="space-y-2">
          {(ptoPreview?.lines || []).map((line) => (
            <div key={line.leaveType} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">{line.leaveType} — {line.hours.toFixed(1)}h balance</p>
                <button
                  className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-default"
                  disabled={!line.policy}
                  onClick={() => line.policy && setViewingPolicy(line.policy)}
                >
                  {line.policy ? `Policy: ${line.policy.policy_name}` : 'No active policy on file'}
                </button>
              </div>
              <div className="text-right">
                {line.willPayOut ? (
                  <p className="text-sm font-semibold text-amber-600">Final check will include PTO payout: {money(line.amount)}</p>
                ) : (
                  <p className="text-sm font-semibold text-red-600">Unused PTO will be forfeited: {line.hours.toFixed(1)}h</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="steel-card p-4 space-y-3">
        <h4 className="font-semibold text-sm">Additional Adjustment (optional)</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount</Label>
            <Input type="number" step="0.01" value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} placeholder="0.00" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Input value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} placeholder="e.g. Final bonus" className="mt-1" disabled={!adjustmentAmount} />
          </div>
        </div>
      </div>

      {estimatedTotal > 0 && (
        <p className="text-sm font-semibold">
          Estimated final check total: {money(estimatedTotal)}
          {wagesGross > 0 && ` (wages ${money(wagesGross)}`}{totalPtoPayout > 0 && `${wagesGross > 0 ? ' + ' : ' ('}PTO ${money(totalPtoPayout)}`}{adjustment !== 0 && `${(wagesGross > 0 || totalPtoPayout > 0) ? ' + ' : ' ('}adjustment ${money(adjustment)}`}{(wagesGross > 0 || totalPtoPayout > 0 || adjustment !== 0) && ')'}
        </p>
      )}

      <Button variant="destructive" className="gap-2" onClick={handleOpenConfirm}>
        <UserX className="w-4 h-4" />Terminate Employee
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Termination — {employee.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>Termination date: <span className="font-medium">{terminationDate}</span></p>
            <p>Reason: <span className="font-medium">{reasonLabel(reason, reasonOther)}</span></p>
            <p className="text-muted-foreground">This computes any unpaid wages and PTO/Sick/Bereavement payout or forfeiture into a single final-check payroll run, marks this employee inactive, and revokes kiosk, Employee Center, and linked portal login. It can be reversed afterward with Reinstate Employee.</p>
            {estimatedTotal > 0 && <p className="font-semibold text-amber-600">A final_check payroll run will be created for {money(estimatedTotal)}.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={saving} onClick={handleConfirm}>{saving ? 'Processing…' : 'Confirm Termination'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingPolicy} onOpenChange={(o) => !o && setViewingPolicy(null)}>
        <DialogContent>
          {viewingPolicy && (
            <>
              <DialogHeader><DialogTitle>{viewingPolicy.policy_name}</DialogTitle></DialogHeader>
              <div className="space-y-1.5 text-sm">
                <p><span className="text-muted-foreground">Leave type: </span>{viewingPolicy.leave_type}</p>
                <p><span className="text-muted-foreground">Accrual method: </span>{viewingPolicy.accrual_method}</p>
                <p><span className="text-muted-foreground">Annual hours: </span>{viewingPolicy.annual_hours}h</p>
                <p><span className="text-muted-foreground">Max balance: </span>{viewingPolicy.max_balance || 'Uncapped'}</p>
                <p><span className="text-muted-foreground">Carryover: </span>{viewingPolicy.carryover_allowed ? `Up to ${viewingPolicy.max_carryover_hours}h` : 'None'}</p>
                <p><span className="text-muted-foreground">Waiting period: </span>{viewingPolicy.waiting_period_days || 0} days</p>
                <p><span className="text-muted-foreground">On termination: </span>{viewingPolicy.payout_on_termination === 'always' ? 'Always paid out' : viewingPolicy.payout_on_termination === 'policy_dependent' ? 'Jurisdiction-dependent (currently treated as forfeit)' : 'Forfeited'}</p>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setViewingPolicy(null)}>Close</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StatusHistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entityType="employees"
        entityId={employee.id}
        fieldName="access_status"
        title={`${employee.full_name} — Access History`}
      />
    </div>
  );
}
