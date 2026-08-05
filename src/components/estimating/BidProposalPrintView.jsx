import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { computeBidTaxBreakdown } from '@/lib/financialAnalytics';
import { getActiveTemplate, isColumnVisible } from '@/lib/reportTemplates';

const ERECTION_CATEGORIES = ['steel_erection', 'outsourced_misc_material_erection', 'erection_labor_hours', 'crane_rental', 'mobilization', 'field_rigging'];

export default function BidProposalPrintView({ bid }) {
  const [lines, setLines] = useState([]);
  const [companyLogoUrl, setCompanyLogoUrl] = useState(null);
  const [template, setTemplate] = useState(null);

  useEffect(() => {
    if (!bid?.id) return;
    db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).then(setLines).catch(() => setLines([]));
    db.entities.Company.list('-created_date', 1).then((rows) => setCompanyLogoUrl(rows[0]?.logo_url || null)).catch(() => {});
    // Fails open: no active template means every line shows, same as before
    // this feature existed.
    getActiveTemplate('proposal').then(setTemplate).catch(() => setTemplate(null));
  }, [bid?.id]);

  const sum = (keys) => lines.filter((l) => keys.includes(l.cost_category)).reduce((s, l) => s + (l.total_cost || 0), 0);

  const detailingTotal = sum(['detailing']);
  const engineeringTotal = sum(['engineering']);
  const erectionTotal = sum(ERECTION_CATEGORIES);
  const subtotal = lines.reduce((s, l) => s + (l.total_cost || 0), 0);
  // Everything that isn't detailing/engineering/erection gets bucketed as one
  // "Structural Steel Fabrication" line — a real commercial proposal doesn't
  // itemize two dozen internal shop cost categories to the client.
  const fabricationTotal = Math.max(0, subtotal - detailingTotal - engineeringTotal - erectionTotal);

  const { taxRate, joistDeckTaxRate, structuralTaxAmount, joistDeckTaxAmount } = computeBidTaxBreakdown(bid, lines);
  const taxAmount = structuralTaxAmount + joistDeckTaxAmount;

  const grandTotal = Number(bid?.bid_total_cost || 0);
  // Hidden Margin Protection: bond, insurance, administrative overrides, and
  // any internal markup are folded into a single reconciling dollar figure
  // rather than exposing the formulas/multipliers/percentages that produced
  // them. This is a plug (grandTotal minus everything else shown) rather than
  // a recomputation, so the printed numbers always foot exactly to Bid Total.
  const adminAllocation = Math.max(0, grandTotal - fabricationTotal - detailingTotal - engineeringTotal - erectionTotal - taxAmount);

  const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!bid) return null;

  return (
    <div className="proposal-print-sheet bg-white text-black p-10 max-w-[8.5in] mx-auto">
      <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight">SteelOS</span>
          <span className="text-2xl font-light text-gray-400">|</span>
          <span className="text-sm text-gray-600">Structural Steel Proposal</span>
        </div>
        {companyLogoUrl ? (
          <img src={companyLogoUrl} alt="Company logo" className="h-12 object-contain" />
        ) : (
          <span className="text-xs text-gray-400">No corporate logo on file</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 border border-gray-300 rounded p-4 text-sm">
        <div><span className="text-gray-500">Job Name</span><p className="font-semibold">{bid.job_name}</p></div>
        <div><span className="text-gray-500">Bid Number</span><p className="font-semibold">{bid.bid_number}</p></div>
        <div><span className="text-gray-500">Bid Due Date</span><p className="font-semibold">{bid.bid_due_date || '—'}</p></div>
        <div><span className="text-gray-500">Customer</span><p className="font-semibold">{bid.customer_name}</p></div>
        <div><span className="text-gray-500">General Contractor</span><p className="font-semibold">{bid.general_contractor_name || '—'}</p></div>
      </div>

      <table className="w-full text-sm mb-6">
        <tbody>
          {isColumnVisible(template, 'show_fabrication') && (
            <tr className="border-b border-gray-200"><td className="py-2">Structural Steel Fabrication</td><td className="py-2 text-right font-mono">{fmt(fabricationTotal)}</td></tr>
          )}
          {isColumnVisible(template, 'show_detailing') && (
            <tr className="border-b border-gray-200"><td className="py-2">Detailing</td><td className="py-2 text-right font-mono">{fmt(detailingTotal)}</td></tr>
          )}
          {isColumnVisible(template, 'show_engineering') && (
            <tr className="border-b border-gray-200"><td className="py-2">Engineering</td><td className="py-2 text-right font-mono">{fmt(engineeringTotal)}</td></tr>
          )}
          {isColumnVisible(template, 'show_erection') && (
            <tr className="border-b border-gray-200"><td className="py-2">Steel Erection</td><td className="py-2 text-right font-mono">{fmt(erectionTotal)}</td></tr>
          )}
          {isColumnVisible(template, 'show_admin_allocation') && (
            <tr className="border-b border-gray-200"><td className="py-2">Overhead &amp; Administrative Allocation</td><td className="py-2 text-right font-mono">{fmt(adminAllocation)}</td></tr>
          )}
          {isColumnVisible(template, 'show_tax_breakdown') && (
            <>
              <tr className="border-b border-gray-200"><td className="py-2">Hancock County Tax ({(taxRate * 100).toFixed(2)}%)</td><td className="py-2 text-right font-mono">{fmt(structuralTaxAmount)}</td></tr>
              <tr className="border-b border-gray-200"><td className="py-2">Joist &amp; Deck Tax ({(joistDeckTaxRate * 100).toFixed(2)}%)</td><td className="py-2 text-right font-mono">{fmt(joistDeckTaxAmount)}</td></tr>
            </>
          )}
          <tr className="border-t-2 border-black"><td className="py-3 font-bold text-base">Bid Total</td><td className="py-3 text-right font-mono font-bold text-base">{fmt(grandTotal)}</td></tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-semibold mb-1 border-b border-gray-300 pb-1">Inclusions</h4>
          <p className="whitespace-pre-wrap text-xs">{bid.inclusions || 'None specified.'}</p>
        </div>
        <div>
          <h4 className="font-semibold mb-1 border-b border-gray-300 pb-1">Exclusions</h4>
          <p className="whitespace-pre-wrap text-xs">{bid.exclusions || 'None specified.'}</p>
        </div>
      </div>
    </div>
  );
}
