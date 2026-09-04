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
import { calculateDistance } from '@/lib/mileageService';
import { calculateBondAmount, bondRateForContractValue, LEED_SURCHARGE_LEVELS, calculateLeedSurcharge, calculatePaymentPlatformFee, PAYMENT_PLATFORM_FEE_RATE } from '@/lib/bidWorksheetCalc';

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
  // LEED/Gov't job surcharge moved to the Administrative Overrides section
  // below (a level dropdown × fixed hours × $50/hr, not a manual $ line) —
  // see the leed_level override field and leedSurchargeAmount.
];

const TakeoffEngine = forwardRef(function TakeoffEngine({ bid, onSaved }, ref) {
  const { toast } = useToast();
  const [lines, setLines] = useState({});
  const [overrides, setOverrides] = useState({
    insurance: bid?.insurance_override ?? '',
    bond: bid?.bond_override ?? '',
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
  const [procorePayEnabled, setProcorePayEnabled] = useState(bid?.procore_pay_enabled ?? false);
  const [texturaEnabled, setTexturaEnabled] = useState(bid?.textura_enabled ?? false);
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
  // Freight mileage calculator: purely a lookup tool that tells the
  // estimator which DeliveryPricingTier rate applies to the Jobsite Freight
  // (Material Delivery) line in the Cost Breakdown table above — it has no
  // total of its own and posts nothing to the job cost ledger. See
  // DeliveryPricingAdmin.jsx for the tier structure itself, unchanged here.
  const [freightTiers, setFreightTiers] = useState([]);
  const [freightDistance, setFreightDistance] = useState(bid?.delivery_distance_miles ?? null);
  const [freightLoading, setFreightLoading] = useState(false);
  const [freightError, setFreightError] = useState('');

  useEffect(() => {
    getEffectiveCompany().then(setCompany).catch(() => setCompany(null));
  }, []);

  useEffect(() => {
    db.entities.DeliveryPricingTier.list('min_miles', 200).then(setFreightTiers).catch(() => setFreightTiers([]));
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
      setFreightDistance(null);
      setFreightError('');
      if (!jobsiteAddress || !companyAddress) {
        setFreightError('Enter a jobsite address above and your company address in Settings to calculate mileage automatically.');
        return;
      }
      setFreightLoading(true);
      try {
        const miles = await calculateDistance(companyAddress, jobsiteAddress);
        if (!cancelled) setFreightDistance(miles);
      } catch (e) {
        if (!cancelled) setFreightError(e?.message || 'Unable to calculate mileage — look up the tier manually.');
      } finally {
        if (!cancelled) setFreightLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [jobsiteAddress, companyAddress]);

  const matchedFreightTier = freightDistance != null
    ? freightTiers.find((t) => freightDistance >= (t.min_miles ?? 0) && freightDistance <= (t.max_miles ?? Infinity))
    : null;
  const maxTierMiles = freightTiers.length > 0 ? Math.max(...freightTiers.map((t) => t.max_miles ?? 0)) : null;
  const freightNoTierReason = freightDistance != null && !matchedFreightTier && maxTierMiles != null
    ? `Mileage exceeds ${maxTierMiles} miles — no matching tier; price Jobsite Freight manually.`
    : '';

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
  const updateProcorePayEnabled = (checked) => { setProcorePayEnabled(checked); setDirty(true); };
  const updateTexturaEnabled = (checked) => { setTexturaEnabled(checked); setDirty(true); };
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
  const overrideTotal = parseFloat(overrides.insurance) || 0;
  const grandTotal = subtotalWithMarkup + overrideTotal;
  // Gated directly on bid.tax_exempt (the single source of truth — the
  // inverse of Base Info's top-level "Tax Enabled" toggle, see BidDetail.jsx)
  // rather than on taxInfo.rate alone: taxInfo is populated by an async effect
  // below, so this keeps the on/off state itself synchronous and immediate
  // even in the brief window before that effect resolves.
  const calculatedTaxRate = bid?.tax_exempt ? 0 : taxInfo.rate;
  const joistDeckTaxRate = getJoistDeckTaxRate(bid, taxInfo.rate);
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
  // Joist & Deck no longer has its own on/off toggle (the old "Joist & Deck
  // Taxable" switch in Administrative Overrides was a second, independently-
  // wired tax gate — removed so every tax line reads from the single top
  // "Tax Enabled" toggle). It still uses its own joist_deck_tax_rate, just
  // gated by the same tax_exempt flag as everything else.
  const joistDeckTaxAmount = bid?.tax_exempt ? 0 : Number(lines['joist_deck']?.total_cost || 0) * lineMarkupMultiplier(lines['joist_deck']) * joistDeckTaxRate;
  const taxAmount = structuralTaxAmount + joistDeckTaxAmount;
  const insuranceAllocation = (parseFloat(insuranceInputs.general_liability) || 0) + (parseFloat(insuranceInputs.umbrella) || 0) + (parseFloat(insuranceInputs.professional_liability) || 0);
  const includedInsuranceAllocation = insuranceEnabled ? insuranceAllocation : 0;
  const leedSurchargeAmount = calculateLeedSurcharge(overrides.leed_level);
  // Bid's running total before the bond itself and before the Procore/Textura
  // fees (both of which are layered on top of everything else, so neither can
  // be part of its own base) — the "current total" the bond tier and the fee
  // % are each applied against.
  const preBondTotal = grandTotal + taxAmount + includedInsuranceAllocation + leedSurchargeAmount;
  const computedBondAmount = calculateBondAmount(preBondTotal);
  const bondOverrideValue = overrides.bond === '' || overrides.bond === null || overrides.bond === undefined
    ? null
    : parseFloat(overrides.bond);
  const effectiveBondAmount = (bondOverrideValue != null && !Number.isNaN(bondOverrideValue)) ? bondOverrideValue : computedBondAmount;
  const includedBondAmount = bondEnabled ? effectiveBondAmount : 0;
  const preFeeTotal = preBondTotal + includedBondAmount;
  const procorePlatformFee = calculatePaymentPlatformFee(preFeeTotal, calculatedTaxRate);
  const texturaPlatformFee = calculatePaymentPlatformFee(preFeeTotal, calculatedTaxRate);
  const includedProcoreFee = procorePayEnabled ? procorePlatformFee.total : 0;
  const includedTexturaFee = texturaEnabled ? texturaPlatformFee.total : 0;
  const totalWithTax = preFeeTotal + includedProcoreFee + includedTexturaFee;
  const canOpenDocuments = currentUserRoles.some(r => ['admin', 'estimator', 'president', 'ceo', 'finance_department'].includes(normalizeRoleName(r)));

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
      // tax_enabled/tax_rate/tax_rate_source/tax_zone_id are NOT re-derived or
      // re-written here — Base Info (BidDetail.jsx's handleBaseInfoSave) is the
      // single source of truth for tax configuration. Re-fetching and
      // recomputing them from this separate save path used to risk writing a
      // stale snapshot back over Base Info's own value whenever "Save Takeoff"
      // was clicked without first saving Base Info (see the tax-worksheet bug
      // fix this comment accompanies) — bid_total_cost below already reflects
      // the live tax config via the bid prop BidDetail passes in.
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
        procore_pay_enabled: procorePayEnabled,
        textura_enabled: texturaEnabled,
        leed_level_override: overrides.leed_level || null,
        delivery_distance_miles: freightDistance,
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

      {/* Freight Mileage Calculator */}
      <div className="steel-card p-5">
        <h4 className="font-semibold mb-1 flex items-center gap-2"><Truck className="w-4 h-4 text-primary" />Freight Mileage Calculator</h4>
        <p className="text-xs text-muted-foreground mb-4">
          Driving distance from your company address (Settings) to this bid's jobsite address (Base Information above), looked up against the Delivery Pricing Tiers to price the Jobsite Freight (Material Delivery) line in the Cost Breakdown above.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Driving Distance</Label>
            <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm">
              {freightLoading ? (
                <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Calculating…</span>
              ) : freightDistance != null ? (
                <span>{freightDistance.toFixed(1)} miles</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs">Matched Tier</Label>
            <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm">
              {matchedFreightTier ? `${matchedFreightTier.min_miles}–${matchedFreightTier.max_miles} mi` : <span className="text-muted-foreground">—</span>}
            </div>
          </div>
          <div>
            <Label className="text-xs">Tier Rate / Load</Label>
            <div className="mt-1 h-9 flex items-center justify-between px-3 rounded-md border border-input bg-muted/30 text-sm">
              <span className="font-mono">
                {matchedFreightTier ? `$${matchedFreightTier.cost_per_trip.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
              </span>
              {matchedFreightTier && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                  onClick={() => updateLine('jobsite_freight', 'unit_cost', matchedFreightTier.cost_per_trip)}>
                  Use Rate
                </Button>
              )}
            </div>
          </div>
        </div>

        {(freightError || freightNoTierReason) && (
          <p className="text-xs text-amber-600 mt-3">{freightError || freightNoTierReason}</p>
        )}
      </div>

      {/* Administrative Manual Overrides */}
      <div className="steel-card p-5">
        <h4 className="font-semibold mb-1">Administrative Overrides</h4>
        <p className="text-xs text-muted-foreground mb-4">Toggle to include a calculated line in Total Cost. Overridden cells are highlighted yellow.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Insurance Allocation</p>
                <p className="text-xs text-muted-foreground">Include insurance allocation in Total Cost</p>
              </div>
              <Switch checked={insuranceEnabled} onCheckedChange={updateInsuranceEnabled} />
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Performance/Payment Bond</p>
                <p className="text-xs text-muted-foreground">
                  {(bondRateForContractValue(preBondTotal) * 100).toFixed(3)}% tiered rate — ${computedBondAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} calculated
                </p>
              </div>
              <Switch checked={bondEnabled} onCheckedChange={updateBondEnabled} />
            </div>
            {bondEnabled && (
              <div className="mt-2">
                <Label className="text-xs">Manual Override ($) — leave blank to use the calculated value</Label>
                <Input
                  type="number" step="0.01"
                  value={overrides.bond ?? ''}
                  placeholder={computedBondAmount.toFixed(2)}
                  onChange={e => updateOverride('bond', e.target.value)}
                  className={cn('mt-1 h-8 text-sm', bondOverrideValue != null && !Number.isNaN(bondOverrideValue) && 'bg-yellow-500/10 ring-1 ring-yellow-500/30')}
                />
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Procore Pay Fee</p>
                <p className="text-xs text-muted-foreground">{(PAYMENT_PLATFORM_FEE_RATE * 100).toFixed(1)}% of proposal total, plus tax</p>
              </div>
              <Switch checked={procorePayEnabled} onCheckedChange={updateProcorePayEnabled} />
            </div>
            {procorePayEnabled && (
              <div className="mt-2 flex justify-between text-xs font-mono text-muted-foreground">
                <span>Fee ${procorePlatformFee.fee.toFixed(2)} + Tax ${procorePlatformFee.tax.toFixed(2)}</span>
                <span className="font-semibold text-foreground">${procorePlatformFee.total.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Textura Fee</p>
                <p className="text-xs text-muted-foreground">{(PAYMENT_PLATFORM_FEE_RATE * 100).toFixed(1)}% of proposal total, plus tax</p>
              </div>
              <Switch checked={texturaEnabled} onCheckedChange={updateTexturaEnabled} />
            </div>
            {texturaEnabled && (
              <div className="mt-2 flex justify-between text-xs font-mono text-muted-foreground">
                <span>Fee ${texturaPlatformFee.fee.toFixed(2)} + Tax ${texturaPlatformFee.tax.toFixed(2)}</span>
                <span className="font-semibold text-foreground">${texturaPlatformFee.total.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
        {/* Joist & Deck taxability is no longer its own toggle here — it's
            governed by the single "Tax Enabled" switch in Base Information
            above (see the Grand Total's tax lines below), same as every
            other tax-affected line item. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={cn(
            'p-2 rounded-lg',
            overrides.insurance !== '' && overrides.insurance !== undefined && overrides.insurance !== null
              ? 'bg-yellow-500/10 ring-1 ring-yellow-500/30' : ''
          )}>
            {/* cost_code 17-994 (see COST_CATEGORIES audit) — stays a bid-level
                override field, not a COST_CATEGORIES line item; exposed here
                for reporting/export lookups only. */}
            <Label className="text-xs">Insurance ($)</Label>
            <Input
              type="number"
              value={overrides.insurance ?? ''}
              placeholder="0.00"
              onChange={e => updateOverride('insurance', e.target.value)}
              className="mt-1 h-8 text-sm"
            />
          </div>
          <div className="p-2 rounded-lg">
            <Label className="text-xs">LEED / Government Job Level</Label>
            <Select
              value={overrides.leed_level || 'none'}
              onValueChange={v => updateOverride('leed_level', v === 'none' ? '' : v)}
            >
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Not a LEED/Gov't job" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not a LEED / Gov't job</SelectItem>
                {LEED_SURCHARGE_LEVELS.map(l => (
                  <SelectItem key={l.value} value={l.value}>{l.label} ({l.hours} hrs)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {leedSurchargeAmount > 0 && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {LEED_SURCHARGE_LEVELS.find(l => l.value === overrides.leed_level)?.hours} hrs × $50/hr = ${leedSurchargeAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            )}
          </div>
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
          <span>Manual Override Total</span>
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
          <div className="flex justify-between text-sm"><span>Manual Override Total</span><span className="font-mono">${overrideTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between text-sm">
            <span>Bond Estimate{!bondEnabled && <span className="text-xs text-muted-foreground"> (off — not included)</span>}</span>
            <span className="font-mono">${includedBondAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Insurance Allocation{!insuranceEnabled && <span className="text-xs text-muted-foreground"> (off — not included)</span>}</span>
            <span className="font-mono">${includedInsuranceAllocation.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          {leedSurchargeAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span>LEED / Gov't Job Surcharge</span>
              <span className="font-mono">${leedSurchargeAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {procorePayEnabled && (
            <div className="flex justify-between text-sm">
              <span>Procore Pay Fee</span>
              <span className="font-mono">${includedProcoreFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {texturaEnabled && (
            <div className="flex justify-between text-sm">
              <span>Textura Fee</span>
              <span className="font-mono">${includedTexturaFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {/* Both tax lines are omitted entirely when the bid is tax exempt
              (top "Tax Enabled" toggle off in Base Information) — matching
              the customer-facing proposal PDF's exempt handling
              (drawPricingBlock in bidProposalPdfLayout.js), which likewise
              drops its tax row rather than showing a $0/"exempt" placeholder. */}
          {!bid?.tax_exempt && (
            <div className="flex justify-between text-sm">
              <span>{taxLabel} ({(calculatedTaxRate * 100).toFixed(2)}%)</span>
              <span className="font-mono">${structuralTaxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {!bid?.tax_exempt && (
            <div className="flex justify-between text-sm">
              <span>Joist &amp; Deck Tax ({(joistDeckTaxRate * 100).toFixed(2)}%)</span>
              <span className="font-mono">${joistDeckTaxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          )}
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