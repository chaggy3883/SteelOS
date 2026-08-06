// Standard browser download trigger — a temporary <a download> click. Shared
// by every "Download" / "Download to Print" button so they all behave
// identically (PdfViewerModal, SmartFileDump, TemplateVaultPanel).
export function downloadFile(source, fileName) {
  if (!source) return;
  const a = document.createElement('a');
  a.href = source;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
