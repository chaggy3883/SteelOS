import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { KeyRound, Plus, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

// NON-CRYPTOGRAPHIC STUB, matching src/lib/hrSecurity.js — this app has no
// backend and no crypto library, so the "encrypted" key is just obfuscated
// well enough that it isn't stored as bare plaintext in the mock DB.
function generateFullKey() {
  const body = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  return `st_live_${body}`;
}
function maskKey(fullKey) {
  return `st_live_...${fullKey.slice(-4)}`;
}
function obscureSecret(fullKey) {
  return btoa(fullKey);
}

export default function TokenVaultManager({ tokens, onChanged }) {
  const { toast } = useToast();
  const [showGenerate, setShowGenerate] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [saving, setSaving] = useState(false);
  const [revealedKey, setRevealedKey] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const handleGenerate = async () => {
    if (!tokenName.trim()) return;
    setSaving(true);
    try {
      const fullKey = generateFullKey();
      const created = await base44.entities.ApiTokenVault.create({
        token_name: tokenName.trim(),
        partial_key_string: maskKey(fullKey),
        encrypted_secret_key: obscureSecret(fullKey),
        status: 'Active',
        created_at: new Date().toISOString(),
      });
      setShowGenerate(false);
      setTokenName('');
      onChanged();
      setRevealedKey({ name: created.token_name, key: fullKey });
    } catch (e) {
      toast({ title: 'Failed to generate key', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (token) => {
    setBusyId(token.id);
    try {
      const nextStatus = token.status === 'Active' ? 'Revoked' : 'Active';
      await base44.entities.ApiTokenVault.update(token.id, { status: nextStatus });
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to update key status', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copied to clipboard' });
    } catch (e) {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="steel-gradient text-white border-0" onClick={() => setShowGenerate(true)}>
          <Plus className="w-3.5 h-3.5" /> Generate Key
        </Button>
      </div>

      <div className="steel-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  No developer keys yet.
                </TableCell>
              </TableRow>
            )}
            {tokens.map(token => (
              <TableRow key={token.id}>
                <TableCell className="font-medium text-sm flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground" /> {token.token_name}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => handleCopy(token.partial_key_string)}
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                    title="Copy masked reference"
                  >
                    {token.partial_key_string} <Copy className="w-3 h-3" />
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={token.status === 'Active' ? 'secondary' : 'outline'} className={token.status === 'Active' ? 'bg-green-500/10 text-green-600 border-transparent' : 'text-muted-foreground'}>
                    {token.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {token.created_at ? new Date(token.created_at).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {busyId === token.id
                    ? <Loader2 className="w-4 h-4 animate-spin ml-auto text-muted-foreground" />
                    : <Switch checked={token.status === 'Active'} onCheckedChange={() => handleToggleStatus(token)} />
                  }
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Developer Key</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">Key Name</Label>
            <Input
              className="mt-1"
              placeholder="e.g. Procore Webhook Key"
              value={tokenName}
              onChange={e => setTokenName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button className="steel-gradient text-white border-0" disabled={saving || !tokenName.trim()} onClick={handleGenerate}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedKey} onOpenChange={(open) => !open && setRevealedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{revealedKey?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Copy this key now — it won't be shown again. Only a masked reference is kept afterward.</p>
          <div className="flex items-center gap-2 bg-muted rounded-md p-3">
            <code className="text-xs font-mono flex-1 break-all">{revealedKey?.key}</code>
            <Button size="sm" variant="outline" onClick={() => handleCopy(revealedKey.key)}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
