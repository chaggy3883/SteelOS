import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { computeBidTaxBreakdown } from '@/lib/financialAnalytics';
import { getTaxDisplayLabel } from '@/lib/taxRate';
import { getActiveTemplate, isColumnVisible } from '@/lib/reportTemplates';
import { rasterizePdfPages, detectDocumentKind } from '@/lib/proposalTermsPdfMerge';

const ERECTION_CATEGORIES = ['steel_erection', 'outsourced_misc_material_erection', 'erection_labor_hours', 'crane_rental', 'mobilization', 'field_rigging'];

export default function BidProposalPrintView({ bid }) {
  const [lines, setLines] = useState([]);
  const [company, setCompany] = useState(null);
  const [template, setTemplate] = useState(null);
  const [taxLabel, setTaxLabel] = useState('Sales Tax');
  // Appended legal/terms pages — each entry is { id, name, kind: 'pdf'|'image'|'other', images?, url? }.
  // 'pdf' entries carry pre-rasterized page images (see proposalTermsPdfMerge.js);
  // there is no backend in this app to merge PDF bytes server-side, so this
  // is what actually makes "append these pages to the proposal" real.
  const [termsPages, setTermsPages] = useState([]);

  useEffect(() => {
    if (!bid?.id) return;
    db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).then(setLines).catch(() => setLines([]));
    // Must resolve the SELLING company that owns this bid, not "whichever
    // company row happens to be most recently created" — the latter breaks
    // as soon as more than one tenant exists.
    if (bid.company_id) {
      db.entities.Company.get(bid.company_id).then(setCompany).catch(() => setCompany(null));
    } else {
      setCompany(null);
    }
    // Fails open: no active template means every line shows, same as before
    // this feature existed.
    getActiveTemplate('proposal').then(setTemplate).catch(() => setTemplate(null));
    // Reads bid.tax_rate_source/tax_zone_id (the snapshot) rather than
    // recomputing live, so this never shows a specific Ohio county's name for
    // a job that isn't actually in that jurisdiction, and never relabels a
    // historical bid just because a jurisdiction rate changed since.
    getTaxDisplayLabel(bid).then(setTaxLabel).catch(() => setTaxLabel('Sales Tax'));
  }, [bid?.id, bid?.company_id, bid?.tax_exempt, bid?.tax_exempt_reason, bid?.tax_rate_source, bid?.tax_zone_id]);

  useEffect(() => {
    if (!bid?.company_id) { setTermsPages([]); return; }
    let cancelled = false;
    (async () => {
      let docs = [];
      try {
        docs = await db.entities.CompanyProposalTerms.filter({ company_id: bid.company_id, is_active: true }, 'sort_order', 100);
      } catch {
        docs = [];
      }
      const rendered = await Promise.all(docs.map(async (doc) => {
        try {
          const kind = await detectDocumentKind(doc.file_url);
          if (kind === 'pdf') {
            const images = await rasterizePdfPages(doc.file_url);
            return { id: doc.id, name: doc.document_name, kind, images };
          }
          return { id: doc.id, name: doc.document_name, kind, url: doc.file_url };
        } catch {
          return null;
        }
      }));
      if (!cancelled) setTermsPages(rendered.filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [bid?.company_id]);

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
  // Price before any tax — shown regardless of taxable/exempt status. When
  // exempt, taxAmount is already 0, so this equals grandTotal.
  const fobPrice = grandTotal - taxAmount;

  const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!bid) return null;

  return (
    <div className="proposal-print-sheet bg-white text-black p-10 print:p-0 max-w-[8.5in] mx-auto">
      <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6">
        <span className="text-sm text-gray-600">Structural Steel Proposal</span>
        {company?.logo_url ? (
          <img src={company.logo_url} alt={company?.name ? `${company.name} logo` : 'Company logo'} className="h-12 object-contain" />
        ) : (
          <span className="text-lg font-semibold">{company?.name || ''}</span>
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
          <tr className="border-b border-gray-200"><td className="py-2 font-semibold">FOB Price (Excl. Tax)</td><td className="py-2 text-right font-mono font-semibold">{fmt(fobPrice)}</td></tr>
          {isColumnVisible(template, 'show_tax_breakdown') && !bid.tax_exempt && (
            <>
              <tr className="border-b border-gray-200">
                <td className="py-2">{`${taxLabel} (${(taxRate * 100).toFixed(2)}%)`}</td>
                <td className="py-2 text-right font-mono">{fmt(structuralTaxAmount)}</td>
              </tr>
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

      <div className="grid grid-cols-2 gap-10 mt-10 pt-6 border-t border-gray-300 text-sm" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
        <div>
          <p className="font-semibold mb-8">{company?.name || 'Company'} (Seller)</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Signature</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Print Name</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Title</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500">Date</p>
        </div>
        <div>
          <p className="font-semibold mb-8">{bid.customer_name || 'Customer'} (Buyer)</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Signature</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Print Name</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Title</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500">Date</p>
        </div>
      </div>

      {termsPages.map((doc) => (
        <React.Fragment key={doc.id}>
          {doc.kind === 'pdf' && doc.images.map((src, i) => (
            <div key={i} className="break-before-page pt-10">
              <img src={src} alt={`${doc.name} — page ${i + 1}`} className="w-full" />
            </div>
          ))}
          {doc.kind === 'image' && (
            <div className="break-before-page pt-10">
              <img src={doc.url} alt={doc.name} className="w-full" />
            </div>
          )}
          {doc.kind === 'other' && (
            <div className="break-before-page pt-10">
              <iframe src={doc.url} title={doc.name} className="w-full h-[10in] border-0" />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
