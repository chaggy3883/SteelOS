import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { db } from '@/api/apiClient';
import { Save, Info, Upload, Pencil, Truck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { computeEffectiveTaxRate, getJoistDeckTaxRate, buildTaxRateInput, getTaxDisplayLabel } from '@/lib/taxRate';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { calculateDistance, isGoogleMapsConfigured } from '@/lib/googleMapsService';
import { isPeriodLocked, formatPeriodLabel } from '@/lib/periodLock';

// No DeliveryPricingTier is tagged with a CostCode, so the ledger posting
// buckets the selected code into JobCostLedgerEntry's fixed MAT/SUB/EQP/LAB
// cost_class by keyword — delivery/freight has no dedicated class in that
// enum, so it defaults to MAT (closest existing bucket, matching how
// jobsite_freight already lives next to structural_material above).
const inferCostClassFromCodeName = (codeName) => {
  const upper = (codeName || '').toUpperCase();
  if (upper.includes('LABOR')) return 'LAB';
  if (upper.includes('EQUIP')) return 'EQP';
  if (upper.includes('SUBCONTRACT')) return 'SUB';
  return 'MAT';
};

const joinAddressParts = (parts) => parts.filter(Boolean).join(', ');

// A company whose pack doesn't include the Fabrication module (see
// modulePacks.js — Erector-only companies have no shop) still initializes
// and saves these categories normally, so pre-existing line data is never
// lost; they're just not rendered in the takeoff form for that company.
const FABRICATION_ONLY_CATEGORIES = ['structural_material', 'structural_fabrication', 'shop_priming'];

// cost_code follows the company's real Division 05 / 17 numbering scheme
// (from the reference estimate audit); null means the category has no
// assigned code there and is a SteelOS-specific addition — left open rather
// than inventing a number. default_markup_pct pre-fills a brand-new line's
// markup_percentage (see loadLines) — categories not in the reference
// estimate default to 10% and are flagged below as needing confirmation.
export const COST_CATEGORIES = [
  { key: 'detailing', label: 'Detailing', unit: 'lot', inputMode: 'flat', priceLabel: 'Flat Price', cost_code: '05-010', default_markup_pct: 35 },
  { key: 'engineering', label: 'Engineering', unit: 'lot', inputMode: 'flat', priceLabel: 'Flat Price', cost_code: '05-011', default_markup_pct: 35 },
  { key: 'bim', label: 'BIM', unit: 'ea', qtyLabel: 'Qty', rateLabel: 'Rate/Each', cost_code: '05-012', default_markup_pct: 10 },
  { key: 'structural_material', label: 'Structural Material', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: '05-105', default_markup_pct: 10 },
  { key: 'bolts_fasteners', label: 'Bolts / Fasteners', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: '05-106', default_markup_pct: 10 },
  { key: 'outsourced_fabrication', label: 'Outsourced Fabrication', unit: 'lot', cost_code: '05-110', default_markup_pct: 10 },
  { key: 'structural_fabrication', label: 'Structural Fabrication', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Shop Rate/Hr', cost_code: '05-121', default_markup_pct: 10 },
  { key: 'galvanizing', label: 'Galvanizing', unit: 'tons', cost_code: '05-122', default_markup_pct: 10 },
  // Not in the reference estimate — no assigned code; default markup unconfirmed.
  { key: 'galvanizing_delivery', label: 'Galvanizing Delivery', unit: 'ea', qtyLabel: 'Qty', rateLabel: 'Rate/Each', cost_code: null, default_markup_pct: 10 },
  // Distinct from misc_fab_processing (scoped under Misc. Fabrication below) — a discrete steel-processing step between galvanizing and rolling.
  { key: 'processing_steel', label: 'Processing Steel', unit: 'tons', cost_code: '05-123', default_markup_pct: 10 },
  { key: 'steel_rolling', label: 'Steel Rolling', unit: 'tons', cost_code: '05-124', default_markup_pct: 10 },
  { key: 'joist_deck', label: 'Joist & Deck', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', is_taxable: false, cost_code: '05-210', default_markup_pct: 36 },
  { key: 'anchor_bolts', label: 'Anchor Bolts', unit: 'ea', cost_code: '05-301', default_markup_pct: 10 },
  // Split from the reference's single 05-302 line for finer input granularity — both halves share the code.
  { key: 'shop_priming', label: 'Shop Priming', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Shop Rate/Hr', cost_code: '05-302', default_markup_pct: 35 },
  { key: 'primer_paint', label: 'Primer (Paint)', unit: 'gal', inputMode: 'coverage', qtyLabel: 'Sq. Ft.', rateLabel: 'Price/Gallon', cost_code: '05-302', default_markup_pct: 35 },
  { key: 'grating', label: 'Grating', unit: 'sqft', cost_code: '05-303', default_markup_pct: 10 },
  { key: 'outsourced_paint', label: 'Outsourced Paint', unit: 'tons', cost_code: '05-305', default_markup_pct: 10 },
  { key: 'outsourced_shot_blasting', label: 'Outsourced Shot Blasting', unit: 'tons', cost_code: '05-306', default_markup_pct: 10 },
  // Load/unload labor step, distinct from the delivery/freight cost below.
  { key: 'load_unload_material', label: 'Load/Unload Material', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Rate/Hr', cost_code: '05-400', default_markup_pct: 10 },
  { key: 'jobsite_freight', label: 'Jobsite Freight (Material Delivery)', unit: 'load', cost_code: '05-401', default_markup_pct: 30 },
  // Split from the reference's single 05-500 line for finer input granularity — both halves share the code.
  { key: 'misc_fab_structural', label: 'Misc. Fab - Structural Shaping', unit: 'hrs', qtyLabel: 'Fab Hours', rateLabel: 'Fab Hourly Rate', cost_code: '05-500', default_markup_pct: 35 },
  { key: 'misc_fab_processing', label: 'Misc. Fab - Processing', unit: 'hrs', qtyLabel: 'Processing Hours', rateLabel: 'Processing Rate', cost_code: '05-500', default_markup_pct: 35 },
  { key: 'misc_material', label: 'Misc. Material', unit: 'ea', cost_code: '05-510', default_markup_pct: 35 },
  { key: 'steel_erection', label: 'Steel Erection', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', is_taxable: false, cost_code: '05-600', default_markup_pct: 10 },
  { key: 'outsourced_misc_material_erection', label: 'Outsourced Misc. Material & Erection', unit: 'lot', is_taxable: false, cost_code: '05-601', default_markup_pct: 10 },
  // Not in the reference estimate — no assigned code; default markup unconfirmed.
  { key: 'erection_labor_hours', label: 'Erection Labor Hours', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Field Rate/Hr', cost_code: null, default_markup_pct: 10 },
  { key: 'crane_rental', label: 'Crane Rental', unit: 'lot', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: null, default_markup_pct: 10 },
  { key: 'mobilization', label: 'Mobilization', unit: 'lot', inputMode: 'flat', priceLabel: 'Flat Price', cost_code: null, default_markup_pct: 10 },
  { key: 'field_rigging', label: 'Field Rigging', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Rate/Hr', cost_code: null, default_markup_pct: 10 },
  { key: 'subcontractor_other', label: 'Subcontractor Other', unit: 'lot', cost_code: '05-602', default_markup_pct: 10 },
  { key: 'allowances', label: 'Allowance(s)', unit: 'lot', cost_code: '05-999', default_markup_pct: 0 },
  { key: 'hss_contingency', label: 'HSS Contingency', unit: 'lot', cost_code: null, default_markup_pct: 10 },
  // Not in the audit's mapping/null lists either — treated the same as the other non-reference additions above pending user confirmation.
  { key: 'additional_cost_insurance', label: 'Additional Cost: Insurance', unit: 'lot', override: true, cost_code: null, default_markup_pct: 10 },
  { key: 'additional_cost_leed_govt', label: "Additional Cost: LEED / Gov't Job", unit: 'lot', override: true, cost_code: null, default_markup_pct: 10 },
];

const TakeoffEngine = forwardRef(function TakeoffEngine({ bid, onSaved }, ref) {
  const { toast } = useToast();
  const [lines, setLines] = useState({});
  const [overrides, setOverrides] = useState({
    insurance: bid?.insurance_override ?? '',
    bond: bid?.bond_override ?? '',
    procore_pay: bid?.procore_pay_override ?? '',
    textura: bid?.textura_override ?? '',
    leed_level: bid?.leed_level_override ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [docDrawerOpen, setDocDrawerOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [currentUserRoles, setCurrentUserRoles] = useState(['user']);
  const [insuranceInputs, setInsuranceInputs] = useState({
    general_liability: bid?.insurance_general_liability ?? '',
    umbrella: bid?.insurance_umbrella ?? '',
    professional_liability: bid?.insurance_professional_liability ?? '',
  });
  const [insuranceEnabled, setInsuranceEnabled] = useState(bid?.insurance_enabled ?? false);
  const [bondEnabled, setBondEnabled] = useState(bid?.bond_enabled ?? true);
  const [joistDeckTaxable, setJoistDeckTaxable] = useState(bid?.joist_deck_taxable ?? false);
  const [taxInfo, setTaxInfo] = useState({ rate: 0, source: 'manual_entry', effective_date: null, tax_zone_id: null });
  const [taxLabel, setTaxLabel] = useState('Sales Tax');
  const [dirty, setDirty] = useState(false);
  const [editingCoverageKey, setEditingCoverageKey] = useState(null);
  const [inclusions, setInclusions] = useState(bid?.inclusions || '');
  const [exclusions, setExclusions] = useState(bid?.exclusions || '');
  const [drawingsUsed, setDrawingsUsed] = useState(bid?.drawings_used || '');
  const [addendums, setAddendums] = useState(bid?.addendums || '');
  const [attentionName, setAttentionName] = useState(bid?.attention_name || '');
  const [specificationSections, setSpecificationSections] = useState(bid?.specification_sections || '');
  const [suppliedCutSheet, setSuppliedCutSheet] = useState(bid?.supplied_cut_sheet || '');
  const [pricingBasis, setPricingBasis] = useState(bid?.pricing_basis || 'fob');
  const [alternatesText, setAlternatesText] = useState(bid?.alternates_text || '');
  const [allowancesText, setAllowancesText] = useState(bid?.allowances_text || '');
  const [metalDeckSquares, setMetalDeckSquares] = useState(bid?.metal_deck_squares ?? '');
  const [steelJoistPieces, setSteelJoistPieces] = useState(bid?.steel_joist_pieces ?? '');
  const [steelJoistTons, setSteelJoistTons] = useState(bid?.steel_joist_tons ?? '');
  // bid.markup_percentage is no longer the bid-wide markup itself — each
  // line item owns its own markup % now. This only pre-fills that per-line
  // field for a new/never-saved line (see loadLines); it has no effect on
  // totals directly.
  const [markupPct, setMarkupPct] = useState(bid?.markup_percentage ?? 0);

  const [company, setCompany] = useState(null);
  const [costCodeOptions, setCostCodeOptions] = useState([]);
  const [deliveryTiers, setDeliveryTiers] = useState([]);
  const [deliveryDistance, setDeliveryDistance] = useState(bid?.delivery_distance_miles ?? null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');
  const [deliveryTripCount, setDeliveryTripCount] = useState(bid?.delivery_trip_count ?? 1);
  const [deliveryCostPerTripManual, setDeliveryCostPerTripManual] = useState(
    bid?.delivery_cost_per_trip != null ? String(bid.delivery_cost_per_trip) : ''
  );
  const [deliveryCostCode, setDeliveryCostCode] = useState(bid?.delivery_cost_code || '');

  useEffect(() => {
    getEffectiveCompany().then(setCompany).catch(() => setCompany(null));
  }, []);

  useEffect(() => {
    db.entities.CostCode.filter({ is_active: true }, 'code_name', 200).then(setCostCodeOptions).catch(() => setCostCodeOptions([]));
    db.entities.DeliveryPricingTier.list('min_miles', 200).then(setDeliveryTiers).catch(() => setDeliveryTiers([]));
  }, []);

  const jobsiteAddress = joinAddressParts([
    bid?.street,
    bid?.city || bid?.job_city,
    joinAddressParts([bid?.state || bid?.job_state, bid?.zip]),
  ]);
  const companyAddress = company ? joinAddressParts([company.address, company.city, joinAddressParts([company.state, company.zip])]) : '';

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setDeliveryDistance(null);
      setDeliveryError('');
      if (!jobsiteAddress || !companyAddress) {
        setDeliveryError('Enter a jobsite address above and your company address in Settings to calculate mileage automatically.');
        return;
      }
      if (!isGoogleMapsConfigured()) {
        setDeliveryError('Google Maps API key not configured — enter cost per trip manually.');
        return;
      }
      setDeliveryLoading(true);
      try {
        const miles = await calculateDistance(companyAddress, jobsiteAddress);
        if (!cancelled) setDeliveryDistance(miles);
      } catch (e) {
        if (!cancelled) setDeliveryError(e?.message || 'Unable to calculate mileage — enter cost per trip manually.');
      } finally {
        if (!cancelled) setDeliveryLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [jobsiteAddress, companyAddress]);

  const matchedDeliveryTier = deliveryDistance != null
    ? deliveryTiers.find((t) => deliveryDistance >= (t.min_miles ?? 0) && deliveryDistance <= (t.max_miles ?? Infinity))
    : null;
  const maxTierMiles = deliveryTiers.length > 0 ? Math.max(...deliveryTiers.map((t) => t.max_miles ?? 0)) : 125;
  const deliveryManualMode = !deliveryLoading && (!!deliveryError || (deliveryDistance != null && !matchedDeliveryTier));
  const deliveryManualReason = deliveryError || (deliveryDistance != null && !matchedDeliveryTier
    ? `Mileage exceeds ${maxTierMiles} miles — enter cost per trip manually.`
    : '');
  const deliveryCostPerTrip = deliveryManualMode
    ? (parseFloat(deliveryCostPerTripManual) || 0)
    : (matchedDeliveryTier?.cost_per_trip || 0);
  const deliveryTotalCost = deliveryCostPerTrip * (parseFloat(deliveryTripCount) || 0);

  const updateDeliveryTripCount = (value) => { setDeliveryTripCount(value); setDirty(true); };
  const updateDeliveryCostPerTripManual = (value) => { setDeliveryCostPerTripManual(value); setDirty(true); };
  const updateDeliveryCostCode = (value) => { setDeliveryCostCode(value); setDirty(true); };

  const visibleCategories = hasModule(company, '/shop-fabrication')
    ? COST_CATEGORIES
    : COST_CATEGORIES.filter((cat) => !FABRICATION_ONLY_CATEGORIES.includes(cat.key));

  useEffect(() => { loadLines(); }, [bid?.id]);

  // Recomputes the effective tax rate (jurisdiction table first, Ohio
  // hardcoded fallback second, manual entry last) live as the bid's address
  // or tax settings change — computeEffectiveTaxRate is async because it now
  // queries the real TaxRate table, so this can't be computed inline during
  // render like it used to be.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await computeEffectiveTaxRate(buildTaxRateInput(bid));
      if (cancelled) return;
      setTaxInfo(info);
      const label = await getTaxDisplayLabel({
        tax_exempt: bid?.tax_exempt,
        tax_exempt_reason: bid?.tax_exempt_reason,
        tax_rate_source: info.source,
        tax_zone_id: info.tax_zone_id,
        state: bid?.state,
        job_state: bid?.job_state,
        tax_enabled: bid?.tax_enabled,
      });
      if (!cancelled) setTaxLabel(label);
    })();
    return () => { cancelled = true; };
  }, [bid?.id, bid?.zip, bid?.street, bid?.state, bid?.job_state, bid?.tax_enabled, bid?.tax_rate, bid?.tax_exempt, bid?.tax_exempt_reason]);

  useEffect(() => {
    setInclusions(bid?.inclusions || '');
    setExclusions(bid?.exclusions || '');
    setDrawingsUsed(bid?.drawings_used || '');
    setAddendums(bid?.addendums || '');
    setAttentionName(bid?.attention_name || '');
    setSpecificationSections(bid?.specification_sections || '');
    setSuppliedCutSheet(bid?.supplied_cut_sheet || '');
    setPricingBasis(bid?.pricing_basis || 'fob');
    setAlternatesText(bid?.alternates_text || '');
    setAllowancesText(bid?.allowances_text || '');
    setMetalDeckSquares(bid?.metal_deck_squares ?? '');
    setSteelJoistPieces(bid?.steel_joist_pieces ?? '');
    setSteelJoistTons(bid?.steel_joist_tons ?? '');
    setMarkupPct(bid?.markup_percentage ?? 0);
  }, [bid?.id]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const me = await db.auth.me();
        const roles = me?.roles || me?.user?.roles || ['user'];
        setCurrentUserRoles(roles.map(r => String(r).toLowerCase()));
      } catch (e) {
        setCurrentUserRoles(['user']);
      }
    };
    loadUser();
  }, []);

  const loadLines = async () => {
    if (!bid?.id) return;
    setLoading(true);
    try {
      const existing = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 100);
      // Each category's own default_markup_pct is the DEFAULT that pre-fills
      // a brand-new line's markup_percentage; Bid.markup_percentage is only
      // the fallback for the rare category missing one. This also covers any
      // line saved before per-line markup existed (found.markup_percentage
      // is undefined there), so opening an older bid doesn't silently zero
      // out the markup it was actually quoted at.
      const bidMarkupPct = parseFloat(bid?.markup_percentage) || 0;
      const map = {};
      COST_CATEGORIES.forEach(cat => {
        const found = existing.find(e => e.cost_category === cat.key);
        const categoryDefaultMarkupPct = cat.default_markup_pct ?? bidMarkupPct;
        map[cat.key] = found
          ? { ...found, coverage_rate: found.coverage_rate ?? 300, markup_percentage: found.markup_percentage ?? categoryDefaultMarkupPct }
          : { quantity: 0, unit_cost: 0, total_cost: 0, coverage_rate: 300, markup_percentage: categoryDefaultMarkupPct, is_auto_filled: false, source: 'manual', id: null };
      });
      setLines(map);
    } catch (e) {
      const bidMarkupPct = parseFloat(bid?.markup_percentage) || 0;
      const empty = {};
      COST_CATEGORIES.forEach(cat => {
        const categoryDefaultMarkupPct = cat.default_markup_pct ?? bidMarkupPct;
        empty[cat.key] = { quantity: 0, unit_cost: 0, total_cost: 0, coverage_rate: 300, markup_percentage: categoryDefaultMarkupPct, is_auto_filled: false, source: 'manual', id: null };
      });
      setLines(empty);
    } finally { setLoading(false); setDirty(false); }
  };

  const updateLine = (key, field, value) => {
    setLines(prev => {
      const line = prev[key] || { quantity: 0, unit_cost: 0, coverage_rate: 300 };
      const updated = { ...line, [field]: value, is_overridden: line.is_auto_filled && field !== 'source' ? true : line.is_overridden };
      const cat = COST_CATEGORIES.find(c => c.key === key);
      updated.total_cost = cat?.inputMode === 'coverage'
        ? ((updated.quantity || 0) / (updated.coverage_rate || 300)) * (updated.unit_cost || 0)
        : (updated.quantity || 0) * (updated.unit_cost || 0);
      return { ...prev, [key]: updated };
    });
    setDirty(true);
  };

  const updateLineMarkup = (key, value) => {
    setLines(prev => {
      const line = prev[key] || { quantity: 0, unit_cost: 0, total_cost: 0, coverage_rate: 300 };
      return { ...prev, [key]: { ...line, markup_percentage: value } };
    });
    setDirty(true);
  };

  const updateFlatPrice = (key, value) => {
    setLines(prev => {
      const line = prev[key] || {};
      const updated = { ...line, quantity: 1, unit_cost: value, total_cost: value, is_overridden: line.is_auto_filled ? true : line.is_overridden };
      return { ...prev, [key]: updated };
    });
    setDirty(true);
  };

  const updateOverride = (field, value) => {
    setOverrides(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const updateInsuranceInput = (field, value) => {
    setInsuranceInputs(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const updateInsuranceEnabled = (checked) => { setInsuranceEnabled(checked); setDirty(true); };
  const updateBondEnabled = (checked) => { setBondEnabled(checked); setDirty(true); };
  const updateJoistDeckTaxable = (checked) => { setJoistDeckTaxable(checked); setDirty(true); };
  const updateMarkupPct = (value) => { setMarkupPct(value); setDirty(true); };

  const subtotal = Object.values(lines).reduce((s, l) => s + (l.total_cost || 0), 0);
  // Each line item now carries its own markup % (set in the Cost Breakdown
  // table below) — Quoted Price = Line Total * lineMarkupMultiplier. Every
  // downstream figure (tax, bond, grand total) is the SUM of each line's own
  // quoted price, not one bid-wide multiplier. Tax is still charged on the
  // marked-up (sell) price, not raw cost, matching how this business actually
  // prices a job.
  const lineMarkupMultiplier = (line) => 1 + ((parseFloat(line?.markup_percentage) || 0) / 100);
  const subtotalWithMarkup = Object.values(lines).reduce((s, l) => s + (l.total_cost || 0) * lineMarkupMultiplier(l), 0);
  const markupAmount = subtotalWithMarkup - subtotal;
  // The bottom-of-worksheet summary shows the dollar-weighted average markup
  // (markupAmount / subtotal), not a plain arithmetic mean of the per-line
  // percentages — most of the 28 categories are unused (0 cost) on any given
  // bid, and a plain mean across all of them would be dragged toward zero
  // regardless of what markup is actually being charged on real dollars.
  const averageMarkupPct = subtotal > 0 ? (markupAmount / subtotal) * 100 : 0;
  const overrideTotal = ['insurance', 'bond', 'procore_pay', 'textura'].reduce((s, k) => s + (parseFloat(overrides[k]) || 0), 0);
  const grandTotal = subtotalWithMarkup + overrideTotal;
  const calculatedTaxRate = taxInfo.rate;
  const joistDeckTaxRate = getJoistDeckTaxRate(bid);
  // Taxable/non-taxable is a data flag on COST_CATEGORIES (is_taxable, default
  // true) rather than a hardcoded category-key list — steel_erection,
  // outsourced_misc_material_erection, and joist_deck are the only categories
  // flagged is_taxable: false today, matching the exact set this replaces.
  // Each line's cost is scaled by its own markup multiplier before tax, same
  // as the subtotal above.
  const structuralTaxAmount = Object.entries(lines).reduce((sum, [categoryKey, line]) => {
    const cat = COST_CATEGORIES.find((c) => c.key === categoryKey);
    if (cat?.is_taxable === false) return sum;
    return sum + Number(line?.total_cost || 0) * lineMarkupMultiplier(line) * calculatedTaxRate;
  }, 0);
  const joistDeckTaxAmount = joistDeckTaxable && !bid?.tax_exempt ? Number(lines['joist_deck']?.total_cost || 0) * lineMarkupMultiplier(lines['joist_deck']) * joistDeckTaxRate : 0;
  const taxAmount = structuralTaxAmount + joistDeckTaxAmount;
  const bondAmount = (() => {
    const contractValue = Math.max(0, subtotalWithMarkup + overrideTotal);
    if (contractValue <= 500000) return contractValue * 0.00810;
    if (contractValue <= 2500000) return contractValue * 0.00567;
    if (contractValue <= 5000000) return contractValue * 0.00486;
    return contractValue * 0.00432;
  })();
  const insuranceAllocation = (parseFloat(insuranceInputs.general_liability) || 0) + (parseFloat(insuranceInputs.umbrella) || 0) + (parseFloat(insuranceInputs.professional_liability) || 0);
  const includedBondAmount = bondEnabled ? bondAmount : 0;
  const includedInsuranceAllocation = insuranceEnabled ? insuranceAllocation : 0;
  const totalWithTax = grandTotal + taxAmount + includedBondAmount + includedInsuranceAllocation + deliveryTotalCost;
  const canOpenDocuments = currentUserRoles.some(r => ['admin', 'estimator', 'president', 'ceo', 'finance_department'].includes(normalizeRoleName(r)));

  // JobCostLedgerEntry requires a project_id — a bid only has one once it's
  // linked to (or won into) a Project. Pre-award, we still save the
  // delivery_* fields on the Bid itself; posting to the ledger just waits
  // until there's a real project to post against. Re-saves update the same
  // entry (via delivery_job_cost_entry_id) instead of creating duplicates.
  const postDeliveryJobCostEntry = async () => {
    const projectId = bid.project_id || bid.won_project_id;
    if (!projectId || !deliveryCostCode || deliveryTotalCost <= 0) {
      return bid.delivery_job_cost_entry_id || null;
    }
    const transactionDate = new Date().toISOString().slice(0, 10);
    const payload = {
      project_id: projectId,
      cost_code: deliveryCostCode,
      cost_class: inferCostClassFromCodeName(deliveryCostCode),
      amount: deliveryTotalCost,
      transaction_date: transactionDate,
      source_type: 'other',
      source_id: bid.id,
      description: `Delivery — ${deliveryTripCount} trip(s) @ $${deliveryCostPerTrip.toFixed(2)}/trip (${deliveryCostCode})`,
    };
    if (bid.delivery_job_cost_entry_id) {
      // Accounting controls audit: JobCostLedgerEntry has no delete path
      // anywhere in the app, but this re-save was its one existing .update()
      // call site with zero period-lock awareness — a closed period is
      // supposed to freeze historical job cost data, so this check stays
      // here even though nothing else currently edits this entity. Don't
      // strip it out without checking src/lib/periodLock.js first.
      if (await isPeriodLocked(transactionDate)) {
        throw new Error(`This period (${formatPeriodLabel(transactionDate.slice(0, 7))}) is closed. An Admin, Controller, or Super Admin must reopen it before this delivery cost can be re-saved.`);
      }
      const updated = await db.entities.JobCostLedgerEntry.update(bid.delivery_job_cost_entry_id, payload);
      return updated.id;
    }
    const created = await db.entities.JobCostLedgerEntry.create(payload);
    return created.id;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ops = COST_CATEGORIES.map(cat => {
        const line = lines[cat.key];
        if (!line) return null;
        const payload = {
          bid_id: bid.id,
          cost_category: cat.key,
          cost_category_label: cat.label,
          quantity: line.quantity || 0,
          unit_cost: line.unit_cost || 0,
          total_cost: line.total_cost || 0,
          markup_percentage: parseFloat(line.markup_percentage) || 0,
          coverage_rate: cat.inputMode === 'coverage' ? (line.coverage_rate || 300) : undefined,
          is_auto_filled: line.is_auto_filled || false,
          is_overridden: line.is_overridden || false,
          source: line.source || 'manual',
        };
        if (line.id) return db.entities.TakeoffLine.update(line.id, payload);
        return db.entities.TakeoffLine.create(payload);
      }).filter(Boolean);
      await Promise.all(ops);
      const freshBid = await db.entities.Bid.get(bid.id);
      const deliveryJobCostEntryId = await postDeliveryJobCostEntry();
      const freshTaxInfo = await computeEffectiveTaxRate(buildTaxRateInput(freshBid));
      await db.entities.Bid.update(bid.id, {
        bid_total_cost: totalWithTax,
        inclusions,
        exclusions,
        drawings_used: drawingsUsed,
        addendums,
        attention_name: attentionName,
        specification_sections: specificationSections,
        supplied_cut_sheet: suppliedCutSheet,
        pricing_basis: pricingBasis,
        alternates_text: alternatesText,
        allowances_text: allowancesText,
        metal_deck_squares: metalDeckSquares === '' ? null : parseFloat(metalDeckSquares),
        steel_joist_pieces: steelJoistPieces === '' ? null : parseFloat(steelJoistPieces),
        steel_joist_tons: steelJoistTons === '' ? null : parseFloat(steelJoistTons),
        markup_percentage: parseFloat(markupPct) || 0,
        insurance_override: parseFloat(overrides.insurance) || null,
        insurance_enabled: insuranceEnabled,
        insurance_general_liability: parseFloat(insuranceInputs.general_liability) || null,
        insurance_umbrella: parseFloat(insuranceInputs.umbrella) || null,
        insurance_professional_liability: parseFloat(insuranceInputs.professional_liability) || null,
        bond_override: parseFloat(overrides.bond) || null,
        bond_enabled: bondEnabled,
        joist_deck_taxable: joistDeckTaxable,
        procore_pay_override: parseFloat(overrides.procore_pay) || null,
        textura_override: parseFloat(overrides.textura) || null,
        leed_level_override: overrides.leed_level || null,
        tax_rate: freshTaxInfo.rate,
        tax_rate_source: freshTaxInfo.source,
        tax_rate_effective_date: freshTaxInfo.effective_date,
        tax_zone_id: freshTaxInfo.tax_zone_id,
        tax_enabled: !!freshBid?.tax_enabled,
        delivery_distance_miles: deliveryDistance,
        delivery_trip_count: parseFloat(deliveryTripCount) || 1,
        delivery_cost_per_trip: deliveryCostPerTrip,
        delivery_cost_manual_entry: deliveryManualMode,
        delivery_cost_code: deliveryCostCode || null,
        delivery_total_cost: deliveryTotalCost,
        delivery_job_cost_entry_id: deliveryJobCostEntryId,
      });
      toast({ title: 'Takeoff saved!' });
      setDirty(false);
      onSaved?.();
    } catch (e) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    isDirty: () => dirty,
  }));

  const openDocuments = async (catKey) => {
    if (!canOpenDocuments) {
      toast({ title: 'Access restricted', description: 'Only authorized estimators and executives can view document previews.', variant: 'destructive' });
      return;
    }
    if (docsLoading) return;
    setSelectedCategory(catKey);
    setDocsLoading(true);
    setDocDrawerOpen(true);
    try {
      const docs = await db.entities.Document.filter({ bid_id: bid?.id }, '-created_date', 50);
      setDocuments(docs.filter(doc => doc.document_type || doc.file_name));
    } catch (e) {
      setDocuments([]);
    } finally {
      setDocsLoading(false);
    }
  };

  const closeDocuments = () => {
    setDocDrawerOpen(false);
    setSelectedCategory(null);
    setDocuments([]);
  };

  if (loading) return <div className="h-64 bg-muted rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      {/* Autofill indicator */}
      {Object.values(lines).some(l => l.is_auto_filled) && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-blue-700 dark:text-blue-400">
            Blue-tagged rows were auto-filled from BIM/AI data. Overridden cells are highlighted in yellow.
          </span>
        </div>
      )}

      {/* Cost Breakdown Form */}
      <div className="steel-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <h4 className="font-semibold">Cost Breakdown — Line Items</h4>
          <div>
            <Label className="text-xs whitespace-nowrap">Default Markup % <span className="font-normal text-muted-foreground">(pre-fills new lines only)</span></Label>
            <div className="relative w-24 mt-1">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={markupPct}
                onChange={(e) => updateMarkupPct(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                className="h-8 text-sm pr-5"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">%</span>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div className="w-40 flex-shrink-0">Category</div>
            <div className="flex-1 min-w-[220px]">Quantity / Rate</div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="min-w-20 sm:min-w-24 w-auto text-right">Line Total</div>
              <div className="min-w-[56px] w-auto text-center">Markup %</div>
              <div className="min-w-20 sm:min-w-24 w-auto text-right">Quoted Price</div>
              <div className="w-[74px]" />
            </div>
          </div>
          {visibleCategories.map(cat => {
            const line = lines[cat.key] || { quantity: 0, unit_cost: 0, total_cost: 0, markup_percentage: 0 };
            const quotedPrice = (line.total_cost || 0) * lineMarkupMultiplier(line);
            return (
              <div key={cat.key} className={cn(
                'flex flex-wrap items-center gap-2 py-1.5 px-2 rounded-lg transition-colors',
                line.is_overridden && 'bg-yellow-500/10 ring-1 ring-yellow-500/30',
                line.is_auto_filled && !line.is_overridden && 'bg-blue-500/5'
              )}>
                <div className="w-full sm:w-40 flex-shrink-0 flex items-center gap-2">
                  <span className="text-sm font-medium">{cat.label}</span>
                  {line.is_auto_filled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">AUTO</span>}
                  {line.is_overridden && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 font-medium">OVERRIDE</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[220px]">
                  {cat.inputMode === 'coverage' ? (
                    <>
                      <div className="w-full sm:w-28 flex items-center gap-1">
                        <Input type="number" value={line.quantity || ''} placeholder="0"
                          onChange={e => updateLine(cat.key, 'quantity', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" />
                        <span className="text-xs text-muted-foreground w-12">{cat.qtyLabel}</span>
                      </div>
                      <div className="min-w-[9rem] sm:min-w-40 w-auto flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input type="number" value={line.unit_cost || ''} placeholder="0.00" step="0.01"
                          onChange={e => updateLine(cat.key, 'unit_cost', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden lg:inline">{cat.rateLabel}</span>
                      </div>
                      <div className="w-full sm:w-32 flex items-center gap-1">
                        {editingCoverageKey === cat.key ? (
                          <Input type="number" autoFocus value={line.coverage_rate ?? 300} placeholder="300"
                            onChange={e => updateLine(cat.key, 'coverage_rate', parseFloat(e.target.value) || 300)}
                            onBlur={() => setEditingCoverageKey(null)}
                            className="h-8 text-sm" />
                        ) : (
                          <>
                            <span className="text-xs font-mono whitespace-nowrap">{line.coverage_rate ?? 300} sqft/gal</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => setEditingCoverageKey(cat.key)}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  ) : cat.inputMode === 'flat' ? (
                    <div className="w-full sm:w-64 flex items-center gap-1">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{cat.priceLabel}</span>
                      <span className="text-xs text-muted-foreground">$</span>
                      <Input type="number" value={line.unit_cost || ''} placeholder="0.00" step="0.01"
                        onChange={e => updateFlatPrice(cat.key, parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm" />
                    </div>
                  ) : (
                    <>
                      <div className="w-full sm:w-28 flex items-center gap-1">
                        <Input type="number" value={line.quantity || ''} placeholder="0"
                          onChange={e => updateLine(cat.key, 'quantity', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" />
                        <span className="text-xs text-muted-foreground w-12">{cat.qtyLabel || cat.unit}</span>
                      </div>
                      <div className="min-w-[9rem] sm:min-w-40 w-auto flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input type="number" value={line.unit_cost || ''} placeholder="0.00" step="0.01"
                          onChange={e => updateLine(cat.key, 'unit_cost', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" />
                        {cat.rateLabel && <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden lg:inline">{cat.rateLabel}</span>}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                  <div className="min-w-20 sm:min-w-24 w-auto text-right font-mono text-sm font-bold">
                    ${(line.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                  <div className="relative min-w-[56px] w-auto">
                    <Input type="number" min="0" step="0.01" value={line.markup_percentage ?? 0}
                      onChange={e => updateLineMarkup(cat.key, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                      className="h-8 text-sm pr-4 min-w-[56px]" />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground pointer-events-none">%</span>
                  </div>
                  <div className="min-w-20 sm:min-w-24 w-auto text-right font-mono text-sm font-bold text-primary">
                    ${quotedPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openDocuments(cat.key)}>
                    <Upload className="w-3.5 h-3.5 mr-1" />Docs
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Subtotal */}
          <div className="flex justify-between items-center py-2 px-2 mt-2 border-t border-border font-semibold">
            <span>Subtotal</span>
            <span className="font-mono">${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>

      {/* Delivery Cost Calculator */}
      <div className="steel-card p-5">
        <h4 className="font-semibold mb-1 flex items-center gap-2"><Truck className="w-4 h-4 text-primary" />Delivery Cost Calculator</h4>
        <p className="text-xs text-muted-foreground mb-4">Freight cost to this bid's jobsite address (Base Information above), banded by mileage from your company address.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs">Delivery Mileage</Label>
            <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm">
              {deliveryLoading ? (
                <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Calculating…</span>
              ) : deliveryDistance != null ? (
                <span>Calculated mileage: {deliveryDistance.toFixed(1)} miles</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs">Number of Trips</Label>
            <Input type="number" min="1" value={deliveryTripCount}
              onChange={e => updateDeliveryTripCount(e.target.value)}
              className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Cost per Trip</Label>
            {deliveryManualMode ? (
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input type="number" step="0.01" value={deliveryCostPerTripManual}
                  onChange={e => updateDeliveryCostPerTripManual(e.target.value)}
                  placeholder="0.00" className="h-9 pl-7" />
              </div>
            ) : (
              <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm font-mono">
                ${deliveryCostPerTrip.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">Delivery Cost Code</Label>
            <Select value={deliveryCostCode} onValueChange={updateDeliveryCostCode}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select cost code" /></SelectTrigger>
              <SelectContent>
                {costCodeOptions.map(c => <SelectItem key={c.id} value={c.code_name}>{c.code_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {deliveryManualMode && deliveryManualReason && (
          <p className="text-xs text-amber-600 mt-3">{deliveryManualReason}</p>
        )}

        <div className="flex justify-between items-center pt-3 mt-3 border-t border-border font-semibold">
          <span>Total Delivery Cost</span>
          <span className="font-mono">${deliveryTotalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      {/* Administrative Manual Overrides */}
      <div className="steel-card p-5">
        <h4 className="font-semibold mb-1">Administrative Overrides</h4>
        <p className="text-xs text-muted-foreground mb-4">Type over to override calculated values. Overridden cells are highlighted yellow.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Insurance Allocation</p>
              <p className="text-xs text-muted-foreground">Include insurance allocation in Total Cost</p>
            </div>
            <Switch checked={insuranceEnabled} onCheckedChange={updateInsuranceEnabled} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Performance/Payment Bond</p>
              <p className="text-xs text-muted-foreground">Include bond estimate in Total Cost</p>
            </div>
            <Switch checked={bondEnabled} onCheckedChange={updateBondEnabled} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Joist &amp; Deck Taxable</p>
              <p className="text-xs text-muted-foreground">{joistDeckTaxable ? `Taxed at ${(joistDeckTaxRate * 100).toFixed(2)}%` : 'Tax exempt — no joist/deck tax applied'}</p>
            </div>
            <Switch checked={joistDeckTaxable} onCheckedChange={updateJoistDeckTaxable} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            // cost_code metadata only (see COST_CATEGORIES audit) — these stay
            // bid-level override fields, not COST_CATEGORIES line items;
            // the code is exposed here for reporting/export lookups only.
            { key: 'insurance', label: 'Insurance ($)', cost_code: '17-994' },
            { key: 'bond', label: 'Performance / Payment Bonds ($)', cost_code: '17-996' },
            { key: 'procore_pay', label: 'Procore Pay ($)', cost_code: '01-970' },
            { key: 'textura', label: 'Textura ($)', cost_code: '01-970' },
            { key: 'leed_level', label: 'LEED Level', isText: true, cost_code: null },
          ].map(field => (
            <div key={field.key} className={cn(
              'p-2 rounded-lg',
              overrides[field.key] !== '' && overrides[field.key] !== undefined && overrides[field.key] !== null
                ? 'bg-yellow-500/10 ring-1 ring-yellow-500/30' : ''
            )}>
              <Label className="text-xs">{field.label}</Label>
              <Input
                type={field.isText ? 'text' : 'number'}
                value={overrides[field.key] ?? ''}
                placeholder={field.isText ? 'e.g. Silver' : '0.00'}
                onChange={e => updateOverride(field.key, e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {[
            { key: 'general_liability', label: 'General Liability ($)' },
            { key: 'umbrella', label: 'Umbrella ($)' },
            { key: 'professional_liability', label: 'Professional Liability ($)' },
          ].map((field) => (
            <div key={field.key}>
              <Label className="text-xs">{field.label}</Label>
              <Input type="number" value={insuranceInputs[field.key] ?? ''} placeholder="TBD" onChange={(e) => updateInsuranceInput(field.key, e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center py-2 mt-3 border-t border-border font-semibold">
          <span>Override Total</span>
          <span className="font-mono">${overrideTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      {docDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/20"
          onClick={(e) => { if (e.target === e.currentTarget) closeDocuments(); }}
        >
          <div className="h-full w-full max-w-md border-l border-border bg-background p-5 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">Document Preview</h4>
                <p className="text-sm text-muted-foreground">{selectedCategory ? COST_CATEGORIES.find(c => c.key === selectedCategory)?.label : 'Documents'}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeDocuments}>Close</Button>
            </div>
            <div className="mt-4 space-y-2">
              {docsLoading ? (
                <p className="text-sm text-muted-foreground">Loading documents…</p>
              ) : documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents linked to this bid yet.</p>
              ) : documents.map((doc) => (
                <a key={doc.id} href={doc.file_url || '#'} target="_blank" rel="noreferrer" className="block rounded-lg border border-border p-3 text-sm hover:bg-muted/50">
                  <p className="font-medium">{doc.name || doc.file_name || 'Document'}</p>
                  <p className="text-xs text-muted-foreground">{doc.document_type || 'uploaded document'}</p>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Grand Total */}
      <div className="steel-card p-5 bg-primary/5">
        <div className="space-y-1">
          <div className="flex justify-between text-sm"><span>Line Item Subtotal</span><span className="font-mono">${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between items-center text-sm">
            <span className="flex items-center gap-2">
              Profit Markup
              {/* Read-only — the dollar-weighted average of each line item's
                  own Markup % in the table above, not a separately settable
                  value. Edit markup per line up there; "Default Markup %"
                  only pre-fills new lines. */}
              <span className="text-xs font-mono text-muted-foreground">(avg {averageMarkupPct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%)</span>
            </span>
            <span className="font-mono">${markupAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-sm"><span>Administrative Overrides</span><span className="font-mono">${overrideTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between text-sm">
            <span>Bond Estimate{!bondEnabled && <span className="text-xs text-muted-foreground"> (off — not included)</span>}</span>
            <span className="font-mono">${includedBondAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Insurance Allocation{!insuranceEnabled && <span className="text-xs text-muted-foreground"> (off — not included)</span>}</span>
            <span className="font-mono">${includedInsuranceAllocation.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Delivery Cost{deliveryCostCode && <span className="text-xs text-muted-foreground"> ({deliveryCostCode})</span>}</span>
            <span className="font-mono">${deliveryTotalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>{bid?.tax_exempt ? taxLabel : `${taxLabel} (${(calculatedTaxRate * 100).toFixed(2)}%)`}</span>
            <span className="font-mono">${structuralTaxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Joist &amp; Deck Tax{joistDeckTaxable && !bid?.tax_exempt ? ` (${(joistDeckTaxRate * 100).toFixed(2)}%)` : ''}</span>
            {joistDeckTaxable && !bid?.tax_exempt ? (
              <span className="font-mono">${joistDeckTaxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            ) : (
              <span className="text-xs text-muted-foreground">Tax Exempt</span>
            )}
          </div>
          <div className="flex justify-between items-center pt-2 mt-1 border-t border-border">
            <span className="font-bold text-lg">Total Cost</span>
            <span className="font-mono font-bold text-lg text-primary">${totalWithTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>

      {/* Text Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="steel-card p-5">
          <Label className="font-semibold">Inclusions</Label>
          <Textarea
            value={inclusions}
            onChange={e => { setInclusions(e.target.value); setDirty(true); }}
            placeholder="List items included in this bid scope…"
            className="mt-2 min-h-[120px]"
            id="inclusions"
          />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Exclusions</Label>
          <Textarea
            value={exclusions}
            onChange={e => { setExclusions(e.target.value); setDirty(true); }}
            placeholder="List items excluded from this bid scope…"
            className="mt-2 min-h-[120px]"
            id="exclusions"
          />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Drawings Used</Label>
          <Textarea
            value={drawingsUsed}
            onChange={e => { setDrawingsUsed(e.target.value); setDirty(true); }}
            placeholder="List the drawing set(s)/revisions this bid was priced from…"
            className="mt-2 min-h-[120px]"
            id="drawings_used"
          />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Addendums</Label>
          <Textarea
            value={addendums}
            onChange={e => { setAddendums(e.target.value); setDirty(true); }}
            placeholder="List any addenda/bulletins incorporated into this bid…"
            className="mt-2 min-h-[120px]"
            id="addendums"
          />
        </div>
      </div>

      {/* Proposal Header Fields — feed the customer-facing proposal PDF's top info block */}
      <div className="steel-card p-5 space-y-4">
        <h4 className="font-semibold text-sm">Proposal Header Fields</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs">Attention (Contact Name)</Label>
            <Input value={attentionName} onChange={e => { setAttentionName(e.target.value); setDirty(true); }} className="mt-1" placeholder="Customer contact name" />
          </div>
          <div>
            <Label className="text-xs">Specification Sections</Label>
            <Input value={specificationSections} onChange={e => { setSpecificationSections(e.target.value); setDirty(true); }} className="mt-1" placeholder="e.g. Division 05" />
          </div>
          <div>
            <Label className="text-xs">Supplied Cut Sheet</Label>
            <Input value={suppliedCutSheet} onChange={e => { setSuppliedCutSheet(e.target.value); setDirty(true); }} className="mt-1" placeholder="Cut sheet reference/file name" />
          </div>
          <div>
            <Label className="text-xs">Pricing Basis</Label>
            <Select value={pricingBasis} onValueChange={v => { setPricingBasis(v); setDirty(true); }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fob">F.O.B. Jobsite (Supply Only - Not Erected)</SelectItem>
                <SelectItem value="erected">Fabricated, Delivered, and Installed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="steel-card p-5">
          <Label className="font-semibold">Alternates</Label>
          <Textarea
            value={alternatesText}
            onChange={e => { setAlternatesText(e.target.value); setDirty(true); }}
            placeholder="List any priced alternates for this bid… leave blank to omit this section"
            className="mt-2 min-h-[100px]"
            id="alternates_text"
          />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Allowances</Label>
          <Textarea
            value={allowancesText}
            onChange={e => { setAllowancesText(e.target.value); setDirty(true); }}
            placeholder="List any allowances carried in this bid… leave blank to omit this section"
            className="mt-2 min-h-[100px]"
            id="allowances_text"
          />
        </div>
      </div>

      <div className="steel-card p-5 space-y-4">
        <div>
          <h4 className="font-semibold text-sm">Material Quantity Summary</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Structural Steel tons come from the linked takeoff ({(bid?.total_weight_tons ?? bid?.estimated_tons ?? 0).toLocaleString()} tons). Metal Deck and Steel Joist
            aren't computed by any takeoff tool — Joist &amp; Deck is priced as a single flat-quote line with no quantity breakdown — so enter them manually below.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Metal Deck (Squares)</Label>
            <Input type="number" min="0" value={metalDeckSquares} onChange={e => { setMetalDeckSquares(e.target.value); setDirty(true); }} className="mt-1" placeholder="0" />
          </div>
          <div>
            <Label className="text-xs">Steel Joist (Pieces)</Label>
            <Input type="number" min="0" value={steelJoistPieces} onChange={e => { setSteelJoistPieces(e.target.value); setDirty(true); }} className="mt-1" placeholder="0" />
          </div>
          <div>
            <Label className="text-xs">Steel Joist (Tons)</Label>
            <Input type="number" min="0" step="0.01" value={steelJoistTons} onChange={e => { setSteelJoistTons(e.target.value); setDirty(true); }} className="mt-1" placeholder="0" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 min-w-32">
          <Save className="w-4 h-4 mr-2" />{saving ? 'Saving…' : 'Save Takeoff'}
        </Button>
      </div>
    </div>
  );
});

export default TakeoffEngine;