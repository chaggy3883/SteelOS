import React, { useCallback, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

// ONE "before you start" prompt listing every warning for a piece (drawing
// not released / old revision, on hold from the detailer file, skipped route
// steps) instead of a separate popup per check. Warn, never block: Continue
// goes ahead, Cancel stops.
//
// Usage:
//   const [askToStart, startWarningsDialog] = useStartWarningsPrompt();
//   if (!(await askToStart({ title, warnings }))) return;
//   ...render {startWarningsDialog}
// askToStart resolves true immediately when there are no warnings.
export function useStartWarningsPrompt() {
  const [prompt, setPrompt] = useState(null);
  const resolverRef = useRef(null);

  const ask = useCallback(({ title, warnings }) => {
    const list = (warnings || []).filter(Boolean);
    if (list.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPrompt({ title, warnings: list });
    });
  }, []);

  const finish = (answer) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPrompt(null);
    if (resolve) resolve(answer);
  };

  const dialog = (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && finish(false)}>
      <DialogContent>
        {prompt && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" />{prompt.title}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Check {prompt.warnings.length === 1 ? 'this' : `these ${prompt.warnings.length} things`} before you start:</p>
            <ul className="space-y-2">
              {prompt.warnings.map((w, i) => (
                <li key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-sm whitespace-pre-wrap">{w}</li>
              ))}
            </ul>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={() => finish(false)}>Cancel</Button>
              <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white border-0" onClick={() => finish(true)}>Continue anyway</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return [ask, dialog];
}
