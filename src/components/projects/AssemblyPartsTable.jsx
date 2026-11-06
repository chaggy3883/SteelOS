import React from 'react';

const fmtLb = (n) => (n == null ? '—' : `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })} lb`);

// What an imported detailer assembly is made of: its main member and every
// attached part, per ONE assembly (quantities are per piece, not the job
// total), with sizes, grades and calculated weights. Pieces created from a
// detailer BOM / KSS carry this (PieceMark.main_member / parts —
// assemblyBom.js). Renders nothing for other pieces.
export default function AssemblyPartsTable({ piece, compact = false }) {
  const main = piece?.main_member;
  const parts = Array.isArray(piece?.parts) ? piece.parts : [];
  if (!main && !parts.length) return null;
  // Steel first, then hardware (bolts / studs from the KSS: no weight).
  const rows = [main && { ...main, _main: true }, ...parts.filter((p) => !p.kind), ...parts.filter((p) => p.kind)].filter(Boolean);
  const total = rows.reduce((s, p) => s + (Number(p.weight_each_lbs) || 0) * (Number(p.quantity_per_assembly) || 0), 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          Assembly {piece.assembly_mark || piece.piece_mark}
          {piece.copy_count > 1 && <span className="text-muted-foreground font-normal"> — piece {piece.copy_number} of {piece.copy_count}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {[piece.assembly_type, piece.finish ? `Finish ${piece.finish}` : ''].filter(Boolean).join(' • ')}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className={`w-full ${compact ? 'text-xs' : 'text-sm'}`}>
          <thead className="bg-muted/50">
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
              <th className="py-1.5 px-2">Part</th>
              <th className="py-1.5 px-2 text-right">Qty</th>
              <th className="py-1.5 px-2">Size</th>
              <th className="py-1.5 px-2">Length</th>
              <th className="py-1.5 px-2">Grade</th>
              <th className="py-1.5 px-2 text-right">Each</th>
              <th className="py-1.5 px-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={`${p.part_mark}-${i}`} className="border-t border-border/60">
                <td className="py-1 px-2 font-mono">
                  {p.part_mark}
                  {p._main && <span className="ml-1 text-[10px] text-primary font-sans">MAIN</span>}
                  {p.kind && <span className={`${p.part_mark ? 'ml-1 ' : ''}text-[10px] text-muted-foreground font-sans`}>{[p.install, p.kind === 'stud' ? 'stud' : 'bolt'].filter(Boolean).join(' ').toUpperCase()}</span>}
                </td>
                <td className="py-1 px-2 text-right tabular-nums">{p.quantity_per_assembly}</td>
                <td className="py-1 px-2 font-mono">{p.profile}</td>
                <td className="py-1 px-2 font-mono">{p.length}</td>
                <td className="py-1 px-2">{p.grade || '—'}</td>
                <td className="py-1 px-2 text-right tabular-nums" title={p.weight_source === 'plate' ? 'Plate: thickness x width x length' : p.weight_source === 'aisc' ? 'AISC shape weight x length' : 'Size not recognized'}>{fmtLb(p.weight_each_lbs)}</td>
                <td className="py-1 px-2 text-right tabular-nums">{p.weight_each_lbs == null ? '—' : fmtLb(p.weight_each_lbs * (p.quantity_per_assembly || 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30 text-xs">
              <td className="py-1 px-2" colSpan={6}>Calculated assembly weight{piece.weight_lbs ? ` (detailer: ${fmtLb(piece.weight_lbs)})` : ''}</td>
              <td className="py-1 px-2 text-right tabular-nums font-medium">{fmtLb(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
