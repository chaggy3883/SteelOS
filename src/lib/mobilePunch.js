// Best-effort mobile/location detection for the field kiosk — neither check
// blocks a punch. A denied/timed-out geolocation prompt or an ambiguous
// device just means the punch goes through without coordinates, same as any
// other optional field in this app.

export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
  const uaMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
  return !!(coarsePointer || uaMobile);
}

const LOCATION_TIMEOUT_MS = 5000;

export function captureLocationCoordinates() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(`${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`),
      () => resolve(null),
      { timeout: LOCATION_TIMEOUT_MS, maximumAge: 60000 }
    );
  });
}
