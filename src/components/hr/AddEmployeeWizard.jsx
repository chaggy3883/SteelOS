import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import FileDropzone from '@/components/ui/FileDropzone';
import RoleMultiSelect from '@/components/admin/RoleMultiSelect';
import { provisionEmployee } from '@/lib/employeesApi';
import { savePdf } from '@/lib/pdfBlobStore';
import { FileCheck2, ArrowLeft, ArrowRight, UserPlus } from 'lucide-react';

const STEP_LABELS = ['Personal Info', 'Job Info', 'Documents', 'Review'];

const emptyForm = (positions) => ({
  full_name: '', dob: '', address_street: '', address_city: '', address_state: '', address_zip: '',
  phone: '', personal_email: '', ssn_last4: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
  classification: positions[0] || '', hire_date: new Date().toISOString().slice(0, 10),
  pay_type: 'hourly', pay_rate_cents: '', annual_salary_cents: '',
  department: '', platform_roles: [], supervisor_name: '',
});

const emptyDocs = () => ({ drivers_license: null, ssn_card: null, birth_cert: null });

function FileBadge({ file }) {
  if (!file) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-600">
      <FileCheck2 className="w-3.5 h-3.5" />{file.name}
    </p>
  );
}

export default function AddEmployeeWizard({ positions, allRoles, onEmployeeCreated }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => emptyForm(positions));
  const [docs, setDocs] = useState(emptyDocs());
  const [companyTemplate, setCompanyTemplate] = useState({ label: '', file: null });
  const [creating, setCreating] = useState(false);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const setInput = (field) => (e) => set(field)(e.target.value);

  const resetWizard = () => {
    setForm(emptyForm(positions));
    setDocs(emptyDocs());
    setCompanyTemplate({ label: '', file: null });
    setStep(1);
  };

  const goNext = () => {
    if (step === 1 && !form.full_name.trim()) {
      toast({ title: 'Full name is required', variant: 'destructive' });
      return;
    }
    setStep((s) => Math.min(s + 1, 4));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 1));

  const handleCreate = async () => {
    setCreating(true);
    try {
      const employee = await provisionEmployee(form);

      const uploads = [
        ['drivers_license', docs.drivers_license],
        ['ssn_card', docs.ssn_card],
        ['birth_cert', docs.birth_cert],
      ];
      for (const [docType, file] of uploads) {
        if (file) await savePdf(`hr_docs/${employee.id}/${docType}`, file);
      }
      if (companyTemplate.file) {
        await savePdf(`hr_docs/${employee.id}/company_template`, companyTemplate.file);
      }

      toast({ title: `Employee #${employee.employee_number} created`, description: employee.full_name });
      onEmployeeCreated(employee);
      resetWizard();
    } catch (e) {
      toast({ title: 'Unable to create employee', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const payLabel = form.pay_type === 'salary'
    ? (form.annual_salary_cents ? `$${(Number(form.annual_salary_cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr` : '—')
    : (form.pay_rate_cents ? `$${(Number(form.pay_rate_cents) / 100).toFixed(2)}/hr` : '—');

  return (
    <div className="steel-card p-4 max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={label}>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step === i + 1 ? 'text-primary' : 'text-muted-foreground'}`}>
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${step >= i + 1 ? 'steel-gradient text-white' : 'bg-muted'}`}>{i + 1}</span>
              {label}
            </div>
            {i < STEP_LABELS.length - 1 && <div className="flex-1 h-px bg-border" />}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Full Name</Label>
            <Input value={form.full_name} onChange={setInput('full_name')} className="mt-1" />
          </div>
          <div>
            <Label>Date of Birth</Label>
            <Input type="date" value={form.dob} onChange={setInput('dob')} className="mt-1" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={setInput('phone')} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Street Address</Label>
            <Input value={form.address_street} onChange={setInput('address_street')} className="mt-1" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={form.address_city} onChange={setInput('address_city')} className="mt-1" />
          </div>
          <div>
            <Label>State</Label>
            <Input value={form.address_state} onChange={setInput('address_state')} className="mt-1" />
          </div>
          <div>
            <Label>ZIP</Label>
            <Input value={form.address_zip} onChange={setInput('address_zip')} className="mt-1" />
          </div>
          <div>
            <Label>Personal Email</Label>
            <Input type="email" value={form.personal_email} onChange={setInput('personal_email')} className="mt-1" />
          </div>
          <div>
            <Label>SSN (last 4)</Label>
            <Input value={form.ssn_last4} onChange={(e) => set('ssn_last4')(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" className="mt-1" />
          </div>
          <div className="col-span-2 pt-2 border-t border-border/50">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Emergency Contact</p>
          </div>
          <div>
            <Label>Contact Name</Label>
            <Input value={form.emergency_contact_name} onChange={setInput('emergency_contact_name')} className="mt-1" />
          </div>
          <div>
            <Label>Contact Phone</Label>
            <Input value={form.emergency_contact_phone} onChange={setInput('emergency_contact_phone')} className="mt-1" />
          </div>
          <div>
            <Label>Relationship</Label>
            <Input value={form.emergency_contact_relationship} onChange={setInput('emergency_contact_relationship')} className="mt-1" placeholder="Spouse, Parent, etc." />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Position / Classification</Label>
            <Select value={form.classification} onValueChange={set('classification')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {positions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Hire Date</Label>
            <Input type="date" value={form.hire_date} onChange={setInput('hire_date')} className="mt-1" />
          </div>
          <div>
            <Label>Pay Type</Label>
            <Select value={form.pay_type} onValueChange={set('pay_type')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="salary">Salary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.pay_type === 'salary' ? (
            <div>
              <Label>Annual Salary (cents)</Label>
              <Input type="number" value={form.annual_salary_cents} onChange={setInput('annual_salary_cents')} className="mt-1" placeholder="6500000" />
            </div>
          ) : (
            <div>
              <Label>Pay Rate (cents/hr)</Label>
              <Input type="number" value={form.pay_rate_cents} onChange={setInput('pay_rate_cents')} className="mt-1" placeholder="2800" />
            </div>
          )}
          <div>
            <Label>Department</Label>
            <Input value={form.department} onChange={setInput('department')} className="mt-1" />
          </div>
          <div>
            <Label>Platform Roles</Label>
            <RoleMultiSelect roles={allRoles} value={form.platform_roles} onChange={set('platform_roles')} className="mt-1" />
          </div>
          <div>
            <Label>Supervisor Name</Label>
            <Input value={form.supervisor_name} onChange={setInput('supervisor_name')} className="mt-1" />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Driver's License</Label>
            <FileDropzone accept="image/*,.pdf" label="Upload Driver's License" onFileSelected={(file) => setDocs((d) => ({ ...d, drivers_license: file }))} className="mt-1" />
            <FileBadge file={docs.drivers_license} />
          </div>
          <div>
            <Label className="text-xs">Social Security Card</Label>
            <FileDropzone accept="image/*,.pdf" label="Upload Social Security Card" onFileSelected={(file) => setDocs((d) => ({ ...d, ssn_card: file }))} className="mt-1" />
            <FileBadge file={docs.ssn_card} />
          </div>
          <div>
            <Label className="text-xs">Birth Certificate</Label>
            <FileDropzone accept="image/*,.pdf" label="Upload Birth Certificate" onFileSelected={(file) => setDocs((d) => ({ ...d, birth_cert: file }))} className="mt-1" />
            <FileBadge file={docs.birth_cert} />
          </div>
          <div>
            <Label className="text-xs">Company Document Template</Label>
            <Input
              value={companyTemplate.label}
              onChange={(e) => setCompanyTemplate((t) => ({ ...t, label: e.target.value }))}
              placeholder="e.g. Disciplinary Write-Up Form"
              className="mt-1 mb-2"
            />
            <FileDropzone accept="image/*,.pdf" label="Upload template file" onFileSelected={(file) => setCompanyTemplate((t) => ({ ...t, file }))} />
            <FileBadge file={companyTemplate.file} />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Personal Info</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="text-muted-foreground">Name:</span> {form.full_name || '—'}</p>
              <p><span className="text-muted-foreground">DOB:</span> {form.dob || '—'}</p>
              <p><span className="text-muted-foreground">Phone:</span> {form.phone || '—'}</p>
              <p><span className="text-muted-foreground">Email:</span> {form.personal_email || '—'}</p>
              <p className="col-span-2"><span className="text-muted-foreground">Address:</span> {[form.address_street, form.address_city, form.address_state, form.address_zip].filter(Boolean).join(', ') || '—'}</p>
              <p><span className="text-muted-foreground">SSN (last 4):</span> {form.ssn_last4 || '—'}</p>
              <p><span className="text-muted-foreground">Emergency Contact:</span> {form.emergency_contact_name || '—'} {form.emergency_contact_relationship ? `(${form.emergency_contact_relationship})` : ''} {form.emergency_contact_phone}</p>
            </div>
          </div>
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Job Info</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="text-muted-foreground">Position:</span> {form.classification}</p>
              <p><span className="text-muted-foreground">Hire Date:</span> {form.hire_date}</p>
              <p><span className="text-muted-foreground">Pay:</span> {payLabel}</p>
              <p><span className="text-muted-foreground">Department:</span> {form.department || '—'}</p>
              <p><span className="text-muted-foreground">Platform Roles:</span> {form.platform_roles.length > 0 ? form.platform_roles.map((v) => allRoles.find((r) => r.value === v)?.label || v).join(', ') : '—'}</p>
              <p><span className="text-muted-foreground">Supervisor:</span> {form.supervisor_name || '—'}</p>
            </div>
          </div>
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Documents</p>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Driver's License:</span> {docs.drivers_license?.name || 'Not uploaded'}</p>
              <p><span className="text-muted-foreground">Social Security Card:</span> {docs.ssn_card?.name || 'Not uploaded'}</p>
              <p><span className="text-muted-foreground">Birth Certificate:</span> {docs.birth_cert?.name || 'Not uploaded'}</p>
              <p><span className="text-muted-foreground">{companyTemplate.label || 'Company Document Template'}:</span> {companyTemplate.file?.name || 'Not uploaded'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={goBack} disabled={step === 1} className="gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />Back
        </Button>
        {step < 4 ? (
          <Button onClick={goNext} className="gap-1.5 steel-gradient text-white border-0">
            Next<ArrowRight className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={creating} className="gap-1.5 steel-gradient text-white border-0">
            <UserPlus className="w-3.5 h-3.5" />{creating ? 'Creating…' : 'Create Employee'}
          </Button>
        )}
      </div>
    </div>
  );
}
