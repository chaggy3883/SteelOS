import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, X, FileText, Link as LinkIcon, ChevronDown, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { openDocumentViewer, isViewableDocumentName, documentRef } from '@/lib/openDocumentViewer';
import { resolveDocumentUrl } from '@/lib/documentBlobStore';
import { downloadFile } from '@/lib/downloadFile';
import { SCOPE_VENDOR_ROLES, scopeVendorFor, quoteName } from '@/components/projects/turnoverReviewShared';

// Who the job is using for each outside scope (Detailing, Erection, Joist &
// Deck, Miscellaneous, Rolling, Steel Material) and the quote they're held to.
// The vendor can be typed or picked from the won estimate's Vendor Pricing for
// that scope; the quote is attached by reference to the estimate's own file
// (or its Vendor Pricing cost-sheet link) — never copied, so there's still
// only one copy of it.
//
// A quote reference: { kind: 'document', id, name } | { kind: 'link', id, url, name }.

const sameQuote = (a, b) => a.kind === b.kind && (a.kind === 'document' ? a.id === b.id : a.url === b.url);

export default function ScopeVendorsCard({ record, readOnly, onChange, vendorsByName, estimate, pricingLinks, estimateDocs }) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Estimate files, quotes first.
  const docs = [...(estimateDocs || [])].sort((a, b) => {
    const qa = a.document_type === 'vendor_quote' ? 0 : 1;
    const qb = b.document_type === 'vendor_quote' ? 0 : 1;
    return qa - qb || String(a.name || a.file_name).localeCompare(String(b.name || b.file_name));
  });

  const openQuote = async (q) => {
    if (q.kind === 'link') {
      if (q.url) window.open(q.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const doc = (estimateDocs || []).find((d) => d.id === q.id);
    const fileName = doc?.file_name || q.file_name || q.name;
    if (isViewableDocumentName(fileName)) { openDocumentViewer(documentRef(q.id), fileName); return; }
    const url = await resolveDocumentUrl(doc || { id: q.id });
    if (!url) { toast({ title: 'This file is not stored in this browser', variant: 'destructive' }); return; }
    downloadFile(url, fileName);
  };

  const setRow = (roleKey, patch) => {
    const current = scopeVendorFor(record, roleKey);
    onChange(roleKey, { ...current, ...patch });
  };
  const attach = (roleKey, quote) => {
    const current = scopeVendorFor(record, roleKey);
    if (current.quotes.some((q) => sameQuote(q, quote))) return;
    onChange(roleKey, { ...current, quotes: [...current.quotes, quote] });
  };
  const detach = (roleKey, index) => {
    const current = scopeVendorFor(record, roleKey);
    onChange(roleKey, { ...current, quotes: current.quotes.filter((_, i) => i !== index) });
  };
  const linkQuote = (link) => (link.cost_sheet_url
    ? { kind: 'link', id: link.id, url: link.cost_sheet_url, name: `${link.vendor_name || 'Vendor'} quote` }
    : null);
  const pickEstimateVendor = (roleKey, link) => {
    const current = scopeVendorFor(record, roleKey);
    const q = linkQuote(link);
    const quotes = q && !current.quotes.some((x) => sameQuote(x, q)) ? [...current.quotes, q] : current.quotes;
    onChange(roleKey, { ...current, vendor_name: link.vendor_name || current.vendor_name, quotes });
  };

  return (
    <div className="steel-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-semibold">Subcontractors &amp; Suppliers</h4>
        {estimate && (
          <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1"
            onClick={() => window.open(`/estimating/${estimate.id}`, '_blank', 'noopener,noreferrer')}>
            Estimate {estimate.bid_number || ''} <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {estimate
          ? "Who we're using on this job, and their quote from the estimate. Leave a row blank if it's not part of the job."
          : 'No estimate is linked to this project, so quotes can’t be attached from one — vendor names can still be entered.'}
      </p>

      <div className="divide-y divide-border">
        {SCOPE_VENDOR_ROLES.map((role) => {
          const row = scopeVendorFor(record, role.key);
          const matched = vendorsByName.get(String(row.vendor_name || '').trim().toLowerCase());
          const catLinks = (pricingLinks || []).filter((l) => l.procurement_category === role.category)
            .sort((a, b) => Number(!!b.is_approved) - Number(!!a.is_approved));
          const linkQuotes = catLinks.map(linkQuote).filter(Boolean);
          const canAttach = !readOnly && estimate && (linkQuotes.length || docs.length);
          return (
            <div key={role.key} className="py-3 grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)] gap-2 md:gap-4" data-scope-role={role.key}>
              <div className="text-sm font-medium pt-2">{role.label}</div>
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.vendor_name || ''}
                    placeholder={`Who's doing ${role.label.toLowerCase()}?`}
                    onChange={(e) => setRow(role.key, { vendor_name: e.target.value })}
                    disabled={readOnly}
                    className="h-9"
                    aria-label={`${role.label} vendor`}
                  />
                  {!readOnly && catLinks.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 shrink-0">From estimate <ChevronDown className="w-3.5 h-3.5 ml-1" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuLabel className="text-xs">Estimate vendor pricing — {role.label}</DropdownMenuLabel>
                        {catLinks.map((l) => (
                          <DropdownMenuItem key={l.id} onSelect={() => pickEstimateVendor(role.key, l)}>
                            <span className="flex-1 truncate">{l.vendor_name || 'Unnamed vendor'}</span>
                            {l.is_approved && <span className="text-[10px] text-green-600 ml-2">Approved</span>}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {canAttach ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 shrink-0"><Paperclip className="w-3.5 h-3.5 mr-1" />Attach quote</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-80 max-h-80 overflow-y-auto">
                        {linkQuotes.length > 0 && (
                          <>
                            <DropdownMenuLabel className="text-xs">Vendor pricing — {role.label}</DropdownMenuLabel>
                            {linkQuotes.map((q) => (
                              <DropdownMenuItem key={`l-${q.id}`} disabled={row.quotes.some((x) => sameQuote(x, q))} onSelect={() => attach(role.key, q)}>
                                <LinkIcon className="w-3.5 h-3.5 mr-2 shrink-0" /><span className="truncate">{q.name}</span>
                              </DropdownMenuItem>
                            ))}
                            {docs.length > 0 && <DropdownMenuSeparator />}
                          </>
                        )}
                        {docs.length > 0 && <DropdownMenuLabel className="text-xs">Estimate files</DropdownMenuLabel>}
                        {docs.map((d) => {
                          const q = { kind: 'document', id: d.id, name: d.name || d.file_name, file_name: d.file_name };
                          return (
                            <DropdownMenuItem key={d.id} disabled={row.quotes.some((x) => sameQuote(x, q))} onSelect={() => attach(role.key, q)}>
                              <FileText className="w-3.5 h-3.5 mr-2 shrink-0" />
                              <span className="truncate flex-1">{d.name || d.file_name}</span>
                              {d.document_type === 'vendor_quote' && <span className="text-[10px] text-muted-foreground ml-2">Quote</span>}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                {matched && (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => navigate(`/crm/directory?vendor=${matched.id}`)}>
                    View Vendor record →
                  </button>
                )}
                {row.quotes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.quotes.map((q, i) => (
                      <span key={`${q.kind}-${q.id || q.url}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 py-0.5 text-xs max-w-full">
                        {q.kind === 'link' ? <LinkIcon className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
                        <button type="button" className="truncate hover:underline text-left" title="Open quote" onClick={() => openQuote(q)}>{quoteName(q)}</button>
                        {!readOnly && (
                          <button type="button" className="p-0.5 rounded hover:bg-muted" title="Remove quote" aria-label={`Remove ${quoteName(q)}`} onClick={() => detach(role.key, i)}>
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
