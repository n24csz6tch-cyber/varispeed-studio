import {
  BEND_CROSSFADE,
  BEND_MAX_SEGMENTS,
  BEND_MAX_TEMPO,
  BEND_MIN_SEGMENT_SECONDS,
  BEND_MIN_TEMPO,
  BEND_MIN_TRACK_SECONDS,
} from './params';
import type { BendMap } from './types';

const EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function segmentEnd(map: BendMap, index: number, sourceDuration: number): number {
  return index + 1 < map.length ? map[index + 1].start : sourceDuration;
}

/**
 * Clamp an incoming map into something the engine can always render: sorted, starting
 * at zero, inside the tempo range and with segments long enough to crossfade.
 * Returns null when the map cannot produce a second segment.
 */
export function normalizeBend(map: BendMap | null | undefined, sourceDuration: number): BendMap | null {
  if (!map || !map.length || sourceDuration < BEND_MIN_TRACK_SECONDS) return null;

  const sorted = [...map].sort((a, b) => a.start - b.start).slice(0, BEND_MAX_SEGMENTS);
  const out: BendMap = [];
  for (const segment of sorted) {
    const tempo = clamp(Number.isFinite(segment.tempo) ? segment.tempo : 1, BEND_MIN_TEMPO, BEND_MAX_TEMPO);
    if (!out.length) {
      out.push({ start: 0, tempo });
      continue;
    }
    const previous = out[out.length - 1].start;
    const latest = sourceDuration - BEND_MIN_SEGMENT_SECONDS;
    const start = clamp(segment.start, previous + BEND_MIN_SEGMENT_SECONDS, latest);
    // No room left for another segment: the previous one keeps the rest of the song.
    if (start > latest + EPS) break;
    out.push({ start: round3(start), tempo });
  }
  return out.length ? out : null;
}

export function validateBend(map: BendMap | null | undefined, sourceDuration: number): { ok: true } | { ok: false; error: string } {
  if (!map || !map.length) return { ok: true };
  if (sourceDuration < BEND_MIN_TRACK_SECONDS) {
    return { ok: false, error: `Bend needs a track of at least ${BEND_MIN_TRACK_SECONDS} seconds.` };
  }
  if (map.length > BEND_MAX_SEGMENTS) {
    return { ok: false, error: `A bend can have at most ${BEND_MAX_SEGMENTS} segments.` };
  }
  if (Math.abs(map[0].start) > EPS) {
    return { ok: false, error: 'The first bend segment must start at 0:00.' };
  }
  for (let i = 0; i < map.length; i++) {
    const segment = map[i];
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.tempo)) {
      return { ok: false, error: 'The bend contains an invalid value.' };
    }
    if (segment.tempo < BEND_MIN_TEMPO - EPS || segment.tempo > BEND_MAX_TEMPO + EPS) {
      return { ok: false, error: `Segment tempos must stay between ${BEND_MIN_TEMPO}× and ${BEND_MAX_TEMPO}×.` };
    }
    if (i > 0 && segment.start < map[i - 1].start + BEND_MIN_SEGMENT_SECONDS - EPS) {
      return { ok: false, error: `Segments must be at least ${BEND_MIN_SEGMENT_SECONDS} s long.` };
    }
  }
  const last = segmentEnd(map, map.length - 1, sourceDuration);
  if (last < map[map.length - 1].start + BEND_MIN_SEGMENT_SECONDS - EPS) {
    return { ok: false, error: `Segments must be at least ${BEND_MIN_SEGMENT_SECONDS} s long.` };
  }
  return { ok: true };
}

/** Cache identity of a map: 1 ms and 0.001× are the smallest addressable changes. */
export function bendKey(map: BendMap): string {
  return map.map((segment) => `${segment.start.toFixed(3)}@${segment.tempo.toFixed(3)}`).join(',');
}

/** Rendered length of a map, in seconds, accounting for the crossfade overlaps. */
export function bendDuration(map: BendMap, sourceDuration: number): number {
  let total = 0;
  for (let i = 0; i < map.length; i++) {
    const length = Math.max(0, segmentEnd(map, i, sourceDuration) - map[i].start);
    total += length / map[i].tempo;
    if (i < map.length - 1) total -= BEND_CROSSFADE;
  }
  return Math.max(0, total);
}

interface Span {
  outStart: number;
  outEnd: number;
  sourceStart: number;
  length: number;
  tempo: number;
}

function spans(map: BendMap, sourceDuration: number): Span[] {
  const result: Span[] = [];
  let outStart = 0;
  for (let i = 0; i < map.length; i++) {
    const length = Math.max(0, segmentEnd(map, i, sourceDuration) - map[i].start);
    const outEnd = outStart + length / map[i].tempo;
    result.push({ outStart, outEnd, sourceStart: map[i].start, length, tempo: map[i].tempo });
    outStart = outEnd - BEND_CROSSFADE;
  }
  return result;
}

/** Source time -> rendered buffer time. */
export function sourceToBuffer(map: BendMap, sourceDuration: number, seconds: number): number {
  const t = clamp(seconds, 0, sourceDuration);
  let output = 0;
  for (let i = 0; i < map.length; i++) {
    const end = segmentEnd(map, i, sourceDuration);
    if (t >= end) {
      output += (end - map[i].start) / map[i].tempo;
      if (i < map.length - 1) output -= BEND_CROSSFADE;
      continue;
    }
    return Math.max(0, output + (t - map[i].start) / map[i].tempo);
  }
  return Math.max(0, output);
}

/**
 * Rendered buffer time -> source time. Inside a crossfade two source times are audible
 * at once; the incoming segment wins after the middle of the fade.
 */
export function bufferToSource(map: BendMap, sourceDuration: number, seconds: number): number {
  const list = spans(map, sourceDuration);
  if (!list.length) return clamp(seconds, 0, sourceDuration);
  const t = clamp(seconds, 0, list[list.length - 1].outEnd);

  let chosen = list[0];
  for (let i = 0; i < list.length; i++) {
    const span = list[i];
    if (t < span.outStart - EPS) break;
    chosen = span;
    if (i > 0 && t < span.outStart + BEND_CROSSFADE / 2) {
      chosen = list[i - 1];
      break;
    }
  }
  // `length` is source seconds; the audible span is length / tempo.
  const local = clamp(t - chosen.outStart, 0, chosen.length / chosen.tempo);
  return clamp(chosen.sourceStart + local * chosen.tempo, 0, sourceDuration);
}

/** Human summary used by the version detail and the bend lane. */
export function bendSummary(map: BendMap): string {
  const speeds = map.map((segment) => `${segment.tempo.toFixed(2)}×`).join(' → ');
  return `Bend · ${map.length} ${map.length === 1 ? 'segment' : 'segments'} · ${speeds}`;
}
