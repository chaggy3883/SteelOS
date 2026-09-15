// The 16ths commonly used when reading structural steel dimensions off a
// drawing — shared by every feet-inches-fraction input in the app
// (BlueprintTakeoff.jsx's Set Scale calibration, CountSetupModal.jsx's
// Length/Width) so there's exactly one canonical list and one decimal-feet
// conversion, not a copy per screen.
export const FRACTION_OPTIONS = [
  { value: '0', label: '0' },
  { value: '0.0625', label: '1/16' },
  { value: '0.125', label: '1/8' },
  { value: '0.1875', label: '3/16' },
  { value: '0.25', label: '1/4' },
  { value: '0.3125', label: '5/16' },
  { value: '0.375', label: '3/8' },
  { value: '0.4375', label: '7/16' },
  { value: '0.5', label: '1/2' },
  { value: '0.5625', label: '9/16' },
  { value: '0.625', label: '5/8' },
  { value: '0.6875', label: '11/16' },
  { value: '0.75', label: '3/4' },
  { value: '0.8125', label: '13/16' },
  { value: '0.875', label: '7/8' },
  { value: '0.9375', label: '15/16' },
];

export function feetInchesFractionToDecimal(feet, inches, fraction) {
  return (parseFloat(feet) || 0) + ((parseFloat(inches) || 0) + (parseFloat(fraction) || 0)) / 12;
}

// Inverse of the above, snapped to the nearest 1/16" — used to re-populate
// the three inputs when editing an already-saved length/width, and to build
// a read-only feet-inches-fraction display string.
export function decimalFeetToFeetInchesFraction(decimalFt) {
  const totalSixteenths = Math.round((Number(decimalFt) || 0) * 12 * 16);
  const feet = Math.floor(totalSixteenths / (12 * 16));
  const remSixteenths = totalSixteenths - feet * 12 * 16;
  const inches = Math.floor(remSixteenths / 16);
  const sixteenths = remSixteenths - inches * 16;
  return { feet: String(feet), inches: String(inches), fraction: FRACTION_OPTIONS[sixteenths]?.value || '0' };
}

export function formatFeetInchesFraction(decimalFt) {
  const { feet, inches, fraction } = decimalFeetToFeetInchesFraction(decimalFt);
  const label = FRACTION_OPTIONS.find((f) => f.value === fraction)?.label;
  return `${feet}'-${inches}${fraction !== '0' && label ? `-${label}` : ''}"`;
}
