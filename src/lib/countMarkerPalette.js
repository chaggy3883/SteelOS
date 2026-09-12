// Shared color/symbol pool for the IRONSIGHT Count/Bolt Count click-to-mark
// engine (BlueprintTakeoff.jsx). ~20 visually distinguishable colors, styled
// after the standard Word/Excel color grid — the palette is scoped per PDF
// page (a color used on page 1 doesn't count against page 2's availability),
// so callers pass in only the colors already used ON THE CURRENT PAGE.
// Once all 20 are taken on a page, additional shape/size/length (or bolt)
// groups fall back to a distinct dot SYMBOL instead of a color.
export const COUNT_COLOR_PALETTE = [
  '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050',
  '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0',
  '#FF66CC', '#FF9900', '#996633', '#808080', '#000000',
  '#00FFFF', '#FF00FF', '#339933', '#3366FF', '#993366',
];

export const COUNT_SYMBOL_SET = ['square', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'cross'];

// First color in the palette not already used on the current page, or null
// once all 20 are taken (caller should fall back to the symbol picker).
export function nextAvailableColor(usedColors = new Set()) {
  return COUNT_COLOR_PALETTE.find((c) => !usedColors.has(c)) || null;
}

// Cycles through the symbol set once colors run out — a page needing a 21st,
// 28th, etc. distinct group reuses symbols rather than failing.
export function symbolForIndex(index) {
  return COUNT_SYMBOL_SET[((index % COUNT_SYMBOL_SET.length) + COUNT_SYMBOL_SET.length) % COUNT_SYMBOL_SET.length];
}
