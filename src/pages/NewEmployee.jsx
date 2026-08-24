import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { provisionEmployee, listEmployeesForRole, hasFullEmployeeAccess } from '@/lib/employeesApi';
import { POSITIONS } from '@/pages/HumanResources';
import { ArrowLeft, UserPlus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const EMPLOYEE_STATUSES = ['Active', 'Inactive', 'On Leave', 'Probation'];

const emptyForm = () => ({
  full_name: '',
  personal_email: '',
  hire_date: new Date().toISOString().slice(0, 10),
  job_title: '',
  department: '',
  classification: '',
  employee_status: 'Active',
  phone: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  emergency_contact_relationship: '',
  emergency_contact2_name: '',
  emergency_contact2_phone: '',
  emergency_contact2_relationship: '',
});

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export default function NewEmployee() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [roles, setRoles] = useState(['user']);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [creating, setCreating] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    let currentRoles = ['user'];
    try {
      const me = await db.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
    } catch (e) {}
    setRoles(currentRoles);
    if (hasFullEmployeeAccess(currentRoles)) {
      listEmployeesForRole(currentRoles).then(setEmployees).catch(() => setEmployees([]));
    }
    setCheckingAccess(false);
  };

  const isFullAccess = hasFullEmployeeAccess(roles);

  const departmentOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(),
    [employees]
  );
  const classificationOptions = useMemo(
    () => Array.from(new Set([...POSITIONS, ...employees.map((e) => e.classification).filter(Boolean)])).sort(),
    [employees]
  );

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const setInput = (field) => (e) => set(field)(e.target.value);

  const handleCreate = async () => {
    const required = [
      ['full_name', 'Full name'],
      ['personal_email', 'Email'],
      ['hire_date', 'Hire date'],
      ['job_title', 'Position / job title'],
      ['department', 'Department'],
      ['classification', 'Classification'],
      ['emergency_contact_name', 'Emergency contact name'],
      ['emergency_contact_phone', 'Emergency contact phone'],
      ['emergency_contact_relationship', 'Emergency contact relationship'],
    ];
    for (const [field, label] of required) {
      if (!String(form[field] || '').trim()) {
        toast({ title: `${label} is required`, variant: 'destructive' });
        return;
      }
    }
    if (!isValidEmail(form.personal_email)) {
      toast({ title: 'Enter a valid email address', variant: 'destructive' });
      return;
    }

    setCreating(true);
    try {
      const employee = await provisionEmployee(form);
      toast({ title: `Employee ${employee.full_name} created.`, description: 'Admin will assign permissions.' });
      navigate(`/human-resources?employee=${employee.id}`);
    } catch (e) {
      toast({ title: 'Unable to create employee', variant: 'destructive' });
    } finally {
      setCreating(false);
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
        <p className="text-sm text-muted-foreground">Only HR Admin, Payroll Admin, or Admin roles can create employees.</p>
        <Link to="/human-resources"><Button variant="outline">Back to Human Resources</Button></Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/human-resources">
          <Button variant="ghost" size="icon" className="rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Employee</h1>
          <p className="text-sm text-muted-foreground">New employees start with employee-center access only — an admin assigns their platform role afterward.</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4">Employee Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Full Name *</Label>
              <Input value={form.full_name} onChange={setInput('full_name')} className="mt-1" />
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={form.personal_email} onChange={setInput('personal_email')} className="mt-1" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input type="tel" value={form.phone} onChange={setInput('phone')} className="mt-1" />
            </div>
            <div>
              <Label>Hire Date *</Label>
              <Input type="date" value={form.hire_date} onChange={setInput('hire_date')} className="mt-1" />
            </div>
            <div>
              <Label>Employee Status *</Label>
              <Select value={form.employee_status} onValueChange={set('employee_status')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Position / Job Title *</Label>
              <Input value={form.job_title} onChange={setInput('job_title')} placeholder="e.g. Senior Ironworker" className="mt-1" />
            </div>
            <div>
              <Label>Classification *</Label>
              <Select value={form.classification} onValueChange={set('classification')}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select classification…" /></SelectTrigger>
                <SelectContent>
                  {classificationOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Department *</Label>
              <Input list="department-options" value={form.department} onChange={setInput('department')} placeholder="e.g. Fabrication Shop" className="mt-1" />
              <datalist id="department-options">
                {departmentOptions.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>
          </div>
        </div>

        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4">Emergency Contact 1 *</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Name</Label>
              <Input value={form.emergency_contact_name} onChange={setInput('emergency_contact_name')} className="mt-1" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input type="tel" value={form.emergency_contact_phone} onChange={setInput('emergency_contact_phone')} className="mt-1" />
            </div>
            <div>
              <Label>Relationship</Label>
              <Input value={form.emergency_contact_relationship} onChange={setInput('emergency_contact_relationship')} placeholder="Spouse, Parent, etc." className="mt-1" />
            </div>
          </div>
        </div>

        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4">Emergency Contact 2 (optional)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Name</Label>
              <Input value={form.emergency_contact2_name} onChange={setInput('emergency_contact2_name')} className="mt-1" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input type="tel" value={form.emergency_contact2_phone} onChange={setInput('emergency_contact2_phone')} className="mt-1" />
            </div>
            <div>
              <Label>Relationship</Label>
              <Input value={form.emergency_contact2_relationship} onChange={setInput('emergency_contact2_relationship')} placeholder="Spouse, Parent, etc." className="mt-1" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Link to="/human-resources"><Button variant="outline" type="button">Cancel</Button></Link>
          <Button type="button" onClick={handleCreate} disabled={creating} className="gap-2 steel-gradient text-white border-0 min-w-40">
            {creating ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <><UserPlus className="w-4 h-4" />Create Employee</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
