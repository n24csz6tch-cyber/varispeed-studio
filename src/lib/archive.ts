/** Search and download public audio from the Internet Archive (no key required). */

import { fetchAudio, fetchJson } from './net';

export interface ArchiveHit {
  id: string;
  title: string;
  creator: string;
}

interface ArchiveDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
}

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
}

const SEARCH = 'https://archive.org/advancedsearch.php';

export async function searchArchive(query: string, signal?: AbortSignal): Promise<ArchiveHit[]> {
  const q = `${query} AND mediatype:audio AND format:(MP3)`;
  const url = `${SEARCH}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=12&page=1&output=json`;
  const data = await fetchJson<{ response?: { docs?: ArchiveDoc[] } }>(url, signal);
  const docs = data.response?.docs ?? [];
  return docs
    .filter((doc) => doc.identifier)
    .map((doc) => ({
      id: doc.identifier,
      title: doc.title ?? doc.identifier,
      creator: Array.isArray(doc.creator) ? doc.creator[0] ?? '' : doc.creator ?? '',
    }));
}

export async function fetchArchiveTrack(hit: ArchiveHit): Promise<File> {
  const meta = await fetchJson<{ files?: ArchiveFile[] }>(`https://archive.org/metadata/${hit.id}`);
  const files = (meta.files ?? []).filter(
    (file) => /mp3/i.test(file.format ?? '') && /\.mp3$/i.test(file.name) && Number(file.size ?? 0) > 300_000,
  );
  if (!files.length) throw new Error('That item has no downloadable MP3.');
  files.sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0));
  const pick = files[0];
  const url = `https://archive.org/download/${hit.id}/${encodeURIComponent(pick.name)}`;
  const blob = await fetchAudio(url);
  if (!blob.size) throw new Error('That track could not be downloaded.');
  return new File([blob], `${hit.title}.mp3`, { type: 'audio/mpeg' });
}
