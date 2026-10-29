import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { boxOf, fontCss, LINE_HEIGHT, TEXT_PAD, NOTE_SIZE } from '@/lib/drawingMarkups';
import { measureText } from './markupCanvasDraw';

// Typing on the drawing. Sits inside BlueprintCanvas's page layer — a div
// whose CSS transform is the same rotation + pan the canvases use — so this
// is positioned at pdfX * scale like everything else and follows zoom/pan.
// Text box / callout: wraps to its box width and grows downward. Typewriter:
// no border, grows to fit. Note: a small comment card beside the note icon.
// Commits on blur, Escape or Ctrl+Enter.
export default function InPlaceTextEditor({ markup, scale, onCommit }) {
  const isNote = markup.type === 'note';
  const [value, setValue] = useState(isNote ? (markup.comment || '') : (markup.text || ''));
  const ref = useRef(null);
  const doneRef = useRef(false);
  const st = markup.style || {};
  const fs = Number(st.font_size) > 0 ? Number(st.font_size) : 12;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  // Grow the box with the text (text box / callout / typewriter).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || isNote) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, scale, isNote]);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(value);
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commit();
    }
  };
  const stop = (e) => e.stopPropagation();

  const p0 = markup.points[0];
  if (isNote) {
    return (
      <div
        className="absolute pointer-events-auto rounded-md border border-amber-400 bg-amber-50 shadow-lg p-1.5"
        style={{ left: (p0.pdfX + NOTE_SIZE) * scale + 6, top: p0.pdfY * scale, width: 220 }}
        onPointerDown={stop}
        onDoubleClick={stop}
        onWheel={stop}
      >
        <p className="text-[10px] font-semibold text-amber-800 mb-1">Note — Ctrl+Enter or click away to save</p>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          className="w-full h-24 text-xs rounded border border-amber-300 bg-white p-1 resize-y outline-none"
          placeholder="Type a comment…"
        />
      </div>
    );
  }

  const box = boxOf(markup);
  const typewriter = markup.type === 'typewriter';
  const longest = Math.max(fs * 4, ...String(value || ' ').split(/\r?\n/).map((l) => measureText(l, st)));
  const widthPts = typewriter ? longest + TEXT_PAD * 2 + fs : Math.max(fs * 2, box?.width || 120);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      spellCheck
      wrap={typewriter ? 'off' : 'soft'}
      className="absolute pointer-events-auto resize-none overflow-hidden outline-none"
      style={{
        left: (box?.x ?? p0.pdfX) * scale,
        top: (box?.y ?? p0.pdfY) * scale,
        width: widthPts * scale,
        minHeight: typewriter ? (fs * LINE_HEIGHT + TEXT_PAD * 2) * scale : (box?.height || 0) * scale,
        padding: TEXT_PAD * scale,
        fontSize: fs * scale,
        lineHeight: LINE_HEIGHT,
        fontFamily: fontCss(st.font_family),
        fontWeight: st.bold ? 700 : 400,
        fontStyle: st.italic ? 'italic' : 'normal',
        textDecoration: st.underline ? 'underline' : 'none',
        textAlign: st.align || 'left',
        color: st.text_color || '#111827',
        background: !typewriter && st.fill_color ? st.fill_color : 'rgba(255,255,255,0.6)',
        border: `${Math.max(1, (Number(st.line_width) || 1) * scale)}px dashed #2563eb`,
        boxSizing: 'border-box',
        whiteSpace: typewriter ? 'pre' : 'pre-wrap',
      }}
      placeholder="Type here…"
    />
  );
}
