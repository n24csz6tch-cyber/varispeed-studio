/**
 * Network helpers.
 *
 * Safari refuses the iTunes Search API: with a mobile user agent Apple answers with a
 * 301 to another host, and WebKit treats the cross-origin redirect as a network error
 * ("Load failed"), so the search came back empty on iPhone. Every third-party request
 * therefore goes through our own Worker (`/api/proxy`), which follows the redirect
 * server-side and answers same-origin.
 */

const PROXY = '/api/proxy?url=';

export function proxied(url: string): string {
  return PROXY + encodeURIComponent(url);
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response | null = null;
  try {
    response = await fetch(proxied(url), { signal });
  } catch {
    response = null;
  }
  if (response?.ok) {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      // Fall through: the proxy answered with HTML instead of JSON.
    }
  }
  // No Worker route (local dev, static hosting such as GitHub Pages): go direct.
  const direct = await fetch(url, { signal });
  if (!direct.ok) throw new Error(`HTTP ${direct.status}`);
  return (await direct.json()) as T;
}

/**
 * Accept whatever link the user pastes: a Drive share link, a Dropbox file or a plain
 * audio URL. Drive needs the `uc?export=download` form to return the bytes.
 */
export function normalizeAudioLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const drive = url.pathname.match(/\/file\/d\/([\w-]{10,})/);
    if (url.hostname.includes('drive.google.com') && drive) {
      return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
    }
    if (url.hostname.endsWith('dropbox.com')) {
      url.searchParams.set('dl', '1');
      return url.toString();
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Download a user-supplied audio link through the worker, which checks it is audio. */
export async function fetchLinkedAudio(url: string): Promise<Blob> {
  const response = await fetch(`/api/audio?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    if (response.status === 415) throw new Error('Ese enlace no apunta a un audio (¿es una página web?).');
    if (response.status === 413) throw new Error('Ese archivo es demasiado grande.');
    if (response.status === 400) throw new Error('El enlace tiene que empezar por https://');
    throw new Error(`No se ha podido descargar ese enlace (HTTP ${response.status}).`);
  }
  return response.blob();
}

export async function fetchAudio(url: string): Promise<Blob> {
  let response: Response | null = null;
  try {
    response = await fetch(proxied(url));
  } catch {
    response = null;
  }
  if (response?.ok) {
    const blob = await response.blob();
    if (/^(audio|video)\//.test(blob.type) || blob.type === 'application/octet-stream') return blob;
  }
  // The proxy was not available (local dev, static hosting), retry the direct request.
  const direct = await fetch(url);
  if (!direct.ok) throw new Error(`HTTP ${direct.status}`);
  return direct.blob();
}
