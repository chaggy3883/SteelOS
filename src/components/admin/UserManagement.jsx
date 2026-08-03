import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, Ban, Trash2, Loader2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SYSTEM_ROLES } from '@/components/admin/adminConstants';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import { isSuperAdmin } from '@/lib/tenantContext';
import { useToast } from '@/components/ui/use-toast';

export default function UserManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderForm, setBuilderForm] = useState({ full_name: '', email: '', password: '', role: 'estimator' });
  const [permissions, setPermissions] = useState({ can_view_bid_workspace: true, can_upload_documents: true, can_manage_users: false, can_view_financials: false });
  const [allRoles, setAllRoles] = useState(SYSTEM_ROLES);
  const [viewerIsSuperAdmin, setViewerIsSuperAdmin] = useState(false);

  useEffect(() => {
    loadUsers();
    getAllRoles().then(setAllRoles);
    base44.auth.me().then((me) => setViewerIsSuperAdmin(isSuperAdmin(me))).catch(() => setViewerIsSuperAdmin(false));
  }, []);

  // Super-Admin Role Firewall: a plain tenant `admin` (not a platform
  // `super_admin`) may never see, assign, or view the `super_admin` tier —
  // it's the platform-operator role, not a tenant permission level.
  const assignableRoles = viewerIsSuperAdmin ? allRoles : allRoles.filter((r) => r.value !== 'super_admin');
  const visibleUsers = viewerIsSuperAdmin ? users : users.filter((u) => !(u.roles || []).includes('super_admin'));

  const loadUsers = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.User.list('-created_date', 200);
      setUsers(list);
    } catch (e) {
      toast({ title: 'Failed to load users', variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const filtered = visibleUsers.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateUser = async () => {
    if (!builderForm.full_name || !builderForm.email || !builderForm.password) {
      toast({ title: 'Complete all required fields', variant: 'destructive' });
      return;
    }
    if (builderForm.role === 'super_admin' && !viewerIsSuperAdmin) {
      toast({ title: 'Only a super_admin can create a super_admin account', variant: 'destructive' });
      return;
    }
    try {
      const created = await base44.entities.User.create({
        full_name: builderForm.full_name,
        email: builderForm.email,
        password: builderForm.password,
        roles: [builderForm.role],
        permissions,
        is_active: true,
      });
      setUsers(prev => [created, ...prev]);
      setShowBuilder(false);
      setBuilderForm({ full_name: '', email: '', password: '', role: 'estimator' });
      setPermissions({ can_view_bid_workspace: true, can_upload_documents: true, can_manage_users: false, can_view_financials: false });
      toast({ title: 'User created manually' });
    } catch (e) {
      toast({ title: 'Failed to create user', description: e?.message || 'Please retry.', variant: 'destructive' });
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    if (newRole === 'super_admin' && !viewerIsSuperAdmin) {
      toast({ title: 'Only a super_admin can assign the super_admin tier', variant: 'destructive' });
      return;
    }
    try {
      await base44.entities.User.update(userId, { roles: [newRole] });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, roles: [newRole] } : u));
      toast({ title: 'Role updated' });
    } catch (e) {
      toast({ title: 'Failed to update role', variant: 'destructive' });
    }
  };

  const handleSuspend = async (user) => {
    if (!confirm(`Suspend ${user.full_name || user.email}? They will lose access on next login.`)) return;
    try {
      await base44.entities.User.update(user.id, { roles: ['suspended'] });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, roles: ['suspended'] } : u));
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
        <Button onClick={() => setShowBuilder(true)} className="steel-gradient text-white border-0">
          <PlusCircle className="w-4 h-4" />Create User
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
                  <Select value={user.roles?.[0] || 'user'} onValueChange={v => handleRoleChange(user.id, v)}>
                    <SelectTrigger className="w-48 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableRoles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
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

      <Dialog open={showBuilder} onOpenChange={setShowBuilder}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>Name</Label><Input value={builderForm.full_name} onChange={e => setBuilderForm(f => ({ ...f, full_name: e.target.value }))} className="mt-1" /></div>
              <div><Label>Email</Label><Input type="email" value={builderForm.email} onChange={e => setBuilderForm(f => ({ ...f, email: e.target.value }))} className="mt-1" /></div>
              <div><Label>Password</Label><Input type="password" value={builderForm.password} onChange={e => setBuilderForm(f => ({ ...f, password: e.target.value }))} className="mt-1" /></div>
              <div><Label>Base Role</Label><Select value={builderForm.role} onValueChange={v => setBuilderForm(f => ({ ...f, role: v }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{assignableRoles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(permissions).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                  <input type="checkbox" checked={value} onChange={() => setPermissions(prev => ({ ...prev, [key]: !prev[key] }))} />
                  <span>{key.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBuilder(false)}>Cancel</Button>
            <Button onClick={handleCreateUser} className="steel-gradient text-white border-0">Create Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}