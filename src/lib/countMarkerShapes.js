// Draws one Count/Bolt Count dot — a filled circle when the group has a
// palette color, or one of a handful of flat symbol shapes once a page's
// 20-color palette is exhausted (see countMarkerPalette.js). Shared by the
// live BlueprintCanvas overlay and the small off-canvas swatches (setup
// modals, the Confirmed Measurements table) so a dot looks identical
// wherever it's shown.
export function drawCountMarker(ctx, x, y, { color, symbol } = {}, radius = 7) {
  ctx.save();
  if (color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  } else {
    drawSymbol(ctx, x, y, symbol || 'square', radius);
  }
  ctx.restore();
}

function fillPolygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function regularPolygonPoints(cx, cy, r, sides, rotation = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts;
}

function starPoints(cx, cy, outerR, innerR, spikes) {
  const pts = [];
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;
  for (let i = 0; i < spikes; i++) {
    pts.push([cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR]);
    rot += step;
    pts.push([cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR]);
    rot += step;
  }
  return pts;
}

function drawSymbol(ctx, x, y, symbol, r) {
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;

  switch (symbol) {
    case 'square':
      fillPolygon(ctx, [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]);
      break;
    case 'triangle':
      fillPolygon(ctx, [[x, y - r], [x + r, y + r * 0.8], [x - r, y + r * 0.8]]);
      break;
    case 'diamond':
      fillPolygon(ctx, [[x, y - r], [x + r, y], [x, y + r], [x - r, y]]);
      break;
    case 'pentagon':
      fillPolygon(ctx, regularPolygonPoints(x, y, r, 5, -Math.PI / 2));
      break;
    case 'hexagon':
      fillPolygon(ctx, regularPolygonPoints(x, y, r, 6, 0));
      break;
    case 'cross': {
      const w = r * 0.4;
      fillPolygon(ctx, [
        [x - w, y - r], [x + w, y - r], [x + w, y - w],
        [x + r, y - w], [x + r, y + w], [x + w, y + w],
        [x + w, y + r], [x - w, y + r], [x - w, y + w],
        [x - r, y + w], [x - r, y - w], [x - w, y - w],
      ]);
      break;
    }
    case 'star':
      fillPolygon(ctx, starPoints(x, y, r, r * 0.45, 5));
      break;
    default:
      fillPolygon(ctx, [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]);
  }
}
