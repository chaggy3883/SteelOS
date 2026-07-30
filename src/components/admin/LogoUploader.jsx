import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FileDropzone from '@/components/ui/FileDropzone';

const BASE_SIZE = 200;
const PREVIEW_BASE_PX = 112;

export default function LogoUploader({ value, savedScalePct, onSave }) {
  const [imageSrc, setImageSrc] = useState(value || null);
  const [scalePct, setScalePct] = useState(savedScalePct || 100);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFileSelected = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result);
      setScalePct(100);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!imageSrc || !imgRef.current) return;
    setSaving(true);
    try {
      const canvas = canvasRef.current;
      // Visual scaling directly translates to the output image's own pixel
      // dimensions — the frame itself grows with the slider (up to 2.5x at
      // 250%) instead of staying pinned at a fixed 200x200 crop.
      const outputSize = Math.round(BASE_SIZE * (scalePct / 100));
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, outputSize, outputSize);

      const img = imgRef.current;
      const fit = Math.min(outputSize / img.naturalWidth, outputSize / img.naturalHeight);
      const w = img.naturalWidth * fit;
      const h = img.naturalHeight * fit;
      ctx.drawImage(img, (outputSize - w) / 2, (outputSize - h) / 2, w, h);

      const dataUri = canvas.toDataURL('image/png');
      await onSave(dataUri, scalePct);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {!imageSrc ? (
        <FileDropzone accept="image/*" label="Drag & drop a logo, or click to browse" onFileSelected={handleFileSelected} className="w-56" />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-muted/30 flex items-center justify-center mx-auto p-2">
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Logo preview"
              style={{ width: `${PREVIEW_BASE_PX * (scalePct / 100)}px`, height: 'auto' }}
              className="object-contain transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <ImageIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              type="range"
              min={20}
              max={250}
              value={scalePct}
              onChange={(e) => setScalePct(Number(e.target.value))}
              className="w-full"
            />
            <span className="text-xs text-muted-foreground w-10 text-right">{scalePct}%</span>
          </div>
          <div className="flex gap-2 justify-center">
            <Button size="sm" variant="outline" onClick={() => setImageSrc(null)}>Replace</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 steel-gradient text-white border-0">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save Logo'}
            </Button>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
