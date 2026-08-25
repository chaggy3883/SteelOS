import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { HeartPulse, Save, AlertTriangle } from 'lucide-react';

// Soft format hint only — never blocks Save. Loose on purpose (7+ digits,
// allowing spaces/parens/dashes/dots/leading +) since these are real-world
// personal phone numbers, not a system we're validating for delivery.
const isPlausiblePhone = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return /^\+?[\d\s().-]{7,}$/.test(trimmed);
};

// Second contact reuses the emergency_contact2_* fields already added for
// the New Employee intake form (NewEmployee.jsx/provisionEmployee in
// employeesApi.js) rather than a differently-named emergency_contact_2_*
// set, so there's one field per contact, not two competing ones.
export default function EmergencyContactPanel({ employee, roles = [], onUpdated }) {
  const { toast } = useToast();
  const canEdit = hasFullEmployeeAccess(roles);
  const [form, setForm] = useState({
    emergency_contact_name: employee.emergency_contact_name || '',
    emergency_contact_relationship: employee.emergency_contact_relationship || '',
    emergency_contact_phone: employee.emergency_contact_phone || '',
    emergency_contact_phone_alt: employee.emergency_contact_phone_alt || '',
    emergency_contact2_name: employee.emergency_contact2_name || '',
    emergency_contact2_relationship: employee.emergency_contact2_relationship || '',
    emergency_contact2_phone: employee.emergency_contact2_phone || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await db.entities.employees.update(employee.id, form);
      onUpdated(updated);
      toast({ title: 'Emergency contacts updated' });
    } catch (e) {
      toast({ title: 'Unable to save emergency contacts', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Phone fields render as type="tel" and show a non-blocking format hint —
  // this never disables Save, it's advisory only (item #4: don't block save).
  const displayOrInput = (field, placeholder, { isPhone = false } = {}) => {
    if (!canEdit) return <p className="mt-1 text-sm">{form[field] || '—'}</p>;
    const showHint = isPhone && !isPlausiblePhone(form[field]);
    return (
      <>
        <Input
          type={isPhone ? 'tel' : 'text'}
          value={form[field]}
          onChange={set(field)}
          placeholder={placeholder}
          className="mt-1"
        />
        {showHint && (
          <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />Doesn't look like a phone number — you can still save.
          </p>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-primary" />Emergency Contact 1</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Contact Name</Label>
            {displayOrInput('emergency_contact_name')}
          </div>
          <div>
            <Label className="text-xs">Relationship</Label>
            {displayOrInput('emergency_contact_relationship', 'Spouse, Parent, etc.')}
          </div>
          <div>
            <Label className="text-xs">Phone Number</Label>
            {displayOrInput('emergency_contact_phone', '', { isPhone: true })}
          </div>
          <div>
            <Label className="text-xs">Alt Phone</Label>
            {displayOrInput('emergency_contact_phone_alt', '', { isPhone: true })}
          </div>
        </div>
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-primary" />Emergency Contact 2 <span className="text-xs font-normal text-muted-foreground">(optional)</span></h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Contact Name</Label>
            {displayOrInput('emergency_contact2_name')}
          </div>
          <div>
            <Label className="text-xs">Relationship</Label>
            {displayOrInput('emergency_contact2_relationship', 'Spouse, Parent, etc.')}
          </div>
          <div>
            <Label className="text-xs">Phone Number</Label>
            {displayOrInput('emergency_contact2_phone', '', { isPhone: true })}
          </div>
        </div>
      </div>

      {canEdit && (
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 steel-gradient text-white border-0">
          <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save All Contacts'}
        </Button>
      )}
    </div>
  );
}
