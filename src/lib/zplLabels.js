// Raw ZPL string compiler for Zebra thermal printers. This app has no
// backend and no raw-socket API in a browser (port 9100 streaming needs a
// real TCP client), so this produces the exact ZPL payload a print server
// or utility like Zebra Setup Utilities/Printer Config would stream to the
// printer — it does not open a connection itself.

export const LABEL_STOCK_SIZES = {
  Piece_Mark: { key: '4x2', widthIn: 4, heightIn: 2, label: '4" x 2" (Piece Mark)' },
  Material_Stock: { key: '4x2', widthIn: 4, heightIn: 2, label: '4" x 2" (Material Stock)' },
  Shipping_Manifest: { key: '4x6', widthIn: 4, heightIn: 6, label: '4" x 6" (Master Shipping Manifest)' },
};

const DOTS_PER_INCH = 203; // standard industrial thermal desktop printer density

function escapeZpl(value) {
  return String(value ?? '').replace(/\^/g, '').replace(/~/g, '');
}

export function buildZplPayload({ labelType, title, subtitle, qrPayload }) {
  const size = LABEL_STOCK_SIZES[labelType] || LABEL_STOCK_SIZES.Piece_Mark;
  const widthDots = size.widthIn * DOTS_PER_INCH;
  const heightDots = size.heightIn * DOTS_PER_INCH;
  const safeTitle = escapeZpl(title);
  const safeSubtitle = escapeZpl(subtitle);
  const safeQr = escapeZpl(qrPayload);

  return [
    '^XA',
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    '^CF0,40',
    '^FO30,30^FD' + safeTitle + '^FS',
    '^CF0,24',
    '^FO30,90^FD' + safeSubtitle + '^FS',
    '^FO30,140^BQN,2,6',
    '^FDQA,' + safeQr + '^FS',
    '^XZ',
  ].join('\n');
}

export function buildPrintableLabel({ labelType, title, subtitle, qrPayload }) {
  const size = LABEL_STOCK_SIZES[labelType] || LABEL_STOCK_SIZES.Piece_Mark;
  return { size, title, subtitle, qrPayload };
}
