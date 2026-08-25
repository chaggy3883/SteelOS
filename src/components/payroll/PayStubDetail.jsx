import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const TAX_TYPE_LABELS = {
  federal_income: 'Federal Income Tax',
  state_income: 'State Income Tax',
  local_income: 'Local Income Tax',
  social_security: 'Social Security',
  medicare: 'Medicare',
  medicare_additional: 'Additional Medicare',
};

// Itemized pay stub — shared by the HR/Payroll Admin run-detail view
// (PayrollRunPanel.jsx, any employee on the run) and the employee's own
// Employee Center Payroll tab (own lines only, access is enforced by the
// caller's data fetch, not by this component). Every tax/deduction row is
// clickable to the TaxWithholding/PayrollRule/Deduction record that
// generated it, per the standing "every data point drills down" rule —
// the source_id/source_type on PayrollLineTax and source_deduction_id on
// PayrollLineDeduction are the FK that makes that lookup exact rather than
// "whichever config is active today," since a later rate change shouldn't
// rewrite what an old stub says it withheld.
export default function PayStubDetail({ open, onOpenChange, employeeLabel, periodLabel, line, taxes, deductions, taxWithholdingsById = {}, payrollRulesById = {}, deductionsById = {} }) {
  const [sourceRecord, setSourceRecord] = useState(null);

  if (!line) return null;

  const showTaxSource = (t) => {
    if (t.source_type === 'TaxWithholding') {
      const tw = taxWithholdingsById[t.source_id];
      setSourceRecord({
        title: `TaxWithholding — ${tw ? titleCase(tw.jurisdiction) : 'Record Unavailable'}`,
        rows: tw ? [
          ['Jurisdiction', titleCase(tw.jurisdiction)],
          ['Filing Status', tw.filing_status || '—'],
          ['Allowances / Credits', tw.allowances_or_credits ?? 0],
          ['Flat Rate', `${tw.flat_rate_percent ?? 0}%`],
          ['Additional Withholding', money(tw.additional_withholding)],
          ['Effective Date', tw.effective_date || '—'],
        ] : [['Note', 'This TaxWithholding row is no longer on file (deleted or superseded since this run).']],
      });
    } else if (t.source_type === 'PayrollRule') {
      const rule = payrollRulesById[t.source_id];
      setSourceRecord({
        title: `PayrollRule — ${rule ? titleCase(rule.config?.tax_type) : 'Record Unavailable'}`,
        rows: rule ? [
          ['Tax Type', titleCase(rule.config?.tax_type)],
          ['Rate', `${rule.config?.rate_percent ?? 0}%`],
          ['Wage Base Cap', rule.config?.wage_base_cap ? money(rule.config.wage_base_cap) : 'Uncapped (not enforced — see PayrollRule setup)'],
          ['Effective Date', rule.effective_date || '—'],
        ] : [['Note', 'This PayrollRule row is no longer on file (deleted or superseded since this run).']],
      });
    } else {
      setSourceRecord({ title: TAX_TYPE_LABELS[t.tax_type] || titleCase(t.tax_type), rows: [['Note', 'No underlying rule record for this line.']] });
    }
  };

  const showDeductionSource = (d) => {
    const ded = deductionsById[d.source_deduction_id];
    setSourceRecord({
      title: `Deduction — ${ded ? titleCase(ded.deduction_subtype || ded.deduction_type) : 'Record Unavailable'}`,
      rows: ded ? [
        ['Category', titleCase(ded.deduction_type)],
        ['Subtype', ded.deduction_subtype ? titleCase(ded.deduction_subtype) : '—'],
        ['Amount / Percent', ded.is_percent ? `${ded.amount_or_percent}% of gross` : money(ded.amount_or_percent)],
        ['Priority Order', ded.priority_order ?? 1],
        ['Effective Date', ded.effective_date || '—'],
        ['End Date', ded.end_date || 'Ongoing'],
      ] : [['Note', 'This Deduction row is no longer on file (deleted or superseded since this run).']],
    });
  };

  // Falls back to the PayrollLine's own stored total when there are no
  // itemized rows (pre-itemization backfill gap) so this figure always
  // matches what was actually withheld, not just what got itemized.
  const totalTax = taxes.length > 0 ? taxes.reduce((s, t) => s + (Number(t.amount) || 0), 0) : Number(line.tax_total) || 0;
  const totalDeductions = deductions.length > 0 ? deductions.reduce((s, d) => s + (Number(d.amount_applied) || 0), 0) : Number(line.deductions_total) || 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{employeeLabel}</DialogTitle>
            {periodLabel && <p className="text-xs text-muted-foreground">{periodLabel}</p>}
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Gross Pay</span>
              <span className="font-mono">{money(line.gross_pay)}</span>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Taxes Withheld</p>
              {taxes.length === 0 ? (
                Number(line.tax_total) > 0 ? (
                  <p className="text-xs text-muted-foreground italic">Itemized breakdown not available — this line was processed before itemized tracking was added. {money(line.tax_total)} was withheld in total (see Tax column).</p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No taxes withheld on this line.</p>
                )
              ) : (
                <div className="space-y-1">
                  {taxes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => showTaxSource(t)}
                      className="w-full flex justify-between text-left hover:bg-muted/60 rounded px-1.5 py-1 -mx-1.5"
                      title="View underlying rule"
                    >
                      <span className="text-muted-foreground">{TAX_TYPE_LABELS[t.tax_type] || titleCase(t.tax_type)}</span>
                      <span className="font-mono">{money(t.amount)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex justify-between pt-1.5 mt-1.5 border-t border-border/50 font-medium">
                <span>Total Taxes</span>
                <span className="font-mono">{money(totalTax)}</span>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Deductions</p>
              {deductions.length === 0 ? (
                Number(line.deductions_total) > 0 ? (
                  <p className="text-xs text-muted-foreground italic">Itemized breakdown not available — this line was processed before itemized tracking was added. {money(line.deductions_total)} was withheld in total (see Deductions column).</p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No deductions on this line.</p>
                )
              ) : (
                <div className="space-y-1">
                  {deductions.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => showDeductionSource(d)}
                      className="w-full flex justify-between text-left hover:bg-muted/60 rounded px-1.5 py-1 -mx-1.5"
                      title="View underlying deduction record"
                    >
                      <span className="text-muted-foreground">
                        {titleCase(d.deduction_type)}
                        {!d.fully_withheld && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-red-600">Shortfall — {money(d.requested_amount - d.amount_applied)} unpaid</span>}
                      </span>
                      <span className="font-mono">{money(d.amount_applied)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex justify-between pt-1.5 mt-1.5 border-t border-border/50 font-medium">
                <span>Total Deductions</span>
                <span className="font-mono">{money(totalDeductions)}</span>
              </div>
            </div>

            <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
              <span>Net Pay</span>
              <span className="font-mono">{money(line.net_pay)}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sourceRecord} onOpenChange={(o) => !o && setSourceRecord(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{sourceRecord?.title}</DialogTitle></DialogHeader>
          <div className="space-y-1.5 text-sm">
            {(sourceRecord?.rows || []).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-right">{value}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
