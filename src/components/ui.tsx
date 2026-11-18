import type { CSSProperties, ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.2v13.6c0 .6.6 1 1.1.7l10.4-6.8a.8.8 0 0 0 0-1.4L9.1 4.5c-.5-.3-1.1.1-1.1.7Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12h14m0 0-5.2-5.2M18.5 12l-5.2 5.2" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

export function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3L12 5.5v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.7 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

export function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 12h1.5M7 8v8M11 5v14M15 8.5v7M19 10.5v3M22 12h-1" />
    </svg>
  );
}

export function LoopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10a6 6 0 0 1 6-6h7m0 0-3-3m3 3-3 3" />
      <path d="M20 14a6 6 0 0 1-6 6H7m0 0 3 3m-3-3 3-3" />
    </svg>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
  hint?: string;
  marks?: { value: number; label: string }[];
  tone?: 'amber' | 'mint';
}

export function Slider({ label, value, min, max, step, format, onChange, disabled, hint, marks, tone = 'amber' }: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className={cx('ctl', disabled && 'is-disabled', tone === 'mint' && 'ctl--mint')}>
      <div className="ctl__top">
        <span className="ctl__label">
          {label}
          {hint ? <span className="ctl__hint">{hint}</span> : null}
        </span>
        <span className="ctl__value">{format(value)}</span>
      </div>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--p': `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties}
      />
      {marks ? (
        <div className="ctl__marks">
          {marks.map((mark) => (
            <button
              key={mark.label}
              type="button"
              className="mark"
              disabled={disabled}
              onClick={() => onChange(mark.value)}
              style={{ left: `${((mark.value - min) / (max - min)) * 100}%` }}
            >
              {mark.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, hint, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      className={cx('toggle', checked && 'is-on', disabled && 'is-disabled')}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      disabled={disabled}
    >
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint ? <span className="toggle__hint">{hint}</span> : null}
      </span>
      <span className="switch" data-on={checked} aria-hidden="true" />
    </button>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx('seg__item', value === option.value && 'is-active')}
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, tone = 'amber' }: { value: number; tone?: 'amber' | 'mint' }) {
  return (
    <div className={cx('progress', tone === 'mint' && 'progress--mint')}>
      <div className="progress__fill" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Panel({
  title,
  meta,
  children,
  action,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h3>{title}</h3>
        <div className="panel__meta">{meta}</div>
        {action}
      </header>
      {children}
    </section>
  );
}
