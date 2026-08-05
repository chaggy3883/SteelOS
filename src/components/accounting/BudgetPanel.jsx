import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ClipboardList, Scale } from 'lucide-react';

// Company-wide annual budgeting with budget-vs-actual variance. This does
// NOT create new cost tracking — actuals are read straight from data that
// already exists (JobCostLedgerEntry for LAB/MAT/SUB/EQP, InvoiceReceivable
// for Revenue). A BudgetLine is purely a plan number to compare against.
const CATEGORIES = ['Revenue', 'LAB', 'MAT', 'SUB', 'EQP'];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const periodFor = (fiscalYear, month) => `${fiscalYear}-${String(month).padStart(2, '0')}`;

const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
const fmtPct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);

export default function BudgetPanel() {
  const { toast } = useToast();
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [budgetLines, setBudgetLines] = useState([]);
  const [loadingBudget, setLoadingBudget] = useState(true);
  const [settingUp, setSettingUp] = useState(false);

  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [invoiceReceivables, setInvoiceReceivables] = useState([]);
  const [loadingActuals, setLoadingActuals] = useState(false);

  // Tracks each line's last-persisted value so blur only writes when the
  // number actually changed, instead of firing an update on every blur.
  const persistedValuesRef = useRef({});

  useEffect(() => { loadBudget(fiscalYear); }, [fiscalYear]);

  const loadBudget = async (year) => {
    setLoadingBudget(true);
    try {
      const rows = await db.entities.BudgetLine.filter({ fiscal_year: year }, 'period', 100);
      setBudgetLines(rows);
      persistedValuesRef.current = rows.reduce((acc, r) => {
        acc[r.id] = Number(r.budgeted_amount) || 0;
        return acc;
      }, {});
      if (rows.length > 0) loadActuals();
      else {
        setLedgerEntries([]);
        setInvoiceReceivables([]);
      }
    } catch (e) {
      setBudgetLines([]);
    } finally {
      setLoadingBudget(false);
    }
  };

  const loadActuals = async () => {
    setLoadingActuals(true);
    try {
      const [ledger, invoices] = await Promise.all([
        db.entities.JobCostLedgerEntry.list('-created_date', 5000),
        db.entities.InvoiceReceivable.list('-created_date', 2000),
      ]);
      setLedgerEntries(ledger);
      setInvoiceReceivables(invoices);
    } catch (e) {
      setLedgerEntries([]);
      setInvoiceReceivables([]);
    } finally {
      setLoadingActuals(false);
    }
  };

  const lineByKey = useMemo(() => {
    const map = {};
    budgetLines.forEach((b) => { map[`${b.category}_${b.period}`] = b; });
    return map;
  }, [budgetLines]);

  const handleSetupBudget = async () => {
    setSettingUp(true);
    try {
      const lines = [];
      CATEGORIES.forEach((category) => {
        MONTHS.forEach((m) => {
          lines.push({ fiscal_year: fiscalYear, period: periodFor(fiscalYear, m), category, budgeted_amount: 0 });
        });
      });
      await db.entities.BudgetLine.bulkCreate(lines);
      toast({ title: `Budget set up for ${fiscalYear}` });
      loadBudget(fiscalYear);
    } catch (e) {
      toast({ title: 'Unable to set up budget', variant: 'destructive' });
    } finally {
      setSettingUp(false);
    }
  };

  const handleCellChange = (id, rawValue) => {
    setBudgetLines((prev) => prev.map((b) => (b.id === id ? { ...b, budgeted_amount: rawValue } : b)));
  };

  const handleCellBlur = async (line) => {
    const newValue = Number(line.budgeted_amount) || 0;
    setBudgetLines((prev) => prev.map((b) => (b.id === line.id ? { ...b, budgeted_amount: newValue } : b)));
    if (newValue === persistedValuesRef.current[line.id]) return;
    try {
      await db.entities.BudgetLine.update(line.id, { budgeted_amount: newValue });
      persistedValuesRef.current[line.id] = newValue;
    } catch (e) {
      toast({ title: 'Unable to save budget amount', variant: 'destructive' });
    }
  };

  const rowTotal = (category) =>
    MONTHS.reduce((sum, m) => sum + (Number(lineByKey[`${category}_${periodFor(fiscalYear, m)}`]?.budgeted_amount) || 0), 0);

  const columnTotal = (m) =>
    CATEGORIES.reduce((sum, category) => sum + (Number(lineByKey[`${category}_${periodFor(fiscalYear, m)}`]?.budgeted_amount) || 0), 0);

  const grandTotal = CATEGORIES.reduce((sum, category) => sum + rowTotal(category), 0);

  // Actuals are read straight from existing records — nothing here is
  // stored. Revenue's billing_period is free text, so it's matched with the
  // same forgiving substring check used for readiness in MonthEndClosePanel.
  const actualForCategoryPeriod = (category, period) => {
    if (category === 'Revenue') {
      return invoiceReceivables
        .filter((inv) => String(inv.billing_period || '').includes(period))
        .reduce((sum, inv) => sum + (Number(inv.net_billing) || 0), 0);
    }
    return ledgerEntries
      .filter((l) => l.cost_class === category && String(l.transaction_date || '').startsWith(period))
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  };

  const budgetedForCategoryPeriod = (category, period) => Number(lineByKey[`${category}_${period}`]?.budgeted_amount) || 0;

  const now = new Date();
  const ytdMonthCount = fiscalYear === String(now.getFullYear()) ? now.getMonth() + 1 : 12;
  const ytdMonths = MONTHS.slice(0, ytdMonthCount);

  // Cost categories (LAB/MAT/SUB/EQP): over budget (variance > 0) is bad.
  // Revenue: under budget (variance < 0) is bad. Same variance formula
  // (actual - budgeted) for both — only which sign counts as "bad" flips.
  const varianceColorClass = (category, variance) => {
    if (variance === 0) return '';
    const isBad = category === 'Revenue' ? variance < 0 : variance > 0;
    return isBad ? 'text-red-500' : 'text-green-500';
  };

  if (loadingBudget) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="steel-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label className="text-xs">Fiscal Year</Label>
            <Input
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="mt-1 max-w-[120px]"
              placeholder="2026"
            />
          </div>
          {budgetLines.length === 0 && (
            <Button onClick={handleSetupBudget} disabled={settingUp || fiscalYear.length !== 4} className="steel-gradient text-white border-0">
              {settingUp ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ClipboardList className="w-4 h-4 mr-1" />}
              Set Up Budget for {fiscalYear}
            </Button>
          )}
        </div>
      </div>

      {budgetLines.length > 0 && (
        <>
          <div className="steel-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4 text-primary" />Budget — {fiscalYear}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-2 px-3">Category</th>
                    {MONTH_LABELS.map((label) => <th key={label} className="text-right py-2 px-2 min-w-[80px]">{label}</th>)}
                    <th className="text-right py-2 px-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map((category) => (
                    <tr key={category} className="border-b border-border/50">
                      <td className="py-2 px-3 font-medium">{category}</td>
                      {MONTHS.map((m) => {
                        const line = lineByKey[`${category}_${periodFor(fiscalYear, m)}`];
                        if (!line) return <td key={m} className="py-1.5 px-2">—</td>;
                        return (
                          <td key={m} className="py-1.5 px-2">
                            <Input
                              type="number"
                              value={line.budgeted_amount}
                              onChange={(e) => handleCellChange(line.id, e.target.value)}
                              onBlur={() => handleCellBlur(line)}
                              className="h-8 text-right font-mono text-xs px-1.5"
                            />
                          </td>
                        );
                      })}
                      <td className="py-2 px-3 text-right font-mono font-bold">{fmtMoney(rowTotal(category))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-muted/30 font-semibold">
                    <td className="py-2 px-3">Total</td>
                    {MONTHS.map((m) => <td key={m} className="py-2 px-2 text-right font-mono text-xs">{fmtMoney(columnTotal(m))}</td>)}
                    <td className="py-2 px-3 text-right font-mono">{fmtMoney(grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="steel-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2"><Scale className="w-4 h-4 text-primary" />Budget vs Actual — {fiscalYear}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Monthly variance % (actual vs budget), plus year-to-date totals through {MONTH_LABELS[ytdMonthCount - 1]}.
                For LAB/MAT/SUB/EQP, over budget is red. For Revenue, under budget is red.
              </p>
            </div>
            {loadingActuals ? (
              <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1500px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 px-3">Category</th>
                      {MONTH_LABELS.map((label) => <th key={label} className="text-right py-2 px-2 min-w-[70px]">{label}</th>)}
                      <th className="text-right py-2 px-3 border-l border-border">YTD Actual</th>
                      <th className="text-right py-2 px-3">YTD Budget</th>
                      <th className="text-right py-2 px-3">YTD Variance</th>
                      <th className="text-right py-2 px-3">YTD Var %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map((category) => {
                      const ytdActual = ytdMonths.reduce((sum, m) => sum + actualForCategoryPeriod(category, periodFor(fiscalYear, m)), 0);
                      const ytdBudgeted = ytdMonths.reduce((sum, m) => sum + budgetedForCategoryPeriod(category, periodFor(fiscalYear, m)), 0);
                      const ytdVariance = ytdActual - ytdBudgeted;
                      const ytdVariancePct = ytdBudgeted !== 0 ? ytdVariance / ytdBudgeted : null;
                      return (
                        <tr key={category} className="border-b border-border/50">
                          <td className="py-2 px-3 font-medium">{category}</td>
                          {MONTHS.map((m) => {
                            const period = periodFor(fiscalYear, m);
                            const actual = actualForCategoryPeriod(category, period);
                            const budgeted = budgetedForCategoryPeriod(category, period);
                            const variance = actual - budgeted;
                            const variancePct = budgeted !== 0 ? variance / budgeted : null;
                            return (
                              <td key={m} className={`py-1.5 px-2 text-right font-mono text-xs ${varianceColorClass(category, variance)}`}>
                                {fmtPct(variancePct)}
                              </td>
                            );
                          })}
                          <td className="py-2 px-3 text-right font-mono border-l border-border">{fmtMoney(ytdActual)}</td>
                          <td className="py-2 px-3 text-right font-mono">{fmtMoney(ytdBudgeted)}</td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${varianceColorClass(category, ytdVariance)}`}>{fmtMoney(ytdVariance)}</td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${varianceColorClass(category, ytdVariance)}`}>{fmtPct(ytdVariancePct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
