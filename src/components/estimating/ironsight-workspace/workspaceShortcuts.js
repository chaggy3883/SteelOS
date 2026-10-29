import { useEffect, useRef } from 'react';

// Keyboard shortcuts for the IRONSIGHT workspace. Every menu item can carry
// `keys` (e.g. 'Ctrl+Shift+Z', 'Delete', 'Shift+L', 'PageDown'); the same
// string is shown in the menu and matched here, so the menu can never
// advertise a shortcut that doesn't work. Nothing fires while typing in an
// input, textarea, select or editable element.

export const isTypingTarget = (t) => Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));

const KEY_ALIASES = { del: 'delete', esc: 'escape', plus: '+', pgdn: 'pagedown', pgup: 'pageup' };

export function parseKeys(spec) {
  const parts = String(spec).split('+').map((p) => p.trim()).filter((p, i, arr) => p || i === arr.length - 1);
  // 'Ctrl++' → ['Ctrl', '', ''] edge: treat a trailing empty as '+'
  let key = parts[parts.length - 1] || '+';
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  key = key.toLowerCase();
  key = KEY_ALIASES[key] || key;
  return { ctrl: mods.includes('ctrl'), shift: mods.includes('shift'), alt: mods.includes('alt'), key };
}

export function matchesKeys(e, spec) {
  const k = parseKeys(spec);
  if (Boolean(e.ctrlKey || e.metaKey) !== k.ctrl) return false;
  if (Boolean(e.altKey) !== k.alt) return false;
  const key = String(e.key || '').toLowerCase();
  // '=' and '+' share a key; Shift is part of typing '+', so don't require it.
  if (k.key === '=' || k.key === '+') return (key === '=' || key === '+') && (k.shift ? e.shiftKey : true);
  if (Boolean(e.shiftKey) !== k.shift) return false;
  if (k.key.length === 1) return key === k.key || (e.code && e.code.toLowerCase() === `key${k.key}`) || (e.code && e.code.toLowerCase() === `digit${k.key}`);
  return key === k.key;
}

/** Flatten a menu tree into [{ keys, onSelect, disabled }]. */
export function collectBindings(menus) {
  const out = [];
  const walk = (items) => (items || []).forEach((it) => {
    if (!it) return;
    if (it.items) walk(it.items);
    if (it.keys && it.onSelect) out.push(it);
    (it.altKeys || []).forEach((k) => it.onSelect && out.push({ ...it, keys: k }));
  });
  menus.forEach((m) => walk(m.items));
  return out;
}

export function useWorkspaceShortcuts(menus, enabled = true) {
  const bindingsRef = useRef([]);
  bindingsRef.current = collectBindings(menus);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      if (e.repeat && !/^(PageDown|PageUp|ArrowLeft|ArrowRight)$/.test(e.key)) return;
      if (isTypingTarget(e.target)) return;
      // A dialog/menu has focus — let it handle its own keys.
      if (e.target?.closest?.('[role="dialog"],[role="menu"],[role="menubar"]')) return;
      const hit = bindingsRef.current.find((b) => matchesKeys(e, b.keys));
      if (!hit) return;
      e.preventDefault();
      if (hit.disabled) return;
      hit.onSelect();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
