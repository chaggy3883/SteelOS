import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, Download } from 'lucide-react';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { generateCashForecastPdf } from '@/lib/cashForecastPdf';
import { loadCashForecastData, computeCashForecastBuckets } from '@/lib/cashForecastEngine';
import LedgerDrilldownModal from '@/components/accounting/LedgerDrilldownModal';

const fmtMoney = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 90-day, weekly-bucketed cash forecast. Starting balance and every bucket's
// net change are all derived from data that already exists elsewhere in the
// app (bank transactions, approved vendor bills, approved/released AR
// invoices, recurring items) — nothing here is stored, it's recomputed on
// every load so it's always consistent with the ledger.
export default function CashForecastPanel() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [bucketDrilldown, setBucketDrilldown] = useState(null);
  const [startingBalance, setStartingBalance] = useState(0);
  const [linkedTransactions, setLinkedTransactions] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [invoiceReceivables, setInvoiceReceivables] = useState([]);
  const [recurringItems, setRecurringItems] = useState([]);

  useEffect(() => { loadForecastData(); }, []);

  const loadForecastData = async () => {
    setLoading(true);
    try {
      const data = await loadCashForecastData();
      setStartingBalance(data.startingBalance);
      setLinkedTransactions(data.linkedTransactions);
      setVendorBills(data.vendorBills);
      setInvoiceReceivables(data.invoiceReceivables);
      setRecurringItems(data.recurringItems);
    } catch (e) {
      toast({ title: 'Failed to load cash forecast data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const buckets = useMemo(
    () => computeCashForecastBuckets({ startingBalance, vendorBills, invoiceReceivables, recurringItems, linkedTransactions, todayIso }),
    [vendorBills, invoiceReceivables, recurringItems, linkedTransactions, startingBalance, todayIso]
  );

  const handleExportPdf = async () => {
    try {
      const company = await getEffectiveCompany().catch(() => null);
      await generateCashForecastPdf({ company, startingBalance, buckets });
      toast({ title: 'Cash Forecast PDF generated' });
    } catch (e) {
      toast({ title: 'Unable to generate Cash Forecast PDF', variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const willGoNegative = buckets.some((b) => b.runningBalance < 0);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="steel-card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />90-Day Cash Forecast</h3>
          <Button size="sm" variant="outline" onClick={handleExportPdf}><Download className="w-3.5 h-3.5 mr-1" />Export PDF</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <button type="button" onClick={() => navigate('/accounting?tab=cash')} className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors">
            <p className="text-xs text-muted-foreground">Starting Balance (all active accounts)</p>
            <p className="font-mono font-bold text-lg">{fmtMoney(startingBalance)}</p>
          </button>
          <button
            type="button"
            onClick={() => setBucketDrilldown({ bucketEndDate: '90-day window', items: buckets.flatMap((b) => b.items) })}
            className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors"
          >
            <p className="text-xs text-muted-foreground">Projected Balance in 90 Days</p>
            <p className={`font-mono font-bold text-lg ${buckets[buckets.length - 1]?.runningBalance < 0 ? 'text-red-500' : ''}`}>
              {fmtMoney(buckets[buckets.length - 1]?.runningBalance)}
            </p>
          </button>
          {willGoNegative && (
            <div>
              <p className="text-xs text-red-500 font-medium">⚠ Projected shortfall — balance goes negative in at least one week below.</p>
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Includes approved vendor bills (by due date), approved/released AR invoices (by expected payment date, net of retainage), and active
          recurring items — excluding anything already reflected in an actual bank transaction.
        </p>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Weekly Projection</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Week Ending</th>
                <th className="text-right py-3 px-4">Net Change</th>
                <th className="text-right py-3 px-4">Projected Balance</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.bucketEndDate} onClick={() => setBucketDrilldown(b)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-3 px-4 text-xs">{b.bucketEndDate}</td>
                  <td className={`py-3 px-4 text-right font-mono ${b.netChange < 0 ? 'text-red-500' : 'text-green-500'}`}>{fmtMoney(b.netChange)}</td>
                  <td className={`py-3 px-4 text-right font-mono font-bold ${b.runningBalance < 0 ? 'text-red-500' : ''}`}>{fmtMoney(b.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <LedgerDrilldownModal
        open={!!bucketDrilldown}
        onOpenChange={(open) => !open && setBucketDrilldown(null)}
        title={`Week Ending ${bucketDrilldown?.bucketEndDate || ''}`}
        entries={bucketDrilldown?.items || []}
        emptyMessage="No specific bills, invoices, or recurring items land in this week."
      />
    </div>
  );
}
