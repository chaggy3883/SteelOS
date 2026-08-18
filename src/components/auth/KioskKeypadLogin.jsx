import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { Delete, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { disableKioskMode } from '@/lib/kioskMode';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function KioskKeypadLogin({ companyCode, companyName }) {
  const { toast } = useToast();
  const [company, setCompany] = useState(null);
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [pin, setPin] = useState('');
  const [activeField, setActiveField] = useState('number');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    db.entities.Company.list('-created_date', 200)
      .then((rows) => setCompany(rows.find((c) => (c.company_code || '').toLowerCase() === companyCode.toLowerCase()) || null))
      .catch(() => setCompany(null));
  }, [companyCode]);

  const attemptLogin = async (finishedNumber, finishedPin) => {
    setLoading(true);
    setError('');
    try {
      await db.auth.loginViaEmployeePin(companyCode, finishedNumber, finishedPin);
      window.location.href = '/employee-center';
    } catch (err) {
      const message = err.message || 'Invalid employee number or PIN';
      toast({ title: message, variant: 'destructive' });
      setError(message);
      setPin('');
      setActiveField('pin');
    } finally {
      setLoading(false);
    }
  };

  const pressKey = (key) => {
    if (loading) return;
    if (key === 'clear') {
      if (activeField === 'number') setEmployeeNumber('');
      else setPin('');
      return;
    }
    if (key === 'back') {
      if (activeField === 'number') setEmployeeNumber((v) => v.slice(0, -1));
      else setPin((v) => v.slice(0, -1));
      return;
    }
    if (activeField === 'number') {
      const next = (employeeNumber + key).slice(0, 3);
      setEmployeeNumber(next);
      if (next.length === 3) setActiveField('pin');
      return;
    }
    const nextPin = (pin + key).slice(0, 4);
    setPin(nextPin);
    if (nextPin.length === 4) attemptLogin(employeeNumber, nextPin);
  };

  const handleExitKiosk = () => {
    disableKioskMode();
    window.location.reload();
  };

  return (
    <AuthLayout
      icon={Delete}
      logoUrl={company?.logo_url}
      title={companyName || company?.name || 'Shop Kiosk'}
      subtitle="Enter your Employee Number and PIN"
      footer={
        <button type="button" onClick={handleExitKiosk} className="text-muted-foreground hover:underline">
          Exit Kiosk Mode
        </button>
      }
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">{error}</div>}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          type="button"
          onClick={() => setActiveField('number')}
          className={`rounded-lg border-2 p-3 text-center transition-colors ${activeField === 'number' ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Employee #</p>
          <p className="text-2xl font-mono font-bold">{employeeNumber.padEnd(3, '·')}</p>
        </button>
        <button
          type="button"
          onClick={() => setActiveField('pin')}
          className={`rounded-lg border-2 p-3 text-center transition-colors ${activeField === 'pin' ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">PIN</p>
          <p className="text-2xl font-mono font-bold">{'•'.repeat(pin.length).padEnd(4, '·')}</p>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={loading}
            onClick={() => pressKey(key)}
            className="h-16 rounded-lg border border-border bg-card hover:bg-muted text-xl font-semibold flex items-center justify-center disabled:opacity-50"
          >
            {key === 'back' ? <Delete className="w-5 h-5" /> : key === 'clear' ? <span className="text-xs">Clear</span> : key}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />Logging in…
        </div>
      )}
    </AuthLayout>
  );
}
