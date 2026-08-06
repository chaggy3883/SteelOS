import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Sparkles } from 'lucide-react';
import { seedDemoData } from '@/lib/demoDataSeeder';

export default function DemoDataPanel() {
  const { toast } = useToast();
  const [seeding, setSeeding] = useState(false);

  const handleLoadDemoData = async () => {
    setSeeding(true);
    try {
      const result = await seedDemoData();
      if (result?.skipped) {
        toast({ title: 'Demo data load cancelled' });
        return;
      }
      toast({
        title: 'Demo data loaded!',
        description: `Created ${result.counts.bids} bids, ${result.counts.projects} projects, ${result.counts.employees} employees, and supporting job cost, cash, close, budget, and AP/AR records.`,
      });
    } catch (e) {
      toast({ title: 'Failed to load demo data', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="steel-card p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Load Demo Data</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Populates this company with realistic, interconnected example data — bids, projects, employees, job costing,
          bank accounts, month-end close, budget, and AP/AR records — for demos and walkthroughs. Running it again on
          top of existing data will add duplicates rather than replace anything.
        </p>
        <Button onClick={handleLoadDemoData} disabled={seeding} className="steel-gradient text-white border-0">
          {seeding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
          {seeding ? 'Loading Demo Data…' : 'Load Demo Data'}
        </Button>
      </div>
    </div>
  );
}
