import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Lock } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { buildZplPayload, LABEL_STOCK_SIZES } from '@/lib/zplLabels';
import LabelStagingQueue from '@/components/barcode-printing/LabelStagingQueue';
import ThermalFormatDesigner from '@/components/barcode-printing/ThermalFormatDesigner';
import PrintTestKiosk from '@/components/barcode-printing/PrintTestKiosk';
import PrintableLabelSheet from '@/components/barcode-printing/PrintableLabelSheet';

const MANAGER_ROLES = ['admin', 'super_admin', 'shop_manager'];

export default function LabelPrintingPanel({ pieces, manifests, printJobs, onReload }) {
  const { user } = useAuth();
  const [selectedLabelType, setSelectedLabelType] = useState('Piece_Mark');
  const [sheet, setSheet] = useState(null);

  const isManager = (user?.roles || []).some((r) => MANAGER_ROLES.includes(r));

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
    await base44.entities.print_label_jobs.create({
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

  return (
    <div className="space-y-4">
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
