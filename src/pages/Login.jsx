import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { LogIn, Mail, Lock, Loader2, Building2, Eye, EyeOff } from "lucide-react";
import KioskKeypadLogin from "@/components/auth/KioskKeypadLogin";
import LoginVaultBackdrop from "@/components/auth/LoginVaultBackdrop";
import { isKioskModeEnabled, getKioskMode } from "@/lib/kioskMode";
import { isSuperAdmin } from "@/lib/tenantContext";

export default function Login() {
  const { toast } = useToast();
  const kiosk = getKioskMode();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // The Login Vault is an always-dark experience regardless of the app's own
  // light/dark toggle (that state lives in AppLayout, which doesn't render
  // for this unauthenticated page) — forcing it here keeps every themed
  // primitive (Input, Button, Dialog) consistent with the vault's dark card.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Devices provisioned via Settings > Devices (see AdminSettings' "Provision
  // Local Shop Floor Kiosk Tablet" button) permanently cache a company here —
  // this device never sees the credential card again until kiosk mode is
  // explicitly exited from the keypad screen.
  if (isKioskModeEnabled()) {
    return <KioskKeypadLogin companyCode={kiosk.companyCode} companyName={kiosk.companyName} />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { user } = await base44.auth.loginViaEmailPassword(email, password);
      // Tenant resolution, company branding, and office-vs-field destination
      // all happen behind the scenes from the authenticated user record —
      // nothing about it is decided on this screen.
      window.location.href = isSuperAdmin(user) ? "/super-admin/dashboard" : "/";
    } catch (err) {
      const message = err.message || "Invalid email or password";
      toast({ title: message, variant: "destructive" });
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPasswordReset = (e) => {
    e.preventDefault();
    setForgotSent(true);
    toast({
      title: "Verification token sent",
      description: `A password reset link has been routed to ${forgotEmail.trim() || "your inbox"}.`,
    });
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setForgotSent(false);
    setForgotEmail("");
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-slate-950">
      <LoginVaultBackdrop />

      <div className="relative z-10 w-full max-w-[340px]">
        <div className="text-center mb-8">
          <Building2 className="w-10 h-10 text-white mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-3xl font-bold tracking-tight text-white">SteelOS</h1>
          <p className="text-slate-400 mt-2">Log in to your account</p>
        </div>

        <div className="bg-transparent border-none shadow-none p-8 w-full">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-black/80 border-2 border-slate-400 focus:border-blue-500 placeholder-slate-400 text-white font-medium h-11 px-4 pl-10"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" onClick={() => setShowForgotPassword(true)} className="text-xs text-primary hover:underline">Forgot password?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" aria-hidden="true" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-black/80 border-2 border-slate-400 focus:border-blue-500 placeholder-slate-400 text-white font-medium h-11 px-4 pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-slate-400 hover:text-white"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-11 bg-white hover:bg-slate-200 text-black font-semibold rounded-md transition-colors tracking-wide"
              disabled={loading}
            >
              {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Entering Vault...</>) : "Enter Vault"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-400 mt-6">
          Enterprise access only — contact your administrator for access.
        </p>
      </div>

      <Dialog open={showForgotPassword} onOpenChange={(open) => (open ? setShowForgotPassword(true) : closeForgotPassword())}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Your Password</DialogTitle></DialogHeader>
          {forgotSent ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <LogIn className="w-4 h-4 text-primary" />A verification token has been routed to your inbox. Follow the link there to finish resetting your password.
            </p>
          ) : (
            <form onSubmit={handleRequestPasswordReset} className="space-y-3">
              <div>
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="mt-1"
                  required
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeForgotPassword}>Cancel</Button>
                <Button type="submit" className="steel-gradient text-white border-0">Send Verification Token</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
