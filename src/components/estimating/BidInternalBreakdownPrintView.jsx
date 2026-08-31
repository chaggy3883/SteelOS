import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { getJoistDeckTaxRate } from '@/lib/taxRate';
import { COST_CATEGORIES } from '@/components/estimating/TakeoffEngine';

// Internal-only: every line item's Line Total, Markup %, and Quoted Price,
// plus the full financial rollup (bond/insurance/tax/delivery included).
// This must never be wired into the customer-facing proposal export — see
// BidProposalPrintView.jsx, which deliberately shows none of this.
export default function BidInternalBreakdownPrintView({ bid }) {
  const [lines, setLines] = useState([]);
  const [companyLogoUrl, setCompanyLogoUrl] = useState(null);

  useEffect(() => {
    if (!bid?.id) return;
    db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).then(setLines).catch(() => setLines([]));
    db.entities.Company.list('-created_date', 1).then((rows) => setCompanyLogoUrl(rows[0]?.logo_url || null)).catch(() => {});
  }, [bid?.id]);

  const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (n) => `${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

  if (!bid) return null;

  // Mirrors TakeoffEngine.jsx's own math (per-line markup applied before
  // tax) rather than the simplified computeBidTaxBreakdown() helper used by
  // the customer proposal — that helper folds markup/admin costs into one
  // reconciling "admin allocation" line since it never itemizes internal
  // categories, but this breakdown IS the itemized internal picture, so it
  // needs the real per-line figures rather than a plug.
  const rows = COST_CATEGORIES
    .map((cat) => ({ cat, line: lines.find((l) => l.cost_category === cat.key) }))
    .filter(({ line }) => line && (line.total_cost || 0) !== 0);

  const subtotal = lines.reduce((s, l) => s + (l.total_cost || 0), 0);
  const lineMarkupMultiplier = (line) => 1 + ((parseFloat(line?.markup_percentage) || 0) / 100);
  const subtotalWithMarkup = lines.reduce((s, l) => s + (l.total_cost || 0) * lineMarkupMultiplier(l), 0);
  const markupAmount = subtotalWithMarkup - subtotal;
  const averageMarkupPct = subtotal > 0 ? (markupAmount / subtotal) * 100 : 0;

  const taxRate = Number(bid?.tax_rate || 0);
  const joistDeckTaxRate = getJoistDeckTaxRate(bid);
  const structuralTaxAmount = bid?.tax_exempt ? 0 : lines.reduce((sum, line) => {
    const cat = COST_CATEGORIES.find((c) => c.key === line.cost_category);
    if (cat?.is_taxable === false) return sum;
    return sum + (line.total_cost || 0) * lineMarkupMultiplier(line) * taxRate;
  }, 0);
  const joistDeckLine = lines.find((l) => l.cost_category === 'joist_deck');
  const joistDeckTaxAmount = bid?.joist_deck_taxable && !bid?.tax_exempt
    ? (joistDeckLine?.total_cost || 0) * lineMarkupMultiplier(joistDeckLine) * joistDeckTaxRate
    : 0;

  const insuranceAllocation = bid?.insurance_enabled
    ? (parseFloat(bid?.insurance_general_liability) || 0) + (parseFloat(bid?.insurance_umbrella) || 0) + (parseFloat(bid?.insurance_professional_liability) || 0)
    : 0;
  const overrideTotal = ['insurance_override', 'bond_override', 'procore_pay_override', 'textura_override']
    .reduce((s, k) => s + (parseFloat(bid?.[k]) || 0), 0);
  // Bond Estimate is a separate tiered-rate calculation from contract value —
  // not the manual bond_override dollar figure, which is its own line inside
  // Administrative Overrides above. Mirrors TakeoffEngine.jsx's bondAmount.
  const bondAmount = (() => {
    const contractValue = Math.max(0, subtotalWithMarkup + overrideTotal);
    if (contractValue <= 500000) return contractValue * 0.00810;
    if (contractValue <= 2500000) return contractValue * 0.00567;
    if (contractValue <= 5000000) return contractValue * 0.00486;
    return contractValue * 0.00432;
  })();
  const grandTotal = Number(bid?.bid_total_cost || 0);

  return (
    <div className="internal-breakdown-print-sheet bg-white text-black p-10 max-w-[8.5in] mx-auto">
      <div className="flex items-center justify-between border-b-2 border-red-600 pb-4 mb-2">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight">SteelOS</span>
          <span className="text-2xl font-light text-gray-400">|</span>
          <span className="text-sm text-gray-600">Internal Financial Breakdown</span>
        </div>
        {companyLogoUrl ? (
          <img src={companyLogoUrl} alt="Company logo" className="h-12 object-contain" />
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 border border-gray-300 rounded p-4 text-sm">
        <div><span className="text-gray-500">Job Name</span><p className="font-semibold">{bid.job_name}</p></div>
        <div><span className="text-gray-500">Bid Number</span><p className="font-semibold">{bid.bid_number}</p></div>
        <div><span className="text-gray-500">Bid Due Date</span><p className="font-semibold">{bid.bid_due_date || '—'}</p></div>
        <div><span className="text-gray-500">Customer</span><p className="font-semibold">{bid.customer_name}</p></div>
      </div>

      <table className="w-full text-xs mb-6">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2 pr-2">Cost Category</th>
            <th className="py-2 pr-2 text-right">Qty</th>
            <th className="py-2 pr-2 text-right">Unit Cost</th>
            <th className="py-2 pr-2 text-right">Line Total</th>
            <th className="py-2 pr-2 text-right">Markup %</th>
            <th className="py-2 text-right">Quoted Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ cat, line }) => {
            const quotedPrice = (line.total_cost || 0) * lineMarkupMultiplier(line);
            return (
              <tr key={cat.key} className="border-b border-gray-200">
                <td className="py-1.5 pr-2">{cat.label}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{line.quantity ? line.quantity.toLocaleString() : '—'}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{fmt(line.unit_cost)}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{fmt(line.total_cost)}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{fmtPct(line.markup_percentage)}</td>
                <td className="py-1.5 text-right font-mono font-semibold">{fmt(quotedPrice)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-black font-semibold">
            <td className="py-2" colSpan={3}>Subtotal</td>
            <td className="py-2 pr-2 text-right font-mono">{fmt(subtotal)}</td>
            <td className="py-2 pr-2 text-right font-mono">{fmtPct(averageMarkupPct)}</td>
            <td className="py-2 text-right font-mono">{fmt(subtotalWithMarkup)}</td>
          </tr>
        </tbody>
      </table>

      <table className="w-full text-sm mb-6">
        <tbody>
          <tr className="border-b border-gray-200"><td className="py-2">Line Item Subtotal</td><td className="py-2 text-right font-mono">{fmt(subtotal)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Profit Markup (avg {fmtPct(averageMarkupPct)})</td><td className="py-2 text-right font-mono">{fmt(markupAmount)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Administrative Overrides</td><td className="py-2 text-right font-mono">{fmt(overrideTotal)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Bond Estimate{!bid.bond_enabled && ' (off)'}</td><td className="py-2 text-right font-mono">{fmt(bid.bond_enabled ? bondAmount : 0)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Insurance Allocation{!bid.insurance_enabled && ' (off)'}</td><td className="py-2 text-right font-mono">{fmt(insuranceAllocation)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Delivery Cost</td><td className="py-2 text-right font-mono">{fmt(bid.delivery_total_cost)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Sales Tax {bid.tax_exempt ? '(exempt)' : `(${(taxRate * 100).toFixed(2)}%)`}</td><td className="py-2 text-right font-mono">{fmt(structuralTaxAmount)}</td></tr>
          <tr className="border-b border-gray-200"><td className="py-2">Joist &amp; Deck Tax {bid.joist_deck_taxable && !bid.tax_exempt ? `(${(joistDeckTaxRate * 100).toFixed(2)}%)` : '(exempt)'}</td><td className="py-2 text-right font-mono">{fmt(joistDeckTaxAmount)}</td></tr>
          <tr className="border-t-2 border-black"><td className="py-3 font-bold text-base">Total Cost</td><td className="py-3 text-right font-mono font-bold text-base">{fmt(grandTotal)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
