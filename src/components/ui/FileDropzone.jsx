import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

// Generic drag-and-drop box. Hands the raw File back to the caller — this
// app has no backend/blob storage, so what the caller does with it (read as
// a data URI, etc.) is entirely up to the specific uploader using this.
export default function FileDropzone({ onFileSelected, accept, label = 'Drag & drop a file here, or click to browse', className }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
        className
      )}
    >
      <UploadCloud className="w-6 h-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
