import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, FileText, Building2, FolderKanban, Calculator, Users, UserSearch, HelpCircle, Tag, X, ShoppingCart, Truck, ClipboardCheck, FilePen, Store, Loader2,
} from 'lucide-react';
import { db } from '@/api/apiClient';
import { useClickOutside } from '@/hooks/useClickOutside';
import { detectOS } from '@/lib/platformDetect';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/components/dashboard/rbacConfig';
import { getEffectiveCompany, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { allowedSearchSources, matchesQuery } from '@/lib/globalSearchSources';

const ICONS = {
  projects: FolderKanban, bids: Calculator, pieces: Tag, purchase_orders: ShoppingCart, customers: Building2, vendors: Store,
  employees: Users, candidates: UserSearch, rfis: HelpCircle, submittals: ClipboardCheck, change_orders: FilePen, loads: Truck, documents: FileText,
};
const PER_GROUP = 6;
const SALES_ONLY_EXEMPT = ['admin', 'super_admin', 'project_manager', 'estimator'];

const normalizeRoles = (roles) => (Array.isArray(roles) ? roles : roles ? [roles] : []).map((r) => String(r || '').toLowerCase().trim());

// Top-bar search (Ctrl/⌘ K). Searches every record type the signed-in role
// can open (src/lib/globalSearchSources.js), within the current company;
// clicking a result — or arrow keys + Enter — goes straight to that record.
export default function GlobalSearchPalette() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState(null); // allowed sources for this user
  const [data, setData] = useState(null); // { rows: { [key]: rows }, ctx } loaded on open
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [os] = useState(() => detectOS());
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const { user } = useAuth();
  const roleKey = normalizeRoles(user?.roles).join(',');
  const roles = useMemo(() => (roleKey ? roleKey.split(',') : []), [roleKey]);

  useClickOutside(panelRef, () => setOpen(false), open);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Which kinds of records this role may search — same rule as the sidebar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [perms, company] = await Promise.all([
          isImpersonating() ? Promise.resolve({ modules: ['*'] }) : getUserPermissions(roles.length ? roles : ['user']),
          getEffectiveCompany().catch(() => null),
        ]);
        if (!cancelled) setSources(allowedSearchSources({ roles, allowedModules: perms.modules, hasModuleFn: (p) => hasModule(company, p) }));
      } catch {
        if (!cancelled) setSources([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, roles]);

  // Load everything searchable each time the palette opens (fresh data),
  // then filter instantly while typing.
  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    if (!sources) return undefined;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const projectRows = await db.entities.Project.list('name', 100000).catch(() => []);
      const ctx = { roles, projectById: new Map(projectRows.map((p) => [p.id, p])) };
      const entries = await Promise.all(sources.map(async (s) => {
        if (s.key === 'projects') return [s.key, projectRows];
        try { return [s.key, (await s.load(ctx)) || []]; } catch { return [s.key, []]; }
      }));
      if (!cancelled) {
        setData({ rows: Object.fromEntries(entries), ctx });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sources, roles]);

  const results = useMemo(() => {
    if (!data || !sources || !query.trim()) return [];
    const isSalesmanOnly = roles.includes('salesman') && !roles.some((r) => SALES_ONLY_EXEMPT.includes(r));
    const employeeId = user?.employee_id;
    return sources.map((s) => {
      let rows = (data.rows[s.key] || []).filter((r) => !r._deleted && matchesQuery(s.fields(r, data.ctx), query));
      // A salesman only sees their own deals (projects/bids they sold).
      if (isSalesmanOnly && s.salesmanOwned) rows = rows.filter((r) => !!employeeId && s.salesmanOwned(r, data.ctx)?.salesman_id === employeeId);
      return { source: s, total: rows.length, rows: rows.slice(0, PER_GROUP) };
    }).filter((g) => g.total > 0);
  }, [data, sources, query, roles, user?.employee_id]);

  const flat = useMemo(() => results.flatMap((g) => g.rows.map((row) => ({ source: g.source, row }))), [results]);
  useEffect(() => { setActive(0); }, [query]);

  const go = (source, row) => {
    navigate(source.route(row));
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % flat.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + flat.length) % flat.length); }
    if (e.key === 'Enter') { e.preventDefault(); const hit = flat[active]; if (hit) go(hit.source, hit.row); }
  };

  const label = sources?.length ? 'Search projects, estimates, pieces, POs, people…' : 'Search…';
  let flatIndex = -1;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full max-w-md px-3 py-2 text-sm bg-muted border border-border rounded-lg hover:bg-muted/80 transition-colors text-muted-foreground"
      >
        <Search className="w-4 h-4" />
        <span className="flex-1 text-left truncate">{label}</span>
        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] bg-background border border-border rounded font-mono">{os === 'macos' ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 sm:px-0 pt-[6vh] sm:pt-[10vh] bg-black/40">
          <div ref={panelRef} className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 p-4 border-b border-border">
              <Search className="w-5 h-5 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={label}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
                aria-label="Global search"
              />
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              <button onClick={() => setOpen(false)} aria-label="Close search"><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
              {!query.trim() && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {sources?.length
                    ? <>Type a name, number, piece mark, serial #, PO #… Searches {sources.map((s) => s.label.toLowerCase()).join(', ')}.</>
                    : 'Nothing to search for your role.'}
                </div>
              )}
              {query.trim() && !loading && results.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">No results found for “{query}”</div>
              )}
              {results.length > 0 && (
                <div className="space-y-3">
                  {results.map(({ source, total, rows }) => {
                    const Icon = ICONS[source.key] || Search;
                    return (
                      <div key={source.key}>
                        <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          <Icon className="w-3.5 h-3.5" /> {source.label}
                          {total > rows.length && <span className="normal-case font-normal">— {rows.length} of {total}, type more to narrow</span>}
                        </div>
                        {rows.map((row) => {
                          flatIndex += 1;
                          const idx = flatIndex;
                          return (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => go(source, row)}
                              onMouseEnter={() => setActive(idx)}
                              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors text-left ${idx === active ? 'bg-muted' : 'hover:bg-muted'}`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{source.title(row, data.ctx) || '—'}</p>
                                <p className="text-xs text-muted-foreground truncate">{source.sub(row, data.ctx) || '—'}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
