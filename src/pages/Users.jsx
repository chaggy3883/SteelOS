import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Users as UsersIcon, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState(['estimator']);
  const [inviting, setInviting] = useState(false);
  const [newUserId, setNewUserId] = useState(null);
  const rowRefs = useRef({});

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.User.list('-created_date', 100);
      setUsers(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const toggleInviteRole = (role) => {
    setInviteRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  };

  const handleInvite = async () => {
    if (!inviteEmail) return;
    // Write through base44.entities.User (the same entity API this page reads
    // from via loadUsers/list) rather than base44.users.inviteUser, which holds
    // its own independent in-memory copy — a write there is invisible to a
    // .list() call through this page's separate User entity instance.
    const existing = users.find((u) => u.email?.toLowerCase() === inviteEmail.toLowerCase());
    if (existing) {
      toast({ title: 'A user with this email already exists', variant: 'destructive' });
      return;
    }
    setInviting(true);
    try {
      const mappedRoles = inviteRoles.map((r) => (r === 'system_administrator' ? 'admin' : r));
      const created = await base44.entities.User.create({
        email: inviteEmail,
        roles: mappedRoles.length > 0 ? mappedRoles : ['user'],
        password: 'changeme123',
        full_name: inviteEmail,
        is_active: true,
      });
      toast({ title: 'Invitation sent!', description: `${inviteEmail} has been invited to SteelOS.` });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRoles(['estimator']);
      await loadUsers();
      setNewUserId(created.id);
      requestAnimationFrame(() => {
        rowRefs.current[created.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => setNewUserId((id) => (id === created.id ? null : id)), 3000);
    } catch (e) {
      toast({ title: 'Failed to invite', description: 'Please try again.', variant: 'destructive' });
    } finally { setInviting(false); }
  };

  const filtered = users.filter(u =>
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
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="steel-gradient text-white border-0">
                <Plus className="w-4 h-4 mr-2" /> Invite User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@yourcompany.com"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Role(s) — select one or more</Label>
                  <div className="mt-1 max-h-56 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                    {ROLES.map(r => (
                      <label key={r} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted cursor-pointer">
                        <input type="checkbox" checked={inviteRoles.includes(r)} onChange={() => toggleInviteRole(r)} />
                        {r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </label>
                    ))}
                  </div>
                </div>
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail} className="w-full steel-gradient text-white border-0">
                  {inviting ? 'Sending Invitation...' : 'Send Invitation'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Role Legend */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Administrators', count: users.filter(u => u.roles?.includes('admin')).length, color: 'text-red-500' },
          { label: 'Office Users', count: users.filter(u => u.roles?.includes('user')).length, color: 'text-blue-500' },
          { label: 'Total Active', count: users.length, color: 'text-green-500' },
          { label: 'Pending Invite', count: 0, color: 'text-orange-500' },
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
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="py-3 px-4"><div className="h-8 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="py-16 text-center">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}