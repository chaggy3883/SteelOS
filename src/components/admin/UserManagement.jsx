import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, UserPlus, Ban, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SYSTEM_ROLES } from '@/components/admin/adminConstants';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import InviteUserDialog from '@/components/admin/InviteUserDialog';
import { useToast } from '@/components/ui/use-toast';

export default function UserManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [allRoles, setAllRoles] = useState(SYSTEM_ROLES);

  useEffect(() => { loadUsers(); getAllRoles().then(setAllRoles); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.User.list('-created_date', 200);
      setUsers(list);
    } catch (e) {
      toast({ title: 'Failed to load users', variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const filtered = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleRoleChange = async (userId, newRole) => {
    try {
      await base44.entities.User.update(userId, { role: newRole });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      toast({ title: 'Role updated' });
    } catch (e) {
      toast({ title: 'Failed to update role', variant: 'destructive' });
    }
  };

  const handleSuspend = async (user) => {
    if (!confirm(`Suspend ${user.full_name || user.email}? They will lose access on next login.`)) return;
    try {
      await base44.entities.User.update(user.id, { role: 'suspended' });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: 'suspended' } : u));
      toast({ title: 'User suspended' });
    } catch (e) {
      toast({ title: 'Failed to suspend user', variant: 'destructive' });
    }
  };

  const handleDelete = async (user) => {
    if (!confirm(`Delete ${user.full_name || user.email}? This cannot be undone.`)) return;
    try {
      await base44.entities.User.delete(user.id);
      setUsers(prev => prev.filter(u => u.id !== user.id));
      toast({ title: 'User deleted' });
    } catch (e) {
      toast({ title: 'Failed to delete user', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Button onClick={() => setShowInvite(true)} className="steel-gradient text-white border-0">
          <UserPlus className="w-4 h-4" />Invite User
        </Button>
      </div>

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role Assignment</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No users found.</td></tr>
            ) : filtered.map(user => (
              <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-medium">{user.full_name || 'Unnamed'}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </td>
                <td className="px-4 py-3">
                  <Select value={user.role || 'user'} onValueChange={v => handleRoleChange(user.id, v)}>
                    <SelectTrigger className="w-48 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allRoles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {user.created_date ? new Date(user.created_date).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSuspend(user)} title="Suspend">
                      <Ban className="w-3.5 h-3.5 text-orange-500" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(user)} title="Delete">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} user(s) • Role changes take effect on next login</p>
      {showInvite && <InviteUserDialog onClose={() => setShowInvite(false)} onInvited={loadUsers} availableRoles={allRoles} />}
    </div>
  );
}