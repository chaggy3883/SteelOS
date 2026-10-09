// Single source of truth for turning a label's qr_payload_string into an
// actual scannable QR raster (a PNG data URI). Used by both the on-screen
// label preview (PrintableLabelSheet.jsx) and the printable PDF
// (labelPdf.js) so the two can never drift — same payload, same encoding
// options, same image, just displayed at different sizes.
//
// Error correction M (~15% recoverable) plus the library's own 4-module
// quiet zone is the standard choice for a printed/scanned industrial label —
// high enough to survive scuffs and dirty camera glass without needlessly
// bloating the module count (which would shrink each module on a small 4x2
// label and hurt scannability more than it helps).
import QRCode from 'qrcode';

export async function generateLabelQrDataUrl(payload, { widthPx = 512 } = {}) {
  return QRCode.toDataURL(String(payload ?? ''), {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: widthPx,
  });
}
