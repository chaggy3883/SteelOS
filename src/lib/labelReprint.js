// Identifies print_label_jobs rows that were printed through
// PrintableLabelSheet.jsx's old window.print()-of-a-lucide-icon path — a
// placeholder glyph, not an encoded QR (see labelQr.js/labelPdf.js for the
// fix). Every such label is physically unscannable and needs reprinting on
// the new PDF path.
//
// There is no flag on the row itself distinguishing old vs. new prints, so
// this is a point-in-time cutoff: every entity record is unconditionally
// stamped with created_date at creation (see normalizeRecord in
// src/api/localData.js), and every row created before the fix shipped went
// through the fake-icon code path, full stop.
export const LEGACY_FAKE_QR_FIX_DEPLOYED_AT = '2026-10-09T12:44:09.677Z';

// A target can have been printed more than once (reprints, re-tagging after
// a correction) — only the MOST RECENT print_label_jobs row per
// label_type+target_record_id determines whether that physical label is
// currently scannable. An older legacy row for a target that has since been
// reprinted on the new PDF path must not keep showing up here forever.
export function findLegacyUnscannableLabelJobs(printJobs) {
  const latestByTarget = new Map();
  (printJobs || []).forEach((job) => {
    const key = `${job.label_type}:${job.target_record_id}`;
    const existing = latestByTarget.get(key);
    if (!existing || (job.created_date || '') > (existing.created_date || '')) {
      latestByTarget.set(key, job);
    }
  });
  return Array.from(latestByTarget.values()).filter(
    (job) => job.status === 'Printed' && job.created_date && job.created_date < LEGACY_FAKE_QR_FIX_DEPLOYED_AT
  );
}

// Resolves a print_label_jobs row back to a human-readable target — the
// piece/manifest/remnant it was printed for — so a reprint list can be
// worked from without cross-referencing ids by hand.
export function describeLegacyLabelJobTarget(job, { pieces = [], manifests = [], remnants = [] } = {}) {
  if (job.label_type === 'Piece_Mark') {
    const piece = pieces.find((p) => p.id === job.target_record_id);
    return { name: piece?.piece_mark || job.target_record_id, detail: piece?.material_shape || '', record: piece || null };
  }
  if (job.label_type === 'Shipping_Manifest') {
    const manifest = manifests.find((m) => m.id === job.target_record_id);
    return {
      name: manifest ? `Manifest — ${manifest.driver_name || manifest.id}` : job.target_record_id,
      detail: manifest?.manifest_qr_payload_string || '',
      record: manifest || null,
    };
  }
  if (job.label_type === 'Material_Stock') {
    const remnant = remnants.find((r) => r.id === job.target_record_id);
    return {
      name: remnant?.material_shape || job.target_record_id,
      detail: [remnant?.material_grade, remnant?.dimensions].filter(Boolean).join(' — '),
      record: remnant || null,
    };
  }
  return { name: job.target_record_id, detail: '', record: null };
}
