import { useEffect, useRef } from 'react';

// Closes an open dropdown/popover/panel when the user clicks outside of it
// or presses Escape. `ref` must be attached to the element that contains
// BOTH the trigger button and the panel it opens — wrapping only the panel
// would make the trigger read as "outside" and cause an open/close race on
// the same click that's supposed to toggle it.
//
// Ignores clicks and Escape presses that belong to a Radix Dialog
// (role="dialog") rendered on top: a modal opened from inside a panel must
// not cascade-close the panel behind it, and dismissing that modal must not
// close the panel either — the topmost dialog owns that click/keypress.
//
// `enabled` should be the panel's own open state, so no listener is
// attached at all while it's closed (and none lingers past unmount).
export function useClickOutside(ref, handler, enabled = true) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);

  useEffect(() => {
    if (!enabled) return undefined;

    const isInsideDialog = (target) => !!target?.closest?.('[role="dialog"]');

    const handlePointerDown = (event) => {
      const el = ref.current;
      if (!el || el.contains(event.target) || isInsideDialog(event.target)) return;
      handlerRef.current(event);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      // A Radix Dialog on top handles its own Escape — don't also close
      // whatever's behind it.
      if (document.querySelector('[role="dialog"]')) return;
      handlerRef.current(event);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, enabled]);
}
