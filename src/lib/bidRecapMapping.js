// Maps a Bid record + accepted blueprint-takeoff rows onto the verified
// input-cell map for Bid_Proposal_Template.xlsx. Every cell reference here
// was cross-checked against the real template's cell contents and merged
// ranges (several in the original spec turned out to be label cells, not
// inputs — see RECAP!A9/A10/H11 and Addtn'l (AKP)!B10/B19 corrections).
// Only writes a cell when there's an honest source for it — the rest of
// the template's manual-entry cells (Bolts/Fasteners, Anchor Bolts, Labor
// hours, Outsourced $, J&D, Allowance, Misc. materials, Procore/Textura,
// FOB-or-Erected) have no equivalent anywhere in this app yet and are left
// for the estimator to fill in Excel, same as today.
const KNOWN_RECAP_ESTIMATORS = ['Bill Holfreter', 'Paul Hostetter']; // must match RECAP!A56:A57 — update if that roster changes
const LEED_TIERS = ['Certified', 'Silver', 'Gold', 'Platinum', 'Government', 'N/A'];
const STATE_TO_JURISDICTION = { indiana: 'Indiana', in: 'Indiana', kentucky: 'Kentucky', ky: 'Kentucky', michigan: 'Michigan', mi: 'Michigan' };

const resolveEstimatorName = (fullName) =>
  KNOWN_RECAP_ESTIMATORS.find((n) => n.toLowerCase() === String(fullName || '').trim().toLowerCase()) || null;

const resolveLeedTier = (value) =>
  LEED_TIERS.find((v) => v.toLowerCase() === String(value || '').trim().toLowerCase()) || null;

// Only returns a jurisdiction when there's a confident match — an
// unrecognized state/city is left blank rather than guessed, since a wrong
// sales-tax jurisdiction on a live bid is a real compliance risk.
const resolveTaxJurisdiction = (bid) => {
  if (!bid?.tax_enabled) return 'Tax Exempt';
  const city = String(bid.job_city || bid.city || '').trim().toLowerCase();
  const state = String(bid.job_state || bid.state || '').trim().toLowerCase();
  if (state === 'ut' || state === 'utah') {
    if (city === 'american fork') return 'UT: American Fork';
    if (city === 'heber city') return 'UT: Heber City';
    return null;
  }
  return STATE_TO_JURISDICTION[state] || null;
};

// PL-Plate rows go to the template's preset "Plate Summary" row; every
// other takeoff shape class (W-Beam, HSS, Channel, Angle) goes to
// "Structural Material Package" — the only two of the sheet's ten category
// rows this takeoff tool has any shape-level signal to distinguish.
const structuralBucket = (shapeClass) => (shapeClass === 'PL-Plate' ? 5 : 4);

export function buildBidRecapWrites({ bid, estimatorFullName, acceptedRows, catalog, rowPaintAreaSqIn }) {
  const structural = {};
  for (const r of acceptedRows) {
    const weight = (r.quantity || 0) * (r.unit_weight_lbs_per_ft || 0) * (r.length_ft || 0);
    if (!weight) continue;
    const bucket = structuralBucket(r.shape_class);
    const key = r.coating_type === 'Paint' ? `B${bucket}` : r.coating_type === 'Galvanized' ? `C${bucket}` : null;
    if (!key) continue;
    structural[key] = (structural[key] || 0) + weight;
  }

  const totalPaintSqIn = acceptedRows.reduce((sum, r) => sum + rowPaintAreaSqIn(r, catalog), 0);

  const recap = {};
  if (totalPaintSqIn > 0) recap.F17 = totalPaintSqIn / 144; // template wants sq ft, we compute sq in
  if (bid?.bid_number) recap.K1 = bid.bid_number;
  if (bid?.customer_name) recap.C9 = bid.customer_name;
  if (bid?.job_name) recap.C10 = bid.job_name;
  if (bid?.street) recap.I9 = bid.street;
  const cityState = [bid?.job_city || bid?.city, bid?.job_state || bid?.state].filter(Boolean).join(', ');
  if (cityState) recap.I10 = cityState;
  const estimatorMatch = resolveEstimatorName(estimatorFullName);
  if (estimatorMatch) recap.K3 = estimatorMatch;

  const addtnlAkp = {};
  if (typeof bid?.insurance_enabled === 'boolean') {
    const flag = bid.insurance_enabled ? 'Y' : 'N';
    addtnlAkp.B4 = flag;
    addtnlAkp.B5 = flag;
    addtnlAkp.B6 = flag;
  }
  if (bid?.insurance_general_liability != null) addtnlAkp.C4 = bid.insurance_general_liability;
  if (bid?.insurance_umbrella != null) addtnlAkp.C5 = bid.insurance_umbrella;
  if (bid?.insurance_professional_liability != null) addtnlAkp.C6 = bid.insurance_professional_liability;
  if (typeof bid?.bond_enabled === 'boolean') addtnlAkp.B11 = bid.bond_enabled ? 'Y' : 'N';
  const leed = resolveLeedTier(bid?.leed_level_override);
  if (leed) addtnlAkp.B24 = leed;
  const jurisdiction = resolveTaxJurisdiction(bid);
  if (jurisdiction) addtnlAkp.B34 = jurisdiction;

  const sheetWrites = {};
  if (Object.keys(structural).length) sheetWrites.Structural = structural;
  if (Object.keys(recap).length) sheetWrites.RECAP = recap;
  if (Object.keys(addtnlAkp).length) sheetWrites["Addtn'l (AKP)"] = addtnlAkp;
  return sheetWrites;
}
