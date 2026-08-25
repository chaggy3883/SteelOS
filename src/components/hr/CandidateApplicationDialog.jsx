import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Printer } from 'lucide-react';
import { exportNodeToPdf } from '@/lib/exportNodeToPdf';

export default function CandidateApplicationDialog({ candidate, open, onOpenChange }) {
  const printRef = useRef(null);
  if (!candidate) return null;

  const handleExportPdf = () => {
    exportNodeToPdf(printRef.current, `${candidate.candidate_name || 'candidate'}-application.pdf`);
  };

  const rows = [
    ['Candidate Name', candidate.candidate_name],
    ['Email', candidate.email],
    ['Phone', candidate.phone],
    ['Position Applied', candidate.position_applied],
    ['Status', candidate.status ? candidate.status.replace(/_/g, ' ') : ''],
    ['Applied Date', candidate.applied_date],
    ...(candidate.status === 'Hired' ? [['Hire Date', candidate.hire_date]] : []),
    ...(candidate.status === 'Rejected' ? [['Rejected Date', candidate.rejection_date], ['Rejection Reason', candidate.rejection_reason]] : []),
    ['Notes', candidate.notes],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Candidate Application</DialogTitle></DialogHeader>
        <div ref={printRef} className="space-y-2.5">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="col-span-2 font-medium whitespace-pre-wrap">{value || '—'}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2 print:hidden">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPdf}>
            <Download className="w-3.5 h-3.5" />Export to PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5" />Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
