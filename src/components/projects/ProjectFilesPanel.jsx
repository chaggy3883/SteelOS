import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder, FolderOpen, FolderPlus, ChevronRight, ChevronDown, UploadCloud, FileText, Image as ImageIcon,
  Download, Eye, Trash2, Pencil, MoveRight, Search, Loader2, Inbox, Lock,
} from 'lucide-react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { cn } from '@/lib/utils';
import { openDocumentViewer, isViewableDocumentName, documentRef } from '@/lib/openDocumentViewer';
import { downloadFile } from '@/lib/downloadFile';
import { resolveDocumentUrl, saveDocumentFile } from '@/lib/documentBlobStore';
import { readFileIntoMemory } from '@/lib/detailerImportBlobStore';
import { archiveDocument } from '@/lib/documentArchive';
import { folderTree, folderPath, documentTypeFor, isImageName } from '@/lib/projectFolders';
import AddFolderDialog from '@/components/projects/AddFolderDialog';

export const UNFILED = '__unfiled__';
export const ALL_FILES = '__all__';

const formatSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// Project → Files. The standard job folders plus any added ones (left), and
// the chosen folder's files (right): drop or browse any file type —
// drawings, specs, Word/Excel, photos — then open, download, rename, move
// or remove them. Each file is stored once, in its folder. Files on the
// project from before folders existed show under "Unfiled" until moved.
export default function ProjectFilesPanel({ project, folders, onFoldersChanged, folderId, onFolderChange, highlightDocId }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [docs, setDocs] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(null); // { current, total }
  const [folderDialog, setFolderDialog] = useState(null); // { mode, parentId, folder }
  const [renameDoc, setRenameDoc] = useState(null);
  const [renameText, setRenameText] = useState('');
  const [moveDoc, setMoveDoc] = useState(null);
  const [moveTo, setMoveTo] = useState('');
  const [thumbs, setThumbs] = useState({});
  const thumbsRef = useRef({});
  const inputRef = useRef(null);

  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const current = folderId && folderId !== UNFILED && folderId !== ALL_FILES ? foldersById.get(folderId) : null;

  const loadDocs = async () => {
    try {
      const list = await db.entities.Document.filter({ project_id: project.id }, '-created_date', 100000);
      // The estimate's own files stay on the estimate (Estimate tab) — older
      // projects got copies of them; those aren't shown twice here.
      setDocs(list.filter((d) => !d.is_archived && !d.bid_id));
    } catch (e) {
      console.error(e);
      setDocs([]);
    }
  };
  useEffect(() => { loadDocs(); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the folders above the one being shown.
  useEffect(() => {
    if (!current) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let f = current.parent_id ? foldersById.get(current.parent_id) : null;
      for (let i = 0; f && i < 20; i += 1) { next.add(f.id); f = f.parent_id ? foldersById.get(f.parent_id) : null; }
      return next;
    });
  }, [current, foldersById]);

  const countIn = useMemo(() => {
    const m = new Map();
    (docs || []).forEach((d) => { const k = d.folder_id && foldersById.has(d.folder_id) ? d.folder_id : UNFILED; m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }, [docs, foldersById]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!docs) return [];
    if (q) return docs.filter((d) => [d.name, d.file_name, d.description, folderPath(foldersById.get(d.folder_id), foldersById)].some((v) => String(v || '').toLowerCase().includes(q)));
    if (folderId === ALL_FILES) return docs;
    if (folderId === UNFILED) return docs.filter((d) => !d.folder_id || !foldersById.has(d.folder_id));
    return docs.filter((d) => d.folder_id === folderId);
  }, [docs, q, folderId, foldersById]);
  const subfolders = current ? folders.filter((f) => f.parent_id === current.id) : [];

  // Picture thumbnails for what's on screen.
  useEffect(() => {
    let cancelled = false;
    shown.filter((d) => isImageName(d.file_name) && !thumbsRef.current[d.id]).slice(0, 60).forEach(async (d) => {
      const url = await resolveDocumentUrl(d).catch(() => null);
      if (cancelled || !url) return;
      thumbsRef.current[d.id] = url;
      setThumbs((t) => ({ ...t, [d.id]: url }));
    });
    return () => { cancelled = true; };
  }, [shown]);
  useEffect(() => () => Object.values(thumbsRef.current).forEach((u) => { if (String(u).startsWith('blob:')) URL.revokeObjectURL(u); }), []);

  // Scroll to a file opened from global search.
  useEffect(() => {
    if (!highlightDocId || !docs) return;
    const t = setTimeout(() => document.getElementById(`project-file-${highlightDocId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
    return () => clearTimeout(t);
  }, [highlightDocId, docs]);

  const upload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!current) {
      toast({ title: 'Pick a folder first', description: 'Choose the folder these files go in, then drop them there.', variant: 'destructive' });
      return;
    }
    let added = 0;
    const failed = [];
    for (let i = 0; i < files.length; i += 1) {
      setUploading({ current: i + 1, total: files.length });
      const file = files[i];
      let created = null;
      try {
        const data = await readFileIntoMemory(file);
        const sameName = (docs || []).filter((d) => d.folder_id === current.id && d.file_name === file.name);
        if (sameName.some((d) => d.file_size === file.size)) { failed.push(`${file.name}: already in this folder`); continue; }
        created = await db.entities.Document.create({
          project_id: project.id,
          folder_id: current.id,
          name: file.name,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || '',
          file_url: '',
          document_type: documentTypeFor(file.name, current, foldersById),
          status: 'uploaded',
          version: sameName.length + 1,
          uploaded_by: user?.full_name || user?.email || '',
          virtual_path: `/${folderPath(current, foldersById)}/`,
        });
        await saveDocumentFile(created.id, data);
        added += 1;
      } catch (e) {
        if (created) await db.entities.Document.delete(created.id).catch(() => {});
        failed.push(`${file.name}: ${e?.message || 'could not be saved'}`);
      }
    }
    setUploading(null);
    await loadDocs();
    if (added) toast({ title: `${added} file${added === 1 ? '' : 's'} added to ${current.name}` });
    if (failed.length) toast({ title: `${failed.length} file${failed.length === 1 ? '' : 's'} not added`, description: failed.slice(0, 3).join(' · '), variant: 'destructive' });
  };

  const open = async (doc) => {
    if (isViewableDocumentName(doc.file_name)) { openDocumentViewer(documentRef(doc.id), doc.file_name || doc.name); return; }
    const url = await resolveDocumentUrl(doc);
    if (!url) { toast({ title: 'This file is not stored in this browser', variant: 'destructive' }); return; }
    downloadFile(url, doc.file_name || doc.name);
  };
  const download = async (doc) => {
    const url = await resolveDocumentUrl(doc);
    if (!url) { toast({ title: 'This file is not stored in this browser', variant: 'destructive' }); return; }
    downloadFile(url, doc.file_name || doc.name);
  };
  const remove = async (doc) => {
    if (!window.confirm(`Remove ${doc.name} from ${foldersById.get(doc.folder_id)?.name || 'this project'}? An admin can restore it from Documents → Show archived.`)) return;
    await archiveDocument(doc);
    await loadDocs();
    toast({ title: `Removed ${doc.name}` });
  };
  const saveRename = async () => {
    const name = renameText.trim();
    if (!name || !renameDoc) return;
    await db.entities.Document.update(renameDoc.id, { name });
    setRenameDoc(null);
    await loadDocs();
  };
  const saveMove = async () => {
    const target = foldersById.get(moveTo);
    if (!target || !moveDoc) return;
    await db.entities.Document.update(moveDoc.id, { folder_id: target.id, virtual_path: `/${folderPath(target, foldersById)}/`, document_type: isImageName(moveDoc.file_name) ? 'photo' : documentTypeFor(moveDoc.file_name, target, foldersById) });
    setMoveDoc(null);
    await loadDocs();
    toast({ title: `Moved to ${target.name}` });
  };
  const deleteFolder = async (f) => {
    const hasFiles = (docs || []).some((d) => d.folder_id === f.id);
    const hasSub = folders.some((x) => x.parent_id === f.id);
    if (hasFiles || hasSub) { toast({ title: `${f.name} isn't empty`, description: 'Move or remove its files and folders first.', variant: 'destructive' }); return; }
    if (!window.confirm(`Delete the empty folder ${f.name}?`)) return;
    await db.entities.ProjectFolder.delete(f.id);
    if (folderId === f.id) onFolderChange(f.parent_id || null);
    onFoldersChanged?.();
  };

  const toggle = (id) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const renderNode = ({ folder: f, depth, children }) => {
    const isOpen = expanded.has(f.id);
    const active = folderId === f.id && !q;
    const count = countIn.get(f.id) || 0;
    return (
      <div key={f.id}>
        <div className={cn('group flex items-center gap-1 rounded-md pr-1 text-sm', active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted')} style={{ paddingLeft: 4 + depth * 14 }}>
          <button type="button" className={cn('h-6 w-5 flex items-center justify-center text-muted-foreground', !children.length && 'invisible')} onClick={() => toggle(f.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <button type="button" className="flex-1 min-w-0 flex items-center gap-1.5 py-1 text-left" onClick={() => { setSearch(''); onFolderChange(f.id); }} title={f.name}>
            {active ? <FolderOpen className="w-4 h-4 flex-shrink-0 text-amber-500" /> : <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />}
            <span className="truncate">{f.name}</span>
            {count > 0 && <span className="text-[10px] text-muted-foreground ml-auto pl-1">{count}</span>}
          </button>
          <button type="button" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary" title={`Add a folder in ${f.name}`} onClick={() => setFolderDialog({ mode: 'add', parentId: f.id })}><FolderPlus className="w-3.5 h-3.5" /></button>
        </div>
        {isOpen && children.map(renderNode)}
      </div>
    );
  };

  const unfiledCount = countIn.get(UNFILED) || 0;
  const heading = q ? `Search: "${search.trim()}"` : folderId === ALL_FILES ? 'All files' : folderId === UNFILED ? 'Unfiled' : current ? folderPath(current, foldersById) : 'Pick a folder';

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      {/* Folder tree */}
      <div className="steel-card p-3 space-y-1 md:max-h-[75vh] md:overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folders</p>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setFolderDialog({ mode: 'add', parentId: null })}><FolderPlus className="w-4 h-4 mr-1" />Add folder</Button>
        </div>
        <button type="button" className={cn('w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-sm', folderId === ALL_FILES && !q ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted')} onClick={() => { setSearch(''); onFolderChange(ALL_FILES); }}>
          <Inbox className="w-4 h-4" />All files<span className="text-[10px] text-muted-foreground ml-auto">{docs?.length ?? ''}</span>
        </button>
        {tree.map(renderNode)}
        {unfiledCount > 0 && (
          <button type="button" className={cn('w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-sm', folderId === UNFILED && !q ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted')} onClick={() => { setSearch(''); onFolderChange(UNFILED); }}>
            <Folder className="w-4 h-4 text-muted-foreground" />Unfiled<span className="text-[10px] text-muted-foreground ml-auto">{unfiledCount}</span>
          </button>
        )}
      </div>

      {/* Folder contents */}
      <div className="steel-card p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold mr-auto flex items-center gap-2 min-w-0">
            <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" /><span className="truncate">{heading}</span>
            {current?.is_base && <Lock className="w-3 h-3 text-muted-foreground" title="Standard job folder" />}
          </h3>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all project files" className="pl-8 h-8" aria-label="Search all project files" />
          </div>
          {current && !q && (
            <>
              <Button size="sm" variant="outline" onClick={() => setFolderDialog({ mode: 'add', parentId: current.id })}><FolderPlus className="w-4 h-4 mr-1" />New folder here</Button>
              {!current.is_base && <Button size="sm" variant="ghost" onClick={() => setFolderDialog({ mode: 'rename', folder: current })}><Pencil className="w-4 h-4 mr-1" />Rename</Button>}
              {!current.is_base && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteFolder(current)}><Trash2 className="w-4 h-4" /></Button>}
            </>
          )}
        </div>

        {current && !q && subfolders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...subfolders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((f) => (
              <button key={f.id} type="button" onClick={() => onFolderChange(f.id)} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                <Folder className="w-4 h-4 text-amber-500" />{f.name}<span className="text-[10px] text-muted-foreground">{countIn.get(f.id) || ''}</span>
              </button>
            ))}
          </div>
        )}

        {current && !q && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={cn('flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-colors', dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50')}
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <UploadCloud className="w-5 h-5 text-muted-foreground" />}
            <p className="text-sm font-medium">{uploading ? `Adding ${uploading.current} of ${uploading.total}…` : `Drop files into ${current.name}, or click to browse`}</p>
            <p className="text-xs text-muted-foreground">Any file — PDFs, drawings, Word, Excel, photos.</p>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          </div>
        )}

        {!current && !q && folderId !== ALL_FILES && folderId !== UNFILED && (
          <p className="text-sm text-muted-foreground py-6 text-center">Pick a folder on the left (or from the Files menu) to add and review its files.</p>
        )}

        {docs === null ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading files…</p>
        ) : (current || q || folderId === ALL_FILES || folderId === UNFILED) && shown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{q ? 'No project files match.' : 'No files in this folder yet.'}</p>
        ) : shown.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {shown.map((d) => {
              const img = isImageName(d.file_name);
              const inFolder = foldersById.get(d.folder_id);
              return (
                <div key={d.id} id={`project-file-${d.id}`} className={cn('flex items-center gap-3 px-3 py-2 hover:bg-muted/40', highlightDocId === d.id && 'ring-2 ring-primary ring-inset')}>
                  <button type="button" onClick={() => open(d)} className="w-10 h-10 rounded border border-border bg-muted/30 flex items-center justify-center overflow-hidden flex-shrink-0" title="Open">
                    {img && thumbs[d.id] ? <img src={thumbs[d.id]} alt="" className="w-full h-full object-cover" /> : img ? <ImageIcon className="w-4 h-4 text-muted-foreground" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  <button type="button" onClick={() => open(d)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium truncate" title={d.name}>{d.name}{d.version > 1 ? <span className="ml-1 text-[10px] text-muted-foreground">v{d.version}</span> : null}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[(q || folderId === ALL_FILES) && inFolder ? folderPath(inFolder, foldersById) : null, formatSize(d.file_size), d.created_date ? new Date(d.created_date).toLocaleDateString() : null, d.uploaded_by || d.created_by].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {isViewableDocumentName(d.file_name) && <Button size="icon" variant="ghost" className="h-7 w-7" title="Open" onClick={() => open(d)}><Eye className="w-3.5 h-3.5" /></Button>}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Download" onClick={() => download(d)}><Download className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Rename" onClick={() => { setRenameDoc(d); setRenameText(d.name || ''); }}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Move to another folder" onClick={() => { setMoveDoc(d); setMoveTo(d.folder_id || ''); }}><MoveRight className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remove" onClick={() => remove(d)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddFolderDialog
        open={!!folderDialog}
        onOpenChange={(o) => !o && setFolderDialog(null)}
        projectId={project.id}
        folders={folders}
        mode={folderDialog?.mode}
        parentId={folderDialog?.parentId}
        folder={folderDialog?.folder}
        onSaved={(f) => { onFoldersChanged?.(); if (folderDialog?.mode !== 'rename') onFolderChange(f.id); }}
      />

      <Dialog open={!!renameDoc} onOpenChange={(o) => !o && setRenameDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rename file</DialogTitle></DialogHeader>
          <Input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDoc(null)}>Cancel</Button>
            <Button onClick={saveRename} disabled={!renameText.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!moveDoc} onOpenChange={(o) => !o && setMoveDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Move {moveDoc?.name}</DialogTitle></DialogHeader>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to folder">
            <option value="" disabled>Pick a folder…</option>
            {(function flat(nodes) { return nodes.flatMap((n) => [n, ...flat(n.children)]); }(tree)).map(({ folder: f, depth }) => (
              <option key={f.id} value={f.id}>{`${'   '.repeat(depth)}${f.name}`}</option>
            ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDoc(null)}>Cancel</Button>
            <Button onClick={saveMove} disabled={!moveTo || moveTo === moveDoc?.folder_id}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
