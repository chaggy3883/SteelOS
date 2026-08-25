import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Search, FileText, Building2, FolderKanban, Calculator, Users, UserSearch, HelpCircle, Tag, X } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { detectOS } from '@/lib/platformDetect';
import { useAuth } from '@/lib/AuthContext';
import { listEmployeesForRole } from '@/lib/employeesApi';

const normalizeRoles = (roles) => (Array.isArray(roles) ? roles : roles ? [roles] : []).map((r) => String(r || '').toLowerCase().trim());

// Which result categories each role can search. A multi-role account gets the
// union of every matching role's categories. Roles with no entry here (or no
// roles at all) fall back to DEFAULT_CATEGORIES.
// Note: shop_manager gets 'employees' (crew lookup) alongside the HR/admin
// roles from the spec — this is safe because listEmployeesForRole() below
// masks the record to public fields (name/id/classification/dates) for any
// role outside hr_admin/payroll_admin/admin, so shop_manager never sees SSN,
// pay rate, or PIN state, just like the rest of the app's HR surfaces.
// candidates is HR-roles-only, matching the ATS/Archive tabs' own access —
// shop_manager/project_manager etc. get employee lookup but never candidate
// pipeline/rejection data.
const ROLE_CATEGORIES = {
  admin: ['bids', 'customers', 'projects', 'documents', 'employees', 'candidates'],
  super_admin: ['bids', 'customers', 'projects', 'documents', 'employees', 'candidates'],
  payroll_admin: ['bids', 'customers', 'projects', 'documents', 'employees', 'candidates'],
  hr_admin: ['employees', 'documents', 'projects', 'candidates'],
  project_manager: ['projects', 'bids', 'customers', 'documents', 'rfis'],
  estimator: ['bids', 'customers', 'projects'],
  shop_manager: ['projects', 'employees', 'pieces', 'documents'],
  purchasing_agent: ['customers', 'projects', 'documents'],
  salesman: ['customers', 'projects', 'bids', 'rfis'],
};
const DEFAULT_CATEGORIES = ['projects', 'documents'];

function categoriesForRoles(roles) {
  const normalized = normalizeRoles(roles);
  const matched = normalized.filter((r) => ROLE_CATEGORIES[r]);
  if (matched.length === 0) return new Set(DEFAULT_CATEGORIES);
  const set = new Set();
  matched.forEach((r) => ROLE_CATEGORIES[r].forEach((c) => set.add(c)));
  return set;
}

const CATEGORY_LABELS = { projects: 'projects', bids: 'bids', customers: 'customers', employees: 'employees', candidates: 'candidates', rfis: 'RFIs', pieces: 'pieces', documents: 'documents' };
const CATEGORY_ORDER = ['projects', 'bids', 'customers', 'employees', 'candidates', 'rfis', 'pieces', 'documents'];

function searchableLabel(categories) {
  const labels = CATEGORY_ORDER.filter((c) => categories.has(c)).map((c) => CATEGORY_LABELS[c]);
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

const EMPTY_RESULTS = { bids: [], customers: [], projects: [], documents: [], employees: [], candidates: [], rfis: [], pieces: [] };

// "Applied for Welder (Rejected Dec 15)" for an archived candidate, "Applied
// for Welder (Interviewing)" otherwise — matches the format HR expects to
// recognize a candidate by at a glance in search results.
const candidateSubtitle = (c) => {
  const role = c.position_applied ? `Applied for ${c.position_applied}` : 'Applied';
  if (c.status === 'Rejected') {
    const rejected = c.rejection_date ? new Date(`${c.rejection_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `${role} (Rejected${rejected ? ` ${rejected}` : ''})`;
  }
  return `${role} (${(c.status || '').replace(/_/g, ' ')})`;
};

export default function GlobalSearchPalette() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Sync, one-time hint — only changes the displayed glyph (⌘K vs Ctrl K),
  // never which keys the listener below actually accepts (both are always
  // handled, regardless of what this guesses).
  const [os] = useState(() => detectOS());
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const { user } = useAuth();
  const categories = categoriesForRoles(user?.roles);

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
    if (!query.trim()) { setResults(EMPTY_RESULTS); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const q = query.toLowerCase();
        const match = (val) => val?.toLowerCase().includes(q);
        const isSalesman = normalizeRoles(user?.roles).includes('salesman');
        const employeeId = user?.employee_id;
        // Own-records-only filter for the salesman role — falls back to
        // excluding everything (rather than showing all) when we don't know
        // who "me" is, so an unresolved employee_id can never leak other
        // salesmen's records.
        const mine = (row) => !!employeeId && row.salesman_id === employeeId;

        const tasks = {};
        if (categories.has('bids')) tasks.bids = db.entities.Bid.filter({ is_archived: false }, '-bid_due_date', 50);
        if (categories.has('customers')) tasks.customers = db.entities.Customer.filter({ is_active: true }, 'name', 50);
        if (categories.has('projects')) tasks.projects = db.entities.Project.filter({ is_archived: false }, 'name', 50);
        if (categories.has('documents')) tasks.documents = db.entities.Document.filter({ is_archived: false }, '-created_date', 50);
        if (categories.has('employees')) tasks.employees = listEmployeesForRole(user?.roles, 'full_name', 50);
        // Includes rejected/archived candidates — the Archive is meant to stay
        // searchable, not just the active pipeline.
        if (categories.has('candidates')) tasks.candidates = db.entities.candidate_profiles.list('-created_date', 100);
        if (categories.has('rfis')) tasks.rfis = db.entities.RFI.list('-created_date', 50);
        if (categories.has('pieces')) tasks.pieces = db.entities.PieceMark.list('-created_date', 50);

        const keys = Object.keys(tasks);
        const values = await Promise.all(keys.map((k) => tasks[k]));
        const raw = Object.fromEntries(keys.map((k, i) => [k, values[i] || []]));
        console.log('[GlobalSearch] fetched', Object.fromEntries(keys.map((k) => [k, raw[k].length])));

        const projectById = new Map((raw.projects || []).map((p) => [p.id, p]));

        let projects = (raw.projects || []).filter(p => match(p.name) || match(p.project_number) || match(p.customer_name));
        let bids = (raw.bids || []).filter(b => match(b.bid_number) || match(b.job_name) || match(b.customer_name));
        if (isSalesman) {
          projects = projects.filter(mine);
          bids = bids.filter(mine);
        }

        const rfis = (raw.rfis || [])
          .map(r => ({ ...r, _project: projectById.get(r.project_id) }))
          .filter(r => match(r.rfi_number) || match(r._project?.name))
          .filter(r => !isSalesman || mine(r._project || {}));

        const pieces = (raw.pieces || [])
          .map(p => ({ ...p, _project: projectById.get(p.project_id) }))
          .filter(p => match(p.piece_mark) || match(p.assembly) || match(p.part_number) || match(p._project?.name));

        const employees = (raw.employees || [])
          .filter(e => match(e.full_name) || match(e.employee_number) || match(e.classification) || match(e.department) || match(e.personal_email));

        const candidates = (raw.candidates || [])
          .filter(c => match(c.candidate_name) || match(c.email) || match(c.position_applied));

        setResults({
          bids: bids.slice(0, 5),
          customers: (raw.customers || []).filter(c => match(c.name) || match(c.email) || match(c.city)).slice(0, 5),
          projects: projects.slice(0, 5),
          documents: (raw.documents || []).filter(d => match(d.name) || match(d.file_name)).slice(0, 5),
          employees: employees.slice(0, 5),
          candidates: candidates.slice(0, 5),
          rfis: rfis.slice(0, 5),
          pieces: pieces.slice(0, 5),
        });
      } catch (e) {} finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, user]);

  const handleResultClick = (type, item) => {
    const routes = {
      bids: `/estimating/${item.id}`,
      customers: `/crm?customer=${item.id}`,
      projects: `/projects/${item.id}`,
      documents: `/documents?doc=${item.id}`,
      employees: `/human-resources?employee=${item.id}`,
      candidates: `/human-resources?candidate=${item.id}`,
      rfis: `/rfis?open=${item.id}`,
      pieces: item._project ? `/projects/${item._project.id}` : `/production`,
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
        <span className="flex-1 text-left truncate">Search {searchableLabel(categories)}…</span>
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
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${searchableLabel(categories)}…`}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
              {loading && <div className="p-4 text-center text-sm text-muted-foreground">Searching…</div>}
              {!loading && !query.trim() && (
                <div className="p-8 text-center text-sm text-muted-foreground">Type to search across {searchableLabel(categories)}.</div>
              )}
              {!loading && query.trim() && totalResults === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">No results found for “{query}”</div>
              )}
              {!loading && totalResults > 0 && (
                <div className="space-y-4">
                  {results.projects.length > 0 && (
                    <ResultGroup icon={FolderKanban} label="Projects" items={results.projects} type="projects" onClick={handleResultClick}
                      titleFn={p => `${p.project_number} — ${p.name}`} subFn={p => p.customer_name} />
                  )}
                  {results.bids.length > 0 && (
                    <ResultGroup icon={Calculator} label="Bids" items={results.bids} type="bids" onClick={handleResultClick}
                      titleFn={b => `${b.bid_number} — ${b.job_name}`} subFn={b => b.customer_name} />
                  )}
                  {results.customers.length > 0 && (
                    <ResultGroup icon={Building2} label="Customers / Vendors" items={results.customers} type="customers" onClick={handleResultClick}
                      titleFn={c => c.name} subFn={c => [c.city, c.state].filter(Boolean).join(', ')} />
                  )}
                  {results.employees.length > 0 && (
                    <ResultGroup icon={Users} label="Employees" items={results.employees} type="employees" onClick={handleResultClick}
                      titleFn={e => e.full_name} subFn={e => [e.classification, e.department].filter(Boolean).join(' • ')} />
                  )}
                  {results.candidates.length > 0 && (
                    <ResultGroup icon={UserSearch} label="Candidates" items={results.candidates} type="candidates" onClick={handleResultClick}
                      titleFn={c => c.candidate_name} subFn={candidateSubtitle} />
                  )}
                  {results.rfis.length > 0 && (
                    <ResultGroup icon={HelpCircle} label="RFIs" items={results.rfis} type="rfis" onClick={handleResultClick}
                      titleFn={r => `RFI ${r.rfi_number}`} subFn={r => r._project?.name} />
                  )}
                  {results.pieces.length > 0 && (
                    <ResultGroup icon={Tag} label="Pieces" items={results.pieces} type="pieces" onClick={handleResultClick}
                      titleFn={p => p.piece_mark} subFn={p => p._project?.name} />
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
