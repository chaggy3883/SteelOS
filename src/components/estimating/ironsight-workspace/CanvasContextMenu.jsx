import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Right-click menu on the drawing. `items`: [{ label, onSelect, disabled,
// hint, keys }] or { separator: true }. Positioned at the mouse, kept on
// screen, closed by any outside click, Escape, scroll or choosing an item.
export default function CanvasContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[70] min-w-[210px] rounded-md border bg-popover text-popover-foreground shadow-lg py-1 text-xs"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.title && <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground border-b mb-1">{menu.title}</div>}
      {menu.items.map((it, i) => (it.separator ? <div key={`s${i}`} className="my-1 h-px bg-border" /> : (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          title={it.disabled ? it.hint : undefined}
          onClick={() => { onClose(); it.onSelect?.(); }}
          className="w-full flex items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{it.label}{it.disabled && it.hint ? <span className="ml-1 italic text-muted-foreground">({it.hint})</span> : null}</span>
          {it.keys && <span className="text-[10px] text-muted-foreground">{it.keys}</span>}
        </button>
      )))}
    </div>
  );
}
