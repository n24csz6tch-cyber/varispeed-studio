/**
 * File names arrive from uploads and from signed CDN links, so they often carry a
 * 64-character token, `hmac=` parameters or a bare hex hash. This keeps something a
 * person can read and falls back to a plain label when nothing usable is left.
 */
export function prettyName(name: string): string {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[0-9a-f]{16,}/gi, '')
    .replace(/\b(?:hmac|token|hdnea|signature|sig|expires|key|id)\s*=\s*/gi, '')
    .replace(/[?&]+/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/-{2,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—·.]+|[\s\-–—·.]+$/g, '')
    .trim();
  if (base.length < 2) return 'Audio sin nombre';
  return base.charAt(0).toUpperCase() + base.slice(1);
}
