import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { logStatusChange } from '@/lib/statusHistory';
import { computeI9ReverificationDueDate, getI9ReverificationFlag, getEVerifyFlag, E_VERIFY_STATUSES } from '@/lib/i9Compliance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { FileCheck2, ShieldCheck, Flag, Save } from 'lucide-react';

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

function FlagBadge({ flag }) {
  if (!flag) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${flag === 'overdue' ? 'bg-red-500/10 text-red-600' : 'bg-yellow-500/10 text-yellow-700'}`}>
      <Flag className="w-3 h-3" />{flag === 'overdue' ? 'Overdue' : 'Due Soon'}
    </span>
  );
}

// Federal I-9/E-Verify tracking — dates/status only. The actual government
// forms are scanned into the Documents tab (employee_documents, document_type_key
// 'I9_Form'/'EVerify_Confirmation'), never stored on this record.
export default function I9ComplianceCenter({ employee, onUpdated }) {
  const { toast } = useToast();
  const [i9OnFile, setI9OnFile] = useState(!!employee.i9_on_file);
  const [i9Date, setI9Date] = useState(employee.i9_date || '');
  const [i9Due, setI9Due] = useState(employee.i9_reverification_due_date || '');
  const [everifyStatus, setEverifyStatus] = useState(employee.e_verify_status || 'not_submitted');
  const [everifyInitiated, setEverifyInitiated] = useState(employee.e_verify_initiated_date || '');
  const [everifyVerified, setEverifyVerified] = useState(employee.e_verify_verified_date || '');
  const [everifyRecheck, setEverifyRecheck] = useState(employee.e_verify_recheck_due_date || '');
  const [savingI9, setSavingI9] = useState(false);
  const [savingEverify, setSavingEverify] = useState(false);
  const [completing, setCompleting] = useState(false);

  const i9Flag = getI9ReverificationFlag(employee, 30);
  const everifyFlag = getEVerifyFlag(employee, 30);

  // I-9 date drives the reverification clock — auto-recompute the due date
  // whenever it changes, but HR can still type over the result afterward.
  const handleI9DateChange = (value) => {
    setI9Date(value);
    const computed = computeI9ReverificationDueDate(value);
    if (computed) setI9Due(computed);
  };

  const handleSaveI9 = async () => {
    setSavingI9(true);
    try {
      const updated = await db.entities.employees.update(employee.id, {
        i9_on_file: i9OnFile,
        i9_date: i9Date,
        i9_reverification_due_date: i9Due,
      });
      onUpdated?.(updated);
      toast({ title: 'I-9 record updated' });
    } finally {
      setSavingI9(false);
    }
  };

  const handleMarkReverificationComplete = async () => {
    setCompleting(true);
    try {
      const today = todayDateOnly();
      const nextDue = computeI9ReverificationDueDate(today);
      const updated = await db.entities.employees.update(employee.id, {
        i9_reverification_completed_date: today,
        i9_reverification_due_date: nextDue,
      });
      await logStatusChange({
        entityType: 'employees',
        entityId: employee.id,
        fieldName: 'i9_reverification',
        fromValue: employee.i9_reverification_due_date || 'None on file',
        toValue: `Completed ${today}`,
        note: `Next reverification due ${nextDue}.`,
      });
      setI9Due(nextDue);
      onUpdated?.(updated);
      toast({ title: 'Reverification marked complete', description: `Next due ${nextDue}.` });
    } finally {
      setCompleting(false);
    }
  };

  const handleSaveEverify = async () => {
    setSavingEverify(true);
    try {
      const updated = await db.entities.employees.update(employee.id, {
        e_verify_status: everifyStatus,
        e_verify_initiated_date: everifyInitiated,
        e_verify_verified_date: everifyVerified,
        e_verify_recheck_due_date: everifyRecheck,
      });
      onUpdated?.(updated);
      toast({ title: 'E-Verify record updated' });
    } finally {
      setSavingEverify(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm flex items-center gap-2"><FileCheck2 className="w-4 h-4 text-primary" />Form I-9</h4>
          <FlagBadge flag={i9Flag} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={i9OnFile} onCheckedChange={setI9OnFile} />
          <span className="text-xs text-muted-foreground">{i9OnFile ? 'On file' : 'Not on file'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">I-9 Date</Label>
            <Input type="date" value={i9Date} onChange={(e) => handleI9DateChange(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Reverification Due (auto-computed — override if needed)</Label>
            <Input type="date" value={i9Due} onChange={(e) => setI9Due(e.target.value)} className="mt-1" />
          </div>
        </div>
        <Button onClick={handleSaveI9} disabled={savingI9} className="gap-1.5 steel-gradient text-white border-0">
          <Save className="w-3.5 h-3.5" />{savingI9 ? 'Saving…' : 'Save I-9 Record'}
        </Button>

        <div className="pt-3 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <Label className="text-xs">Reverification Completed Date</Label>
            <p className="text-sm mt-1">{employee.i9_reverification_completed_date || 'Not yet completed'}</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleMarkReverificationComplete} disabled={completing}>
            {completing ? 'Saving…' : 'Mark Reverification Complete'}
          </Button>
        </div>
      </div>

      <div className="steel-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />E-Verify</h4>
          <FlagBadge flag={everifyFlag} />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={everifyStatus} onValueChange={setEverifyStatus}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {E_VERIFY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Initiated</Label>
            <Input type="date" value={everifyInitiated} onChange={(e) => setEverifyInitiated(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Verified</Label>
            <Input type="date" value={everifyVerified} onChange={(e) => setEverifyVerified(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Recheck Due</Label>
            <Input type="date" value={everifyRecheck} onChange={(e) => setEverifyRecheck(e.target.value)} className="mt-1" />
          </div>
        </div>
        <Button onClick={handleSaveEverify} disabled={savingEverify} className="gap-1.5 steel-gradient text-white border-0">
          <Save className="w-3.5 h-3.5" />{savingEverify ? 'Saving…' : 'Save E-Verify Record'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">Scanned I-9 and E-Verify confirmation documents are stored in the Documents tab — these fields track dates and status only.</p>
    </div>
  );
}
