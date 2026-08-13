import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Search, FileText, Building2, FolderKanban, Calculator, X } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';

export default function GlobalSearchPalette() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ bids: [], customers: [], projects: [], documents: [] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  useClickOutside(panelRef, () => setOpen(false), open);

  // Cmd/Ctrl+K is a global shortcut independent of open/close state (it must
  // work to OPEN the palette too), so it stays a dedicated listener —
  // closing on outside-click/Escape is handled by useClickOutside above.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults({ bids: [], customers: [], projects: [], documents: [] }); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const q = query.toLowerCase();
        const match = (val) => val?.toLowerCase().includes(q);
        const [bids, customers, projects, documents] = await Promise.all([
          db.entities.Bid.filter({ is_archived: false }, '-bid_due_date', 50),
          db.entities.Customer.filter({ is_active: true }, 'name', 50),
          db.entities.Project.filter({ is_archived: false }, 'name', 50),
          db.entities.Document.filter({ is_archived: false }, '-created_date', 50),
        ]);
        setResults({
          bids: bids.filter(b => match(b.bid_number) || match(b.job_name) || match(b.customer_name)).slice(0, 5),
          customers: customers.filter(c => match(c.name) || match(c.email) || match(c.city)).slice(0, 5),
          projects: projects.filter(p => match(p.name) || match(p.project_number) || match(p.customer_name)).slice(0, 5),
          documents: documents.filter(d => match(d.name) || match(d.file_name)).slice(0, 5),
        });
      } catch (e) {} finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const handleResultClick = (type, item) => {
    const routes = {
      bids: `/estimating/${item.id}`,
      customers: '/crm',
      projects: `/projects/${item.id}`,
      documents: '/documents',
    };
    navigate(routes[type]);
    setOpen(false);
    setQuery('');
  };

  const totalResults = Object.values(results).flat().length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full max-w-md px-3 py-2 text-sm bg-muted border border-border rounded-lg hover:bg-muted/80 transition-colors text-muted-foreground"
      >
        <Search className="w-4 h-4" />
        <span className="flex-1 text-left">Search bids, customers, projects…</span>
        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] bg-background border border-border rounded font-mono">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-black/40">
          <div ref={panelRef} className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 p-4 border-b border-border">
              <Search className="w-5 h-5 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search bids, customers, vendors, projects, documents…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
              {loading && <div className="p-4 text-center text-sm text-muted-foreground">Searching…</div>}
              {!loading && !query.trim() && (
                <div className="p-8 text-center text-sm text-muted-foreground">Type to search across bids, customers, projects, and documents.</div>
              )}
              {!loading && query.trim() && totalResults === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">No results found for “{query}”</div>
              )}
              {!loading && totalResults > 0 && (
                <div className="space-y-4">
                  {results.bids.length > 0 && (
                    <ResultGroup icon={Calculator} label="Bids" items={results.bids} type="bids" onClick={handleResultClick}
                      titleFn={b => `${b.bid_number} — ${b.job_name}`} subFn={b => b.customer_name} />
                  )}
                  {results.customers.length > 0 && (
                    <ResultGroup icon={Building2} label="Customers / Vendors" items={results.customers} type="customers" onClick={handleResultClick}
                      titleFn={c => c.name} subFn={c => [c.city, c.state].filter(Boolean).join(', ')} />
                  )}
                  {results.projects.length > 0 && (
                    <ResultGroup icon={FolderKanban} label="Projects" items={results.projects} type="projects" onClick={handleResultClick}
                      titleFn={p => `${p.project_number} — ${p.name}`} subFn={p => p.customer_name} />
                  )}
                  {results.documents.length > 0 && (
                    <ResultGroup icon={FileText} label="Documents" items={results.documents} type="documents" onClick={handleResultClick}
                      titleFn={d => d.name} subFn={d => d.document_type?.replace(/_/g, ' ')} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ResultGroup({ icon: Icon, label, items, type, onClick, titleFn, subFn }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      {items.map(item => (
        <button key={item.id} onClick={() => onClick(type, item)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-left">
          <div>
            <p className="text-sm font-medium">{titleFn(item)}</p>
            <p className="text-xs text-muted-foreground">{subFn(item) || '—'}</p>
          </div>
        </button>
      ))}
    </div>
  );
}