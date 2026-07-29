import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Factory, CreditCard, CalendarCheck, ShieldCheck, Gauge, Radar, Truck, ArrowRight,
} from 'lucide-react';

const FEATURES = [
  { icon: Factory, title: 'Shop Floor to Field', description: 'One system from takeoff through fabrication, erection, and hook-time logging — no spreadsheets stitching modules together.' },
  { icon: Gauge, title: 'Certified Multi-Scale Payroll', description: 'Shop and field labor priced on their own wage scales, with daily/weekly overtime computed automatically.' },
  { icon: Radar, title: 'OSHA/DOT Compliance Radar', description: '30-day expiration alerts on crane, DOT, and rigging inspections — with a hard dispatcher block on expired gear.' },
  { icon: Truck, title: 'Fleet & Rental Tracking', description: 'Owned and third-party rented equipment in one registry, with off-rent pickup alerts.' },
];

const emptyDemoForm = () => ({ company_name: '', annual_ton_capacity: '', contact_name: '', contact_email: '', contact_phone: '' });

export default function LandingPage() {
  const { toast } = useToast();
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [showBillingStub, setShowBillingStub] = useState(false);
  const [demoForm, setDemoForm] = useState(emptyDemoForm());
  const [saving, setSaving] = useState(false);

  const submitDemoRequest = async () => {
    if (!demoForm.company_name.trim() || !demoForm.contact_email.trim()) {
      toast({ title: 'Company name and contact email are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.demo_requests.create({
        company_name: demoForm.company_name.trim(),
        annual_ton_capacity: Number(demoForm.annual_ton_capacity) || 0,
        contact_name: demoForm.contact_name.trim(),
        contact_email: demoForm.contact_email.trim(),
        contact_phone: demoForm.contact_phone.trim(),
        status: 'New',
        created_at: new Date().toISOString(),
      });
      setShowDemoForm(false);
      setDemoForm(emptyDemoForm());
      toast({ title: 'Request received', description: "We'll reach out to schedule your live demo & training consultation." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <span className="w-8 h-8 rounded-lg steel-gradient flex items-center justify-center text-white text-sm">OS</span>
            SteelOS
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setShowBillingStub(true)}>
              <CreditCard className="w-4 h-4" />Client Account Portal
            </Button>
            <Link to="/login"><Button className="steel-gradient text-white border-0">Log In</Button></Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-20 md:py-28 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          SteelOS: The Monolith Operating System<br className="hidden md:block" /> for Structural Steel Fabrication &amp; Erection
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
          Estimating, shop fabrication, field erection, fleet maintenance, and certified payroll — unified in one platform built for structural steel contractors.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button size="lg" className="gap-2 steel-gradient text-white border-0 h-12 px-6" onClick={() => setShowDemoForm(true)}>
            <CalendarCheck className="w-5 h-5" />Book a Live Demo &amp; Training Consultation
          </Button>
          <Link to="/login">
            <Button size="lg" variant="outline" className="gap-2 h-12 px-6">
              Existing Customer Log In<ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="steel-card p-6">
            <f.icon className="w-8 h-8 text-primary mb-3" />
            <h3 className="font-semibold mb-1.5">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.description}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <ShieldCheck className="w-4 h-4 inline mr-1.5" />SteelOS — built for structural steel fabricators and erectors.
      </footer>

      <Dialog open={showDemoForm} onOpenChange={setShowDemoForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Book a Live Demo &amp; Training Consultation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Company Name</Label>
              <Input value={demoForm.company_name} onChange={(e) => setDemoForm((f) => ({ ...f, company_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Annual Ton Capacity</Label>
              <Input type="number" value={demoForm.annual_ton_capacity} onChange={(e) => setDemoForm((f) => ({ ...f, annual_ton_capacity: e.target.value }))} className="mt-1" placeholder="e.g. 12000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact Name</Label>
                <Input value={demoForm.contact_name} onChange={(e) => setDemoForm((f) => ({ ...f, contact_name: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input value={demoForm.contact_phone} onChange={(e) => setDemoForm((f) => ({ ...f, contact_phone: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input type="email" value={demoForm.contact_email} onChange={(e) => setDemoForm((f) => ({ ...f, contact_email: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDemoForm(false)}>Cancel</Button>
            <Button onClick={submitDemoRequest} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Sending…' : 'Request Demo'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBillingStub} onOpenChange={setShowBillingStub}>
        <DialogContent>
          <DialogHeader><DialogTitle>Client Account Portal</DialogTitle></DialogHeader>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 text-sm">
            <CreditCard className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              This button would hand off to Stripe's hosted invoice payment portal in production. No live Stripe integration
              exists in this demo — this is a placeholder, not a real payment link.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowBillingStub(false)} className="steel-gradient text-white border-0">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
