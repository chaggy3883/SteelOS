import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Lock, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { buildZplPayload, LABEL_STOCK_SIZES } from '@/lib/zplLabels';
import { findLegacyUnscannableLabelJobs, describeLegacyLabelJobTarget } from '@/lib/labelReprint';
import LabelStagingQueue from '@/components/barcode-printing/LabelStagingQueue';
import ThermalFormatDesigner from '@/components/barcode-printing/ThermalFormatDesigner';
import PrintTestKiosk from '@/components/barcode-printing/PrintTestKiosk';
import PrintableLabelSheet from '@/components/barcode-printing/PrintableLabelSheet';
import { Button } from '@/components/ui/button';

const MANAGER_ROLES = ['admin', 'super_admin', 'shop_manager'];

export default function LabelPrintingPanel({ pieces, manifests, remnants = [], printJobs, onReload }) {
  const { user } = useAuth();
  const [selectedLabelType, setSelectedLabelType] = useState('Piece_Mark');
  const [sheet, setSheet] = useState(null);

  const isManager = (user?.roles || []).some((r) => MANAGER_ROLES.includes(r));

  // Rows still showing a Printed status from before the real-QR fix
  // (PrintableLabelSheet.jsx used to print a placeholder icon, not an
  // encoded QR) — see labelReprint.js. Those physical labels can't be
  // scanned and need to be reprinted on the new PDF path. Computed above
  // the role-gate return below so this hook always runs in the same order.
  const legacyJobs = useMemo(() => findLegacyUnscannableLabelJobs(printJobs), [printJobs]);

  if (!isManager) {
    return (
      <div className="steel-card p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <Lock className="w-6 h-6" />
        Label printing is restricted to shop managers and admins.
      </div>
    );
  }

  const openSheet = ({ labelType, title, subtitle, qrPayload, targetRecordId }) => {
    setSheet({ size: LABEL_STOCK_SIZES[labelType], labelType, title, subtitle, qrPayload, targetRecordId });
  };

  const recordPrintJob = async ({ labelType, targetRecordId, title, subtitle, qrPayload }) => {
    if (!targetRecordId) return;
    const zpl_payload_string = buildZplPayload({ labelType, title, subtitle, qrPayload });
    await db.entities.print_label_jobs.create({
      label_type: labelType,
      target_record_id: targetRecordId,
      zpl_payload_string,
      status: 'Printed',
      created_at: new Date().toISOString(),
    });
    await onReload();
  };

  const handlePrintPiece = (piece) => {
    openSheet({
      labelType: 'Piece_Mark',
      title: piece.piece_mark,
      subtitle: piece.material_shape,
      qrPayload: piece.qr_payload_string,
      targetRecordId: piece.id,
    });
  };

  const handlePrintManifest = (manifest) => {
    openSheet({
      labelType: 'Shipping_Manifest',
      title: 'Master Shipping Manifest',
      subtitle: manifest.driver_name,
      qrPayload: manifest.manifest_qr_payload_string,
      targetRecordId: manifest.id,
    });
  };

  const handlePrintTest = ({ labelType, title, subtitle, qrPayload }) => {
    openSheet({ labelType, title, subtitle, qrPayload, targetRecordId: null });
  };

  const handlePrinted = () => {
    if (sheet?.targetRecordId) {
      recordPrintJob(sheet);
    }
  };

  const handleReprintLegacy = (job) => {
    if (job.label_type === 'Piece_Mark') {
      const piece = pieces.find((p) => p.id === job.target_record_id);
      if (piece) handlePrintPiece(piece);
      return;
    }
    if (job.label_type === 'Shipping_Manifest') {
      const manifest = manifests.find((m) => m.id === job.target_record_id);
      if (manifest) handlePrintManifest(manifest);
    }
  };

  return (
    <div className="space-y-4">
      {legacyJobs.length > 0 && (
        <div className="steel-card p-4 border-amber-500/40 bg-amber-500/5">
          <h4 className="font-semibold text-sm mb-1 flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4" />Needs Reprint — {legacyJobs.length} label{legacyJobs.length === 1 ? '' : 's'} not scannable
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            These were printed before the QR fix and only show a placeholder icon on the physical label, not a real scannable code.
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {legacyJobs.map((job) => {
              const target = describeLegacyLabelJobTarget(job, { pieces, manifests, remnants });
              const canReprintHere = job.label_type === 'Piece_Mark' || job.label_type === 'Shipping_Manifest';
              return (
                <div key={job.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 p-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{target.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{job.label_type.replace('_', ' ')}{target.detail ? ` — ${target.detail}` : ''}</p>
                  </div>
                  {canReprintHere ? (
                    <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => handleReprintLegacy(job)}>Reprint</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground flex-shrink-0">Reprint from Leftover Material Inventory</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LabelStagingQueue
        pieces={pieces}
        manifests={manifests}
        printJobs={printJobs}
        onPrintPiece={handlePrintPiece}
        onPrintManifest={handlePrintManifest}
      />
      <ThermalFormatDesigner selectedLabelType={selectedLabelType} onSelectLabelType={setSelectedLabelType} />
      <PrintTestKiosk selectedLabelType={selectedLabelType} onPrintTest={handlePrintTest} />

      <PrintableLabelSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        onPrinted={handlePrinted}
        size={sheet?.size || LABEL_STOCK_SIZES.Piece_Mark}
        title={sheet?.title}
        subtitle={sheet?.subtitle}
        qrPayload={sheet?.qrPayload}
      />
    </div>
  );
}
