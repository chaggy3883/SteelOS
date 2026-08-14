// Best-effort OS/chip hint for convenience UI only (flash-drive install
// instructions, keyboard-shortcut glyphs) — this must NEVER gate
// functionality. Browsers deliberately obscure exact hardware for
// fingerprinting-resistance reasons (Safari and Firefox in particular expose
// none of this), so 'unknown' is a first-class, expected result here, not an
// error case to work around.

const OVERRIDE_KEY = 'steelos_platform_override';

// Sync — low-entropy Client Hints (`navigator.userAgentData.platform`) where
// available, else classic `navigator.userAgent`/`navigator.platform` string
// sniffing. Good enough for OS family; never attempts chip architecture
// (that needs the async high-entropy call in detectChip below).
export function detectOS() {
  if (typeof navigator === 'undefined') return 'unknown';

  const uaDataPlatform = navigator.userAgentData?.platform;
  if (uaDataPlatform) {
    const p = uaDataPlatform.toLowerCase();
    if (p.includes('mac')) return 'macos';
    if (p.includes('win')) return 'windows';
    if (p.includes('linux')) return 'linux';
    if (p.includes('android')) return 'android';
    if (p.includes('ios')) return 'ios';
  }

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'macos';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Linux/i.test(platform)) return 'linux';
  return 'unknown';
}

// Async — chip architecture is only exposed through the Client Hints
// high-entropy API (Chromium-based browsers, behind an awaited call). Safari
// and Firefox never expose it, and — worse — Apple Silicon Macs still report
// "Intel Mac OS X" in navigator.userAgent for backward compatibility, so
// string-sniffing the UA can never distinguish Apple Silicon from Intel.
// Returning 'unknown' here is the honest answer for most visitors, not a bug.
export async function detectChip(os) {
  if (typeof navigator === 'undefined' || os !== 'macos') return 'unknown';

  try {
    const uaData = navigator.userAgentData;
    if (uaData?.getHighEntropyValues) {
      const { architecture } = await uaData.getHighEntropyValues(['architecture']);
      if (architecture === 'arm') return 'apple_silicon';
      if (architecture === 'x86') return 'intel';
    }
  } catch (e) {
    // Unsupported/denied — fall through to 'unknown' below.
  }
  return 'unknown';
}

// The one call most consumers want: { os, chip }. Always resolves — never
// throws, never blocks on a denied or unsupported API.
export async function detectPlatform() {
  const os = detectOS();
  const chip = await detectChip(os);
  return { os, chip };
}

// --- Manual override -------------------------------------------------------
// A wrong guess must never be a dead end. Device-local only (this browser),
// same tiny localStorage-wrapper shape as src/lib/kioskMode.js.

export function getPlatformOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Pass { os } and/or { chip }; set a field to undefined to clear just that
// one field back to auto-detected.
export function setPlatformOverride(partial) {
  try {
    const current = getPlatformOverride() || {};
    const next = { ...current, ...partial };
    Object.keys(next).forEach((k) => { if (next[k] === undefined) delete next[k]; });
    if (Object.keys(next).length === 0) {
      localStorage.removeItem(OVERRIDE_KEY);
    } else {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
    }
  } catch (e) {
    // Best-effort — a storage failure here just means the override doesn't
    // persist across reloads, not a broken app.
  }
}

export function clearPlatformOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch (e) {}
}

// Detected value with any manual override applied per-field on top — this is
// what UI should actually render/use. detectPlatform() alone ignores overrides.
export async function getEffectivePlatform() {
  const detected = await detectPlatform();
  const override = getPlatformOverride() || {};
  return {
    os: override.os || detected.os,
    chip: override.chip || detected.chip,
    detected,
    isOverridden: Boolean(override.os || override.chip),
  };
}
