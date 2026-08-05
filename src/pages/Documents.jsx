import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Search, Upload, FolderOpen, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';

const DOC_TYPE_ICONS = {
  specification: '📋', contract: '📝', structural_drawing: '📐', architectural_drawing: '🏗️',
  addendum: '➕', bid_form: '💰', rfi: '❓', submittal: '📤', other: '📄',
};

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [docData, projData] = await Promise.all([
        db.entities.Document.filter({ is_archived: false }, '-created_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
      ]);
      setDocuments(docData);
      setProjects(projData);
    } catch (e) {} finally { setLoading(false); }
  };

  const filtered = documents.filter(d => {
    const matchSearch = !search || d.name?.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || d.document_type === typeFilter;
    const matchProject = projectFilter === 'all' || d.project_id === projectFilter;
    return matchSearch && matchType && matchProject;
  });

  const formatSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const DOC_TYPES = ['specification','contract','general_conditions','structural_drawing','architectural_drawing','addendum','bid_form','rfi','submittal','other'];

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Documents"
        subtitle={`${documents.length} documents across all projects`}
        actions={<Button className="steel-gradient text-white border-0"><Upload className="w-4 h-4 mr-2" />Upload Document</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Document</th>
                <th className="text-left py-3 px-4">Project</th>
                <th className="text-left py-3 px-4">Type</th>
                <th className="text-left py-3 px-4">Version</th>
                <th className="text-right py-3 px-4">Size</th>
                <th className="text-left py-3 px-4">AI Status</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No documents found. Upload documents from a project page.</p>
                </td></tr>
              ) : (
                filtered.map(doc => {
                  const proj = projects.find(p => p.id === doc.project_id);
                  return (
                    <tr key={doc.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{DOC_TYPE_ICONS[doc.document_type] || '📄'}</span>
                          <div>
                            <p className="font-medium truncate max-w-[200px]">{doc.name}</p>
                            {doc.file_name && <p className="text-xs text-muted-foreground">{doc.file_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{proj ? `${proj.project_number}` : '—'}</td>
                      <td className="py-3 px-4">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {doc.document_type?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-sm">v{doc.version || 1}{doc.revision ? `.${doc.revision}` : ''}</td>
                      <td className="py-3 px-4 text-right text-xs text-muted-foreground">{formatSize(doc.file_size)}</td>
                      <td className="py-3 px-4"><StatusBadge status={doc.ai_processing_status} /></td>
                      <td className="py-3 px-4"><StatusBadge status={doc.status} /></td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1">
                          {doc.file_url && (
                            <a href={doc.file_url} target="_blank" rel="noreferrer">
                              <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="w-3.5 h-3.5" /></Button>
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}