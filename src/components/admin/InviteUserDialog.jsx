import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SYSTEM_ROLES } from '@/components/admin/adminConstants';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

export default function InviteUserDialog({ onClose, onInvited, availableRoles }) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!email) return;
    setSaving(true);
    try {
      await base44.users.inviteUser(email, role);
      toast({ title: `Invitation sent to ${email}` });
      onInvited();
      onClose();
    } catch (e) {
      toast({ title: e.message || 'Failed to invite user', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite New User</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Email Address</Label>
            <Input type="email" placeholder="user@company.com" value={email}
              onChange={e => setEmail(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(availableRoles || SYSTEM_ROLES).filter(r => r.value !== 'suspended').map(r =>
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !email} className="steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}