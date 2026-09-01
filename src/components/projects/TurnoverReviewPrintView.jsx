import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { SIMPLE_CHECKLIST_ITEMS, FREE_TEXT_FIELDS } from '@/components/projects/turnoverReviewShared';

// Internal operational/logistics handoff document — deliberately carries no
// pricing/cost data from the Bid Worksheet (see TakeoffEngine.jsx), matching
// TurnoverReviewPanel.jsx's own scope.
//
// `record` is passed in from the panel's own live state (see
// TurnoverReviewPanel.jsx's getPrintData(), wired through
// ProjectHandoffPanel.jsx and ProjectDetail.jsx) rather than fetched here —
// an earlier version of this component self-fetched by project_id on mount,
// but since it's mounted once and never re-fetches, that snapshot went stale
// the moment the user saved a change after this component's initial mount,
// silently exporting an empty/outdated PDF. Reading the panel's actual state
// at export time is what's actually current.
export default function TurnoverReviewPrintView({ project, record }) {
  const [companyLogoUrl, setCompanyLogoUrl] = useState(null);

  useEffect(() => {
    db.entities.Company.list('-created_date', 1).then((rows) => setCompanyLogoUrl(rows[0]?.logo_url || null)).catch(() => {});
  }, []);

  if (!project || !record) return null;
  const items = record.checklist_items || {};
  const yesNo = (v) => (v ? 'Yes' : 'No');

  return (
    <div className="turnover-review-print-sheet bg-white text-black p-10 max-w-[8.5in] mx-auto text-sm">
      <div className="flex items-center justify-between border-b-2 border-red-600 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight">SteelOS</span>
          <span className="text-2xl font-light text-gray-400">|</span>
          <span className="text-sm text-gray-600">Turnover / Contract Review</span>
        </div>
        {companyLogoUrl ? <img src={companyLogoUrl} alt="Company logo" className="h-12 object-contain" /> : null}
      </div>

      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{project.name}</p>
          <p className="text-gray-600">{project.project_number}</p>
        </div>
        <p className="text-gray-600">Printed {new Date().toLocaleDateString()}</p>
      </div>

      <h4 className="font-semibold border-b border-gray-300 pb-1 mb-2">Checklist</h4>
      <table className="w-full mb-6">
        <tbody>
          {SIMPLE_CHECKLIST_ITEMS.map(({ key, label }) => (
            <tr key={key} className="border-b border-gray-200">
              <td className="py-1.5 pr-4">{label}</td>
              <td className="py-1.5 text-right font-mono w-16">{yesNo(items[key])}</td>
            </tr>
          ))}
          <tr className="border-b border-gray-200">
            <td className="py-1.5 pr-4">Detailing{items.detailing_required && record.detailing_company ? ` — ${record.detailing_company}` : ''}</td>
            <td className="py-1.5 text-right font-mono w-16">{yesNo(items.detailing_required)}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="py-1.5 pr-4">Galvanizing{items.galvanizing_required && record.galvanizing_tons ? ` — ${record.galvanizing_tons} tons` : ''}</td>
            <td className="py-1.5 text-right font-mono w-16">{yesNo(items.galvanizing_required)}</td>
          </tr>
        </tbody>
      </table>

      <h4 className="font-semibold border-b border-gray-300 pb-1 mb-2">Pricing</h4>
      <p className="mb-1">Pricing Basis: <span className="font-medium">{record.pricing_basis === 'fob' ? 'FOB' : record.pricing_basis === 'erected' ? 'Erected' : '—'}</span></p>
      {record.pricing_basis === 'erected' && <p className="mb-6">Erector: <span className="font-medium">{record.erector_name || '—'}</span></p>}
      {record.pricing_basis !== 'erected' && <div className="mb-6" />}

      <h4 className="font-semibold border-b border-gray-300 pb-1 mb-2">Sub Quotes</h4>
      {(record.sub_quotes || []).length === 0 ? (
        <p className="text-gray-500 mb-6">None listed.</p>
      ) : (
        <table className="w-full mb-6">
          <thead><tr className="border-b border-gray-300 text-xs text-gray-500"><th className="text-left py-1">Company</th><th className="text-left py-1">Type</th></tr></thead>
          <tbody>
            {record.sub_quotes.map((row, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="py-1.5">{row.company || '—'}</td>
                <td className="py-1.5">{row.type || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="grid grid-cols-2 gap-6 mb-6">
        {FREE_TEXT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <h4 className="font-semibold border-b border-gray-300 pb-1 mb-1">{label}</h4>
            <p className="whitespace-pre-wrap text-xs">{record[key] || 'None specified.'}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <h4 className="font-semibold border-b border-gray-300 pb-1 mb-1">Required Attendees</h4>
          {(record.required_attendees || []).length === 0 ? <p className="text-xs text-gray-500">None listed.</p> : (
            <ul className="text-xs list-disc list-inside">{record.required_attendees.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
        </div>
        <div>
          <h4 className="font-semibold border-b border-gray-300 pb-1 mb-1">Actual Attendees</h4>
          {(record.actual_attendees || []).length === 0 ? <p className="text-xs text-gray-500">None listed.</p> : (
            <ul className="text-xs list-disc list-inside">{record.actual_attendees.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-10 mt-10 pt-6 border-t border-gray-300">
        <div>
          <p className="font-semibold mb-8">Completed By</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs text-gray-500 mb-4">Signature</p>
          <p className="text-xs">{record.completed_by || 'Not yet marked completed'}</p>
          <p className="text-xs text-gray-500">Print Name</p>
        </div>
        <div>
          <p className="font-semibold mb-8">Date</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs">{record.completed_date || '—'}</p>
        </div>
      </div>
    </div>
  );
}
