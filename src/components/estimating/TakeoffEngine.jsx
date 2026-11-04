import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Save, Info, Upload, Pencil, Truck, Loader2, Download } from 'lucide-react';
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
import { LEED_SURCHARGE_LEVELS, LEED_RATE_CATEGORY_KEY, resolveLeedHourlyRate, PAYMENT_PLATFORM_FEE_RATE, FAB_HOURS_CATEGORY_KEY, roundTakeoffHours, lineMarkupMultiplier, buildWorksheetLineMap, matchDeliveryTier, computeWorksheetTotals, lineLabels, lineUnit, convertLineUnit, SHOP_PRIMING_RATE_KEY, resolveShopPrimingRate } from '@/lib/bidWorksheetCalc';
import { buildCostCategoryRateMap, currentCostCategoryRate } from '@/lib/bidWorksheetRateEngine';
import { buildFastenerCountPull, buildTonsPull, buildPaintAreaPull, buildPrimingHoursPull, BOLT_PULL_CODES, ANCHOR_PULL_CODES, BY_LENGTH_FASTENER_CODES } from '@/lib/worksheetTakeoffPulls';
import { UnitToggle, LineNotes, TakeoffPullPanel } from '@/components/estimating/WorksheetLineAids';

const joinAddressParts = (parts) => parts.filter(Boolean).join(', ');

// A company whose pack doesn't include the Fabrication module (see
// modulePacks.js — Erector-only companies have no shop) still initializes
// and saves these categories normally, so pre-existing line data is never
// lost; they're just not rendered in the takeoff form for that company.
const FABRICATION_ONLY_CATEGORIES = ['structural_material', 'structural_fabrication', 'shop_priming'];

// The Structural Fabrication line's Hours auto-fill from the Full Takeoff's
// shop man-hours (FullTakeoff.jsx: each MaterialTakeoffLine's total_tons x
// its shape class's hoursPerTon from steelShapeSelector.js, divided by the
// bid's Shop Efficiency %, saved as Bid.estimated_man_hours). Rounded to one
// decimal, the same way the Full Takeoff's "Total Estimated Man-Hours" card
// shows it, so the two screens always read the same number.
// FAB_HOURS_CATEGORY_KEY/roundTakeoffHours live in bidWorksheetCalc.js now,
// shared with the Full Breakdown export.
const formatHours = (hours) => roundTakeoffHours(hours).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Categories whose rate field is filled from a company-configurable default
// (CostCategoryDefaultRate, admin-managed at /admin/bid-worksheet-rates) —
// the per-company equivalent of default_markup_pct below, kept out of
// COST_CATEGORIES itself because the actual number is admin-editable data,
// not a source-code constant. Only pre-fills a brand-new line's unit_cost
// (see loadLines); the value stays fully editable per-line afterward and a
// manual edit is never overwritten by a later default change.
// jobsite_freight's company rate is a $/load the admin fills in; the Freight
// Mileage Calculator's tier rate can still be applied over it per bid.
export const RATE_DEFAULT_CATEGORY_KEYS = ['field_rigging', 'erection_labor_hours', 'load_unload_material', 'shop_priming', 'structural_fabrication', 'jobsite_freight', 'primer_paint'];

// Rates only an admin may change on a bid (set in Bid Worksheet Default
// Rates); for everyone else the box shows the company price, read-only.
export const ADMIN_ONLY_RATE_KEYS = ['primer_paint'];

// cost_code follows the company's real Division 05 / 17 numbering scheme
// (from the reference estimate audit); null means the category has no
// assigned code there and is a SteelOS-specific addition — left open rather
// than inventing a number. default_markup_pct pre-fills a brand-new line's
// markup_percentage (see loadLines) — categories not in the reference
// estimate default to 10% and are flagged below as needing confirmation.
//
// How a line is entered: inputMode 'flat' = one quote amount (stored as 1 x
// amount); 'coverage' = sq ft / coverage x price/gal; otherwise qty x rate.
// wasUnit = the unit a now-quote-only line used to be entered in (for the
// note on a saved line carried into its quote - see migrateSavedLine in
// bidWorksheetCalc.js); fromQuote = was a quote, now qty x price each.
// unitOptions = units the estimator can switch between (perBase = how many
// make one of the first). takeoffPull = which 'Pull from takeoff' the line
// offers (worksheetTakeoffPulls.js).
export const COST_CATEGORIES = [
  { key: 'detailing', label: 'Detailing', unit: 'lot', inputMode: 'flat', priceLabel: 'Flat Price', cost_code: '05-010', default_markup_pct: 35 },
  { key: 'engineering', label: 'Engineering', unit: 'lot', inputMode: 'flat', priceLabel: 'Flat Price', cost_code: '05-011', default_markup_pct: 35 },
  { key: 'bim', label: 'BIM', unit: 'ea', qtyLabel: 'Qty', rateLabel: 'Rate/Each', cost_code: '05-012', default_markup_pct: 10 },
  { key: 'structural_material', label: 'Structural Material', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: '05-105', default_markup_pct: 10 },
  { key: 'bolts_fasteners', label: 'Bolts / Fasteners', unit: 'ea', qtyLabel: 'Qty', rateLabel: 'Price/Each', fromQuote: true, takeoffPull: 'bolts', cost_code: '05-106', default_markup_pct: 10 },
  { key: 'outsourced_fabrication', label: 'Outsourced Fabrication', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'lot', cost_code: '05-110', default_markup_pct: 10 },
  { key: 'structural_fabrication', label: 'Structural Fabrication', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Shop Rate/Hr', cost_code: '05-121', default_markup_pct: 10 },
  { key: 'galvanizing', label: 'Galvanizing', unit: 'tons', qtyLabel: 'Tons', rateLabel: 'Rate/Ton', unitOptions: [{ value: 'tons', qtyLabel: 'Tons', rateLabel: 'Rate/Ton', perBase: 1 }, { value: 'lbs', qtyLabel: 'Lbs', rateLabel: 'Rate/Lb', perBase: 2000 }], cost_code: '05-122', default_markup_pct: 10 },
  // Not in the reference estimate — no assigned code; default markup unconfirmed.
  { key: 'galvanizing_delivery', label: 'Galvanizing Delivery', unit: 'ea', qtyLabel: 'Qty', rateLabel: 'Rate/Each', cost_code: null, default_markup_pct: 10 },
  // Distinct from misc_fab_processing (scoped under Misc. Fabrication below) — a discrete steel-processing step between galvanizing and rolling.
  { key: 'processing_steel', label: 'Processing Steel', unit: 'tons', qtyLabel: 'Tons', rateLabel: 'Rate/Ton', takeoffPull: 'tons', cost_code: '05-123', default_markup_pct: 10 },
  { key: 'steel_rolling', label: 'Steel Rolling', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'tons', cost_code: '05-124', default_markup_pct: 10 },
  { key: 'joist_deck', label: 'Joist & Deck', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', is_taxable: false, cost_code: '05-210', default_markup_pct: 36 },
  { key: 'anchor_bolts', label: 'Anchor Bolts', unit: 'ea', qtyLabel: 'Qty', rateLabel: 'Price/Each', takeoffPull: 'anchor_bolts', cost_code: '05-301', default_markup_pct: 10 },
  // Split from the reference's single 05-302 line for finer input granularity — both halves share the code.
  { key: 'shop_priming', label: 'Shop Priming', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Shop Rate/Hr', takeoffPull: 'priming_hours', cost_code: '05-302', default_markup_pct: 35 },
  { key: 'primer_paint', label: 'Primer (Paint)', unit: 'gal', inputMode: 'coverage', qtyLabel: 'Sq. Ft.', rateLabel: 'Price/Gallon', takeoffPull: 'paint_sqft', cost_code: '05-302', default_markup_pct: 35 },
  { key: 'grating', label: 'Grating', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'sqft', cost_code: '05-303', default_markup_pct: 10 },
  { key: 'outsourced_paint', label: 'Outsourced Paint', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'tons', cost_code: '05-305', default_markup_pct: 10 },
  { key: 'outsourced_shot_blasting', label: 'Outsourced Shot Blasting', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'tons', cost_code: '05-306', default_markup_pct: 10 },
  // Load/unload labor step, distinct from the delivery/freight cost below.
  { key: 'load_unload_material', label: 'Load/Unload Material', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Rate/Hr', cost_code: '05-400', default_markup_pct: 10 },
  { key: 'jobsite_freight', label: 'Jobsite Freight (Material Delivery)', unit: 'load', qtyLabel: 'Loads', rateLabel: 'Rate/Load', cost_code: '05-401', default_markup_pct: 30 },
  // Split from the reference's single 05-500 line for finer input granularity — both halves share the code.
  { key: 'misc_fab_structural', label: 'Misc. Fab - Structural Shaping', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: '05-500', default_markup_pct: 35 },
  { key: 'misc_fab_processing', label: 'Misc. Fab - Processing', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: '05-500', default_markup_pct: 35 },
  { key: 'misc_material', label: 'Misc. Material', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'ea', cost_code: '05-510', default_markup_pct: 35 },
  { key: 'steel_erection', label: 'Steel Erection', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', is_taxable: false, cost_code: '05-600', default_markup_pct: 10 },
  { key: 'outsourced_misc_material_erection', label: 'Outsourced Misc. Material & Erection', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'lot', is_taxable: false, cost_code: '05-601', default_markup_pct: 10 },
  // Not in the reference estimate — no assigned code; default markup unconfirmed.
  { key: 'erection_labor_hours', label: 'Erection Labor Hours', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Field Rate/Hr', cost_code: null, default_markup_pct: 10 },
  { key: 'crane_rental', label: 'Crane Rental', unit: 'lot', inputMode: 'flat', priceLabel: 'Quote Amount', cost_code: null, default_markup_pct: 10 },
  { key: 'mobilization', label: 'Mobilization', unit: 'lot', inputMode: 'flat', priceLabel: 'Flat Price', cost_code: null, default_markup_pct: 10 },
  { key: 'field_rigging', label: 'Field Rigging', unit: 'hrs', qtyLabel: 'Hours', rateLabel: 'Rate/Hr', cost_code: null, default_markup_pct: 10 },
  { key: 'subcontractor_other', label: 'Subcontractor Other', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'lot', cost_code: '05-602', default_markup_pct: 10 },
  { key: 'allowances', label: 'Allowance(s)', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'lot', cost_code: '05-999', default_markup_pct: 0 },
  // Shown as Company Contingency (was HSS Contingency); the stored key stays
  // hss_contingency so saved bids keep their line.
  { key: 'hss_contingency', label: 'Company Contingency', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'lot', cost_code: null, default_markup_pct: 10 },
  // Not in the audit's mapping/null lists either — treated the same as the other non-reference additions above pending user confirmation.
  { key: 'additional_cost_insurance', label: 'Additional Cost: Insurance', unit: 'quote', inputMode: 'flat', priceLabel: 'Quote Amount', wasUnit: 'lot', override: true, cost_code: null, default_markup_pct: 10 },
  // LEED/Gov't job surcharge moved to the Administrative Overrides section
  // below (a level dropdown × fixed hours × the company's configured LEED
  // $/hr, not a manual $ line) — see the leed_level override field,
  // leedHourlyRate, and leedSurchargeAmount.
];

// Line Total for qty x rate / coverage lines (flat lines are 1 x amount).
const computeLineTotal = (cat, line) => (cat?.inputMode === 'coverage'
  ? ((line.quantity || 0) / (line.coverage_rate || 300)) * (line.unit_cost || 0)
  : (line.quantity || 0) * (line.unit_cost || 0));

const PULL_TITLES = {
  bolts: 'Bolts / Fasteners in the takeoff',
  anchor_bolts: 'Anchor bolts in the takeoff',
  tons: 'Tons in the takeoff',
  paint_sqft: 'Painted area in the takeoff',
  priming_hours: 'Shop priming hours from painted area',
};

const TakeoffEngine = forwardRef(function TakeoffEngine({ bid, onSaved, onOpenFullTakeoff }, ref) {
  const { toast } = useToast();
  const navigate = useNavigate();
  // The shop priming sq ft/hr production rate. (Company rates for
  // RATE_DEFAULT_CATEGORY_KEYS go straight into each line's rate box — see
  // buildWorksheetLineMap.)
  const [primingRate, setPrimingRate] = useState(() => resolveShopPrimingRate(null));
  // "Pull from takeoff": which line's panel is open and the takeoff records
  // it reads (loaded when a panel first opens; the refresh button reloads).
  const [openPullKey, setOpenPullKey] = useState(null);
  const [pullData, setPullData] = useState(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullError, setPullError] = useState('');
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
  const [scopeEdited, setScopeEdited] = useState(false);
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
  // $/hr the LEED surcharge is priced at — see resolveLeedHourlyRate in
  // bidWorksheetCalc.js. Starts from the bid's own snapshot (or the $50
  // fallback) and is re-resolved against the company's configured rate once
  // loadLines has fetched CostCategoryDefaultRate.
  const [leedHourlyRate, setLeedHourlyRate] = useState(() => resolveLeedHourlyRate(bid, null));

  const [company, setCompany] = useState(null);
  // Freight mileage calculator: finds the DeliveryPricingTier for the driving
  // distance and fills its $/trip into the Jobsite Freight (Material
  // Delivery) rate (freightFollowsMileage below) — it has no total of its
  // own and posts nothing to the job cost ledger. See
  // the Delivery Pricing Tiers section of CostCategoryRatesAdmin.jsx
  // (/admin/bid-worksheet-rates) for the tier structure itself.
  const [freightTiers, setFreightTiers] = useState([]);
  const [freightDistance, setFreightDistance] = useState(bid?.delivery_distance_miles ?? null);
  const [freightLoading, setFreightLoading] = useState(false);
  const [freightError, setFreightError] = useState('');
  // Company $/load for Jobsite Freight (Bid Worksheet Default Rates), set in
  // loadLines — a line still on it follows the mileage tier.
  const freightDefaultRateRef = useRef(0);

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
    setFreightDistance(null);
    setFreightError('');
    if (!jobsiteAddress || !companyAddress) {
      setFreightError('Enter a jobsite address above and your company address in Settings to calculate mileage automatically.');
      return () => { cancelled = true; };
    }
    // liveTaxBid (BidDetail.jsx) overlays the Base Information address fields
    // onto `bid` on every keystroke so tax calc can react instantly — this
    // effect's deps ride along with that. Without a debounce, this fired a
    // live Nominatim geocode + OSRM route request on every single keystroke
    // while a user typed the job address, hammering Nominatim's ~1req/sec
    // public-instance limit and frequently surfacing a rate-limit/geocode
    // error for the finished address because of the burst of stale,
    // in-flight lookups for partial addresses typed a moment earlier. Wait
    // for typing to pause before firing.
    const timer = setTimeout(() => {
      const run = async () => {
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
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobsiteAddress, companyAddress]);

  const matchedFreightTier = matchDeliveryTier(freightTiers, freightDistance);
  const maxTierMiles = freightTiers.length > 0 ? Math.max(...freightTiers.map((t) => t.max_miles ?? 0)) : null;
  const freightNoTierReason = freightDistance != null && !matchedFreightTier && maxTierMiles != null
    ? `Mileage exceeds ${maxTierMiles} miles — no matching tier; price Jobsite Freight manually.`
    : '';

  // The mileage tier's $/trip goes straight into the Jobsite Freight rate, so
  // the estimator only enters the number of loads. A rate typed by hand
  // (rate_source 'manual') is left alone; "Use mileage rate" puts the line
  // back on the tier. Lines saved before rate_source existed follow the
  // mileage only when their rate is empty, the company $/load, or a tier
  // rate (an earlier "Use Rate") — a custom rate on an old bid is kept.
  const freightFollowsMileage = (line) => {
    if (!line) return true;
    if (line.rate_source === 'mileage') return true;
    if (line.rate_source === 'manual') return false;
    const rate = Number(line.unit_cost) || 0;
    if (rate === 0 || rate === freightDefaultRateRef.current) return true;
    return freightTiers.some((t) => Number(t.cost_per_trip) === rate);
  };
  const applyMileageFreightRate = (tier) => {
    if (!tier) return;
    const cat = COST_CATEGORIES.find((c) => c.key === 'jobsite_freight');
    setLines((prev) => {
      const line = prev.jobsite_freight || { quantity: 0, unit_cost: 0, total_cost: 0 };
      const updated = { ...line, unit_cost: Number(tier.cost_per_trip) || 0, rate_source: 'mileage' };
      updated.total_cost = computeLineTotal(cat, updated);
      return { ...prev, jobsite_freight: updated };
    });
    setDirty(true);
  };
  const freightLine = lines.jobsite_freight;
  const freightOnMileage = Boolean(matchedFreightTier) && freightFollowsMileage(freightLine);
  useEffect(() => {
    if (loading || !matchedFreightTier || !freightFollowsMileage(freightLine)) return;
    const tierRate = Number(matchedFreightTier.cost_per_trip) || 0;
    if ((Number(freightLine?.unit_cost) || 0) === tierRate) return;
    applyMileageFreightRate(matchedFreightTier);
  }, [loading, matchedFreightTier?.id, matchedFreightTier?.cost_per_trip, freightLine?.unit_cost, freightLine?.rate_source]);

  const visibleCategories = hasModule(company, '/shop-fabrication')
    ? COST_CATEGORIES
    : COST_CATEGORIES.filter((cat) => !FABRICATION_ONLY_CATEGORIES.includes(cat.key));

  useEffect(() => { loadLines(); }, [bid?.id]);

  const takeoffFabHours = roundTakeoffHours(bid?.estimated_man_hours);

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

  // Scope Text saved on its own tab: follow it here unless this screen has
  // its own unsaved edit of the same text.
  useEffect(() => {
    if (scopeEdited) return;
    setInclusions(bid?.inclusions || '');
    setExclusions(bid?.exclusions || '');
  }, [bid?.inclusions, bid?.exclusions]);

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
      const [existing, categoryRateDefaults] = await Promise.all([
        db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 100),
        db.entities.CostCategoryDefaultRate.list('-effective_date', 500).catch(() => []),
      ]);
      const defaultRateByCategory = buildCostCategoryRateMap(categoryRateDefaults, RATE_DEFAULT_CATEGORY_KEYS);
      freightDefaultRateRef.current = defaultRateByCategory.get('jobsite_freight') ?? 0;
      setPrimingRate(resolveShopPrimingRate(currentCostCategoryRate(categoryRateDefaults, SHOP_PRIMING_RATE_KEY)?.hourly_rate));
      const configuredLeedRate = currentCostCategoryRate(categoryRateDefaults, LEED_RATE_CATEGORY_KEY);
      setLeedHourlyRate(resolveLeedHourlyRate(bid, configuredLeedRate ? configuredLeedRate.hourly_rate : null));
      // Each category's own default_markup_pct is the DEFAULT that pre-fills
      // a brand-new line's markup_percentage; Bid.markup_percentage is only
      // the fallback for the rare category missing one. This also covers any
      // line saved before per-line markup existed (found.markup_percentage
      // is undefined there), so opening an older bid doesn't silently zero
      // out the markup it was actually quoted at.
      // Map building (default markup per category, Full Takeoff auto-fill of
      // Primer (Paint)/Galvanizing/Structural Fabrication quantities) lives in
      // bidWorksheetCalc.js's buildWorksheetLineMap, shared with the Full
      // Breakdown export so both read the exact same lines.
      const map = buildWorksheetLineMap({
        categories: COST_CATEGORIES,
        existing,
        bid,
        defaultRateByCategory,
        rateDefaultKeys: RATE_DEFAULT_CATEGORY_KEYS,
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
      // Only a hand-typed QUANTITY detaches an auto-filled line from the
      // takeoff — the auto-fill only ever supplies quantity, and loadLines
      // keeps the saved rate/coverage either way, so setting the shop rate
      // on an auto-filled line must not stop its hours following the takeoff.
      const updated = { ...line, [field]: value, is_overridden: line.is_auto_filled && field === 'quantity' ? true : line.is_overridden };
      // Re-entering the count or the price each replaces an old quote; a
      // hand-typed quantity replaces a pulled one (its note goes with it).
      if ((field === 'quantity' || field === 'unit_cost') && line.legacy_quote_amount != null) updated.legacy_quote_amount = null;
      if (field === 'quantity' && line.notes) updated.notes = undefined;
      // A typed freight rate wins over the mileage tier from here on.
      if (key === 'jobsite_freight' && field === 'unit_cost') updated.rate_source = 'manual';
      const cat = COST_CATEGORIES.find(c => c.key === key);
      updated.total_cost = computeLineTotal(cat, updated);
      return { ...prev, [key]: updated };
    });
    setDirty(true);
  };

  // Galvanizing tons <-> lbs: quantity and rate both convert, the line
  // total doesn't move (convertLineUnit in bidWorksheetCalc.js). Not an
  // override — an auto-filled line keeps following the takeoff in the new
  // unit.
  const changeLineUnit = (key, toUnit) => {
    const cat = COST_CATEGORIES.find(c => c.key === key);
    setLines(prev => ({ ...prev, [key]: convertLineUnit(cat, prev[key] || { quantity: 0, unit_cost: 0, total_cost: 0 }, toUnit) }));
    setDirty(true);
  };

  // Applies a number the estimator picked in a "Pull from takeoff" panel.
  // option.follow (Primer (Paint) from the Full Takeoff) re-attaches the
  // line to the takeoff the same way the auto-fill does; anything else is a
  // one-time value with a note saying where it came from. An old Bolts quote
  // keeps its total: the price each becomes quote ÷ count until retyped.
  const applyPulledQuantity = (key, option) => {
    const cat = COST_CATEGORIES.find(c => c.key === key);
    setLines(prev => {
      const line = prev[key] || { quantity: 0, unit_cost: 0, total_cost: 0, coverage_rate: 300 };
      // Painted sq ft is kept to two decimals.
      const qty = key === 'primer_paint' ? Math.round((Number(option.value) || 0) * 100) / 100 : option.value;
      const updated = { ...line, quantity: qty, source: 'calculated' };
      if (option.follow) {
        updated.is_auto_filled = true;
        updated.is_overridden = false;
        updated.notes = undefined;
      } else {
        updated.is_overridden = line.is_auto_filled ? true : line.is_overridden;
        updated.notes = option.applyNote;
      }
      if (Number(line.legacy_quote_amount) > 0 && qty > 0) {
        updated.unit_cost = Number(line.legacy_quote_amount) / qty;
        updated.total_cost = Number(line.legacy_quote_amount);
      } else {
        updated.total_cost = computeLineTotal(cat, updated);
      }
      return { ...prev, [key]: updated };
    });
    setDirty(true);
  };

  const loadPullData = async () => {
    if (!bid?.id) return;
    setPullLoading(true);
    setPullError('');
    try {
      const [materialLines, sessions, shapeTypes, steelRows] = await Promise.all([
        db.entities.MaterialTakeoffLine.filter({ bid_id: bid.id }, '-created_date', 1000),
        db.entities.blueprint_takeoffs.filter({ bid_id: bid.id }, '-created_date', 100).catch(() => []),
        db.entities.MaterialShapeType.filter({ category: 'Bolts/Fasteners' }, 'shape_code', 200).catch(() => []),
        db.entities.steel_catalog.list('size_designation', 2000).catch(() => []),
      ]);
      setPullData({ materialLines, sessions: sessions.filter((s) => !s.is_deleted), shapeTypes, steelRows });
    } catch (e) {
      setPullError(e?.message || 'Could not read the takeoff.');
    } finally {
      setPullLoading(false);
    }
  };

  const togglePull = (key) => {
    if (openPullKey === key) { setOpenPullKey(null); return; }
    setOpenPullKey(key);
    if (!pullData && !pullLoading) loadPullData();
  };

  // "Use takeoff hours" — puts the Structural Fabrication line back on the
  // takeoff's number and re-attaches it, so later takeoff saves flow through
  // again. Works for an overridden auto line and for a line typed in by hand
  // before auto-fill existed.
  const resetFabHoursToTakeoff = () => {
    setLines(prev => {
      const line = prev[FAB_HOURS_CATEGORY_KEY] || { quantity: 0, unit_cost: 0, coverage_rate: 300 };
      const updated = {
        ...line,
        quantity: takeoffFabHours,
        total_cost: takeoffFabHours * (line.unit_cost || 0),
        is_auto_filled: true,
        is_overridden: false,
        source: 'calculated',
      };
      return { ...prev, [FAB_HOURS_CATEGORY_KEY]: updated };
    });
    setDirty(true);
  };

  // Drill-down from the fabrication hours to the takeoff lines that produced
  // them (the Full Takeoff tab). Switching tabs unmounts this worksheet, so
  // unsaved edits here are saved first rather than silently dropped.
  const openFullTakeoff = async () => {
    if (!onOpenFullTakeoff) return;
    if (dirty) {
      const shouldSave = window.confirm('Save your worksheet changes before opening the Full Takeoff?');
      if (!shouldSave) return;
      const saved = await handleSave();
      if (!saved) return;
    }
    onOpenFullTakeoff();
  };

  // Drill-down to this bid's IRONSIGHT session(s), saving first the same way.
  const openIronsight = async () => {
    if (!bid?.id) return;
    if (dirty) {
      const shouldSave = window.confirm('Save your worksheet changes before opening IRONSIGHT?');
      if (!shouldSave) return;
      const saved = await handleSave();
      if (!saved) return;
    }
    navigate(`/estimating/blueprint-takeoff/${bid.id}`);
  };

  const openPullSource = (kind) => {
    if (kind === 'full_takeoff') openFullTakeoff();
    else if (kind === 'ironsight') openIronsight();
  };

  // Props for a line's "Pull from takeoff" panel: the numbers it can apply
  // (with their math) and, for fasteners, the counts by source and size.
  const pullPanelProps = (cat, line) => {
    const data = pullData || { materialLines: [], sessions: [], shapeTypes: [], steelRows: [] };
    const base = { title: PULL_TITLES[cat.takeoffPull], loading: pullLoading || (!pullData && !pullError), error: pullError, currentValue: Number(line.quantity) || 0, unitLabel: lineLabels(cat, line).qtyLabel };
    if (cat.takeoffPull === 'bolts' || cat.takeoffPull === 'anchor_bolts') {
      const isAnchor = cat.takeoffPull === 'anchor_bolts';
      const pull = buildFastenerCountPull({ ...data, codes: isAnchor ? ANCHOR_PULL_CODES : BOLT_PULL_CODES, byLengthCodes: isAnchor ? [] : BY_LENGTH_FASTENER_CODES });
      const option = (key, label, value, sourceKind, lines) => ({ key, label, value, unit: 'ea', decimals: 0, sourceKind, lines, applyNote: `Qty pulled from takeoff: ${label} ${value.toLocaleString()} ea` });
      const [ft, ir] = pull.sources;
      return {
        ...base,
        groups: pull.sources.map((src) => ({
          key: src.key,
          label: src.label,
          sourceKind: src.key,
          total: src.total,
          unit: 'ea',
          emptyText: src.key === 'ironsight' ? 'No pushed IRONSIGHT counts of these types.' : 'No lines of these types.',
          rows: src.groups.map((g) => ({ key: `${g.code}|${g.size}|${g.grade}`, label: `${g.code} ${g.size}${g.grade ? ` — ${g.grade}` : ''}`, value: g.qty })),
        })),
        options: [
          { ...option('total', 'Total, both sources', pull.total, null, pull.lines), applyNote: pull.applyNote },
          option('full_takeoff', 'Full Takeoff only', ft.total, 'full_takeoff', ft.groups.map((g) => `${g.code} ${g.size}: ${g.qty}`)),
          option('ironsight', 'IRONSIGHT only', ir.total, 'ironsight', ir.groups.map((g) => `${g.code} ${g.size}: ${g.qty}`)),
        ],
        footnotes: [
          `Counts ${pull.codes.join(', ')}${isAnchor ? '' : ' (anchor bolts are on the Anchor Bolts line)'}. IRONSIGHT counts are included once pushed to the estimate from its Markups List.`,
          pull.byLength.length ? `Bought by length, not counted: ${pull.byLength.map((r) => `${r.code} ${r.size} — ${r.qty} pcs${r.lengthFt ? ` @ ${r.lengthFt} ft` : ''}`).join('; ')}.` : '',
          pull.unknown.length ? `IRONSIGHT bolt counts with no type, not counted: ${pull.unknown.map((r) => `${r.label} (${r.qty})`).join('; ')}.` : '',
          Number(line.legacy_quote_amount) > 0 ? 'This line was a quote — Use keeps that total and splits it per piece until you type the real price each.' : '',
        ],
      };
    }
    if (cat.takeoffPull === 'tons') {
      const pull = buildTonsPull({ bid, materialLines: data.materialLines });
      return {
        ...base,
        groups: [
          { key: 'typed', label: 'Typed in the Full Takeoff', sourceKind: 'full_takeoff', total: pull.typed, unit: 't', decimals: 3, rows: pull.rows.filter((r) => r.source === 'full_takeoff').map((r) => ({ key: r.lineId, label: r.label, value: r.tons })) },
          { key: 'ironsight', label: 'Pushed from IRONSIGHT', sourceKind: 'ironsight', total: pull.pushed, unit: 't', decimals: 3, emptyText: 'No pushed IRONSIGHT lines with tons.', rows: pull.rows.filter((r) => r.source === 'ironsight').map((r) => ({ key: r.lineId, label: r.label, value: r.tons })) },
        ],
        options: pull.options,
        footnotes: ['Pick one — the Full Takeoff total already includes the IRONSIGHT lines shown in its grid, so they are never added together.'],
      };
    }
    const paintPull = buildPaintAreaPull({ bid, materialLines: data.materialLines, sessions: data.sessions, steelRows: data.steelRows });
    if (cat.takeoffPull === 'paint_sqft') {
      return { ...base, groups: [], options: paintPull.options, footnotes: ['Full Takeoff keeps this line following its paint area (AUTO). An IRONSIGHT or combined number is a one-time value.'] };
    }
    const primerLine = lines.primer_paint || {};
    const pull = buildPrimingHoursPull({ primerSqft: primerLine.quantity, paintPull, sqftPerHour: primingRate.value, rateIsDefault: primingRate.isDefault });
    return {
      ...base,
      groups: [],
      options: pull.options,
      footnotes: [
        primingRate.isDefault ? `Using the default ${primingRate.value} sq ft per hour — an admin can set the company's rate at Bid Worksheet Default Rates.` : `Company rate: ${primingRate.value} sq ft per hour (Bid Worksheet Default Rates).`,
        'Hours stay editable after you use one.',
      ],
    };
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
      // A typed amount replaces one carried in from an old qty x rate line.
      const updated = { ...line, quantity: 1, unit_cost: value, total_cost: value, carried_from: undefined, is_overridden: line.is_auto_filled ? true : line.is_overridden };
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

  // Every total below comes from bidWorksheetCalc.js's computeWorksheetTotals
  // (shared with the Full Breakdown PDF/Excel export). Each line item carries
  // its own markup % — Quoted Price = Line Total * lineMarkupMultiplier — and
  // every downstream figure (tax, bond, grand total) is the SUM of each line's
  // own quoted price. Tax is charged on the marked-up (sell) price. The
  // summary's markup % is the dollar-weighted average (markupAmount /
  // subtotal). Tax is gated on bid.tax_exempt (the single source of truth,
  // the inverse of Base Info's "Tax Enabled" toggle) so on/off is immediate
  // even before the async taxInfo effect resolves. Taxable/non-taxable is the
  // is_taxable flag on COST_CATEGORIES. Joist & Deck uses its own
  // joist_deck_tax_rate, gated by the same tax_exempt flag. Bond and the
  // Procore/Textura fees are each layered on top of the total before them.
  const joistDeckTaxRate = getJoistDeckTaxRate(bid, taxInfo.rate);
  const {
    subtotal, markupAmount, averageMarkupPct, overrideTotal,
    calculatedTaxRate, structuralTaxAmount, joistDeckTaxAmount,
    includedInsuranceAllocation, leedSurchargeAmount,
    bondRate, computedBondAmount, bondOverrideValue, includedBondAmount,
    procorePlatformFee, texturaPlatformFee, includedProcoreFee, includedTexturaFee, totalWithTax,
  } = computeWorksheetTotals({
    categories: COST_CATEGORIES,
    lines,
    bid,
    taxRate: taxInfo.rate,
    joistDeckTaxRate,
    insuranceOverride: overrides.insurance,
    bondOverride: overrides.bond,
    leedLevel: overrides.leed_level,
    leedHourlyRate,
    insuranceInputs,
    insuranceEnabled,
    bondEnabled,
    procorePayEnabled,
    texturaEnabled,
  });
  const isWorksheetAdmin = currentUserRoles.some(r => ['admin', 'super_admin'].includes(normalizeRoleName(r)));
  const canOpenDocuments = currentUserRoles.some(r => ['admin', 'estimator', 'president', 'ceo', 'finance_department'].includes(normalizeRoleName(r)));

  // Returns true when saved. { quiet } skips the success toast (Save
  // Estimate shows one summary).
  const handleSave = async ({ quiet = false } = {}) => {
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
          // The line's unit (Galvanizing: the picked tons/lbs). Also marks the
          // line as saved under the current entry rules (see migrateSavedLine).
          unit_of_measure: lineUnit(cat, line),
          // Where a pulled quantity came from ("Qty pulled from takeoff: …").
          notes: line.notes || undefined,
          // Jobsite Freight: 'mileage' = rate follows the Freight Mileage
          // Calculator's tier, 'manual' = typed by the estimator.
          rate_source: cat.key === 'jobsite_freight' ? (line.rate_source || undefined) : undefined,
        };
        // Bolts / Fasteners: an old quote still waiting to be re-entered.
        if (cat.fromQuote) payload.legacy_quote_amount = Number(line.legacy_quote_amount) > 0 ? Number(line.legacy_quote_amount) : null;
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
        // Inclusions / Exclusions are shared with the Scope Text tab — only
        // written when they were edited here, so this save never puts an
        // older copy back over Scope Text's.
        ...(scopeEdited ? { inclusions, exclusions } : {}),
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
        // Snapshot only alongside a LEED level, so a non-LEED bid that later
        // becomes one picks up the company's then-current rate.
        leed_hourly_rate: overrides.leed_level ? leedHourlyRate : null,
        delivery_distance_miles: freightDistance,
      });
      if (!quiet) toast({ title: 'Takeoff saved!' });
      setDirty(false);
      setScopeEdited(false);
      onSaved?.();
      return true;
    } catch (e) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
      return false;
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

  // Plain-language note under the Structural Fabrication line saying where
  // its hours came from. Every hours figure here is a link to the Full
  // Takeoff tab (the takeoff lines behind it) when the parent provides one.
  const renderFabHoursNote = (line) => {
    const lineHours = Number(line.quantity) || 0;
    const hoursLink = (hours, className) => (onOpenFullTakeoff ? (
      <button type="button" onClick={openFullTakeoff} title="Show the takeoff lines these hours come from" className={cn('font-semibold underline underline-offset-2 hover:opacity-80', className)}>
        {formatHours(hours)} hrs
      </button>
    ) : <span className={cn('font-semibold', className)}>{formatHours(hours)} hrs</span>);
    const openTakeoffButton = onOpenFullTakeoff && (
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={openFullTakeoff}>Open Full Takeoff</Button>
    );
    const useTakeoffButton = (
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={resetFabHoursToTakeoff}>Use takeoff hours</Button>
    );

    if (takeoffFabHours <= 0) {
      if (line.is_auto_filled && !line.is_overridden && lineHours > 0) {
        return (
          <div className="w-full flex flex-wrap items-center gap-2 text-xs text-yellow-700 dark:text-yellow-500">
            <span>The Full Takeoff now shows 0 shop hours, but this line still has {formatHours(lineHours)} hrs from an earlier takeoff. Check the takeoff, or type the hours you want.</span>
            {openTakeoffButton}
          </div>
        );
      }
      return (
        <div className="w-full flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>No takeoff hours yet. Fill in and save the Full Takeoff and its shop hours will drop in here — or type the hours in yourself.</span>
          {openTakeoffButton}
        </div>
      );
    }

    if (line.is_auto_filled && !line.is_overridden) {
      return (
        <div className="w-full flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
            From takeoff: {hoursLink(takeoffFabHours)}
          </span>
          <span className="text-muted-foreground">Follows the Full Takeoff every time it's saved. Type a different number to set your own.</span>
        </div>
      );
    }

    return (
      <div className="w-full flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-500">
          {line.is_overridden ? 'Overridden' : 'Typed in by hand'} — takeoff says {hoursLink(takeoffFabHours)}
        </span>
        {useTakeoffButton}
      </div>
    );
  };

  if (loading) return <div className="h-64 bg-muted rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      {/* Autofill indicator */}
      {Object.values(lines).some(l => l.is_auto_filled) && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-blue-700 dark:text-blue-400">
            Blue rows were filled in from the Full Takeoff. Yellow rows were changed by hand and no longer follow the takeoff.
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
            const labels = lineLabels(cat, line);
            const pullButton = cat.takeoffPull && (
              <Button type="button" variant={openPullKey === cat.key ? 'secondary' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => togglePull(cat.key)} title="See what the Full Takeoff and IRONSIGHT have for this line, and pick a number to use">
                <Download className="w-3.5 h-3.5 mr-1" />Pull from takeoff
              </Button>
            );
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
                  {cat.key === 'jobsite_freight' && freightOnMileage && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium" title={`Rate/load from the Freight Mileage Calculator: ${freightDistance?.toFixed(1)} mi, ${matchedFreightTier.min_miles}–${matchedFreightTier.max_miles} mi tier. Enter the number of loads.`}>MILES</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[220px]">
                  {cat.inputMode === 'coverage' ? (
                    <>
                      {/* Painted sq ft runs to five or six digits — wide box, two decimals. */}
                      <div className="w-full sm:w-52 flex items-center gap-1">
                        <Input type="number" step="0.01" value={line.quantity || ''} placeholder="0.00"
                          onChange={e => updateLine(cat.key, 'quantity', parseFloat(e.target.value) || 0)}
                          onBlur={e => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v) && Math.round(v * 100) / 100 !== v) updateLine(cat.key, 'quantity', Math.round(v * 100) / 100);
                          }}
                          className="h-8 text-sm min-w-[8rem]" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{cat.qtyLabel}</span>
                      </div>
                      <div className="min-w-[9rem] sm:min-w-40 w-auto flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        {(() => {
                          // Paint price per gallon: set by an admin in Bid
                          // Worksheet Default Rates; read-only for everyone else.
                          const locked = ADMIN_ONLY_RATE_KEYS.includes(cat.key) && !isWorksheetAdmin;
                          return (
                            <Input type="number" value={line.unit_cost || ''} placeholder="0.00" step="0.01"
                              readOnly={locked}
                              title={locked ? 'Set by an admin in Bid Worksheet Default Rates' : undefined}
                              onChange={e => { if (!locked) updateLine(cat.key, 'unit_cost', parseFloat(e.target.value) || 0); }}
                              className={cn('h-8 text-sm', locked && 'bg-muted/40 cursor-not-allowed')} />
                          );
                        })()}
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
                      {pullButton}
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
                      {cat.unitOptions && (
                        <UnitToggle options={cat.unitOptions} unit={lineUnit(cat, line)} onChange={(u) => changeLineUnit(cat.key, u)} />
                      )}
                      <div className={cn('w-full flex items-center gap-1', cat.unitOptions ? 'sm:w-36' : 'sm:w-28')}>
                        <Input type="number" value={line.quantity || ''} placeholder="0"
                          onChange={e => updateLine(cat.key, 'quantity', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" />
                        <span className={cn('text-xs w-12', cat.unitOptions ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{labels.qtyLabel}</span>
                      </div>
                      <div className="min-w-[9rem] sm:min-w-40 w-auto flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input type="number" value={line.unit_cost || ''} placeholder="0.00" step="any"
                          onChange={e => updateLine(cat.key, 'unit_cost', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" />
                        {labels.rateLabel && <span className={cn('text-[10px] whitespace-nowrap', cat.unitOptions ? 'font-semibold text-foreground' : 'text-muted-foreground hidden lg:inline')}>{labels.rateLabel}</span>}
                      </div>
                      {pullButton}
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
                {cat.key === FAB_HOURS_CATEGORY_KEY && renderFabHoursNote(line)}
                <LineNotes line={line} qtyLabel={labels.qtyLabel} />
                {cat.takeoffPull && openPullKey === cat.key && (
                  <TakeoffPullPanel
                    {...pullPanelProps(cat, line)}
                    onApply={(option) => applyPulledQuantity(cat.key, option)}
                    onOpenSource={openPullSource}
                    onRefresh={loadPullData}
                    onClose={() => setOpenPullKey(null)}
                  />
                )}
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
          Driving distance from your company address (Settings) to this bid's jobsite address (Base Information above), looked up against the Delivery Pricing Tiers. The tier's rate per load goes into the Jobsite Freight (Material Delivery) line above automatically — you only enter the number of loads.
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
            </div>
          </div>
        </div>

        {matchedFreightTier && (freightOnMileage ? (
          <p className="text-xs text-green-600 mt-3">
            Filled into Jobsite Freight (Material Delivery) as the rate per load — just enter the number of loads there.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-600">
            <span>
              Jobsite Freight uses a typed rate (${(Number(freightLine?.unit_cost) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/load), not this tier.
            </span>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => applyMileageFreightRate(matchedFreightTier)}>
              Use mileage rate
            </Button>
          </div>
        ))}

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
                  {(bondRate * 100).toFixed(3)}% tiered rate — ${computedBondAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} calculated
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
                {LEED_SURCHARGE_LEVELS.find(l => l.value === overrides.leed_level)?.hours} hrs × ${Number(leedHourlyRate).toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr = ${leedSurchargeAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
            onChange={e => { setInclusions(e.target.value); setScopeEdited(true); setDirty(true); }}
            placeholder="List items included in this bid scope…"
            className="mt-2 min-h-[120px]"
            id="inclusions"
          />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Exclusions</Label>
          <Textarea
            value={exclusions}
            onChange={e => { setExclusions(e.target.value); setScopeEdited(true); setDirty(true); }}
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