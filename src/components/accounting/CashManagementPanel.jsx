import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, Landmark, Scale, UploadCloud } from 'lucide-react';
import { computeAccountBalance } from '@/lib/cashBalance';

const ACCOUNT_TYPES = ['Checking', 'Savings', 'Line of Credit'];
const TRANSACTION_TYPES = ['Deposit', 'Withdrawal', 'Transfer', 'Fee', 'Interest'];

// Splits one CSV line on commas while respecting double-quoted fields (so a
// quoted description like "Payment, ACH" doesn't get split into two cells)
// — real bank exports do this for descriptions/memos.
function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

// Bank exports use every date format imaginable (MM/DD/YYYY, "Jan 5, 2026",
// already-ISO, etc.) — rather than requiring one, this normalizes to the
// same 'YYYY-MM-DD' shape the date input/manual entries already use, so
// sorting and the duplicate check below compare like with like.
function normalizeCsvDate(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// Strips currency formatting ($, commas) and treats parenthesized amounts
// as negative — the convention several bank/card exports use instead of a
// leading minus sign for withdrawals.
function normalizeCsvAmount(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,]/g, '');
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return isParenNegative ? -Math.abs(n) : n;
}

// Header names vary by bank ("Transaction Date" vs "Post Date" vs "Date"),
// so this matches by partial keyword rather than requiring an exact column
// name. Returns [] (not a throw) for anything that doesn't look like a
// transaction export — the caller turns that into a toast, not a crash.
function parseBankCsv(text) {
  const lines = String(text || '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const dateIdx = headers.findIndex((h) => /date/i.test(h));
  const descIdx = headers.findIndex((h) => /desc/i.test(h));
  const amountIdx = headers.findIndex((h) => /amount/i.test(h));
  if (dateIdx === -1 || descIdx === -1 || amountIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = normalizeCsvDate(cells[dateIdx]);
    const amount = normalizeCsvAmount(cells[amountIdx]);
    if (date == null || amount == null) continue;
    rows.push({ date, description: (cells[descIdx] || '').trim(), amount });
  }
  return rows;
}

const emptyAccountForm = () => ({
  account_name: '',
  bank_name: '',
  account_type: 'Checking',
  account_number_last4: '',
  routing_number_last4: '',
  opening_balance: 0,
});

const emptyTransactionForm = () => ({
  transaction_date: '',
  description: '',
  amount: '',
  transaction_type: 'Deposit',
  memo: '',
});

const fmtMoney = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CashManagementPanel() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const [transactions, setTransactions] = useState([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm());
  const [savingAccount, setSavingAccount] = useState(false);

  const [transactionForm, setTransactionForm] = useState(emptyTransactionForm());
  const [savingTransaction, setSavingTransaction] = useState(false);

  const [statementBalanceInput, setStatementBalanceInput] = useState('');

  const [csvPreviewRows, setCsvPreviewRows] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    setStatementBalanceInput('');
    setCsvPreviewRows([]);
    if (selectedAccountId) {
      loadTransactions(selectedAccountId);
    } else {
      setTransactions([]);
    }
  }, [selectedAccountId]);

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const rows = await db.entities.BankAccount.filter({ is_active: true }, '-created_date', 100);
      setAccounts(rows);
      if (!selectedAccountId && rows.length > 0) setSelectedAccountId(rows[0].id);
    } catch (e) {
      toast({ title: 'Failed to load bank accounts', variant: 'destructive' });
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadTransactions = async (accountId) => {
    setLoadingTransactions(true);
    try {
      const rows = await db.entities.BankTransaction.filter({ bank_account_id: accountId }, '-transaction_date', 500);
      setTransactions(rows);
    } catch (e) {
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // Running balance is opening_balance + the cumulative sum of every
  // transaction up through and including that row's date, in chronological
  // order — computed fresh from the loaded transactions every render, never
  // stored, so it can never drift from what's actually in the ledger.
  const runningBalanceById = useMemo(() => {
    const balances = {};
    const opening = selectedAccount?.opening_balance || 0;
    const ascending = [...transactions].sort((a, b) => (a.transaction_date || '').localeCompare(b.transaction_date || ''));
    let running = opening;
    ascending.forEach((t) => {
      running += Number(t.amount) || 0;
      balances[t.id] = running;
    });
    return balances;
  }, [transactions, selectedAccount]);

  const currentBalance = computeAccountBalance(selectedAccount, transactions);
  const reconciledBalance = (selectedAccount?.opening_balance || 0) +
    transactions.filter((t) => t.reconciled).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const statementBalance = statementBalanceInput === '' ? null : Number(statementBalanceInput) || 0;
  const reconciliationDifference = statementBalance == null ? null : statementBalance - reconciledBalance;

  const transactionsSortedDesc = useMemo(
    () => [...transactions].sort((a, b) => (b.transaction_date || '').localeCompare(a.transaction_date || '')),
    [transactions]
  );

  const handleAddAccount = async () => {
    if (!accountForm.account_name.trim()) {
      toast({ title: 'Account name is required', variant: 'destructive' });
      return;
    }
    setSavingAccount(true);
    try {
      const created = await db.entities.BankAccount.create({
        account_name: accountForm.account_name.trim(),
        bank_name: accountForm.bank_name.trim(),
        account_type: accountForm.account_type,
        account_number_last4: accountForm.account_number_last4.trim().slice(-4),
        routing_number_last4: accountForm.routing_number_last4.trim().slice(-4),
        opening_balance: Number(accountForm.opening_balance) || 0,
      });
      toast({ title: 'Bank account added' });
      setAccountForm(emptyAccountForm());
      setShowAddAccount(false);
      await loadAccounts();
      setSelectedAccountId(created.id);
    } catch (e) {
      toast({ title: 'Unable to add bank account', variant: 'destructive' });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleAddTransaction = async () => {
    if (!selectedAccountId) return;
    if (!transactionForm.transaction_date) {
      toast({ title: 'Transaction date is required', variant: 'destructive' });
      return;
    }
    if (transactionForm.amount === '' || Number.isNaN(Number(transactionForm.amount))) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    setSavingTransaction(true);
    try {
      await db.entities.BankTransaction.create({
        bank_account_id: selectedAccountId,
        transaction_date: transactionForm.transaction_date,
        description: transactionForm.description.trim(),
        amount: Number(transactionForm.amount),
        transaction_type: transactionForm.transaction_type,
        memo: transactionForm.memo.trim(),
        source: 'manual',
      });
      toast({ title: 'Transaction added' });
      setTransactionForm(emptyTransactionForm());
      loadTransactions(selectedAccountId);
    } catch (e) {
      toast({ title: 'Unable to add transaction', variant: 'destructive' });
    } finally {
      setSavingTransaction(false);
    }
  };

  const handleToggleReconciled = async (txn) => {
    const nextReconciled = !txn.reconciled;
    try {
      await db.entities.BankTransaction.update(txn.id, {
        reconciled: nextReconciled,
        reconciled_date: nextReconciled ? new Date().toISOString().slice(0, 10) : null,
      });
      loadTransactions(selectedAccountId);
    } catch (e) {
      toast({ title: 'Unable to update reconciliation status', variant: 'destructive' });
    }
  };

  const handleCsvFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a cancel/retry
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBankCsv(text);
      if (parsed.length === 0) {
        toast({
          title: 'No transactions found in that file',
          description: 'Expected columns with Date, Description, and Amount in the header row.',
          variant: 'destructive',
        });
        return;
      }
      const withDuplicateFlag = parsed.map((row) => ({
        ...row,
        isDuplicate: transactions.some((t) =>
          t.transaction_date === row.date &&
          Math.abs((Number(t.amount) || 0) - row.amount) < 0.005 &&
          String(t.description || '').trim().toLowerCase() === row.description.trim().toLowerCase()
        ),
      }));
      setCsvPreviewRows(withDuplicateFlag);
    } catch (err) {
      toast({ title: 'Could not read that CSV file', variant: 'destructive' });
    }
  };

  const csvDuplicateCount = csvPreviewRows.filter((r) => r.isDuplicate).length;
  const csvImportableRows = csvPreviewRows.filter((r) => !r.isDuplicate);

  const handleConfirmCsvImport = async () => {
    if (!selectedAccountId || csvImportableRows.length === 0) return;
    setCsvImporting(true);
    try {
      await db.entities.BankTransaction.bulkCreate(csvImportableRows.map((r) => ({
        bank_account_id: selectedAccountId,
        transaction_date: r.date,
        description: r.description,
        amount: r.amount,
        transaction_type: r.amount < 0 ? 'Withdrawal' : 'Deposit',
        source: 'import',
      })));
      toast({ title: `Imported ${csvImportableRows.length} transaction(s)` });
      setCsvPreviewRows([]);
      loadTransactions(selectedAccountId);
    } catch (e) {
      toast({ title: 'Import failed', variant: 'destructive' });
    } finally {
      setCsvImporting(false);
    }
  };

  if (loadingAccounts) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="steel-card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />Bank Accounts</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAddAccount((v) => !v)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Account
          </Button>
        </div>

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bank accounts yet — add one to start tracking cash.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedAccountId(a.id)}
                className={`text-left rounded-lg border px-3 py-2 text-xs transition-colors ${
                  a.id === selectedAccountId ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <p className="font-medium text-sm">{a.account_name}</p>
                <p className="text-muted-foreground">{a.bank_name || '—'} · {a.account_type || '—'} · ****{a.account_number_last4 || '----'}</p>
              </button>
            ))}
          </div>
        )}

        {showAddAccount && (
          <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Account Name</Label>
              <Input value={accountForm.account_name} onChange={(e) => setAccountForm((f) => ({ ...f, account_name: e.target.value }))} className="mt-1" placeholder="e.g. Operating Checking" />
            </div>
            <div>
              <Label className="text-xs">Bank Name</Label>
              <Input value={accountForm.bank_name} onChange={(e) => setAccountForm((f) => ({ ...f, bank_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Account Type</Label>
              <Select value={accountForm.account_type} onValueChange={(v) => setAccountForm((f) => ({ ...f, account_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Account Number (last 4 only)</Label>
              <Input
                value={accountForm.account_number_last4}
                onChange={(e) => setAccountForm((f) => ({ ...f, account_number_last4: e.target.value.replace(/\D/g, '').slice(-4) }))}
                className="mt-1"
                maxLength={4}
                placeholder="1234"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Never enter a full account number — last 4 digits only.</p>
            </div>
            <div>
              <Label className="text-xs">Routing Number (last 4 only)</Label>
              <Input
                value={accountForm.routing_number_last4}
                onChange={(e) => setAccountForm((f) => ({ ...f, routing_number_last4: e.target.value.replace(/\D/g, '').slice(-4) }))}
                className="mt-1"
                maxLength={4}
                placeholder="5678"
              />
            </div>
            <div>
              <Label className="text-xs">Opening Balance ($)</Label>
              <Input
                type="number"
                value={accountForm.opening_balance}
                onChange={(e) => setAccountForm((f) => ({ ...f, opening_balance: parseFloat(e.target.value) || 0 }))}
                className="mt-1"
              />
            </div>
            <div className="md:col-span-3 flex justify-end">
              <Button onClick={handleAddAccount} disabled={savingAccount} className="steel-gradient text-white border-0">
                {savingAccount ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                Save Account
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectedAccount && (
        <>
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Scale className="w-4 h-4 text-primary" />Reconciliation — {selectedAccount.account_name}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
              <div>
                <Label className="text-xs">Statement Ending Balance ($)</Label>
                <Input
                  type="number"
                  value={statementBalanceInput}
                  onChange={(e) => setStatementBalanceInput(e.target.value)}
                  className="mt-1"
                  placeholder="From your bank statement"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="font-mono font-bold text-lg">{fmtMoney(currentBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reconciled Balance</p>
                <p className="font-mono font-bold text-lg">{fmtMoney(reconciledBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Difference</p>
                <p className={`font-mono font-bold text-lg ${reconciliationDifference == null ? '' : Math.abs(reconciliationDifference) < 0.005 ? 'text-green-500' : 'text-red-500'}`}>
                  {reconciliationDifference == null ? '—' : fmtMoney(reconciliationDifference)}
                </p>
              </div>
            </div>
          </div>

          <div className="steel-card p-6">
            <h3 className="font-semibold mb-3">Add Transaction</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={transactionForm.transaction_date} onChange={(e) => setTransactionForm((f) => ({ ...f, transaction_date: e.target.value }))} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={transactionForm.description} onChange={(e) => setTransactionForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={transactionForm.amount}
                  onChange={(e) => setTransactionForm((f) => ({ ...f, amount: e.target.value }))}
                  className="mt-1"
                  placeholder="-250.00"
                />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={transactionForm.transaction_type} onValueChange={(v) => setTransactionForm((f) => ({ ...f, transaction_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 md:col-span-4">
                <Label className="text-xs">Memo</Label>
                <Input value={transactionForm.memo} onChange={(e) => setTransactionForm((f) => ({ ...f, memo: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Button onClick={handleAddTransaction} disabled={savingTransaction} className="steel-gradient text-white border-0 w-full">
                  {savingTransaction ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Amount: positive for deposits, negative for withdrawals/payments.</p>
          </div>

          <div className="steel-card p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2"><UploadCloud className="w-4 h-4 text-primary" />Import Bank Statement (CSV)</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Column headers just need to contain "date", "description", and "amount" somewhere in them — exact bank export naming doesn't matter.
            </p>
            <input type="file" accept=".csv" onChange={handleCsvFileSelected} className="text-sm" />

            {csvPreviewRows.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <p className="text-sm font-medium">
                    {csvPreviewRows.length} row{csvPreviewRows.length === 1 ? '' : 's'} found
                    {csvDuplicateCount > 0 && ` — ${csvDuplicateCount} duplicate${csvDuplicateCount === 1 ? '' : 's'} will be skipped`}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setCsvPreviewRows([])}>Cancel</Button>
                    <Button size="sm" onClick={handleConfirmCsvImport} disabled={csvImporting || csvImportableRows.length === 0} className="steel-gradient text-white border-0">
                      {csvImporting && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                      Import {csvImportableRows.length} Transaction{csvImportableRows.length === 1 ? '' : 's'}
                    </Button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left py-2 px-3">Date</th>
                        <th className="text-left py-2 px-3">Description</th>
                        <th className="text-right py-2 px-3">Amount</th>
                        <th className="text-center py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewRows.map((row, i) => (
                        <tr key={i} className={`border-t border-border/50 ${row.isDuplicate ? 'opacity-50' : ''}`}>
                          <td className="py-1.5 px-3">{row.date}</td>
                          <td className="py-1.5 px-3">{row.description || '—'}</td>
                          <td className={`py-1.5 px-3 text-right font-mono ${row.amount < 0 ? 'text-red-500' : 'text-green-500'}`}>{fmtMoney(row.amount)}</td>
                          <td className="py-1.5 px-3 text-center text-[10px] uppercase tracking-wide text-muted-foreground">{row.isDuplicate ? 'Duplicate' : 'New'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="steel-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold">Transactions — {transactionsSortedDesc.length}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Date</th>
                    <th className="text-left py-3 px-4">Description</th>
                    <th className="text-left py-3 px-4">Type</th>
                    <th className="text-right py-3 px-4">Amount</th>
                    <th className="text-right py-3 px-4">Balance</th>
                    <th className="text-center py-3 px-4">Reconciled</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingTransactions ? (
                    <tr><td colSpan={6} className="py-6 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ) : transactionsSortedDesc.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No transactions for this account yet.</td></tr>
                  ) : (
                    transactionsSortedDesc.map((t) => (
                      <tr key={t.id} className={`border-b border-border/50 hover:bg-muted/50 ${t.reconciled ? '' : ''}`}>
                        <td className="py-3 px-4 text-xs">{t.transaction_date || '—'}</td>
                        <td className="py-3 px-4">
                          {t.description || '—'}
                          {t.memo && <p className="text-xs text-muted-foreground">{t.memo}</p>}
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{t.transaction_type || '—'}</td>
                        <td className={`py-3 px-4 text-right font-mono ${(t.amount || 0) < 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {fmtMoney(t.amount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{fmtMoney(runningBalanceById[t.id])}</td>
                        <td className="py-3 px-4 text-center">
                          <Checkbox checked={!!t.reconciled} onCheckedChange={() => handleToggleReconciled(t)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
