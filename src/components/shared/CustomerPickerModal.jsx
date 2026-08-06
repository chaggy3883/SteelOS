import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search, ExternalLink } from 'lucide-react';

// Dumb/reusable on purpose — the caller loads and owns `customers`, this
// component only searches and picks from what it's handed. Used anywhere a
// text field needs a more visual alternative to typing/selecting a CRM name.
export default function CustomerPickerModal({ open, onOpenChange, customers, onSelect }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => (c.name || '').toLowerCase().includes(q));
  }, [customers, search]);

  const handleOpenChange = (next) => {
    if (!next) setSearch('');
    onOpenChange(next);
  };

  const handleSelect = (customer) => {
    onSelect(customer);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Customer</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
            className="pl-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No customers match "{search}".</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c)}
                className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm"
              >
                {c.name}
              </button>
            ))
          )}
        </div>
        <a href="/crm" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" />Don't see them? Manage the full customer list in CRM →
        </a>
      </DialogContent>
    </Dialog>
  );
}
