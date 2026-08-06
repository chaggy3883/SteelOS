const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_INITIAL_QUALITY = 0.75;
const DEFAULT_MAX_DATA_URI_LENGTH = 900 * 1024; // ~900KB, checked against the data URI string itself
const DEFAULT_QUALITY_STEP = 0.15;
const DEFAULT_MAX_RETRIES = 3;

function loadImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = objectUrl;
  });
}

// Only ever scales down — an image already smaller than maxDimension on its
// longest side is returned at its native size.
function scaledDimensions(width, height, maxDimension) {
  const longestSide = Math.max(width, height);
  if (longestSide <= maxDimension) return { width, height };
  const scale = maxDimension / longestSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Downscales and re-encodes an image file client-side (Canvas API, no
// dependency) so large photos don't blow the localStorage quota this app's
// mock DB is backed by. Retries at progressively lower JPEG quality before
// giving up, rather than silently storing an oversized data URI.
export async function compressImageFile(file, options = {}) {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    initialQuality = DEFAULT_INITIAL_QUALITY,
    maxDataUriLength = DEFAULT_MAX_DATA_URI_LENGTH,
    qualityStep = DEFAULT_QUALITY_STEP,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const { width, height } = scaledDimensions(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      maxDimension
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);

    let quality = initialQuality;
    let dataUri = canvas.toDataURL('image/jpeg', quality);

    let attempt = 0;
    while (dataUri.length > maxDataUriLength && attempt < maxRetries) {
      quality = Math.max(quality - qualityStep, 0.1);
      dataUri = canvas.toDataURL('image/jpeg', quality);
      attempt += 1;
    }

    if (dataUri.length > maxDataUriLength) {
      throw new Error('This image is too large even after compression — please use a smaller photo.');
    }

    return dataUri;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
