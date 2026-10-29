// The IRONSIGHT menu bar, built from the workspace's actions (`x`, wired in
// BlueprintTakeoff). Plain shop wording, our own layout. Every entry either
// does something real or is disabled with a reason; `keys` is both the
// label shown and the shortcut bound (workspaceShortcuts.js).
import { MEASURE_TOOLS } from '@/lib/takeoffGeometry';
import { MARKUP_TYPES, STAMPS } from '@/lib/drawingMarkups';
import { MARKUP_KEYS, MEASURE_KEYS } from './WorkspaceToolbars';

const NA = 'Not available';
const sep = { separator: true };

export function buildWorkspaceMenus(x) {
  const noFile = !x.hasFile;
  const markupItems = ['pen', 'highlight', 'line', 'arrow', 'polyline', 'polygon', 'rect', 'ellipse', 'cloud']
    .map((id) => ({ id: `mk-${id}`, label: MARKUP_TYPES[id].label, keys: MARKUP_KEYS[id], disabled: noFile, onSelect: () => x.startMarkup(id) }));
  const textItems = ['textbox', 'typewriter', 'callout', 'note']
    .map((id) => ({ id: `mk-${id}`, label: MARKUP_TYPES[id].label, keys: MARKUP_KEYS[id], disabled: noFile, onSelect: () => x.startMarkup(id) }));
  const measureItems = [
    { id: 'ms-count', label: 'Count', keys: MEASURE_KEYS.count, disabled: noFile, onSelect: () => x.startCount('beam') },
    { id: 'ms-bolt', label: 'Bolt Count', keys: MEASURE_KEYS.bolt_count, disabled: noFile, onSelect: () => x.startCount('bolt') },
    ...Object.entries(MEASURE_TOOLS).map(([id, def]) => ({ id: `ms-${id}`, label: def.label, keys: MEASURE_KEYS[id], disabled: noFile, onSelect: () => x.startMeasure(id) })),
  ];

  return [
    {
      id: 'file',
      label: 'File',
      items: [
        { id: 'open', label: 'Open a drawing for this project…', keys: 'Ctrl+O', onSelect: x.openDrawing },
        { id: 'recent', label: 'Recent drawings for this project', items: x.recent, empty: 'No other drawings yet' },
        { id: 'rev', label: 'Load new revision…', disabled: !x.hasSession, onSelect: x.loadRevision },
        sep,
        { id: 'save', label: 'Save', keys: 'Ctrl+S', disabled: !x.hasSession, onSelect: x.save },
        { id: 'exppdf', label: 'Export marked-up PDF…', keys: 'Ctrl+Shift+E', disabled: !x.hasStoredPdf, hint: x.hasStoredPdf ? undefined : 'Drawing not stored yet', onSelect: x.exportPdf },
        { id: 'expcsv', label: 'Export Markups List to CSV', disabled: !x.hasSession, onSelect: x.exportCsv },
        { id: 'print', label: 'Print this page…', keys: 'Ctrl+P', disabled: noFile, onSelect: x.print },
        sep,
        { id: 'close', label: 'Close drawing (back to sessions)', onSelect: x.close },
        ...(x.linkLabel ? [{ id: 'gojob', label: `Go to ${x.linkLabel}`, onSelect: x.goToLink }] : []),
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'undo', label: 'Undo', keys: 'Ctrl+Z', disabled: !x.canUndo, onSelect: x.undo },
        { id: 'redo', label: 'Redo', keys: 'Ctrl+Y', altKeys: ['Ctrl+Shift+Z'], disabled: !x.canRedo, onSelect: x.redo },
        sep,
        { id: 'cut', label: 'Cut', keys: 'Ctrl+X', disabled: !x.canCopy, hint: 'Drawing markups only', onSelect: x.cut },
        { id: 'copy', label: 'Copy', keys: 'Ctrl+C', disabled: !x.canCopy, hint: 'Drawing markups only', onSelect: x.copy },
        { id: 'paste', label: 'Paste', keys: 'Ctrl+V', disabled: !x.canPaste || noFile, onSelect: x.paste },
        { id: 'del', label: 'Delete', keys: 'Delete', disabled: !x.hasSelection, onSelect: x.deleteSelection },
        sep,
        { id: 'all', label: 'Select all on this page', keys: 'Ctrl+A', disabled: noFile, onSelect: x.selectAll },
        { id: 'none', label: 'Select none', disabled: !x.hasSelection, onSelect: x.selectNone },
        sep,
        { id: 'prefs', label: 'Preferences…', keys: 'Ctrl+K', onSelect: x.preferences },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { id: 'zin', label: 'Zoom in', keys: 'Ctrl+=', disabled: noFile, onSelect: x.zoomIn },
        { id: 'zout', label: 'Zoom out', keys: 'Ctrl+-', disabled: noFile, onSelect: x.zoomOut },
        { id: 'fitp', label: 'Fit page', keys: 'Ctrl+0', disabled: noFile, onSelect: x.fitPage },
        { id: 'fitw', label: 'Fit width', keys: 'Ctrl+2', disabled: noFile, onSelect: x.fitWidth },
        { id: 'actual', label: 'Actual size (100%)', keys: 'Ctrl+1', disabled: noFile, onSelect: x.actualSize },
        sep,
        { id: 'single', label: 'Single page', checked: !x.continuous, onSelect: () => x.setContinuous(false) },
        { id: 'cont', label: 'Continuous', checked: x.continuous, onSelect: () => x.setContinuous(true) },
        sep,
        { id: 'rotcw', label: 'Rotate view clockwise', keys: 'Ctrl+]', disabled: noFile, onSelect: () => x.rotateView(90) },
        { id: 'rotccw', label: 'Rotate view counterclockwise', keys: 'Ctrl+[', disabled: noFile, onSelect: () => x.rotateView(-90) },
        sep,
        { id: 'pl', label: 'Left panel', keys: 'Ctrl+Shift+1', checked: x.layout.leftOpen, onSelect: () => x.togglePanel('left') },
        { id: 'pr', label: 'Right panel', keys: 'Ctrl+Shift+2', checked: x.layout.rightOpen, onSelect: () => x.togglePanel('right') },
        { id: 'pb', label: 'Bottom panel (Markups List)', keys: 'Ctrl+Shift+3', altKeys: ['F4'], checked: x.layout.bottomOpen, onSelect: () => x.togglePanel('bottom') },
        sep,
        { id: 'grid', label: 'Grid', keys: 'F7', checked: x.grid, onSelect: x.toggleGrid },
        { id: 'snap', label: 'Snap to content', keys: 'F9', checked: x.snap, onSelect: x.toggleSnap },
        { id: 'ortho', label: 'Ortho', keys: 'F8', checked: x.ortho, onSelect: x.toggleOrtho },
        sep,
        { id: 'full', label: 'Full screen', keys: 'Ctrl+Shift+F', checked: x.isFullscreen, onSelect: x.toggleFullscreen },
        { id: 'find', label: 'Find text…', keys: 'Ctrl+F', disabled: noFile, onSelect: x.findText },
      ],
    },
    {
      id: 'document',
      label: 'Document',
      items: [
        { id: 'first', label: 'First page', keys: 'Ctrl+Home', disabled: noFile || x.pageNum <= 1, onSelect: () => x.goToPage(1) },
        { id: 'prev', label: 'Previous page', keys: 'PageUp', disabled: noFile || x.pageNum <= 1, onSelect: () => x.goToPage(x.pageNum - 1) },
        { id: 'next', label: 'Next page', keys: 'PageDown', disabled: noFile || x.pageNum >= x.numPages, onSelect: () => x.goToPage(x.pageNum + 1) },
        { id: 'last', label: 'Last page', keys: 'Ctrl+End', disabled: noFile || x.pageNum >= x.numPages, onSelect: () => x.goToPage(x.numPages) },
        {
          id: 'goto',
          label: 'Go to page',
          disabled: noFile,
          items: Array.from({ length: Math.min(x.numPages, 300) }, (_, i) => ({
            id: `p${i + 1}`,
            label: x.pageLabels?.[i] && x.pageLabels[i] !== String(i + 1) ? `${i + 1} — ${x.pageLabels[i]}` : `Page ${i + 1}`,
            checked: x.pageNum === i + 1,
            onSelect: () => x.goToPage(i + 1),
          })),
        },
        sep,
        { id: 'rotpage', label: 'Rotate this page (view only)', disabled: noFile, onSelect: () => x.rotateView(90) },
        { id: 'resetrot', label: 'Reset page rotation', disabled: noFile || !x.pageRotation, onSelect: x.resetRotation },
        sep,
        { id: 'compare', label: 'Compare with older revision…', disabled: noFile, onSelect: x.compare },
        { id: 'overlay', label: 'Overlay pages (red / blue)…', disabled: noFile, onSelect: x.compare },
        { id: 'carry', label: 'Bring markups forward…', disabled: !x.hasPrevious, hint: 'Not a revision of an older takeoff', onSelect: x.carryForward },
        sep,
        x.pageLabels?.length
          ? { id: 'labels', label: `Page labels (${x.pageLabels.length})`, items: x.pageLabels.slice(0, 300).map((l, i) => ({ id: `l${i}`, label: `${l}  (page ${i + 1})`, onSelect: () => x.goToPage(i + 1) })) }
          : { id: 'labels', label: 'Page labels', disabled: true, hint: 'This PDF has none' },
      ],
    },
    {
      id: 'batch',
      label: 'Batch',
      items: [
        { id: 'bexp', label: 'Export marked-up PDF for many pages…', disabled: !x.hasStoredPdf, onSelect: x.exportPdf },
        { id: 'bscale', label: 'Apply a scale to many pages…', disabled: noFile, onSelect: x.applyScaleMany },
        { id: 'bcarry', label: 'Bring markups forward from the older revision…', disabled: !x.hasPrevious, hint: 'Not a revision of an older takeoff', onSelect: x.carryForward },
        sep,
        { id: 'bmerge', label: 'Merge PDFs', disabled: true, hint: NA },
        { id: 'bslip', label: 'Replace sheets in a set', disabled: true, hint: NA },
        { id: 'bflat', label: 'Flatten markups into many files', disabled: true, hint: NA },
        { id: 'bsign', label: 'Sign many files', disabled: true, hint: NA },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { id: 'tsel', label: 'Select', keys: 'V', onSelect: x.selectTool },
        { id: 'tpan', label: 'Pan', keys: 'H', onSelect: x.panTool },
        { id: 'tzoom', label: 'Zoom', keys: 'Z', onSelect: x.zoomTool },
        sep,
        { id: 'tmark', label: 'Markup', items: markupItems },
        { id: 'ttext', label: 'Text & notes', items: textItems },
        { id: 'tstamp', label: 'Stamps', items: STAMPS.map((s) => ({ id: `st-${s.id}`, label: s.label, disabled: noFile, onSelect: () => { x.setStampKind(s.id); x.startMarkup('stamp'); } })) },
        { id: 'tmeas', label: 'Measure', items: measureItems },
        sep,
        { id: 'tcal', label: 'Calibrate', keys: 'Shift+K', disabled: noFile, onSelect: x.calibrate },
        { id: 'tscale', label: 'Drawing scale…', disabled: noFile, onSelect: x.openScale },
        { id: 'tcheck', label: 'Check scale', disabled: noFile || !x.pageCalibrated, onSelect: x.checkScale },
        { id: 'tvp', label: 'Add scale viewport', disabled: noFile, onSelect: x.addViewport },
        sep,
        { id: 'tfind', label: 'Find symbols', keys: 'Shift+F', disabled: noFile, onSelect: x.findSymbols },
        { id: 'tleg', label: 'Legend on this page', checked: x.legendOn, onSelect: x.toggleLegend },
        { id: 'tchest', label: 'Tool Chest', onSelect: x.openToolChest },
        { id: 'tai', label: 'Detect shapes with local AI (whole document)', disabled: noFile || x.scanning, onSelect: x.runLocalAi },
        { id: 'tcat', label: 'Steel size catalog…', onSelect: x.steelCatalog },
        sep,
        { id: 'tocr', label: 'OCR (read scanned text)', disabled: true, hint: NA },
        { id: 'tform', label: 'Form fields', disabled: true, hint: NA },
        { id: 'tsig', label: 'Digital signatures', disabled: true, hint: NA },
        { id: 't3d', label: '3D models', disabled: true, hint: NA },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        { id: 'wl', label: 'Left panel', checked: x.layout.leftOpen, onSelect: () => x.togglePanel('left') },
        { id: 'wr', label: 'Right panel', checked: x.layout.rightOpen, onSelect: () => x.togglePanel('right') },
        { id: 'wb', label: 'Bottom panel', checked: x.layout.bottomOpen, onSelect: () => x.togglePanel('bottom') },
        { id: 'wreset', label: 'Reset panel layout', onSelect: x.resetLayout },
        sep,
        { id: 'wopen', label: 'Open drawings', items: x.openDrawings, empty: 'Only this drawing is open' },
        { id: 'wtile', label: 'Tile drawings side by side', disabled: true, hint: 'One drawing shows at a time — switch with the tabs' },
        sep,
        { id: 'wback', label: 'Back to sessions', onSelect: x.close },
      ],
    },
  ];
}
