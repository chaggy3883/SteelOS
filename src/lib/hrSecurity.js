// NON-CRYPTOGRAPHIC STUB.
// This app has no crypto/hashing library and no backend — every other secret
// in this mock DB (e.g. User.password) is already stored in plaintext. These
// helpers exist only so PIN/signature fields aren't stored as bare obvious
// text; they provide ZERO real security and must never be presented as such.

const STUB_KEY = 7;

const shiftString = (value, key) =>
  String(value)
    .split('')
    .map((ch) => String.fromCharCode(ch.charCodeAt(0) + key))
    .join('');

export function encodePin(pin) {
  return btoa(shiftString(String(pin), STUB_KEY));
}

export function decodePin(encoded) {
  try {
    return shiftString(atob(encoded), -STUB_KEY);
  } catch (e) {
    return '';
  }
}

export function verifyPin(rawPin, encodedPin) {
  return encodePin(rawPin) === encodedPin;
}

export function stubSignatureHash(signaturePayload) {
  return btoa(shiftString(String(signaturePayload), STUB_KEY));
}
