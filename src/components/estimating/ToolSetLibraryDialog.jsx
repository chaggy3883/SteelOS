import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ToolSetLibraryPanel from '@/components/estimating/ToolSetLibraryPanel';

// Modal wrapper around ToolSetLibraryPanel for IRONSIGHT. Pass the same
// onApplyTool / onApplyToolSet callbacks the panel takes; the dialog stays
// open after "Use" so several tools can be loaded in a row.
export default function ToolSetLibraryDialog({ open, onOpenChange, onApplyTool, onApplyToolSet, initialToolSetId }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Tool set library</DialogTitle>
          <DialogDescription>
            Company-wide measuring tools and custom columns. Load a whole set into this takeoff, or use one tool at a time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          {open && (
            <ToolSetLibraryPanel
              onApplyTool={onApplyTool}
              onApplyToolSet={onApplyToolSet}
              initialToolSetId={initialToolSetId}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
