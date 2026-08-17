// Default ServiceSchedule baselines seeded once per company (see
// src/api/localData.js buildSeedData()). This is NOT read by any page or
// component at render time — EquipmentServiceForm.jsx and
// serviceScheduleEngine.js always read live ServiceSchedule records via
// db.entities.ServiceSchedule, so an admin editing/overriding a schedule in
// ServiceScheduleAdmin.jsx is the actual source of truth going forward.
// These are OEM-manual-baseline placeholders, not manufacturer specs.
//
// Each level stores ONLY its own checklist_items — composeCumulativeChecklist
// in serviceScheduleEngine.js composes B = A+B, C = A+B+C, D = A+B+C+D at
// render time, grouped by section across all contributing levels.

const item = (section, text, notesRequired = false) => ({ section, item: text, notes_required: notesRequired });

export const SERVICE_SCHEDULE_SEEDS = [
  // --- SEMI_TRACTOR (mileage-based) ---
  {
    equipment_type: 'SEMI_TRACTOR', service_level: 'A', interval_value: 10000, interval_unit: 'miles',
    interval_label: '10,000–15,000 mi',
    checklist_items: [
      item('Safety Inspection', 'Complete DOT pre-trip style safety inspection'),
      item('Chassis', 'Chassis lubrication (all grease fittings)'),
      item('Engine', 'Engine oil and filter change'),
      item('Brakes', 'Brake system inspection (pads/shoes/lines)', true),
      item('Lighting', 'Lights and reflectors functional check'),
      item('Tires', 'Tire tread depth and inflation pressure check'),
      item('Fluids', 'Fluid levels (coolant, power steering, washer)'),
    ],
  },
  {
    equipment_type: 'SEMI_TRACTOR', service_level: 'B', interval_value: 25000, interval_unit: 'miles',
    interval_label: '25,000–30,000 mi',
    checklist_items: [
      item('Fuel System', 'Fuel filter replacement'),
      item('Engine', 'Air filter inspection/replacement'),
      item('Driveline', 'Driveline inspection (u-joints, slip yoke)'),
      item('Powertrain', 'Powertrain inspection (transmission mounts, PTO)'),
      item('Brakes', 'Brake adjustment (slack adjusters)', true),
      item('Suspension', 'Suspension inspection (springs, air bags, shocks)'),
      item('Steering', 'Steering linkage inspection'),
    ],
  },
  {
    equipment_type: 'SEMI_TRACTOR', service_level: 'C', interval_value: 50000, interval_unit: 'miles',
    interval_label: '50,000–60,000 mi',
    checklist_items: [
      item('Cooling System', 'Coolant system service/flush'),
      item('Drivetrain Fluids', 'Transmission and differential fluid service'),
      item('Steering', 'Front-end alignment check'),
      item('Emissions', 'Aftertreatment/DPF service', true),
      item('Brakes', 'Brake drum/rotor measurement', true),
      item('Wheel Ends', 'Wheel-end service (bearings, seals)'),
    ],
  },
  {
    equipment_type: 'SEMI_TRACTOR', service_level: 'D', interval_value: 100000, interval_unit: 'miles',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '100,000 mi or annually',
    checklist_items: [
      item('Major Components', 'Major component rebuild/replacement assessment (engine, transmission)', true),
      item('Seasonal', 'Seasonal service / winterization'),
      item('Compliance', 'Federal annual inspection (49 CFR 396.17)', true),
    ],
  },

  // --- SEMI_TRAILER (calendar-based) ---
  {
    equipment_type: 'SEMI_TRAILER', service_level: 'A', interval_value: 3, interval_unit: 'months',
    interval_label: 'Quarterly (3 months)',
    checklist_items: [
      item('Lighting', 'Lights and marker lamps functional check'),
      item('Electrical', '7-way plug connection and continuity check'),
      item('Brakes', 'Brake function and adjustment check', true),
      item('Air System', 'Air lines inspection (chafing, leaks)'),
      item('Tires', 'Tire tread depth and pressure check'),
      item('Landing Gear', 'Landing gear operation (legs, crank, feet)'),
      item('Coupling', 'Kingpin and fifth-wheel plate wear inspection', true),
      item('Safety', 'Breakaway cable and system check'),
    ],
  },
  {
    equipment_type: 'SEMI_TRAILER', service_level: 'B', interval_value: 6, interval_unit: 'months',
    interval_label: '6 months',
    checklist_items: [
      item('Brakes', 'Brake lining thickness measurement', true),
      item('Brakes', 'Slack adjuster inspection'),
      item('Suspension', 'Suspension and air bag inspection'),
      item('Wheel Ends', 'Wheel bearing check'),
      item('Structure', 'Floor and deck condition inspection'),
    ],
  },
  {
    equipment_type: 'SEMI_TRAILER', service_level: 'C', interval_value: 12, interval_unit: 'months',
    interval_label: 'Annual (federal annual inspection)',
    checklist_items: [
      item('Brakes', 'Full brake service (linings, drums, hardware)', true),
      item('Wheel Ends', 'Wheel-end repack (bearings, seals)'),
      item('Structure', 'Structural/frame inspection', true),
      item('Compliance', 'DOT annual certification (49 CFR 396.17)', true),
    ],
  },
  {
    equipment_type: 'SEMI_TRAILER', service_level: 'D', interval_value: 999, interval_unit: 'months',
    interval_label: 'As-needed / major repair',
    checklist_items: [
      item('Structure', 'Axle or suspension rebuild assessment', true),
      item('Structure', 'Deck replacement assessment', true),
      item('Structure', 'Structural repair (frame, crossmembers)', true),
    ],
  },

  // --- MOBILE_CRANE (engine hours, some levels with a calendar backstop) ---
  {
    equipment_type: 'MOBILE_CRANE', service_level: 'A', interval_value: 250, interval_unit: 'engine_hours',
    interval_label: 'Daily/shift + 250 hours',
    checklist_items: [
      item('Operator Checks', 'Operator pre-use checks (controls, mirrors, backup alarm)'),
      item('Engine', 'Engine oil and filter check'),
      item('Engine', 'Air filter inspection'),
      item('Rigging', 'Wire rope visual inspection', true),
      item('Rigging', 'Hook throat opening and latch inspection', true),
      item('Safety Devices', 'LMI/RCI operation check'),
      item('Safety Devices', 'Anti-two-block system test'),
      item('Safety Devices', 'Hoist limit switch check'),
      item('Hydraulics', 'Hydraulic fluid level and leak check'),
    ],
  },
  {
    equipment_type: 'MOBILE_CRANE', service_level: 'B', interval_value: 500, interval_unit: 'engine_hours',
    interval_label: '500 hours',
    checklist_items: [
      item('Hydraulics', 'Hydraulic filter change'),
      item('Structure', 'Boom/telescoping section inspection', true),
      item('Outriggers', 'Outrigger pads and cylinders inspection'),
      item('Drivetrain', 'Swing/slew function check'),
      item('Rigging', 'Load line reeving inspection', true),
      item('Safety Devices', 'Fire suppression system check'),
    ],
  },
  {
    equipment_type: 'MOBILE_CRANE', service_level: 'C', interval_value: 1000, interval_unit: 'engine_hours',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '1,000 hours or 12 months',
    checklist_items: [
      item('Hydraulics', 'Full hydraulic oil replacement'),
      item('Rigging', 'Wire rope measurement and discard assessment (29 CFR 1926.1413)', true),
      item('Safety Devices', 'LMI calibration verification', true),
      item('Brakes', 'Brake overhaul'),
      item('Structure', 'Slew ring bolt torque check', true),
      item('Electrical', 'Full electrical system inspection'),
    ],
  },
  {
    equipment_type: 'MOBILE_CRANE', service_level: 'D', interval_value: 2000, interval_unit: 'engine_hours',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '2,000 hours or annual/major',
    checklist_items: [
      item('Structure', 'Structural NDT of boom sections and turntable', true),
      item('Load Testing', 'Load test', true),
      item('Major Components', 'Major component rebuild assessment'),
    ],
  },

  // --- AERIAL_BOOM_LIFT (engine hours, ANSI A92-style) ---
  {
    equipment_type: 'AERIAL_BOOM_LIFT', service_level: 'A', interval_value: 50, interval_unit: 'engine_hours',
    interval_label: 'Daily pre-use + 50 hours',
    checklist_items: [
      item('Pre-Use', 'Pre-use inspection (placards/decals legible, function tests)'),
      item('Engine', 'Engine/hydraulic oil level check'),
      item('Tires', 'Tire condition inspection'),
      item('Safety Devices', 'Tilt alarm function check', true),
      item('Safety Devices', 'Emergency lowering system check', true),
      item('Platform', 'Platform gate and guardrail inspection'),
      item('Fall Protection', 'Lanyard anchor point inspection', true),
    ],
  },
  {
    equipment_type: 'AERIAL_BOOM_LIFT', service_level: 'B', interval_value: 250, interval_unit: 'engine_hours',
    interval_label: '250 hours',
    checklist_items: [
      item('Hydraulics', 'Hydraulic filter check/replacement'),
      item('Chassis', 'Chassis lubrication'),
      item('Wheels', 'Wheel lug torque check'),
      item('Structure', 'Boom wear pad inspection'),
      item('Hydraulics', 'Hose and fitting inspection'),
    ],
  },
  {
    equipment_type: 'AERIAL_BOOM_LIFT', service_level: 'C', interval_value: 500, interval_unit: 'engine_hours',
    secondary_interval_value: 6, secondary_interval_unit: 'months',
    interval_label: '500 hours or 6 months',
    checklist_items: [
      item('Hydraulics', 'Hydraulic oil analysis'),
      item('Structure', 'ANSI A92 interim structural inspection', true),
      item('Controls', 'Function control calibration'),
      item('Electrical', 'Battery and electrical system inspection'),
    ],
  },
  {
    equipment_type: 'AERIAL_BOOM_LIFT', service_level: 'D', interval_value: 1000, interval_unit: 'engine_hours',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '1,000 hours or 12 months (ANSI A92.2 annual)',
    checklist_items: [
      item('Structure', 'Full structural NDT inspection', true),
      item('Controls', 'Load-sensing system calibration', true),
      item('Rigging', 'Wire rope/chain replacement assessment'),
      item('Hydraulics', 'Major hydraulic component overhaul'),
    ],
  },

  // --- TELEHANDLER_FORKLIFT (engine hours, OSHA 1910.178 / ANSI B56.6) ---
  {
    equipment_type: 'TELEHANDLER_FORKLIFT', service_level: 'A', interval_value: 50, interval_unit: 'engine_hours',
    interval_label: 'Daily pre-shift + 50 hours',
    checklist_items: [
      item('Pre-Shift', 'Pre-shift inspection (forks/carriage, tires, horn/lights)'),
      item('Engine', 'Engine oil and coolant level check'),
      item('Hydraulics', 'Hydraulic fluid level check'),
      item('Structure', 'Boom/attachment visual inspection', true),
      item('Operator Safety', 'Seatbelt and ROPS inspection'),
    ],
  },
  {
    equipment_type: 'TELEHANDLER_FORKLIFT', service_level: 'B', interval_value: 250, interval_unit: 'engine_hours',
    interval_label: '250 hours',
    checklist_items: [
      item('Hydraulics', 'Hydraulic filter change'),
      item('Engine', 'Air filter check'),
      item('Drivetrain', 'Transmission fluid check'),
      item('Structure', 'Boom pivot pin and bushing lubrication'),
      item('Compliance', 'Load chart/data plate legibility check'),
    ],
  },
  {
    equipment_type: 'TELEHANDLER_FORKLIFT', service_level: 'C', interval_value: 500, interval_unit: 'engine_hours',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '500 hours or annual OSHA inspection',
    checklist_items: [
      item('Brakes', 'Brake adjustment', true),
      item('Stability', 'Stabilizer/outrigger inspection', true),
      item('Structure', 'Boom wear pad replacement assessment'),
      item('Lubrication', 'Full lubrication service'),
    ],
  },
  {
    equipment_type: 'TELEHANDLER_FORKLIFT', service_level: 'D', interval_value: 1000, interval_unit: 'engine_hours',
    secondary_interval_value: 24, secondary_interval_unit: 'months',
    interval_label: '1,000 hours or major/2 years',
    checklist_items: [
      item('Hydraulics', 'Hydraulic cylinder reseal', true),
      item('Structure', 'Structural boom inspection', true),
      item('Drivetrain', 'Transmission/differential service'),
      item('Compliance', 'Load test verification', true),
    ],
  },

  // --- WELDING_MACHINE (engine-driven welder/generator set) ---
  {
    equipment_type: 'WELDING_MACHINE', service_level: 'A', interval_value: 50, interval_unit: 'engine_hours',
    interval_label: 'Daily/weekly + 50 hours',
    checklist_items: [
      item('Visual', 'Visual inspection of cables/leads for fraying', true),
      item('Engine', 'Engine oil level check'),
      item('Engine', 'Air filter check'),
      item('Grounding', 'Ground clamp condition check'),
      item('Electrical', 'Output cable connection check'),
    ],
  },
  {
    equipment_type: 'WELDING_MACHINE', service_level: 'B', interval_value: 250, interval_unit: 'engine_hours',
    interval_label: '100–250 hours',
    checklist_items: [
      item('Engine', 'Oil and filter change'),
      item('Fuel System', 'Fuel filter replacement'),
      item('Exhaust', 'Spark arrestor check (gas units)'),
      item('Cooling', 'Cooling fan and belt inspection'),
      item('Output', 'Duty-cycle/output calibration check', true),
    ],
  },
  {
    equipment_type: 'WELDING_MACHINE', service_level: 'C', interval_value: 500, interval_unit: 'engine_hours',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '500 hours or annual',
    checklist_items: [
      item('Engine', 'Full engine tune-up'),
      item('Generator Head', 'Generator winding insulation test', true),
      item('Electrical', 'Control board/electronics inspection'),
      item('Output', 'Calibration of output meters', true),
    ],
  },
  {
    equipment_type: 'WELDING_MACHINE', service_level: 'D', interval_value: 1000, interval_unit: 'engine_hours',
    interval_label: '1,000 hours or major',
    checklist_items: [
      item('Engine', 'Engine overhaul/rebuild assessment', true),
      item('Generator Head', 'Generator head rebuild/replacement assessment', true),
      item('Electrical', 'Complete rewiring inspection'),
    ],
  },

  // --- GENERATOR (standby/towable, NFPA 110-style intervals) ---
  {
    equipment_type: 'GENERATOR', service_level: 'A', interval_value: 50, interval_unit: 'engine_hours',
    interval_label: 'Weekly/monthly + 50 hours',
    checklist_items: [
      item('Visual', 'Visual inspection (leaks, damage, corrosion)'),
      item('Engine', 'Oil level check'),
      item('Cooling', 'Coolant level check'),
      item('Electrical', 'Battery terminals and charge check'),
      item('Engine', 'Air filter check'),
      item('Exercise', 'Exercise run/load check', true),
    ],
  },
  {
    equipment_type: 'GENERATOR', service_level: 'B', interval_value: 250, interval_unit: 'engine_hours',
    secondary_interval_value: 3, secondary_interval_unit: 'months',
    interval_label: '250 hours or quarterly',
    checklist_items: [
      item('Engine', 'Oil and filter change'),
      item('Fuel System', 'Fuel filter and fuel system inspection', true),
      item('Belts', 'Belt tension check'),
      item('Load Test', 'Load bank test', true),
    ],
  },
  {
    equipment_type: 'GENERATOR', service_level: 'C', interval_value: 500, interval_unit: 'engine_hours',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '500 hours or annual',
    checklist_items: [
      item('Cooling', 'Full coolant system service'),
      item('Electrical', 'Transfer switch inspection (if equipped)', true),
      item('Controls', 'Governor/voltage regulator calibration', true),
      item('Exhaust', 'Exhaust system inspection'),
    ],
  },
  {
    equipment_type: 'GENERATOR', service_level: 'D', interval_value: 1500, interval_unit: 'engine_hours',
    secondary_interval_value: 24, secondary_interval_unit: 'months',
    interval_label: '1,000–2,000 hours or major',
    checklist_items: [
      item('Engine', 'Engine overhaul assessment', true),
      item('Generator Head', 'Generator winding test', true),
      item('Electrical', 'Complete electrical system inspection'),
      item('Load Test', 'Load test at rated capacity', true),
    ],
  },

  // --- PICKUP_SERVICE_TRUCK (mileage-based, light/medium duty OEM schedule) ---
  {
    equipment_type: 'PICKUP_SERVICE_TRUCK', service_level: 'A', interval_value: 5000, interval_unit: 'miles',
    interval_label: '5,000–7,500 mi',
    checklist_items: [
      item('Engine', 'Oil and filter change'),
      item('Tires', 'Tire rotation and pressure check'),
      item('Fluids', 'Fluid levels check'),
      item('Lighting', 'Lights check'),
      item('Wipers', 'Wiper blade check'),
      item('Brakes', 'Brake visual check', true),
    ],
  },
  {
    equipment_type: 'PICKUP_SERVICE_TRUCK', service_level: 'B', interval_value: 15000, interval_unit: 'miles',
    interval_label: '15,000–22,500 mi',
    checklist_items: [
      item('Engine', 'Cabin/engine air filter replacement'),
      item('Drivetrain', 'Differential/transfer case fluid check'),
      item('Brakes', 'Brake pad measurement', true),
      item('Electrical', 'Battery test'),
      item('Engine', 'Belt/hose inspection'),
    ],
  },
  {
    equipment_type: 'PICKUP_SERVICE_TRUCK', service_level: 'C', interval_value: 30000, interval_unit: 'miles',
    interval_label: '30,000–45,000 mi',
    checklist_items: [
      item('Drivetrain', 'Transmission fluid service'),
      item('Cooling', 'Coolant flush'),
      item('Engine', 'Spark plug replacement (gas) or fuel filter (diesel)'),
      item('Suspension', 'Suspension/steering inspection', true),
      item('Steering', 'Alignment check'),
    ],
  },
  {
    equipment_type: 'PICKUP_SERVICE_TRUCK', service_level: 'D', interval_value: 60000, interval_unit: 'miles',
    secondary_interval_value: 12, secondary_interval_unit: 'months',
    interval_label: '60,000–100,000 mi or annually',
    checklist_items: [
      item('Engine', 'Timing belt/chain inspection', true),
      item('Engine', 'Major component service (injectors/turbo for diesel)', true),
      item('Service Body', 'Service body/utility box inspection (toolboxes, ladder rack, welder/compressor mounts)'),
      item('Compliance', 'Full DOT-style safety inspection (if GVWR requires)', true),
    ],
  },
];
