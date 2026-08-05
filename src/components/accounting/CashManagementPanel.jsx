import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, Landmark, Scale } from 'lucide-react';

const ACCOUNT_TYPES = ['Checking', 'Savings', 'Line of Credit'];
const TRANSACTION_TYPES = ['Deposit', 'Withdrawal', 'Transfer', 'Fee', 'Interest'];

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

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    setStatementBalanceInput('');
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

  const currentBalance = (selectedAccount?.opening_balance || 0) + transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
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
        reconciled_date: nextReconciled ? new Date().toISOString() : null,
      });
      loadTransactions(selectedAccountId);
    } catch (e) {
      toast({ title: 'Unable to update reconciliation status', variant: 'destructive' });
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
