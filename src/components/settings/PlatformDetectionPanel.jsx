import React, { useEffect, useState } from 'react';
import { Cpu, Loader2, RotateCcw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { detectPlatform, getPlatformOverride, setPlatformOverride, clearPlatformOverride } from '@/lib/platformDetect';

const AUTO = '__auto';

const OS_LABELS = { macos: 'macOS', windows: 'Windows', linux: 'Linux', ios: 'iOS', android: 'Android', unknown: 'Unknown' };
const CHIP_LABELS = { apple_silicon: 'Apple Silicon (arm64)', intel: 'Intel (x64)', unknown: 'Unknown' };

// node-mac-arm64 / node-mac-x64 is the portable Node runtime bundled on the
// shop's flash-drive install (see .claude/steelos-dev/BACKLOG.md's "Mac
// flash drive chip auto-detect" item). This is a convenience suggestion
// only — grabbing the wrong build just fails to launch with a clear error,
// it never corrupts the drive or blocks anyone from trying the other one.
const FLASH_DRIVE_BUILD = { apple_silicon: 'node-mac-arm64', intel: 'node-mac-x64', unknown: null };

export default function PlatformDetectionPanel() {
  const [detected, setDetected] = useState(null);
  const [override, setOverride] = useState(() => getPlatformOverride());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    detectPlatform().then((result) => {
      if (!cancelled) { setDetected(result); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const effectiveOs = override?.os || detected?.os || 'unknown';
  const effectiveChip = override?.chip || detected?.chip || 'unknown';
  const isOverridden = Boolean(override?.os || override?.chip);

  const handleOverride = (field, value) => {
    setPlatformOverride({ [field]: value === AUTO ? undefined : value });
    setOverride(getPlatformOverride());
  };

  const handleReset = () => {
    clearPlatformOverride();
    setOverride(null);
  };

  const recommendedBuild = FLASH_DRIVE_BUILD[effectiveChip];

  return (
    <div className="steel-card p-6">
      <h3 className="font-semibold mb-1 flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" /> Portable / Flash-Drive Install</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Best-effort detection of this browser's OS and, on a Mac, its chip — used only to suggest which portable
        Node build to grab for a flash-drive install. Browsers deliberately limit how much hardware detail they
        expose (Safari and Firefox in particular can't reveal chip architecture at all), so treat this as a hint,
        not a guarantee, and correct it below if it's wrong.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" />Detecting…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Operating System</label>
              <Select value={override?.os || AUTO} onValueChange={(v) => handleOverride('os', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Auto-detected: {OS_LABELS[detected?.os] || 'Unknown'}</SelectItem>
                  {Object.entries(OS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Mac Chip</label>
              <Select value={override?.chip || AUTO} onValueChange={(v) => handleOverride('chip', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Auto-detected: {CHIP_LABELS[detected?.chip] || 'Unknown'}</SelectItem>
                  {Object.entries(CHIP_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-sm text-muted-foreground">
              {effectiveOs !== 'macos' ? (
                <>This browser doesn't look like macOS — the flash-drive chip recommendation only applies there. Override the OS above if that's wrong.</>
              ) : recommendedBuild ? (
                <>Recommended build: <span className="font-mono font-medium text-foreground">{recommendedBuild}</span></>
              ) : (
                <>Chip undetermined — grab either <span className="font-mono">node-mac-arm64</span> or <span className="font-mono">node-mac-x64</span>; the wrong one simply fails to launch with a clear error.</>
              )}
            </p>
            {isOverridden && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-muted-foreground flex-shrink-0">
                <RotateCcw className="w-3.5 h-3.5" />Reset to auto-detected
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
