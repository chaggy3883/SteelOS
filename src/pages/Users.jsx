import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/api/apiClient';
import { Users as UsersIcon, Plus, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { isSuperAdmin } from '@/lib/tenantContext';
import PermissionsGridPanel from '@/components/hr/PermissionsGridPanel';

const ROLES = [
  'system_administrator', 'company_administrator', 'executive', 'operations_manager',
  'chief_estimator', 'senior_estimator', 'estimator', 'project_manager', 'assistant_pm',
  'detailer', 'checker', 'purchasing', 'inventory_manager', 'controller', 'accounting',
  'accounts_payable', 'accounts_receivable', 'payroll', 'quality_manager', 'safety_manager',
  'shop_manager', 'shop_foreman', 'fabricator', 'welder', 'painter', 'shipping',
  'inspector', 'field_superintendent', 'ironworker', 'customer', 'vendor', 'guest'
];

const roleColor = (role) => {
  if (['system_administrator','company_administrator'].includes(role)) return 'bg-red-500/10 text-red-500';
  if (['executive','operations_manager'].includes(role)) return 'bg-purple-500/10 text-purple-500';
  if (role?.includes('estimator') || role?.includes('project_manager')) return 'bg-blue-500/10 text-blue-500';
  if (['quality_manager','safety_manager','inspector'].includes(role)) return 'bg-green-500/10 text-green-500';
  if (['shop_manager','shop_foreman','fabricator','welder','painter'].includes(role)) return 'bg-orange-500/10 text-orange-500';
  if (['accounting','controller','accounts_payable','accounts_receivable','payroll'].includes(role)) return 'bg-teal-500/10 text-teal-500';
  return 'bg-gray-500/10 text-gray-500';
};

export default function Users() {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [formFullName, setFormFullName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formPin, setFormPin] = useState('');
  const [createRoles, setCreateRoles] = useState(['estimator']);
  const [creating, setCreating] = useState(false);
  const [newUserId, setNewUserId] = useState(null);
  const [viewerIsSuperAdmin, setViewerIsSuperAdmin] = useState(false);
  const [permissionsUser, setPermissionsUser] = useState(null);
  const rowRefs = useRef({});

  useEffect(() => {
    loadUsers();
    db.auth.me().then((me) => setViewerIsSuperAdmin(isSuperAdmin(me))).catch(() => setViewerIsSuperAdmin(false));
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await db.entities.User.list('-created_date', 100);
      setUsers(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const toggleCreateRole = (role) => {
    setCreateRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  };

  const resetCreateForm = () => {
    setFormFullName('');
    setFormEmail('');
    setFormPassword('');
    setFormPin('');
    setCreateRoles(['estimator']);
  };

  const handleCreateUser = async () => {
    if (!formFullName.trim() || !formEmail.trim() || !formPassword || !/^\d{5}$/.test(formPin)) {
      toast({ title: 'Full name, email, password, and a 5-digit security PIN are all required', variant: 'destructive' });
      return;
    }
    // Write through db.entities.User (the same entity API this page reads
    // from via loadUsers/list) rather than db.users.inviteUser, which holds
    // its own independent in-memory copy — a write there is invisible to a
    // .list() call through this page's separate User entity instance.
    const existing = users.find((u) => u.email?.toLowerCase() === formEmail.toLowerCase());
    if (existing) {
      toast({ title: 'A user with this email already exists', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const mappedRoles = createRoles.map((r) => (r === 'system_administrator' ? 'admin' : r));
      const created = await db.entities.User.create({
        email: formEmail,
        full_name: formFullName,
        password: formPassword,
        security_pin: formPin,
        roles: mappedRoles.length > 0 ? mappedRoles : ['user'],
        is_active: true,
      });
      toast({ title: 'User created', description: `${formFullName} can log in immediately.` });
      setCreateOpen(false);
      resetCreateForm();
      await loadUsers();
      setNewUserId(created.id);
      requestAnimationFrame(() => {
        rowRefs.current[created.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => setNewUserId((id) => (id === created.id ? null : id)), 3000);
    } catch (e) {
      toast({ title: 'Failed to create user', description: 'Please try again.', variant: 'destructive' });
    } finally { setCreating(false); }
  };

  // Super-Admin Role Firewall: a plain tenant admin never sees a
  // super_admin-holding user row, even in counts/search results.
  const visibleUsers = viewerIsSuperAdmin ? users : users.filter((u) => !(u.roles || []).includes('super_admin'));
  const filtered = visibleUsers.filter(u =>
    !search ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Users & Roles"
        subtitle={`${users.length} users in your organization`}
        actions={
          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
            <DialogTrigger asChild>
              <Button className="steel-gradient text-white border-0">
                <Plus className="w-4 h-4 mr-2" /> Create User
              </Button>
            </DialogTrigger>
            <DialogContent className="fixed top-10 left-1/2 -translate-x-1/2 translate-y-0 max-h-[85vh] w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg shadow-2xl flex flex-col p-6 overflow-y-auto scrollbar-thin">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Full Name</Label>
                  <Input
                    placeholder="Jordan Lee"
                    value={formFullName}
                    onChange={e => setFormFullName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Username / Email</Label>
                  <Input
                    type="email"
                    placeholder="colleague@yourcompany.com"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="Set an initial password"
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>5-Digit Security PIN</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="12345"
                    value={formPin}
                    onChange={e => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Role(s) — select one or more</Label>
                  <div className="mt-1 max-h-56 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                    {ROLES.map(r => (
                      <label key={r} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted cursor-pointer">
                        <input type="checkbox" checked={createRoles.includes(r)} onChange={() => toggleCreateRole(r)} />
                        {r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={handleCreateUser}
                  disabled={creating || !formFullName.trim() || !formEmail.trim() || !formPassword || !/^\d{5}$/.test(formPin)}
                  className="w-full steel-gradient text-white border-0"
                >
                  {creating ? 'Creating Account...' : 'Create Account'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Role Legend */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Administrators', count: visibleUsers.filter(u => u.roles?.includes('admin')).length, color: 'text-red-500' },
          { label: 'Office Users', count: visibleUsers.filter(u => u.roles?.includes('user')).length, color: 'text-blue-500' },
          { label: 'Total Active', count: visibleUsers.length, color: 'text-green-500' },
          { label: 'Security PIN Set', count: visibleUsers.filter(u => /^\d{5}$/.test(u.security_pin || '')).length, color: 'text-orange-500' },
        ].map(({ label, count, color }) => (
          <div key={label} className="steel-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : count}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Users List */}
      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">User</th>
                <th className="text-left py-3 px-4">Role</th>
                <th className="text-left py-3 px-4">Joined</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="py-3 px-4"><div className="h-8 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center">
                  <UsersIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No users found</p>
                </td></tr>
              ) : (
                filtered.map(user => (
                  <tr
                    key={user.id}
                    ref={(el) => { rowRefs.current[user.id] = el; }}
                    className={`border-b border-border/50 hover:bg-muted/50 transition-colors ${newUserId === user.id ? 'bg-primary/10 animate-pulse' : ''}`}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {user.full_name?.charAt(0) || user.email?.charAt(0) || '?'}
                        </div>
                        <div>
                          <p className="font-medium">{user.full_name || 'No name'}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(user.roles?.length > 0 ? user.roles : ['user']).map((r) => (
                          <span key={r} className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleColor(r)}`}>
                            {r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">
                      {user.created_date ? new Date(user.created_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500">
                        Active
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPermissionsUser(user)}>
                        <ShieldCheck className="w-3.5 h-3.5" />Manage
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!permissionsUser} onOpenChange={(open) => !open && setPermissionsUser(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{permissionsUser?.full_name || permissionsUser?.email} — Permissions</DialogTitle>
          </DialogHeader>
          {permissionsUser && (
            <PermissionsGridPanel
              subject={permissionsUser}
              subjectType="User"
              onUpdated={(updated) => {
                setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
                setPermissionsUser(updated);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}