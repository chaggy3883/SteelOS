import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { Folder, FileText, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/ui/StatusBadge';
import PathBreadcrumb from './PathBreadcrumb';

const PAGE_SIZE = 50;

const normalizePath = (path) => {
  if (!path) return '/';
  const trimmed = `/${path.split('/').filter(Boolean).join('/')}/`;
  return trimmed;
};

export default function FileExplorer({ projectId, onUpload, documentTypeFilter }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [currentPath, setCurrentPath] = useState('/');
  const [activeTags, setActiveTags] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.entities.Document.filter({ project_id: projectId }, '-created_date', limit)
      .then((docs) => {
        if (cancelled) return;
        const types = documentTypeFilter ? (Array.isArray(documentTypeFilter) ? documentTypeFilter : [documentTypeFilter]) : null;
        setDocuments(types ? docs.filter((d) => types.includes(d.document_type)) : docs);
      })
      .catch((e) => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, limit, documentTypeFilter]);

  const hasMore = documents.length === limit;

  const allTags = useMemo(() => {
    const set = new Set();
    documents.forEach((d) => (d.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [documents]);

  const toggleTag = (tag) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const navigate = (path) => {
    setActiveTags([]);
    setCurrentPath(path);
  };

  // Tag filtering bypasses folder navigation entirely — matches across all paths.
  const taggedFiles = useMemo(() => {
    if (activeTags.length === 0) return null;
    return documents.filter((d) => activeTags.every((t) => (d.tags || []).includes(t)));
  }, [documents, activeTags]);

  const { folders, files } = useMemo(() => {
    if (taggedFiles) return { folders: [], files: [] };

    const folderCounts = new Map();
    const filesHere = [];

    documents.forEach((doc) => {
      const path = normalizePath(doc.virtual_path);
      if (path === currentPath) {
        filesHere.push(doc);
        return;
      }
      if (path.startsWith(currentPath)) {
        const rest = path.slice(currentPath.length).split('/').filter(Boolean);
        const childFolder = rest[0];
        if (childFolder) {
          folderCounts.set(childFolder, (folderCounts.get(childFolder) || 0) + 1);
        }
      }
    });

    const folderList = Array.from(folderCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { folders: folderList, files: filesHere };
  }, [documents, currentPath, taggedFiles]);

  const FileRow = ({ doc }) => (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground">{doc.document_type?.replace(/_/g, ' ')} • v{doc.version || 1}</p>
            {(doc.tags || []).map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
            ))}
          </div>
        </div>
      </div>
      <StatusBadge status={doc.ai_processing_status} label={doc.ai_processing_status} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <PathBreadcrumb currentPath={currentPath} onNavigate={navigate} />
        {onUpload && (
          <Button size="sm" className="gap-2 shrink-0" onClick={() => onUpload(currentPath)}>
            <Upload className="w-4 h-4" /> Upload
          </Button>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {allTags.map((tag) => (
            <Badge
              key={tag}
              variant={activeTags.includes(tag) ? 'default' : 'outline'}
              className="cursor-pointer select-none"
              onClick={() => toggleTag(tag)}
            >
              {tag}
              {activeTags.includes(tag) && <X className="w-3 h-3 ml-1" />}
            </Badge>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading documents…</div>
      ) : taggedFiles ? (
        taggedFiles.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No documents match the selected tags</p>
          </div>
        ) : (
          <div className="space-y-2">
            {taggedFiles.map((doc) => <FileRow key={doc.id} doc={doc} />)}
          </div>
        )
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No documents in this folder yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {folders.map((folder) => (
            <button
              key={folder.name}
              type="button"
              onClick={() => navigate(`${currentPath}${folder.name}/`)}
              className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <Folder className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">{folder.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{folder.count}</span>
            </button>
          ))}
          {files.map((doc) => <FileRow key={doc.id} doc={doc} />)}
        </div>
      )}

      {!loading && !taggedFiles && hasMore && (
        <div className="text-center pt-2">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
