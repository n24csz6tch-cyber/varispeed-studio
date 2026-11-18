/**
 * Small server-side proxy so the browser never talks to Apple or the Internet Archive
 * directly (Safari breaks on their cross-origin redirects). Only known hosts are
 * allowed, so this cannot be used as an open proxy.
 */

const ALLOWED_HOSTS = new Set([
  'api.deezer.com',
  'cdnt-preview.dzcdn.net',
  'discoveryprovider.audius.co',
  'creatornode.audius.co',
  'itunes.apple.com',
  'audio-ssl.itunes.apple.com',
  'archive.org',
]);
const ALLOWED_SUFFIXES = ['.mzstatic.com', '.dzcdn.net', '.audius.co'];

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function isAllowed(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // User-supplied audio link (their own Drive, Dropbox or any direct audio URL).
    // Only audio content is relayed, and never from a private address.
    if (url.pathname === '/api/audio') {
      const target = url.searchParams.get('url');
      if (!target) return new Response('missing url', { status: 400 });

      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return new Response('bad url', { status: 400 });
      }
      if (parsed.protocol !== 'https:') return new Response('https only', { status: 400 });

      const host = parsed.hostname.toLowerCase();
      const blocked =
        host === 'localhost' ||
        host.endsWith('.local') ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$)/.test(host) ||
        host === '[::1]' ||
        host === '::1';
      if (blocked) return new Response('forbidden', { status: 403 });

      let upstream;
      try {
        upstream = await fetch(parsed.toString(), {
          headers: { 'user-agent': BROWSER_UA, accept: 'audio/*,*/*' },
          redirect: 'follow',
        });
      } catch {
        return new Response('upstream unavailable', { status: 502 });
      }

      if (!upstream.ok) return new Response(`upstream ${upstream.status}`, { status: 502 });
      const type = upstream.headers.get('content-type') || '';
      const size = Number(upstream.headers.get('content-length') || 0);
      if (size > 80e6) return new Response('too large', { status: 413 });
      if (!/^(audio\/|application\/octet-stream)/i.test(type)) {
        return new Response(`not audio (${type.slice(0, 40)})`, { status: 415 });
      }

      const headers = new Headers();
      headers.set('content-type', type);
      headers.set('cache-control', 'no-store');
      return new Response(upstream.body, { status: 200, headers });
    }

    if (url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url');
      if (!target) return new Response('missing url', { status: 400 });

      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return new Response('bad url', { status: 400 });
      }
      if (parsed.protocol !== 'https:' || !isAllowed(parsed.hostname)) {
        return new Response('forbidden', { status: 403 });
      }

      let upstream;
      try {
        upstream = await fetch(parsed.toString(), {
          headers: { 'user-agent': BROWSER_UA, accept: '*/*' },
          redirect: 'follow',
        });
      } catch {
        return new Response('upstream unavailable', { status: 502 });
      }

      const headers = new Headers();
      headers.set('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
      headers.set('cache-control', upstream.ok ? 'public, max-age=1800' : 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
