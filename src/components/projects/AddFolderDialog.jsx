import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { folderTree, flattenTree, checkFolderName } from '@/lib/projectFolders';

// New folder in a project's Files — at the top level or inside any folder.
// mode 'rename' renames `folder` instead.
export default function AddFolderDialog({ open, onOpenChange, projectId, folders = [], parentId = null, folder = null, mode = 'add', onSaved }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parentId || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(mode === 'rename' ? folder?.name || '' : '');
    setParent(mode === 'rename' ? folder?.parent_id || '' : parentId || '');
  }, [open, mode, folder, parentId]);

  const options = useMemo(() => flattenTree(folderTree(folders)), [folders]);
  const check = checkFolderName(name, parent || null, folders, mode === 'rename' ? folder?.id : null);

  const save = async () => {
    if (!check.ok) return;
    setSaving(true);
    try {
      const saved = mode === 'rename'
        ? await db.entities.ProjectFolder.update(folder.id, { name: check.name })
        : await db.entities.ProjectFolder.create({ project_id: projectId, name: check.name, parent_id: parent || null, is_base: false, created_by: user?.full_name || user?.email || '' });
      toast({ title: mode === 'rename' ? `Renamed to ${saved.name}` : `Folder ${saved.name} added` });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not save the folder', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{mode === 'rename' ? 'Rename folder' : 'Add folder'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Folder name</Label>
            <Input
              autoFocus
              className="mt-1"
              value={name}
              placeholder="e.g. Bulletins, Photos, Seq 1"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            />
            {name.trim() && !check.ok && <p className="text-xs text-destructive mt-1">{check.message}</p>}
          </div>
          {mode !== 'rename' && (
            <div>
              <Label>Put it in</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">Top level (next to the standard folders)</option>
                {options.map(({ folder: f, depth }) => (
                  <option key={f.id} value={f.id}>{`${'   '.repeat(depth + 1)}${f.name}`}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!check.ok || saving}>{saving ? 'Saving…' : mode === 'rename' ? 'Rename' : 'Add folder'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
