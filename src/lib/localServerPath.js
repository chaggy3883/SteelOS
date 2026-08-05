// Best-effort local/network folder launcher shared by BidDetail.jsx and
// ProjectManagement.jsx. Browsers sandbox file:// navigation from a served
// (http/https) origin as a core security boundary — there is no JS API that
// reliably opens a Windows Explorer window from a web page, so this is
// honestly a best-effort attempt via a file:// URI, not a guaranteed launch.
// Works when the browser/OS is configured to hand file:// off to Explorer
// (some Windows/Edge setups do); silently does nothing in most sandboxed
// browser contexts.
export function openLocalServerPath(rawPath) {
  const path = String(rawPath || '').trim();
  if (!path) return;

  const normalized = path.replace(/\\/g, '/');
  const isDriveLetterPath = /^[a-zA-Z]:\//.test(normalized);
  const fileUrl = isDriveLetterPath
    ? `file:///${normalized}`
    : `file://${normalized.replace(/^\/+/, '')}`;

  window.open(fileUrl, '_blank');
}
