import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Edit2, Trash2, Loader2, Shield, Lock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { BUILTIN_ROLES, ALL_MODULES, WIDGET_LIBRARY } from '@/components/dashboard/rbacConfig';
import { isSuperAdmin } from '@/lib/tenantContext';

export default function RoleManager() {
  const { toast } = useToast();
  const [customRoles, setCustomRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ role_name: '', label: '', description: '', allowed_modules: [], allowed_widgets: [] });
  const [viewerIsSuperAdmin, setViewerIsSuperAdmin] = useState(false);

  useEffect(() => {
    loadRoles();
    db.auth.me().then((me) => setViewerIsSuperAdmin(isSuperAdmin(me))).catch(() => setViewerIsSuperAdmin(false));
  }, []);

  // Super-Admin Role Firewall: a plain tenant admin never sees the
  // platform-operator role card at all — not even read-only.
  const visibleBuiltinRoles = BUILTIN_ROLES.filter((r) => r.name !== 'user' && (viewerIsSuperAdmin || r.name !== 'super_admin'));

  const loadRoles = async () => {
    setLoading(true);
    try { const list = await db.entities.CustomRole.list('-created_date', 50); setCustomRoles(list); }
    catch (e) {}
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!form.role_name || !form.label) return;
    setSaving(true);
    try {
      if (editing) {
        await db.entities.CustomRole.update(editing.id, form);
        toast({ title: 'Role updated' });
      } else {
        await db.entities.CustomRole.create({ ...form, is_system: false, is_active: true });
        toast({ title: 'Custom role created' });
      }
      loadRoles();
      setShowForm(false); setEditing(null);
      setForm({ role_name: '', label: '', description: '', allowed_modules: [], allowed_widgets: [] });
    } catch (e) { toast({ title: 'Failed to save role', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const handleEdit = (role) => {
    setEditing(role);
    setForm({ role_name: role.role_name, label: role.label, description: role.description || '', allowed_modules: role.allowed_modules || [], allowed_widgets: role.allowed_widgets || [] });
    setShowForm(true);
  };

  const handleDelete = async (role) => {
    if (!confirm(`Delete role "${role.label}"? Users with this role will lose access.`)) return;
    try { await db.entities.CustomRole.delete(role.id); toast({ title: 'Role deleted' }); loadRoles(); }
    catch (e) { toast({ title: 'Failed to delete role', variant: 'destructive' }); }
  };

  const toggleModule = (path) => {
    setForm(f => ({ ...f, allowed_modules: f.allowed_modules.includes(path) ? f.allowed_modules.filter(m => m !== path) : [...f.allowed_modules, path] }));
  };

  const toggleWidget = (id) => {
    setForm(f => ({ ...f, allowed_widgets: f.allowed_widgets.includes(id) ? f.allowed_widgets.filter(w => w !== id) : [...f.allowed_widgets, id] }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" />Built-in Roles</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {visibleBuiltinRoles.map(role => (
            <div key={role.name} className="steel-card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">{role.label}</p>
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mb-3">{role.description}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {role.allowed_modules.includes('*') ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">All Modules</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">{role.allowed_modules.length} modules</span>
                )}
                {role.allowed_widgets.includes('*') ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">All Widgets</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">{role.allowed_widgets.length} widgets</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Custom Roles</h3>
          <Button size="sm" onClick={() => { setEditing(null); setForm({ role_name: '', label: '', description: '', allowed_modules: [], allowed_widgets: [] }); setShowForm(true); }} className="steel-gradient text-white border-0">
            <Plus className="w-3.5 h-3.5" />Create Role
          </Button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : customRoles.length === 0 ? (
          <div className="steel-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No custom roles yet. Create one to define granular access permissions.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {customRoles.map(role => (
              <div key={role.id} className="steel-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{role.label}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{role.role_name}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(role)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(role)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{role.description || 'No description'}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">{role.allowed_modules?.length || 0} modules</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">{role.allowed_widgets?.length || 0} widgets</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <Dialog open onOpenChange={() => { setShowForm(false); setEditing(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? 'Edit Role' : 'Create Custom Role'}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Role Name (internal)</Label>
                  <Input placeholder="e.g. field_supervisor" value={form.role_name} disabled={!!editing}
                    onChange={e => setForm(f => ({ ...f, role_name: e.target.value.toLowerCase().replace(/\s/g, '_') }))} className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label>Display Label</Label>
                  <Input placeholder="e.g. Field Supervisor" value={form.label}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className="mt-1" />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Input placeholder="What can this role do?" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="mb-2 block">Module Access Permissions</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-3 border border-border rounded-lg max-h-48 overflow-y-auto">
                  {ALL_MODULES.map(mod => (
                    <label key={mod.path} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                      <Checkbox checked={form.allowed_modules.includes(mod.path)} onCheckedChange={() => toggleModule(mod.path)} />
                      <span className="text-xs">{mod.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Dashboard Widget Permissions</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-3 border border-border rounded-lg max-h-48 overflow-y-auto">
                  {WIDGET_LIBRARY.map(w => {
                    const Icon = w.icon;
                    return (
                      <label key={w.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                        <Checkbox checked={form.allowed_widgets.includes(w.id)} onCheckedChange={() => toggleWidget(w.id)} />
                        <Icon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs">{w.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.role_name || !form.label} className="steel-gradient text-white border-0">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editing ? 'Update Role' : 'Create Role'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}