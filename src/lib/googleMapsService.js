import { Loader } from '@googlemaps/js-api-loader';

// Client-side wrapper around the Maps JavaScript API's Distance Matrix
// service (DistanceMatrixService lives in the "routes" library under the
// v3.51+ importLibrary loading model). No backend proxy exists in this app,
// so this calls Google directly from the browser using the publishable
// VITE_GOOGLE_MAPS_API_KEY — restrict that key to this app's origin(s) in
// Google Cloud Console rather than relying on secrecy.
const METERS_PER_MILE = 1609.344;

let routesLibraryPromise = null;

export function getGoogleMapsApiKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

export function isGoogleMapsConfigured() {
  return !!getGoogleMapsApiKey();
}

// Loads the Maps JS API + routes library exactly once per session.
async function loadDistanceMatrixService() {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    throw new Error('VITE_GOOGLE_MAPS_API_KEY is not set — mileage calculations are unavailable until it is configured.');
  }
  if (!routesLibraryPromise) {
    const loader = new Loader({ apiKey });
    routesLibraryPromise = loader.importLibrary('routes');
  }
  const { DistanceMatrixService } = await routesLibraryPromise;
  return new DistanceMatrixService();
}

// Returns driving distance in miles between two addresses/place strings.
// Throws if the API key is missing, the request fails, or no route is found.
export async function calculateDistance(fromAddress, toAddress) {
  if (!fromAddress || !toAddress) {
    throw new Error('calculateDistance requires both a fromAddress and a toAddress.');
  }

  const service = await loadDistanceMatrixService();

  return new Promise((resolve, reject) => {
    service.getDistanceMatrix(
      {
        origins: [fromAddress],
        destinations: [toAddress],
        travelMode: window.google.maps.TravelMode.DRIVING,
        unitSystem: window.google.maps.UnitSystem.IMPERIAL,
      },
      (response, status) => {
        if (status !== 'OK') {
          reject(new Error(`Distance Matrix request failed: ${status}`));
          return;
        }

        const element = response?.rows?.[0]?.elements?.[0];
        if (!element || element.status !== 'OK') {
          reject(new Error(`No route found between "${fromAddress}" and "${toAddress}".`));
          return;
        }

        resolve(element.distance.value / METERS_PER_MILE);
      }
    );
  });
}
