import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

const CREATE_NEW_VALUE = '__create_new_sequence_area__';

// Shared Sequence/Area picker — same dropdown pattern as ProjectDetail.jsx's
// Phasing tab (a Select of ProjectSequenceArea rows plus "Unassigned"), plus
// a "Create New Sequence/Area…" option so assigning one isn't blocked on a
// separate trip to the project's Lifecycle tab first. Creation mirrors
// ProjectManagement.jsx's createSequenceArea ({project_id, name, sort_order}).
export default function SequenceAreaSelect({ projectId, sequenceAreas, value, onChange, onCreated, triggerClassName }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleValueChange = (v) => {
    if (v === CREATE_NEW_VALUE) {
      setNewName('');
      setShowCreate(true);
      return;
    }
    onChange(v === 'unassigned' ? null : v);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !projectId) return;
    setCreating(true);
    try {
      const created = await db.entities.ProjectSequenceArea.create({
        project_id: projectId,
        name: newName.trim(),
        sort_order: sequenceAreas.length,
      });
      onCreated?.(created);
      onChange(created.id);
      setShowCreate(false);
      toast({ title: `Sequence/Area "${created.name}" created` });
    } catch (e) {
      toast({ title: 'Unable to create sequence/area', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Select value={value || 'unassigned'} onValueChange={handleValueChange}>
        <SelectTrigger className={triggerClassName || 'h-7 w-40 text-xs'}><SelectValue /></SelectTrigger>
        <SelectContent>
          {sequenceAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          <SelectItem value="unassigned">Unassigned</SelectItem>
          <SelectItem value={CREATE_NEW_VALUE} className="text-primary font-medium">+ Create New Sequence/Area…</SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create New Sequence/Area</DialogTitle></DialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Sequence 1, Area A - North Wing"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>{creating ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
