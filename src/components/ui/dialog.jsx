"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// Resizable by default, at this one shared primitive, so every one of its
// call sites gets a drag handle for free without touching any of them.
// Native CSS `resize` doesn't work here because the fixed/translate-based
// centering re-centers the box on every size change and fights the drag —
// so size is tracked in JS state and applied as an explicit width/height
// style instead, which coexists with the centering transform.
const DialogContent = React.forwardRef(({ className, children, resizable = true, dialogId, ...props }, ref) => {
  const storageKey = dialogId ? `dialogSize:${dialogId}` : null;
  const [size, setSize] = React.useState(() => {
    if (!storageKey) return null;
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const contentEl = e.currentTarget.parentElement;
    const startWidth = size?.width || contentEl.offsetWidth;
    const startHeight = size?.height || contentEl.offsetHeight;
    const onMove = (me) => {
      const newWidth = Math.max(400, Math.min(window.innerWidth * 0.95, startWidth + (me.clientX - startX)));
      const newHeight = Math.max(300, Math.min(window.innerHeight * 0.9, startHeight + (me.clientY - startY)));
      setSize({ width: newWidth, height: newHeight });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (storageKey) {
        setSize((s) => { localStorage.setItem(storageKey, JSON.stringify(s)); return s; });
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const resetSize = () => {
    setSize(null);
    if (storageKey) localStorage.removeItem(storageKey);
  };

  const canResize = resizable && !isMobile;
  const sizeStyle = size ? { width: size.width, height: size.height, maxWidth: '95vw', maxHeight: '90vh' } : undefined;

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        style={sizeStyle}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex flex-col w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg overflow-hidden",
          className
        )}
        {...props}>
        {/* Header/body stack in normal flex flow (no grid stretch), so
            leftover vertical space from a resized box collects at the
            bottom instead of inflating the gap between header and content —
            see the dialog-resize-layout fix. Scrolls as one unit when taller
            than the box; this wrapper can't selectively pin DialogHeader
            without touching every call site. */}
        <div className="flex flex-col h-full min-h-0 gap-4 overflow-y-auto">
          {children}
        </div>
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
        {canResize && (
          <>
            <button
              type="button"
              onMouseDown={startResize}
              aria-label="Resize dialog"
              className="absolute bottom-1 right-1 w-5 h-5 cursor-nwse-resize flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
              style={{ touchAction: 'none' }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1"/></svg>
            </button>
            {size && (
              <button
                type="button"
                onClick={resetSize}
                className="absolute bottom-1 left-1 text-[10px] text-muted-foreground opacity-40 hover:opacity-80 transition-opacity"
              >
                Reset size
              </button>
            )}
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
