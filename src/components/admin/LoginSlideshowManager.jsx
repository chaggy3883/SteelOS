import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import FileDropzone from '@/components/ui/FileDropzone';
import { Image as ImageIcon, Trash2, GalleryHorizontal } from 'lucide-react';

// Platform-level, not tenant-scoped — this feeds the public Login Vault's
// background slideshow, which renders before any company code is resolved.
export default function LoginSlideshowManager() {
  const { toast } = useToast();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadImages = async () => {
    try {
      const rows = await base44.entities.login_slideshow_images.list('display_order', 20);
      setImages(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadImages(); }, []);

  const handleFileSelected = (file) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const nextOrder = images.reduce((max, img) => Math.max(max, img.display_order || 0), 0) + 1;
        const created = await base44.entities.login_slideshow_images.create({
          image_data_uri: reader.result,
          display_order: nextOrder,
        });
        setImages((prev) => [...prev, created]);
        toast({ title: 'Slideshow image added' });
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async (image) => {
    await base44.entities.login_slideshow_images.delete(image.id);
    setImages((prev) => prev.filter((i) => i.id !== image.id));
    toast({ title: 'Slideshow image removed' });
  };

  return (
    <div className="steel-card p-4">
      <h4 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <GalleryHorizontal className="w-4 h-4 text-primary" />Login Vault Slideshow
      </h4>
      <p className="text-xs text-muted-foreground mb-3">
        Background images that slowly rotate behind the login screen. Falls back to a plain dark backdrop when empty.
      </p>

      <FileDropzone accept="image/*" label="Drag & drop a slideshow photo, or click to browse" onFileSelected={handleFileSelected} className="w-full mb-4" />

      {loading ? (
        <p className="text-sm text-muted-foreground py-2 text-center">Loading…</p>
      ) : images.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2 text-center">No slideshow images on file yet — the login screen uses its plain dark backdrop.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {images.map((img) => (
            <div key={img.id} className="relative rounded-lg border border-border overflow-hidden aspect-video bg-muted/30 group">
              <img src={img.image_data_uri} alt="Slideshow" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => handleDelete(img)}
                className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {uploading && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" />Uploading…</p>
      )}
    </div>
  );
}
