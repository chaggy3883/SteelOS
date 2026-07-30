import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  LogIn, Mail, Lock, Loader2, Briefcase, Wrench,
  Building2, ArrowLeft, KeyRound, Hash, Settings, ShieldCheck,
} from "lucide-react";
import GoogleIcon from "@/components/GoogleIcon";
import KioskKeypadLogin from "@/components/auth/KioskKeypadLogin";
import LoginVaultBackdrop from "@/components/auth/LoginVaultBackdrop";
import { isKioskModeEnabled, getKioskMode, enableKioskMode } from "@/lib/kioskMode";

export default function Login() {
  const { toast } = useToast();
  const kiosk = getKioskMode();
  const [step, setStep] = useState("company"); // 'company' | 'credentials'
  const [companyCode, setCompanyCode] = useState("");
  const [company, setCompany] = useState(null);
  const [companyError, setCompanyError] = useState("");
  const [resolvingCompany, setResolvingCompany] = useState(false);

  const [loginMode, setLoginMode] = useState("office"); // 'office' | 'shop_field'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [showKioskSetup, setShowKioskSetup] = useState(false);
  const [kioskSetupCode, setKioskSetupCode] = useState("");
  const [kioskSetupError, setKioskSetupError] = useState("");
  const [savingKioskSetup, setSavingKioskSetup] = useState(false);

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

  if (isKioskModeEnabled()) {
    return <KioskKeypadLogin companyCode={kiosk.companyCode} companyName={kiosk.companyName} />;
  }

  const handleEnableKioskMode = async (e) => {
    e.preventDefault();
    setKioskSetupError("");
    setSavingKioskSetup(true);
    try {
      const rows = await base44.entities.Company.list("-created_date", 200);
      const match = rows.find((c) => (c.company_code || "").toLowerCase() === kioskSetupCode.trim().toLowerCase());
      if (!match) {
        setKioskSetupError("Company code not found");
        return;
      }
      enableKioskMode(match.company_code, match.name);
      window.location.reload();
    } finally {
      setSavingKioskSetup(false);
    }
  };

  const handleResolveCompany = async (e) => {
    e.preventDefault();
    setCompanyError("");
    setResolvingCompany(true);
    try {
      const rows = await base44.entities.Company.list("-created_date", 200);
      const match = rows.find((c) => (c.company_code || "").toLowerCase() === companyCode.trim().toLowerCase());
      if (!match) {
        setCompanyError("Company code not found");
        return;
      }
      setCompany(match);
      setStep("credentials");
    } finally {
      setResolvingCompany(false);
    }
  };

  const handleChangeCompany = () => {
    setStep("company");
    setCompany(null);
    setCompanyCode("");
    setError("");
  };

  const handleOfficeSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleShopFieldSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmployeePin(company.company_code, employeeNumber, pin);
      window.location.href = "/employee-center";
    } catch (err) {
      const message = err.message || "Invalid employee number or PIN";
      toast({ title: message, variant: "destructive" });
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    base44.auth.loginWithProvider("google", "/");
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

  const title = step === "company" ? "SteelOS" : company?.name || "Welcome back";
  const subtitle = step === "company" ? "Enter your company code to continue" : "Log in to your account";

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-slate-950">
      <LoginVaultBackdrop />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4 shadow-lg shadow-primary/30 overflow-hidden">
            {step === "credentials" && company?.logo_url ? (
              <img src={company.logo_url} alt={`${company.name} logo`} className="w-full h-full object-contain p-1.5" />
            ) : (
              <Building2 className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          <p className="text-slate-400 mt-2">{subtitle}</p>
        </div>

        <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-100 rounded-xl shadow-2xl p-8 w-full">
          {step === "company" ? (
            <>
              <form onSubmit={handleResolveCompany} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company-code">Company Code</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="company-code"
                      autoFocus
                      placeholder="e.g. hancock"
                      value={companyCode}
                      onChange={(e) => setCompanyCode(e.target.value)}
                      className="pl-10 h-12"
                      required
                    />
                  </div>
                </div>
                {companyError && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{companyError}</div>
                )}
                <Button type="submit" className="w-full h-12 font-medium steel-gradient text-white border-0" disabled={resolvingCompany}>
                  {resolvingCompany ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Continue
                </Button>
              </form>

              <button
                type="button"
                onClick={() => setShowKioskSetup(true)}
                className="mt-6 w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 hover:underline"
              >
                <Settings className="w-3.5 h-3.5" />Set up this device as a Shop Kiosk
              </button>

              <Dialog open={showKioskSetup} onOpenChange={setShowKioskSetup}>
                <DialogContent>
                  <DialogHeader><DialogTitle>Dedicated Shop Kiosk Setup</DialogTitle></DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    This locks this device permanently to a single company. Every future visit skips straight to an Employee
                    Number + PIN keypad — no email login, no company code screen. Use only on a shared shop-floor terminal.
                  </p>
                  <form onSubmit={handleEnableKioskMode} className="space-y-3">
                    <div>
                      <Label htmlFor="kiosk-company-code">Company Code</Label>
                      <Input
                        id="kiosk-company-code"
                        autoFocus
                        placeholder="e.g. hancock"
                        value={kioskSetupCode}
                        onChange={(e) => setKioskSetupCode(e.target.value)}
                        className="mt-1"
                        required
                      />
                    </div>
                    {kioskSetupError && <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{kioskSetupError}</div>}
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setShowKioskSetup(false)}>Cancel</Button>
                      <Button type="submit" disabled={savingKioskSetup} className="steel-gradient text-white border-0">
                        {savingKioskSetup ? "Enabling…" : "Enable Kiosk Mode for This Device"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted">
                <button
                  type="button"
                  onClick={() => { setLoginMode("office"); setError(""); }}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${loginMode === "office" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                >
                  <Briefcase className="w-4 h-4" />Office / PM
                </button>
                <button
                  type="button"
                  onClick={() => { setLoginMode("shop_field"); setError(""); }}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${loginMode === "shop_field" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                >
                  <Wrench className="w-4 h-4" />Shop / Field
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              {loginMode === "office" ? (
                <>
                  <Button variant="outline" className="w-full h-12 text-sm font-medium mb-6" onClick={handleGoogle}>
                    <GoogleIcon className="w-5 h-5 mr-2" />
                    Continue with Google
                  </Button>
                  <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-3 text-muted-foreground">or</span></div>
                  </div>
                  <form onSubmit={handleOfficeSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                          id="email"
                          type="email"
                          autoComplete="email"
                          autoFocus
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 h-12"
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
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                          id="password"
                          type="password"
                          autoComplete="current-password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 h-12"
                          required
                        />
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
                      {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging in...</>) : "Log in"}
                    </Button>
                  </form>
                </>
              ) : (
                <form onSubmit={handleShopFieldSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="employee-number">Employee Number</Label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="employee-number"
                        maxLength={3}
                        autoFocus
                        placeholder="001"
                        value={employeeNumber}
                        onChange={(e) => setEmployeeNumber(e.target.value.replace(/\D/g, "").slice(0, 3))}
                        className="pl-10 h-12 font-mono"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-pin">5-Digit Formula PIN</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="employee-pin"
                        type="password"
                        maxLength={5}
                        placeholder="•••••"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        className="pl-10 h-12 font-mono"
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-12 font-medium steel-gradient text-white border-0" disabled={loading}>
                    {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging in...</>) : "Clock In / Log In"}
                  </Button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="text-center text-sm text-slate-400 mt-6">
          {step === "company" ? (
            "Enterprise access only — contact your administrator for a company code."
          ) : (
            <button type="button" onClick={handleChangeCompany} className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" />Not {company?.name}? Change company code
            </button>
          )}
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
