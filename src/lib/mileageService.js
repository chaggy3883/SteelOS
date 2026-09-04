// Free replacement for the old Google Maps Distance Matrix lookup (which
// required a paid, per-key-restricted API) — geocodes with OpenStreetMap's
// Nominatim, then routes with the public OSRM demo server. No API key.
//
// Nominatim's usage policy caps unauthenticated use at roughly 1 request/sec
// and asks for an identifying User-Agent, which isn't settable on a browser
// fetch — acceptable here since this is a one-off, user-triggered lookup
// (the Bid Worksheet's freight mileage calculator), not bulk geocoding.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';
const METERS_PER_MILE = 1609.344;

async function geocode(address) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Geocoding request failed (${res.status}).`);
  }
  const results = await res.json();
  const match = results?.[0];
  if (!match) {
    throw new Error(`Could not find a location for "${address}".`);
  }
  return { lat: parseFloat(match.lat), lon: parseFloat(match.lon) };
}

// Returns driving distance in miles between two addresses/place strings.
// Throws if either address can't be geocoded or no route is found.
export async function calculateDistance(fromAddress, toAddress) {
  if (!fromAddress || !toAddress) {
    throw new Error('calculateDistance requires both a fromAddress and a toAddress.');
  }

  const [from, to] = await Promise.all([geocode(fromAddress), geocode(toAddress)]);

  const url = `${OSRM_ROUTE_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Routing request failed (${res.status}).`);
  }
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) {
    throw new Error(`No driving route found between "${fromAddress}" and "${toAddress}".`);
  }

  return route.distance / METERS_PER_MILE;
}
