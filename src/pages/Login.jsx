import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  LogIn, Mail, Lock, Loader2, ShieldCheck, Briefcase, Wrench, Package,
  Building2, ArrowLeft, KeyRound, Hash,
} from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";

export default function Login() {
  const { toast } = useToast();
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

  const quickLogin = async (demoEmail, demoPassword) => {
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(demoEmail, demoPassword);
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Unable to sign in with demo account");
    } finally {
      setLoading(false);
    }
  };

  if (step === "company") {
    return (
      <AuthLayout
        icon={Building2}
        title="SteelOS"
        subtitle="Enter your company code to continue"
        footer={
          <>
            Don't have an account?{" "}
            <Link to="/register" className="text-primary font-medium hover:underline">
              Create one
            </Link>
          </>
        }
      >
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
            {resolvingCompany ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Continue
          </Button>
        </form>

        <div className="mt-8 grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Demo roles (skip company code)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => quickLogin("admin@steelos.dev", "password123")}>
              <ShieldCheck className="w-4 h-4" /> Demo Admin
            </Button>
            <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => quickLogin("estimator@steelos.dev", "password123")}>
              <Wrench className="w-4 h-4" /> Estimator
            </Button>
            <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => quickLogin("projectmanager@steelos.dev", "password123")}>
              <Briefcase className="w-4 h-4" /> Project Manager
            </Button>
            <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => quickLogin("purchasing@steelos.dev", "password123")}>
              <Package className="w-4 h-4" /> Purchasing
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={LogIn}
      logoUrl={company?.logo_url}
      title={company?.name || "Welcome back"}
      subtitle="Log in to your account"
      footer={
        <button type="button" onClick={handleChangeCompany} className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" />Not {company?.name}? Change company code
        </button>
      }
    >
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
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
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
    </AuthLayout>
  );
}
