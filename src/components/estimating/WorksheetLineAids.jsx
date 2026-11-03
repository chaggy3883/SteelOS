import React from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import MathDrill from '@/components/estimating/MathDrill';

// Small pieces of the Bid Worksheet's line rows (TakeoffEngine.jsx): the
// unit switch, the company-rate hint, the notes under a line, and the
// "Pull from takeoff" panel. Every number here opens its math or its source.

const fmt = (v, d = 0) => (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => `$${fmt(v, 2)}`;

// Tons | Lbs (Galvanizing) — switching converts the quantity and the rate.
export function UnitToggle({ options = [], unit, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-input overflow-hidden h-8" role="group" aria-label="Unit">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => o.value !== unit && onChange(o.value)}
          title={`Enter this line in ${o.qtyLabel.toLowerCase()} — the line total stays the same`}
          className={cn('px-2 text-xs', o.value === unit ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
        >
          {o.qtyLabel}
        </button>
      ))}
    </div>
  );
}

// "Company rate $78.00/hr" next to a rate box, linked to the admin page
// that sets it, plus "Reset to company rate" when this bid's rate differs.
export function CompanyRateHint({ companyRate, lineRate, suffix, onReset }) {
  if (companyRate == null) {
    return (
      <a href="/admin/bid-worksheet-rates" target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground underline underline-offset-2 whitespace-nowrap" title="Set the company rate (Bid Worksheet Default Rates)">
        No company rate set
      </a>
    );
  }
  const differs = Math.abs((Number(lineRate) || 0) - companyRate) >= 0.005;
  return (
    <span className="flex items-center gap-1.5 text-[10px] whitespace-nowrap">
      <a href="/admin/bid-worksheet-rates" target="_blank" rel="noreferrer" className={cn('underline underline-offset-2', differs ? 'text-yellow-700 dark:text-yellow-500' : 'text-muted-foreground')} title="Company rate from Bid Worksheet Default Rates (opens in a new tab)">
        Company {money(companyRate)}{suffix}
      </a>
      {differs && (
        <button type="button" onClick={onReset} className="text-primary underline underline-offset-2 hover:opacity-80">Reset to company rate</button>
      )}
    </span>
  );
}

// Notes under a line: a qty x rate line carried into its quote amount, an
// old quote kept as 1 x $X, and where a pulled quantity came from.
export function LineNotes({ line, qtyLabel }) {
  const notes = [];
  const carried = line?.carried_from;
  if (carried) {
    notes.push({
      key: 'carried',
      tone: 'info',
      text: `Now a quote amount. This line was saved as ${fmt(carried.quantity, 2)}${carried.unit ? ` ${carried.unit}` : ''} × ${money(carried.unit_cost)} = ${money(carried.quantity * carried.unit_cost)}, carried in so the total doesn't change.`,
    });
  }
  if (Number(line?.legacy_quote_amount) > 0) {
    const q = Number(line.quantity) || 0;
    notes.push({
      key: 'legacy',
      tone: 'warn',
      text: q === 1
        ? `Was a quote of ${money(line.legacy_quote_amount)} — kept as 1 × ${money(line.legacy_quote_amount)} until you enter the ${String(qtyLabel || 'qty').toLowerCase()} and price each.`
        : `Was a quote of ${money(line.legacy_quote_amount)} — price each is that quote ÷ ${fmt(q)} so the total is unchanged. Type the real price each.`,
    });
  }
  if (line?.notes) notes.push({ key: 'pulled', tone: 'muted', text: line.notes });
  if (notes.length === 0) return null;
  return (
    <div className="w-full space-y-0.5">
      {notes.map((n) => (
        <p key={n.key} className={cn('text-xs', n.tone === 'warn' ? 'text-yellow-700 dark:text-yellow-500' : n.tone === 'info' ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground')}>{n.text}</p>
      ))}
    </div>
  );
}

const SOURCE_BUTTON_TITLE = {
  full_takeoff: 'Open the Full Takeoff lines behind this number',
  ironsight: 'Open this bid in IRONSIGHT',
  worksheet: '',
};

function SourceLink({ kind, onOpenSource, children }) {
  if (!kind || kind === 'worksheet' || !onOpenSource) return <span>{children}</span>;
  return (
    <button type="button" onClick={() => onOpenSource(kind)} title={SOURCE_BUTTON_TITLE[kind]} className="underline underline-offset-2 hover:text-primary text-left">
      {children}
    </button>
  );
}

// The "Pull from takeoff" panel under a line. `options` are the numbers the
// estimator can apply (each with its math); `groups` are by-source/by-size
// detail tables (fastener counts). Nothing is applied until a Use button is
// clicked.
export function TakeoffPullPanel({ title, loading, error, options = [], groups = [], footnotes = [], currentValue, unitLabel, onApply, onOpenSource, onRefresh, onClose }) {
  return (
    <div className="w-full mt-1 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-sm">{title}</p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onRefresh} title="Reload the takeoff numbers"><RefreshCw className="w-3 h-3" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close"><X className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading the takeoff…</p>
      ) : error ? (
        <p className="text-destructive">{error}</p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex justify-between font-medium">
                <SourceLink kind={g.sourceKind} onOpenSource={onOpenSource}>{g.label}</SourceLink>
                <span className="font-mono">{fmt(g.total, g.decimals ?? 0)} {g.unit}</span>
              </div>
              {g.rows.length === 0 ? (
                <p className="text-muted-foreground pl-3">{g.emptyText || 'Nothing found.'}</p>
              ) : (
                <ul className="pl-3">
                  {g.rows.map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <SourceLink kind={g.sourceKind} onOpenSource={onOpenSource}>{r.label}</SourceLink>
                      <span className="font-mono">{fmt(r.value, g.decimals ?? 0)} {g.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="space-y-1">
            {options.map((o) => {
              const same = currentValue != null && Math.abs((Number(currentValue) || 0) - o.value) < 10 ** -(o.decimals ?? 0) / 2;
              return (
                <div key={o.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1">
                  <div className="min-w-0">
                    <SourceLink kind={o.sourceKind} onOpenSource={onOpenSource}>{o.label}</SourceLink>
                    {o.caution && <p className="text-[10px] text-yellow-700 dark:text-yellow-500">{o.caution}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <MathDrill value={`${fmt(o.value, o.decimals ?? 0)} ${o.unit}`} title={o.label} lines={o.lines} />
                    <Button type="button" size="sm" variant={same ? 'ghost' : 'outline'} className="h-6 px-2 text-xs" disabled={same || !(o.value > 0)} onClick={() => onApply(o)}>
                      {same ? 'In use' : `Use ${fmt(o.value, o.decimals ?? 0)}`}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {currentValue != null && (
            <p className="text-muted-foreground">This line now: {fmt(currentValue, 3).replace(/\.?0+$/, '')} {unitLabel}. Use replaces it; you can still type over it afterward.</p>
          )}
          {footnotes.filter(Boolean).map((f, i) => <p key={i} className="text-muted-foreground">{f}</p>)}
        </>
      )}
    </div>
  );
}
