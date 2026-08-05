import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Search, ChevronLeft, ChevronRight, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ACTION_TYPES } from '@/components/admin/adminConstants';

const PAGE_SIZE = 15;

export default function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const list = await db.entities.AuditLog.list('-created_date', 200);
      setLogs(list);
    } catch (e) {
      setLogs([]);
    } finally { setLoading(false); }
  };

  const filtered = logs.filter(log => {
    if (actionFilter !== 'all' && log.action_type !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return log.user_name?.toLowerCase().includes(q) ||
             log.action_type?.toLowerCase().includes(q) ||
             log.entity_name?.toLowerCase().includes(q) ||
             log.ip_address?.toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageLogs = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const safeParse = (str) => {
    if (!str) return null;
    try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by user, action, entity..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-10" />
        </div>
        <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {ACTION_TYPES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">IP Address</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : pageLogs.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No audit logs found.</td></tr>
            ) : pageLogs.map(log => (
              <React.Fragment key={log.id}>
                <tr className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {log.created_date ? new Date(log.created_date).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-xs">{log.user_name || 'Unknown'}</p>
                    <p className="text-[10px] text-muted-foreground">{log.user_email || ''}</p>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{log.ip_address || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">{log.action_type}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-medium">{log.entity_name || '—'}</p>
                    <p className="text-[10px] text-muted-foreground">{log.entity_type || ''}</p>
                  </td>
                  <td className="px-2">
                    {expandedId === log.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </td>
                </tr>
                {expandedId === log.id && (
                  <tr className="bg-muted/20">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">BEFORE STATE</p>
                          <pre className="text-xs bg-background border border-border rounded p-2 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">{safeParse(log.before_state) || '—'}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">AFTER STATE</p>
                          <pre className="text-xs bg-background border border-border rounded p-2 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">{safeParse(log.after_state) || '—'}</pre>
                        </div>
                        {log.notes && <div className="md:col-span-2"><p className="text-xs font-semibold text-muted-foreground mb-1">NOTES</p><p className="text-xs">{log.notes}</p></div>}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {page + 1} of {totalPages} • {filtered.length} total logs</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}