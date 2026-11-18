import { useEffect, useRef, useState } from 'react';
import { THEMES, type ThemeId } from '../lib/theme';
import { cx } from './ui';

/** Palette picker: four fixed schemes, remembered between visits. */
export function ThemeMenu({ theme, onTheme }: { theme: ThemeId; onTheme: (id: ThemeId) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = THEMES.find((item) => item.id === theme) ?? THEMES[0];

  return (
    <div className="thememenu" ref={rootRef}>
      <button
        type="button"
        className="iconbtn"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Interface theme: ${active.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme — ${active.name}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h1.5a3.8 3.8 0 0 0 3.8-3.8c0-3.9-3.6-7.1-8-7.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="8" cy="9" r="1.15" fill="currentColor" />
          <circle cx="12" cy="7" r="1.15" fill="currentColor" />
          <circle cx="7" cy="13.2" r="1.15" fill="currentColor" />
        </svg>
      </button>

      {open ? (
        <div className="thememenu__panel" role="menu" aria-label="Interface theme">
          <span className="micro">INTERFACE</span>
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === item.id}
              className={cx('thememenu__opt', theme === item.id && 'is-active')}
              onClick={() => {
                onTheme(item.id);
                setOpen(false);
              }}
            >
              <span className="thememenu__dots" aria-hidden="true">
                <i style={{ background: item.swatch[0] }} />
                <i style={{ background: item.swatch[1] }} />
              </span>
              <span className="thememenu__name">
                {item.name}
                <em>{item.blurb}</em>
              </span>
              <span className="thememenu__check" aria-hidden="true">
                {theme === item.id ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
