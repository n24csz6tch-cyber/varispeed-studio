/**
 * Music search without keys or accounts.
 *
 * Audius gives full-length tracks, Deezer gives 30-second previews of the commercial
 * catalogue (that is all the labels license). A search runs both and merges them, so
 * looking up an artist always returns something: full tracks first when they exist,
 * previews for the rest.
 */

import { fetchAudio, fetchJson } from './net';

const AUDIUS = 'https://discoveryprovider.audius.co';

export interface SongHit {
  id: string;
  title: string;
  artist: string;
  album: string;
  preview: string;
  artwork: string;
  /** Length of the track in seconds. */
  duration: number;
  genre: string;
  /** True when the audio is the whole song, false for a 30 s preview. */
  full: boolean;
}

interface DeezerTrack {
  id?: number;
  title?: string;
  duration?: number;
  preview?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_big?: string; cover_xl?: string };
}

interface ItunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
}

interface AudiusTrack {
  id?: string;
  title?: string;
  duration?: number;
  is_streamable?: boolean;
  genre?: string;
  user?: { name?: string; profile_picture?: Record<string, string> };
  artwork?: Record<string, string>;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function searchAudius(term: string, signal?: AbortSignal): Promise<SongHit[]> {
  const url = `${AUDIUS}/v1/tracks/search?query=${encodeURIComponent(term)}&app_name=Varispeed&limit=20`;
  const data = await fetchJson<{ data?: AudiusTrack[] }>(url, signal);
  return (data.data ?? [])
    .filter((track) => !!track.id && track.is_streamable !== false)
    .map((track) => ({
      id: `au-${track.id}`,
      title: track.title ?? 'Sin título',
      artist: track.user?.name ?? 'Audius',
      album: track.genre ?? '',
      preview: `${AUDIUS}/v1/tracks/${track.id}/stream?app_name=Varispeed`,
      artwork: track.artwork?.['480x480'] ?? track.user?.profile_picture?.['480x480'] ?? '',
      duration: track.duration ?? 0,
      genre: track.genre ?? '',
      full: true,
    }));
}

async function searchDeezer(term: string, signal?: AbortSignal): Promise<SongHit[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=25`;
  const data = await fetchJson<{ data?: DeezerTrack[] }>(url, signal);
  return (data.data ?? [])
    .filter((track) => !!track.preview && track.id != null)
    .map((track) => ({
      id: `dz-${track.id}`,
      title: track.title ?? 'Sin título',
      artist: track.artist?.name ?? '',
      album: track.album?.title ?? '',
      preview: track.preview as string,
      artwork: track.album?.cover_big ?? track.album?.cover_xl ?? '',
      duration: track.duration ?? 30,
      genre: '',
      full: false,
    }));
}

/** The API only returns a 100 px thumbnail; the same image is served at other sizes. */
function biggerArtwork(url?: string): string {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/300x300bb.$1');
}

async function searchItunes(term: string, signal?: AbortSignal): Promise<SongHit[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=24`;
  const data = await fetchJson<{ results?: ItunesResult[] }>(url, signal);
  return (data.results ?? [])
    .filter((row) => !!row.previewUrl)
    .map((row) => ({
      id: `it-${row.trackId ?? row.previewUrl}`,
      title: row.trackName ?? 'Sin título',
      artist: row.artistName ?? '',
      album: row.collectionName ?? '',
      preview: row.previewUrl as string,
      artwork: biggerArtwork(row.artworkUrl100),
      duration: (row.trackTimeMillis ?? 30_000) / 1000,
      genre: row.primaryGenreName ?? '',
      full: false,
    }));
}

/** Deezer first; Apple covers the terms Deezer fails on. */
async function searchSamples(term: string, signal?: AbortSignal): Promise<SongHit[]> {
  try {
    const rows = await searchDeezer(term, signal);
    if (rows.length || signal?.aborted) return rows;
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return searchItunes(term, signal);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function searchSongs(term: string, signal?: AbortSignal): Promise<SongHit[]> {
  const [full, samples] = await Promise.allSettled([
    // A slow Audius must not hold back the previews.
    withTimeout(searchAudius(term, signal), 5000),
    searchSamples(term, signal),
  ]);

  if (full.status === 'rejected' && samples.status === 'rejected') {
    throw samples.reason instanceof Error ? samples.reason : new Error('La búsqueda ha fallado.');
  }

  const seen = new Set<string>();
  const merged: SongHit[] = [];
  const push = (hit: SongHit) => {
    const key = `${normalize(hit.title)}|${normalize(hit.artist)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(hit);
  };

  // Full tracks go in first so a duplicate keeps the complete audio.
  if (full.status === 'fulfilled') full.value.forEach(push);
  if (samples.status === 'fulfilled') samples.value.forEach(push);

  // Searching an artist used to bury the official songs under Audius covers: rank by
  // how well the row matches the words the user typed.
  const query = normalize(term);
  const score = (hit: SongHit): number => {
    const artist = normalize(hit.artist);
    const title = normalize(hit.title);
    let value = 0;
    if (artist === query) value += 100;
    else if (artist.includes(query)) value += 60;
    else if (query.includes(artist) && artist.length > 2) value += 45;
    if (title === query) value += 50;
    else if (title.startsWith(query)) value += 35;
    else if (title.includes(query)) value += 18;
    if (hit.full) value += 4;
    return value;
  };

  merged.sort((a, b) => score(b) - score(a));
  return merged.slice(0, 32);
}

export async function fetchSong(hit: SongHit): Promise<File> {
  const blob = await fetchAudio(hit.preview);
  if (!blob.size) throw new Error('Esa canción no se ha podido descargar.');
  const name = `${hit.artist} — ${hit.title}`.replace(/[\\/:*?"<>|]+/g, '');
  const type = blob.type || 'audio/mpeg';
  const ext = type.includes('mpeg') ? 'mp3' : type.includes('mp4') || type.includes('aac') ? 'm4a' : 'audio';
  return new File([blob], `${name}.${ext}`, { type });
}
