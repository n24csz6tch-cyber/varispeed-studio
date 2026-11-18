import { useEffect } from 'react';

const KEYS: { keys: string[]; label: string }[] = [
  { keys: ['Space'], label: 'Play / pause the transport' },
  { keys: ['←', '→'], label: 'Skip 5 seconds' },
  { keys: ['Shift', '←', '→'], label: 'Skip 1 second' },
  { keys: ['?'], label: 'Open or close this panel' },
  { keys: ['Esc'], label: 'Close this panel' },
];

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet__panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <button type="button" className="sheet__close" onClick={onClose} aria-label="Close shortcuts" autoFocus>
          ×
        </button>
        <span className="micro">REFERENCE</span>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl className="sheet__keys">
          {KEYS.map((item) => (
            <div key={item.label}>
              <dt>
                {item.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{item.label}</dd>
            </div>
          ))}
        </dl>
        <p className="sheet__note">
          Shortcuts work while the studio is open, as long as you are not typing in a field or using a slider.
        </p>
      </div>
    </div>
  );
}
