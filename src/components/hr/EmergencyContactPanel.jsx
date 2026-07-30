import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { HeartPulse, Save } from 'lucide-react';

export default function EmergencyContactPanel({ employee, onUpdated }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    emergency_contact_name: employee.emergency_contact_name || '',
    emergency_contact_relationship: employee.emergency_contact_relationship || '',
    emergency_contact_phone: employee.emergency_contact_phone || '',
    emergency_contact_phone_alt: employee.emergency_contact_phone_alt || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await base44.entities.employees.update(employee.id, form);
      onUpdated(updated);
      toast({ title: 'Emergency contact updated' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="steel-card p-4">
      <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-primary" />Emergency Contact</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Primary Contact Name</Label>
          <Input value={form.emergency_contact_name} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_name: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Relationship</Label>
          <Input value={form.emergency_contact_relationship} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_relationship: e.target.value }))} className="mt-1" placeholder="Spouse, Parent, etc." />
        </div>
        <div>
          <Label className="text-xs">Phone Number</Label>
          <Input value={form.emergency_contact_phone} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_phone: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Alt Phone</Label>
          <Input value={form.emergency_contact_phone_alt} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_phone_alt: e.target.value }))} className="mt-1" />
        </div>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 steel-gradient text-white border-0 mt-4">
        <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save Emergency Contact'}
      </Button>
    </div>
  );
}
