import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { computeTerminationPtoSettlementPreview, processTerminationPtoSettlement, listPtoTransactionsForEmployee } from '@/lib/ptoEngine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { UserX, Loader2, ShieldAlert } from 'lucide-react';

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

// HR's termination checklist — currently scoped to the PTO settlement piece
// only (final-check payout vs. forfeiture per leave type). Equipment return,
// access revocation, and exit interview are separate, not-yet-built
// checklist items and deliberately out of scope here.
export default function TerminationPanel({ employee, roles = [], onUpdated }) {
  const { toast } = useToast();
  const canTerminate = hasFullEmployeeAccess(roles);
  const [currentUser, setCurrentUser] = useState(null);
  const [terminationDate, setTerminationDate] = useState(todayDateOnly());
  const [preview, setPreview] = useState(null);
  const [pastSettlement, setPastSettlement] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewingPolicy, setViewingPolicy] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => { db.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null)); }, []);
  useEffect(() => { load(); }, [employee?.id, employee?.termination_date, terminationDate]);

  const load = async () => {
    setLoading(true);
    try {
      if (employee.termination_date) {
        const txns = await listPtoTransactionsForEmployee(employee.id);
        setPastSettlement(txns.filter((t) => t.source_type === 'termination'));
      } else {
        const result = await computeTerminationPtoSettlementPreview(employee, terminationDate);
        setPreview(result);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const settlement = await processTerminationPtoSettlement({
        employee, terminationDate, createdBy: currentUser?.full_name || currentUser?.email || 'Unknown',
      });
      const updated = await db.entities.employees.update(employee.id, { termination_date: terminationDate, is_active: false });
      onUpdated?.(updated);
      setConfirmOpen(false);
      toast({
        title: settlement.totalPayoutAmount > 0
          ? `Terminated — final check includes $${settlement.totalPayoutAmount.toFixed(2)} PTO payout`
          : 'Terminated — unused PTO forfeited',
      });
    } catch (e) {
      toast({ title: 'Unable to complete termination', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
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
    return (
      <div className="space-y-4">
        <div className="steel-card p-4">
          <p className="text-sm font-semibold">Terminated {employee.termination_date}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Employment status: {employee.is_active ? 'Active' : 'Inactive'}</p>
        </div>
        <div className="steel-card p-4">
          <h4 className="font-semibold text-sm mb-3">PTO Settlement at Termination</h4>
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
      </div>
    );
  }

  const totalPayout = (preview?.lines || []).reduce((sum, l) => sum + (l.willPayOut ? l.amount : 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Termination Date</Label>
        <Input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} className="mt-1 max-w-xs" />
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-1">Final Check — PTO Settlement Preview</h4>
        <p className="text-xs text-muted-foreground mb-3">Based on {employee.full_name}'s balances and each leave type's governing policy as of {terminationDate}.</p>
        <div className="space-y-2">
          {(preview?.lines || []).map((line) => (
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
                  <p className="text-sm font-semibold text-amber-600">Final check will include PTO payout: ${line.amount.toFixed(2)}</p>
                ) : (
                  <p className="text-sm font-semibold text-red-600">Unused PTO will be forfeited: {line.hours.toFixed(1)}h</p>
                )}
              </div>
            </div>
          ))}
        </div>
        {totalPayout > 0 && (
          <p className="text-sm font-semibold mt-3 pt-3 border-t border-border/50">
            Total final-check PTO payout: ${totalPayout.toFixed(2)}
            {preview?.payRate ? ` (at $${preview.payRate.hourlyRate.toFixed(2)}/hr)` : ' — no current pay rate on file, payout cannot be priced'}
          </p>
        )}
      </div>

      <Button variant="destructive" className="gap-2" onClick={() => setConfirmOpen(true)}>
        <UserX className="w-4 h-4" />Terminate Employee
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Termination — {employee.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>Termination date: <span className="font-medium">{terminationDate}</span></p>
            <p className="text-muted-foreground">This forfeits or pays out unused PTO/Sick/Bereavement per each leave type's policy, and marks this employee inactive. It cannot be undone from here.</p>
            {totalPayout > 0 && <p className="font-semibold text-amber-600">A final_check payroll run will be created for ${totalPayout.toFixed(2)}.</p>}
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
    </div>
  );
}
