import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import LedgerDrilldownModal from '@/components/accounting/LedgerDrilldownModal';
import CommittedDrilldownModal from '@/components/accounting/CommittedDrilldownModal';

const money = (n) => `$${Math.round(n || 0).toLocaleString()}`;

// Over budget (actual > estimate) reads as bad/red; under reads as
// good/green — standard job-cost convention. No estimate on file never
// renders a direction at all, per the "never compute variance against
// zero" rule this is built around.
function VarianceBadge({ variance, variancePct }) {
  if (variance === null || variancePct === null) {
    return <span className="text-slate-500 text-lg">—</span>;
  }
  const over = variance > 0;
  const flat = variance === 0;
  const Icon = flat ? Minus : over ? ArrowUp : ArrowDown;
  const colorClass = flat ? 'text-slate-400' : over ? 'text-red-400' : 'text-emerald-400';
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${colorClass}`}>
      <Icon className="w-5 h-5" aria-hidden="true" />
      {over ? '+' : ''}{money(variance)} ({over ? '+' : ''}{variancePct.toFixed(1)}%)
    </span>
  );
}

// One job, one screen: Estimate / Actual / Committed / Variance by cost
// code. Every aggregated number (Actual, Committed, Variance) drills into
// the real records that compose it — Estimate is a single already-visible
// ProjectJobCostSummary field, not an aggregate, so it has nothing further
// to drill into.
export default function JobCostByJobSlide({ project, rows }) {
  const [ledgerDrilldown, setLedgerDrilldown] = useState(null);
  const [committedDrilldown, setCommittedDrilldown] = useState(null);

  const totals = rows.reduce((acc, row) => ({
    estimate: acc.estimate + (row.estimate || 0),
    actual: acc.actual + row.actual,
    committed: acc.committed + row.committed,
  }), { estimate: 0, actual: 0, committed: 0 });
  const anyEstimate = rows.some((r) => r.hasEstimate);
  const totalVariance = anyEstimate ? totals.actual - totals.estimate : null;
  const totalVariancePct = anyEstimate && totals.estimate > 0 ? (totalVariance / totals.estimate) * 100 : null;

  const openLedger = (row) => setLedgerDrilldown({
    title: `${row.cost_code} — Actual Cost Detail`,
    subtitle: `${project.project_number || ''} ${project.name || ''}`.trim(),
    entries: row.ledgerEntries,
    emptyMessage: 'No job cost ledger entries recorded against this cost code yet.',
  });

  const openCommitted = (row) => setCommittedDrilldown({
    title: `${row.cost_code} — Committed Detail`,
    subcontracts: row.committedSubcontracts,
    emptyMessage: 'No open subcontract commitments recorded against this cost code.',
  });

  return (
    <div className="flex flex-col h-full text-white">
      <div className="px-10 pt-8 pb-4">
        <p className="text-lg text-slate-400 uppercase tracking-wide">Job Cost by Job</p>
        <h1 className="text-5xl font-bold mt-1">{project.name}</h1>
        <p className="text-2xl text-slate-300 mt-1">{project.project_number}</p>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-2xl text-slate-400">No job cost activity recorded for this job yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-10 pb-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-lg text-slate-400 uppercase tracking-wide border-b-2 border-slate-700">
                <th className="py-3 pr-4 font-medium">Cost Code</th>
                <th className="py-3 pr-4 font-medium text-right">Estimate</th>
                <th className="py-3 pr-4 font-medium text-right">Actual</th>
                <th className="py-3 pr-4 font-medium text-right">Committed</th>
                <th className="py-3 pl-4 font-medium text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cost_code} className="border-b border-slate-800">
                  <td className="py-4 pr-4">
                    <div className="text-2xl font-semibold">{row.cost_code}</div>
                    {row.description && <div className="text-base text-slate-400">{row.description}</div>}
                  </td>
                  <td className="py-4 pr-4 text-right text-2xl font-mono">
                    {row.hasEstimate ? money(row.estimate) : <span className="text-slate-500 text-lg">No estimate set</span>}
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => openLedger(row)}
                      className="text-2xl font-mono font-semibold underline decoration-slate-600 hover:decoration-white hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                    >
                      {money(row.actual)}
                    </button>
                  </td>
                  <td className="py-4 pr-4 text-right">
                    {row.committed > 0 ? (
                      <button
                        type="button"
                        onClick={() => openCommitted(row)}
                        className="text-2xl font-mono font-semibold underline decoration-slate-600 hover:decoration-white hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                      >
                        {money(row.committed)}
                      </button>
                    ) : (
                      <span className="text-2xl font-mono text-slate-500">$0</span>
                    )}
                  </td>
                  <td className="py-4 pl-4 text-right">
                    {row.variance === null ? (
                      <VarianceBadge variance={null} variancePct={null} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => openLedger(row)}
                        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                      >
                        <VarianceBadge variance={row.variance} variancePct={row.variancePct} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-700">
                <td className="py-4 pr-4 text-xl font-semibold text-slate-300">Total</td>
                <td className="py-4 pr-4 text-right text-2xl font-mono font-bold">
                  {anyEstimate ? money(totals.estimate) : <span className="text-slate-500 text-lg">No estimate set</span>}
                </td>
                <td className="py-4 pr-4 text-right text-2xl font-mono font-bold">{money(totals.actual)}</td>
                <td className="py-4 pr-4 text-right text-2xl font-mono font-bold">{money(totals.committed)}</td>
                <td className="py-4 pl-4 text-right"><VarianceBadge variance={totalVariance} variancePct={totalVariancePct} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {ledgerDrilldown && (
        <LedgerDrilldownModal
          open={!!ledgerDrilldown}
          onOpenChange={(open) => !open && setLedgerDrilldown(null)}
          title={ledgerDrilldown.title}
          subtitle={ledgerDrilldown.subtitle}
          entries={ledgerDrilldown.entries}
          emptyMessage={ledgerDrilldown.emptyMessage}
        />
      )}
      {committedDrilldown && (
        <CommittedDrilldownModal
          open={!!committedDrilldown}
          onOpenChange={(open) => !open && setCommittedDrilldown(null)}
          title={committedDrilldown.title}
          subcontracts={committedDrilldown.subcontracts}
          emptyMessage={committedDrilldown.emptyMessage}
        />
      )}
    </div>
  );
}
