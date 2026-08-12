import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Plus, Edit2, Trash2, Loader2, Shield, Lock, Eye } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { BUILTIN_ROLES, ALL_MODULES, WIDGET_LIBRARY } from '@/components/dashboard/rbacConfig';

const moduleLabel = (path) => ALL_MODULES.find(m => m.path === path)?.label || path;
const widgetName = (id) => WIDGET_LIBRARY.find(w => w.id === id)?.name || id;

function AccessSummary({ list, allLabel, unit }) {
  if ((list || []).includes('*')) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium whitespace-nowrap">{allLabel}</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium whitespace-nowrap">{(list || []).length} {unit}</span>;
}

function AccessDetail({ list, allLabel, items, nameOf }) {
  if ((list || []).includes('*')) {
    return <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary font-medium">{allLabel}</span>;
  }
  if (!list || list.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map(id => (
        <span key={id} className="text-xs px-2 py-1 rounded bg-muted text-foreground">{nameOf(id)}</span>
      ))}
    </div>
  );
}

const EMPTY_FORM = { role_name: '', label: '', description: '', allowed_modules: [], allowed_widgets: [] };

export default function RoleManager() {
  const { toast } = useToast();
  const [customRoles, setCustomRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [viewingBuiltin, setViewingBuiltin] = useState(null);
  const [viewingCustom, setViewingCustom] = useState(null);

  useEffect(() => {
    loadRoles();
  }, []);

  // Super-Admin Role Firewall: no one — including a viewer who is
  // themselves a super_admin — sees the platform-operator role card here.
  // There is currently no out-of-band provisioning path for super_admin
  // accounts; a future one would hook in here (and in
  // `UserManagement.jsx`'s assignableRoles) rather than restoring it to
  // this list.
  const visibleBuiltinRoles = BUILTIN_ROLES.filter((r) => r.name !== 'super_admin');

  const loadRoles = async () => {
    setLoading(true);
    try { const list = await db.entities.CustomRole.list('-created_date', 50); setCustomRoles(list); }
    catch (e) {}
    finally { setLoading(false); }
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); };

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
      setForm(EMPTY_FORM);
    } catch (e) { toast({ title: 'Failed to save role', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const handleEdit = (role) => {
    setViewingCustom(null);
    setEditing(role);
    setForm({ role_name: role.role_name, label: role.label, description: role.description || '', allowed_modules: role.allowed_modules || [], allowed_widgets: role.allowed_widgets || [] });
    setShowForm(true);
  };

  const handleDelete = async (role) => {
    if (!confirm(`Delete role "${role.label}"? Users with this role will lose access.`)) return;
    try {
      await db.entities.CustomRole.delete(role.id);
      toast({ title: 'Role deleted' });
      setViewingCustom(null);
      loadRoles();
    } catch (e) { toast({ title: 'Failed to delete role', variant: 'destructive' }); }
  };

  const handleToggleActive = async (role) => {
    try {
      await db.entities.CustomRole.update(role.id, { is_active: !role.is_active });
      toast({ title: role.is_active ? 'Role deactivated' : 'Role activated' });
      setViewingCustom(null);
      loadRoles();
    } catch (e) { toast({ title: 'Failed to update role', variant: 'destructive' }); }
  };

  const toggleModule = (path) => {
    setForm(f => ({ ...f, allowed_modules: f.allowed_modules.includes(path) ? f.allowed_modules.filter(m => m !== path) : [...f.allowed_modules, path] }));
  };

  const toggleWidget = (id) => {
    setForm(f => ({ ...f, allowed_widgets: f.allowed_widgets.includes(id) ? f.allowed_widgets.filter(w => w !== id) : [...f.allowed_widgets, id] }));
  };

  return (
    <div className="space-y-8">
      {/* Built-in Roles */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" />Built-in Roles</h3>
        <div className="steel-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role Name</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Allowed Modules</TableHead>
                <TableHead>Allowed Widgets</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBuiltinRoles.map(role => (
                <TableRow key={role.name} onClick={() => setViewingBuiltin(role)} className="cursor-pointer">
                  <TableCell className="font-mono text-xs">{role.name}</TableCell>
                  <TableCell className="font-medium">{role.label}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-xs truncate" title={role.description}>{role.description}</TableCell>
                  <TableCell><AccessSummary list={role.allowed_modules} allLabel="All Modules" unit="modules" /></TableCell>
                  <TableCell><AccessSummary list={role.allowed_widgets} allLabel="All Widgets" unit="widgets" /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setViewingBuiltin(role); }}>
                      <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Custom Roles */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Custom Roles</h3>
          <Button size="sm" onClick={openCreate} className="steel-gradient text-white border-0">
            <Plus className="w-3.5 h-3.5" />Add Custom Role
          </Button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : customRoles.length === 0 ? (
          <div className="steel-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No custom roles yet. Create one to define granular access permissions.</p>
          </div>
        ) : (
          <div className="steel-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role Name</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Allowed Modules</TableHead>
                  <TableHead>Allowed Widgets</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customRoles.map(role => (
                  <TableRow key={role.id} onClick={() => setViewingCustom(role)} className={`cursor-pointer ${role.is_active === false ? 'opacity-60' : ''}`}>
                    <TableCell className="font-mono text-xs">{role.role_name}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {role.label}
                        {role.is_active === false && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-xs truncate" title={role.description || 'No description'}>{role.description || 'No description'}</TableCell>
                    <TableCell><AccessSummary list={role.allowed_modules} allLabel="All Modules" unit="modules" /></TableCell>
                    <TableCell><AccessSummary list={role.allowed_widgets} allLabel="All Widgets" unit="widgets" /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Switch checked={role.is_active !== false} onCheckedChange={() => handleToggleActive(role)} />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(role)}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(role)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Built-in role detail modal — read-only */}
      <Dialog open={!!viewingBuiltin} onOpenChange={(next) => !next && setViewingBuiltin(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewingBuiltin && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" />{viewingBuiltin.label}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2 text-sm">
                <div><span className="text-xs text-muted-foreground font-mono">{viewingBuiltin.name}</span></div>
                <p className="text-muted-foreground">{viewingBuiltin.description}</p>
                <div>
                  <Label className="mb-2 block">Allowed Modules</Label>
                  <AccessDetail list={viewingBuiltin.allowed_modules} allLabel="All Modules" nameOf={moduleLabel} />
                </div>
                <div>
                  <Label className="mb-2 block">Allowed Widgets</Label>
                  <AccessDetail list={viewingBuiltin.allowed_widgets} allLabel="All Widgets" nameOf={widgetName} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewingBuiltin(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Custom role detail modal — edit/delete/toggle-active */}
      <Dialog open={!!viewingCustom} onOpenChange={(next) => !next && setViewingCustom(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewingCustom && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {viewingCustom.label}
                  {viewingCustom.is_active === false && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2 text-sm">
                <div><span className="text-xs text-muted-foreground font-mono">{viewingCustom.role_name}</span></div>
                <p className="text-muted-foreground">{viewingCustom.description || 'No description'}</p>
                <div>
                  <Label className="mb-2 block">Allowed Modules</Label>
                  <AccessDetail list={viewingCustom.allowed_modules} allLabel="All Modules" nameOf={moduleLabel} />
                </div>
                <div>
                  <Label className="mb-2 block">Allowed Widgets</Label>
                  <AccessDetail list={viewingCustom.allowed_widgets} allLabel="All Widgets" nameOf={widgetName} />
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Switch checked={viewingCustom.is_active !== false} onCheckedChange={() => handleToggleActive(viewingCustom)} />
                  <span className="text-xs text-muted-foreground">{viewingCustom.is_active === false ? 'Inactive — cannot be assigned to new users' : 'Active'}</span>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="text-destructive" onClick={() => handleDelete(viewingCustom)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete
                </Button>
                <Button variant="outline" onClick={() => handleEdit(viewingCustom)}>
                  <Edit2 className="w-3.5 h-3.5 mr-1.5" />Edit
                </Button>
                <Button onClick={() => setViewingCustom(null)} className="steel-gradient text-white border-0">Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / edit form */}
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
