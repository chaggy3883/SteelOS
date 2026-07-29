const DAY_MS = 24 * 60 * 60 * 1000;

export function getCertStatus(expirationDate, days = 60, referenceDate = new Date()) {
  if (!expirationDate) return 'Valid';
  const expires = new Date(expirationDate);
  const daysRemaining = Math.floor((expires.getTime() - referenceDate.getTime()) / DAY_MS);
  if (daysRemaining < 0) return 'Expired';
  if (daysRemaining <= days) return 'Expiring_Soon';
  return 'Valid';
}

export function getExpiringCertifications(certs, days = 60, referenceDate = new Date()) {
  return certs
    .map((cert) => ({ ...cert, status: getCertStatus(cert.expiration_date, days, referenceDate) }))
    .filter((cert) => cert.status !== 'Valid')
    .sort((a, b) => new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime());
}
