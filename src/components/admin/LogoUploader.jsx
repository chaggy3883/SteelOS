import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FileDropzone from '@/components/ui/FileDropzone';

const CANVAS_SIZE = 200;

export default function LogoUploader({ value, onSave }) {
  const [imageSrc, setImageSrc] = useState(value || null);
  const [scalePct, setScalePct] = useState(100);
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
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const img = imgRef.current;
      const scale = scalePct / 100;
      const drawWidth = img.naturalWidth * scale;
      const drawHeight = img.naturalHeight * scale;
      // Fit within the canvas regardless of the slider, then center — the
      // slider still controls perceived size (zoom in/out), it just can't
      // paint outside the saved logo's fixed frame.
      const fit = Math.min(1, CANVAS_SIZE / drawWidth, CANVAS_SIZE / drawHeight);
      const w = drawWidth * fit;
      const h = drawHeight * fit;
      ctx.drawImage(img, (CANVAS_SIZE - w) / 2, (CANVAS_SIZE - h) / 2, w, h);

      const dataUri = canvas.toDataURL('image/png');
      await onSave(dataUri);
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
          <div className="w-28 h-28 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden mx-auto">
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Logo preview"
              style={{ transform: `scale(${scalePct / 100})` }}
              className="max-w-full max-h-full object-contain transition-transform"
            />
          </div>
          <div className="flex items-center gap-2">
            <ImageIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              type="range"
              min={20}
              max={200}
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
