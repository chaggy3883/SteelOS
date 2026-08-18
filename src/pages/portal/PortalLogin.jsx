import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Building2, Truck } from 'lucide-react';
import { portalLogin } from '@/lib/portalAuth';

export default function PortalLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orgType, setOrgType] = useState(searchParams.get('type') === 'vendor' ? 'vendor' : 'customer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    try {
      const session = await portalLogin(orgType, email, password);
      navigate(session.orgType === 'vendor' ? '/portal/vendor' : '/portal/customer');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    handleSubmit(e);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm steel-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h1 className="font-semibold">SteelOS External Portal</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-5">Separate, isolated sign-in for Customers and Vendors — not your internal SteelOS account.</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => setOrgType('customer')}
            className={`flex items-center justify-center gap-2 rounded-lg border p-2 text-sm ${orgType === 'customer' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
          >
            <Building2 className="w-4 h-4" />Customer
          </button>
          <button
            type="button"
            onClick={() => setOrgType('vendor')}
            className={`flex items-center justify-center gap-2 rounded-lg border p-2 text-sm ${orgType === 'vendor' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
          >
            <Truck className="w-4 h-4" />Vendor
          </button>
        </div>

        <div onKeyDown={handleKeyDown} className="space-y-3">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" placeholder="you@company.com" />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <Button type="button" onClick={handleSubmit} disabled={loading} className="w-full steel-gradient text-white border-0">
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </div>
      </div>
    </div>
  );
}
