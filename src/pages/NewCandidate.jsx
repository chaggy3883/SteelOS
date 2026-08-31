import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { JOB_TITLES } from '@/pages/HumanResources';
import { ArrowLeft, ShieldAlert, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const emptyForm = () => ({ candidate_name: '', email: '', phone: '', position_applied: JOB_TITLES[0] || '' });

export default function NewCandidate() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [roles, setRoles] = useState(['user']);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    let currentRoles = ['user'];
    try {
      const me = await db.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
    } catch (e) {}
    setRoles(currentRoles);
    setCheckingAccess(false);
  };

  const isFullAccess = hasFullEmployeeAccess(roles);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const setInput = (field) => (e) => set(field)(e.target.value);

  const handleCreate = async () => {
    if (!form.candidate_name.trim()) {
      toast({ title: 'Candidate name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const created = await db.entities.candidate_profiles.create({
        ...form,
        status: 'Applied',
        applied_date: new Date().toISOString().slice(0, 10),
      });
      toast({ title: 'Candidate added', description: created.candidate_name });
      navigate(`/human-resources?candidate=${created.id}`);
    } catch (e) {
      toast({ title: 'Unable to add candidate', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (checkingAccess) {
    return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  }

  if (!isFullAccess) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
        <h1 className="text-lg font-semibold">Restricted</h1>
        <p className="text-sm text-muted-foreground">Only HR Admin, Payroll Admin, or Admin roles can add candidates.</p>
        <Link to="/human-resources"><Button variant="outline">Back to Human Resources</Button></Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/human-resources">
          <Button variant="ghost" size="icon" className="rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Candidate</h1>
          <p className="text-sm text-muted-foreground">Adds a candidate to the ATS pipeline.</p>
        </div>
      </div>

      <div className="steel-card p-6 space-y-4">
        <div>
          <Label>Candidate Name</Label>
          <Input value={form.candidate_name} onChange={setInput('candidate_name')} className="mt-1" />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={setInput('email')} className="mt-1" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input type="tel" value={form.phone} onChange={setInput('phone')} className="mt-1" />
        </div>
        <div>
          <Label>Position Applied</Label>
          <Select value={form.position_applied} onValueChange={set('position_applied')}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {JOB_TITLES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <Link to="/human-resources"><Button variant="outline" type="button">Cancel</Button></Link>
          <Button type="button" onClick={handleCreate} disabled={saving} className="gap-2 steel-gradient text-white border-0 min-w-40">
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <><UserPlus className="w-4 h-4" />Add Candidate</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
