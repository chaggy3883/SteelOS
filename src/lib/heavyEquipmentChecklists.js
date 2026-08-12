// Real OSHA/ASME checklist structure for the two inspection types that get
// a full AI-scanned checklist — Crane_Annual and Rigging_Quarterly.
// DOT_Vehicle / Trailer_Safety keep the old "date + pass/fail" shape only;
// they aren't in scope for checklist-item detail here.
//
// Tier tags aren't persisted on the record (heavy_equipment_inspections.
// checklist_items is just {item, pass, notes} per schema) — they exist only
// so this file can (a) give the AI prompt real regulatory structure to
// extract against and (b) power the "Load Standard Checklist" quick-fill.

export const CRANE_ANNUAL_CHECKLIST = [
  // Shift inspection — competent person, before each shift — 29 CFR 1926.1412(c)
  { item: 'Control mechanisms checked for maladjustments interfering with proper operation (1926.1412(c)(2))', tier: 'shift' },
  { item: 'Hydraulic/pneumatic hoses, fittings, and tubing checked for leaks and damage (1926.1412(c)(2))', tier: 'shift' },
  { item: 'Hooks and latches inspected for deformation, chemical damage, cracks, or wear (1926.1412(c)(2))', tier: 'shift' },
  { item: 'Wire rope reeving checked against manufacturer specifications (1926.1412(c)(2))', tier: 'shift' },
  { item: 'Electrical apparatus checked for malfunction, excessive deterioration, dirt, or moisture accumulation (1926.1412(c)(2))', tier: 'shift' },
  { item: 'Ground conditions around the equipment checked for proper support (1926.1412(c)(3))', tier: 'shift' },
  { item: 'Level of the equipment checked (1926.1412(c)(3))', tier: 'shift' },
  // Monthly inspection — competent person, documented, records retained 3 months — 1926.1412(d)
  { item: 'Structural members and boom checked for deformation, cracks, or corrosion (1926.1412(d))', tier: 'monthly' },
  { item: 'Bolts or rivets checked for looseness (1926.1412(d))', tier: 'monthly' },
  { item: 'Sheaves and drums checked for cracks or excessive wear (1926.1412(d))', tier: 'monthly' },
  { item: 'Brake and clutch system components checked for excessive wear (1926.1412(d))', tier: 'monthly' },
  { item: 'Safety devices (anti-two-block, boom hoist limiter, load moment indicator) function-tested (1926.1412(d))', tier: 'monthly' },
  { item: 'Power plant checked for malfunction and improper performance (1926.1412(d))', tier: 'monthly' },
  // Annual / comprehensive inspection — qualified person, documented — 1926.1412(e)-(f)
  { item: 'Complete structural inspection of members and connections for deformation, cracks, or corrosion (1926.1412(e))', tier: 'annual' },
  { item: 'All fasteners (bolts, nuts, pins) checked for looseness or missing hardware (1926.1412(e))', tier: 'annual' },
  { item: 'Gears, bearings, bushings, and pins checked for excessive wear (1926.1412(e))', tier: 'annual' },
  { item: 'Rated capacity indicators, load/boom angle indicators, and operational aids function-tested (1926.1412(e))', tier: 'annual' },
  { item: 'Hydraulic/pneumatic pumps and motors checked for loose bolts and leakage (1926.1412(e))', tier: 'annual' },
  // Wire rope removal criteria — 29 CFR 1926.1413
  { item: 'Wire rope free of 6 randomly distributed broken wires in one lay, or 3 broken wires in one strand in one lay (1926.1413(a)(1))', tier: 'wire_rope' },
  { item: 'No broken wires at end connections (1926.1413(a)(2))', tier: 'wire_rope' },
  { item: 'Outer wire wear does not exceed one-third of original outer wire diameter (1926.1413(a)(3))', tier: 'wire_rope' },
  { item: 'No kinking, crushing, bird-caging, or core protrusion distorting the rope structure (1926.1413(a)(4))', tier: 'wire_rope' },
  { item: 'No evidence of heat damage from any cause (1926.1413(a)(5))', tier: 'wire_rope' },
  { item: 'Diameter reduction from nominal does not exceed manufacturer limits for the rope type (1926.1413(a)(6))', tier: 'wire_rope' },
];

export const RIGGING_QUARTERLY_CHECKLIST = [
  // Daily / before-each-use — competent person — 29 CFR 1926.251(a)(6)
  { item: 'Sling and all fasteners visually inspected for damage before use each shift (1926.251(a)(6))', tier: 'daily' },
  { item: 'Any damaged or defective sling immediately removed from service (1926.251(a)(6))', tier: 'daily' },
  { item: 'Sling identification/capacity tag present and legible (ASME B30.9)', tier: 'daily' },
  // Periodic recorded inspection — qualified person, interval by service severity — ASME B30.9
  { item: 'Periodic inspection performed at an interval based on service severity and documented (ASME B30.9)', tier: 'periodic' },
  { item: 'Hardware (hooks, rings, links, master links) checked for distortion, cracks, or excessive wear (ASME B30.9)', tier: 'periodic' },
  { item: 'Sling checked for excessive wear developing at fold or contact points (ASME B30.9)', tier: 'periodic' },
  // Removal criteria — Wire Rope Slings — ASME B30.9 Ch.5-2 / 1926.251(c)
  { item: 'Wire rope sling free of 10 randomly distributed broken wires in one lay, or 5 in one strand in one lay (1926.251(c)(4))', tier: 'wire_rope_sling' },
  { item: 'Outer wire wear does not exceed one-third of original outer wire diameter (1926.251(c)(4))', tier: 'wire_rope_sling' },
  { item: 'No kinking, crushing, or bird-caging of the rope structure (1926.251(c)(4))', tier: 'wire_rope_sling' },
  { item: 'End attachments free of cracks, deformation, or excessive wear (1926.251(c)(4))', tier: 'wire_rope_sling' },
  // Removal criteria — Chain Slings — ASME B30.9 Ch.3-2 / 1926.251(b)
  { item: 'Chain link wear does not exceed 10% of original link diameter at any point (1926.251(b)(2))', tier: 'chain_sling' },
  { item: 'No cracks, nicks, gouges, or heat-discoloration on links (1926.251(b)(2))', tier: 'chain_sling' },
  { item: 'No stretch beyond manufacturer allowable limit or visibly elongated links (ASME B30.9 Ch.3-2)', tier: 'chain_sling' },
  { item: 'No bent, twisted, or otherwise deformed links or master links (1926.251(b)(2))', tier: 'chain_sling' },
  // Removal criteria — Synthetic Web/Round Slings — ASME B30.9 Ch.9/10 / 1926.251(d)
  { item: 'No acid or caustic burns present (1926.251(d)(2))', tier: 'synthetic_sling' },
  { item: 'No melting, charring, or weld spatter on any part of the sling (1926.251(d)(2))', tier: 'synthetic_sling' },
  { item: 'No holes, tears, cuts, snags, or broken/worn stitching (1926.251(d)(2))', tier: 'synthetic_sling' },
  { item: 'No excessive abrasive wear or broken/worn fibers (1926.251(d)(2))', tier: 'synthetic_sling' },
  { item: 'No knots in any part of the sling (1926.251(d)(2))', tier: 'synthetic_sling' },
  { item: 'Capacity tag present, legible, and not embrittled/discolored from chemical or UV exposure (ASME B30.9)', tier: 'synthetic_sling' },
];

export const CHECKLIST_BY_TYPE = {
  Crane_Annual: CRANE_ANNUAL_CHECKLIST,
  Rigging_Quarterly: RIGGING_QUARTERLY_CHECKLIST,
};

// Both checklist types here represent the formal, recorded inspection (the
// annual/comprehensive crane tier, and the periodic/recorded rigging tier)
// which OSHA/ASME both put at the qualified-person bar — the daily/shift/
// monthly tiers are competent-person tasks and aren't separately recorded.
export const REQUIRED_PERSON_TIER = {
  Crane_Annual: 'qualified',
  Rigging_Quarterly: 'qualified',
};

export function getRequiredPersonTier(inspectionType) {
  return REQUIRED_PERSON_TIER[inspectionType] || null;
}

// 29 CFR 1926.32(f) competent person vs 1926.32(m) qualified person — flags
// when a record's signer tier doesn't meet the bar its inspection type requires.
export function getPersonTierMismatch(inspectionType, competentPerson, qualifiedPerson) {
  const required = getRequiredPersonTier(inspectionType);
  if (!required) return null;
  if (required === 'qualified' && !qualifiedPerson) {
    const typeLabel = inspectionType.replace(/_/g, ' ');
    return competentPerson
      ? `${typeLabel} requires sign-off by a Qualified Person (29 CFR 1926.32(m)) — this record indicates only Competent Person (1926.32(f)) status.`
      : `${typeLabel} requires sign-off by a Qualified Person (29 CFR 1926.32(m)) — no person tier was recorded for this inspection.`;
  }
  return null;
}

const DEFAULT_VALIDITY_DAYS = {
  Crane_Annual: 365,
  DOT_Vehicle: 365,
  Trailer_Safety: 365,
  Rigging_Quarterly: 91,
};

export function computeExpirationDate(inspectionType, executedDate) {
  if (!executedDate) return '';
  const d = new Date(executedDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (DEFAULT_VALIDITY_DAYS[inspectionType] || 365));
  return d.toISOString().slice(0, 10);
}
