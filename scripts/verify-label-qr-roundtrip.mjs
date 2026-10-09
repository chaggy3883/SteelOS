// One-time acceptance proof for the label QR fix (PrintableLabelSheet.jsx /
// labelPdf.js / labelQr.js): generates a real QR for a sample payload using
// the exact same encoder the app ships, rasterizes and decodes it with an
// independent QR decoder, and confirms the decoded string is byte-for-byte
// the original payload. Then feeds that decoded string through the app's
// actual scan-matching logic (pieceScan.js) to confirm a scan resolves to
// the right piece. Not wired into `npm run build` — run manually with
// `node scripts/verify-label-qr-roundtrip.mjs` after touching the label QR
// pipeline.
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { generateLabelQrDataUrl } from '../src/lib/labelQr.js';
import { matchPieceByScan } from '../src/lib/pieceScan.js';

const SAMPLE_PAYLOAD = 'QR-HARBOR-BM12-K3X9F2Q';

function dataUrlToPngBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

function decodePng(buffer) {
  return new Promise((resolve, reject) => {
    new PNG().parse(buffer, (err, png) => (err ? reject(err) : resolve(png)));
  });
}

async function main() {
  let failures = 0;
  const check = (label, pass, detail) => {
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? `: ${detail}` : ''}`);
    if (!pass) failures += 1;
  };

  // 1) Generate the exact QR raster the app embeds in both the on-screen
  // preview (PrintableLabelSheet.jsx) and the printed PDF (labelPdf.js).
  const dataUrl = await generateLabelQrDataUrl(SAMPLE_PAYLOAD, { widthPx: 512 });
  check('generateLabelQrDataUrl returns a PNG data URI', dataUrl.startsWith('data:image/png;base64,'));

  // 2) Rasterize + decode with an independent decoder (jsqr), not the
  // encoder's own internals — a real round trip, not a tautology.
  const png = await decodePng(dataUrlToPngBuffer(dataUrl));
  const decoded = jsQR(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height);
  check('jsQR decoded a QR code from the generated raster', !!decoded);
  check(
    'decoded payload matches the original exactly',
    decoded?.data === SAMPLE_PAYLOAD,
    `expected "${SAMPLE_PAYLOAD}", got "${decoded?.data}"`
  );

  // 3) Confirm the app's actual scan-resolution code (the same function
  // every scan surface — ShopFabrication, YardScanning, the camera scanner —
  // calls) resolves the decoded string back to the right piece.
  const pieces = [
    { id: 'piece-1', qr_payload_string: SAMPLE_PAYLOAD, piece_mark: 'BM12', project_id: 'project-harbor' },
    { id: 'piece-2', qr_payload_string: 'QR-OTHER-XYZ', piece_mark: 'BM13', project_id: 'project-harbor' },
  ];
  const { piece, ambiguous } = matchPieceByScan(pieces, decoded?.data ?? '');
  check('matchPieceByScan resolves the decoded QR to the correct piece', piece?.id === 'piece-1' && !ambiguous);

  console.log('');
  console.log(
    failures === 0
      ? 'ALL CHECKS PASSED — the printed label QR is genuinely scannable and resolves via the existing scan handler.'
      : `${failures} CHECK(S) FAILED — see above.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
