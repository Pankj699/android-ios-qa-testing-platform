/**
 * Generates standardized, sanitized filenames for BugDesk screen recordings.
 * Example: FlyerMaker_BillingMigration_R1_20261019_111500.webm
 * If round is not configured or empty, it is cleanly omitted:
 * Example: FlyerMaker_BillingMigration_20261019_111500.webm
 */
export function generateRecordingFilename({
  project = '',
  module = '',
  round = '',
  ext = 'webm',
  date = new Date()
}) {
  const sanitize = (str) =>
    (str || '')
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

  const pPart = sanitize(project) || 'BugDesk';
  const mPart = sanitize(module) || 'Module';
  const rPart = round && typeof round === 'string' && round.trim() ? sanitize(round) : '';

  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const timestamp = `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;

  const cleanExt = (ext || 'webm').replace(/^\./, '');

  if (rPart) {
    return `${pPart}_${mPart}_${rPart}_${timestamp}.${cleanExt}`;
  }
  return `${pPart}_${mPart}_${timestamp}.${cleanExt}`;
}
