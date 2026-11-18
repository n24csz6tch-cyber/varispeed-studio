import { useEffect, useRef, useState } from 'react';
import { bendSummary } from '../audio/bend';
import {
  BEND_MAX_SEGMENTS,
  BEND_MAX_TEMPO,
  BEND_MIN_SEGMENT_SECONDS,
  BEND_MIN_TEMPO,
  BEND_MIN_TRACK_SECONDS,
  formatTime,
} from '../audio/params';
import type { BendMap } from '../audio/types';
import { cx } from './ui';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Musical starting points: three equal stretches with a clear direction. */
const SHAPES: { id: string; label: string; tempos: number[] }[] = [
  { id: 'settle', label: 'Slow down', tempos: [1.12, 1.0, 0.84] },
  { id: 'lift', label: 'Speed up', tempos: [0.9, 1.06, 1.28] },
  { id: 'swell', label: 'Swell', tempos: [0.84, 1.16, 0.84] },
];

interface BendLaneProps {
  bend: BendMap | null;
  duration: number;
  tempo: number;
  onChange: (bend: BendMap | null) => void;
}

/**
 * Tempo map editor: the song is split into constant-speed segments and joined with a
 * short crossfade in the engine. Segment times are source time, like the waveform ghost.
 */
export function BendLane({ bend, duration, tempo, onChange }: BendLaneProps) {
  const available = duration >= BEND_MIN_TRACK_SECONDS;
  const canShape = duration / 3 >= BEND_MIN_SEGMENT_SECONDS;
  const [selected, setSelected] = useState(0);
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bend) {
      setSelected(0);
      return;
    }
    setSelected((current) => Math.min(current, bend.length - 1));
  }, [bend]);

  const segmentEnd = (index: number): number =>
    bend && index + 1 < bend.length ? bend[index + 1].start : duration;

  const percent = (seconds: number): string => `${(seconds / Math.max(duration, 0.001)) * 100}%`;

  const applyShape = (tempos: number[]) => {
    if (!canShape) return;
    const span = duration / tempos.length;
    onChange(tempos.map((tempo, index) => ({ start: round2(index * span), tempo })));
    setSelected(0);
  };

  const setSegmentTempo = (index: number, value: number) => {
    if (!bend) return;
    const next = clamp(round2(value), BEND_MIN_TEMPO, BEND_MAX_TEMPO);
    onChange(bend.map((segment, i) => (i === index ? { ...segment, tempo: next } : segment)));
  };

  const split = (index: number) => {
    if (!bend || bend.length >= BEND_MAX_SEGMENTS) return;
    const start = bend[index].start;
    const end = segmentEnd(index);
    const middle = round2((start + end) / 2);
    if (middle - start < BEND_MIN_SEGMENT_SECONDS || end - middle < BEND_MIN_SEGMENT_SECONDS) return;
    onChange([
      ...bend.slice(0, index),
      { ...bend[index] },
      { start: middle, tempo: bend[index].tempo },
      ...bend.slice(index + 1),
    ]);
    setSelected(index + 1);
  };

  const remove = (index: number) => {
    if (!bend || index === 0 || bend.length <= 1) return;
    onChange(bend.filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  };

  const moveCut = (index: number, seconds: number) => {
    if (!bend) return;
    const min = bend[index - 1].start + BEND_MIN_SEGMENT_SECONDS;
    const max = (index + 1 < bend.length ? bend[index + 1].start : duration) - BEND_MIN_SEGMENT_SECONDS;
    if (max < min) return;
    const start = round2(clamp(seconds, min, max));
    onChange(bend.map((segment, i) => (i === index ? { ...segment, start } : segment)));
  };

  const secondsAt = (clientX: number): number => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    return ((clientX - rect.left) / Math.max(1, rect.width)) * duration;
  };

  const onCutPointerDown = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = index;
    setSelected(index);
  };

  const onCutPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = dragRef.current;
    if (index === null) return;
    moveCut(index, secondsAt(event.clientX));
  };

  const onCutPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onCutKeyDown = (index: number, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!bend) return;
    const step = event.shiftKey ? 1 : 0.1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveCut(index, bend[index].start + (event.key === 'ArrowLeft' ? -step : step));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(index);
    }
  };

  const onSegmentKeyDown = (index: number, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!bend) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const current = bend[index].tempo;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSegmentTempo(index, current - step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSegmentTempo(index, current + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSegmentTempo(index, BEND_MIN_TEMPO);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSegmentTempo(index, BEND_MAX_TEMPO);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(index);
    }
  };

  const active = bend ?? null;
  const activeSegment = active ? active[Math.min(selected, active.length - 1)] : null;

  return (
    <section className={cx('bend', active && 'is-on')} aria-label="Tempo bend">
      <div className="bend__head">
        <span className="micro">BEND</span>
        <span className="bend__hint">
          {active
            ? 'The speed changes at the cuts. Join is crossfaded.'
            : available
              ? 'One speed for the whole track.'
              : `Load ${BEND_MIN_TRACK_SECONDS} s or more to bend time.`}
        </span>
        <div className="bend__actions">
          {active ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
              Clear bend
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                onChange([{ start: 0, tempo }]);
                setSelected(0);
              }}
              disabled={!available}
            >
              Add bend
            </button>
          )}
        </div>
      </div>

      {available ? (
        <div className="bend__shapes">
          <span className="micro">SHAPES</span>
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className="bend__shape"
              onClick={() => applyShape(shape.tempos)}
              disabled={!canShape}
              title={`${shape.label}: ${shape.tempos.map((t) => t.toFixed(2)).join(' → ')}×`}
            >
              {shape.label}
            </button>
          ))}
          <span className="bend__shapehint">
            {canShape ? 'Three equal parts, joined with a crossfade' : 'Track too short for a three-part shape'}
          </span>
        </div>
      ) : null}

      {active ? (
        <div className="bend__lane">
          <div className="bend__track" ref={laneRef}>
            {active.map((segment, index) => {
              const end = segmentEnd(index);
              return (
                <div
                  key={index}
                  className={cx('bend__seg', selected === index && 'is-selected')}
                  style={{ left: percent(segment.start), width: percent(end - segment.start) }}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Bend segment ${index + 1} of ${active.length}`}
                  aria-valuemin={BEND_MIN_TEMPO}
                  aria-valuemax={BEND_MAX_TEMPO}
                  aria-valuenow={segment.tempo}
                  aria-valuetext={`${segment.tempo.toFixed(2)} times, ${formatTime(segment.start)} to ${formatTime(end)}`}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => onSegmentKeyDown(index, event)}
                >
                  <span
                    className={cx('bend__seg-fill', segment.tempo >= 1 ? 'is-fast' : 'is-slow')}
                    style={{
                      height: `${Math.max(8, ((segment.tempo - BEND_MIN_TEMPO) / (BEND_MAX_TEMPO - BEND_MIN_TEMPO)) * 100)}%`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="bend__seg-idx">{String(index + 1).padStart(2, '0')}</span>
                  <b>{segment.tempo.toFixed(2)}×</b>
                  <span className="bend__seg-time">
                    {formatTime(segment.start)} – {formatTime(end)}
                  </span>
                </div>
              );
            })}

            {active.map((segment, index) =>
              index === 0 ? null : (
                <div
                  key={`cut-${index}`}
                  className="bend__cut"
                  style={{ left: percent(segment.start) }}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Cut before bend segment ${index + 1}`}
                  aria-valuemin={active[index - 1].start + BEND_MIN_SEGMENT_SECONDS}
                  aria-valuemax={(index + 1 < active.length ? active[index + 1].start : duration) - BEND_MIN_SEGMENT_SECONDS}
                  aria-valuenow={segment.start}
                  aria-valuetext={formatTime(segment.start)}
                  onPointerDown={(event) => onCutPointerDown(index, event)}
                  onPointerMove={onCutPointerMove}
                  onPointerUp={onCutPointerUp}
                  onPointerCancel={onCutPointerUp}
                  onKeyDown={(event) => onCutKeyDown(index, event)}
                >
                  <span className="bend__cut-grip" aria-hidden="true" />
                </div>
              ),
            )}
          </div>
          <p className="bend__live" aria-live="polite">
            {bendSummary(active)}
          </p>
        </div>
      ) : null}

      {active && activeSegment ? (
        <div className="bend__editor">
          <span className="bend__editor-label">
            SEGMENT {Math.min(selected, active.length - 1) + 1} / {active.length}
          </span>
          <div className="bend__stepper">
            <button
              type="button"
              onClick={() => setSegmentTempo(selected, activeSegment.tempo - 0.01)}
              aria-label="Slower"
            >
              −
            </button>
            <span className="bend__num">{activeSegment.tempo.toFixed(2)}×</span>
            <button
              type="button"
              onClick={() => setSegmentTempo(selected, activeSegment.tempo + 0.01)}
              aria-label="Faster"
            >
              +
            </button>
          </div>
          <input
            className="range bend__range"
            type="range"
            min={BEND_MIN_TEMPO}
            max={BEND_MAX_TEMPO}
            step={0.01}
            value={activeSegment.tempo}
            aria-label={`Segment ${selected + 1} tempo`}
            style={{ '--p': `${((activeSegment.tempo - BEND_MIN_TEMPO) / (BEND_MAX_TEMPO - BEND_MIN_TEMPO)) * 100}%` } as React.CSSProperties}
            onChange={(event) => setSegmentTempo(selected, Number(event.target.value))}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => split(selected)}
            disabled={
              active.length >= BEND_MAX_SEGMENTS ||
              segmentEnd(selected) - active[selected].start < BEND_MIN_SEGMENT_SECONDS * 2
            }
          >
            Split
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => remove(selected)}
            disabled={selected === 0}
          >
            Remove
          </button>
        </div>
      ) : null}
    </section>
  );
}
