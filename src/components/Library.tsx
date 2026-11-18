import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteSource, deleteVersion, listSources, listVersions, type SavedSource, type SavedVersion } from '../lib/library';
import { prettyName } from '../lib/names';
import { cx } from './ui';

export type LoadOrigin = 'upload' | 'library';

interface LibraryProps {
  onLoadFile: (file: File, origin: LoadOrigin) => void;
  onSaveVersion: (() => Promise<SavedVersion | null>) | null;
  onMix: ((a: SavedSource, b: SavedSource, fadeSeconds: number) => Promise<void>) | null;
  canSave: boolean;
  refreshKey: number;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** WebKit reports every network failure as "Load failed"; never show that raw. */
function friendlyError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : '';
  if (/load failed|failed to fetch|network|offline/i.test(message)) {
    return 'Could not reach that file. Check your connection and try again.';
  }
  return message || fallback;
}

/** A tiny equaliser glyph so a playing row reads at a glance. */
function Bars() {
  return (
    <span className="bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Library({ onLoadFile, onSaveVersion, onMix, canSave, refreshKey }: LibraryProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [mixA, setMixA] = useState('');
  const [mixB, setMixB] = useState('');
  const [fade, setFade] = useState(4);
  const [mixing, setMixing] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    try {
      const [nextSources, nextVersions] = await Promise.all([listSources(), listVersions()]);
      setSources(nextSources);
      setVersions(nextVersions);
    } catch {
      /* private mode without IndexedDB */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const map = urls.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  // Keep the two mix slots pointing at something that exists, and prefer a different
  // track in the second slot instead of mixing a song with a copy of itself.
  useEffect(() => {
    if (sources.length === 0) return;
    setMixA((current) => (sources.some((s) => s.id === current) ? current : sources[0].id));
    setMixB((current) => {
      if (sources.some((s) => s.id === current)) return current;
      const first = sources[0];
      const different = sources.find((s) => s.id !== first.id && prettyName(s.name) !== prettyName(first.name));
      return (different ?? sources[1] ?? sources[0]).id;
    });
  }, [sources]);

  const urlFor = (id: string, blob: Blob): string => {
    const existing = urls.current.get(id);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    urls.current.set(id, url);
    return url;
  };

  const stopPreview = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    setPlayingId(null);
  }, []);

  const togglePreview = useCallback(
    (id: string, src: string) => {
      const el = audioRef.current;
      if (!el) return;
      if (playingId === id) {
        stopPreview();
        return;
      }
      el.src = src;
      setPlayingId(id);
      setError(null);
      void el.play().catch(() => {
        setPlayingId(null);
        setError('The browser blocked playback. Tap play again.');
      });
    },
    [playingId, stopPreview],
  );

  const openSource = (source: SavedSource) => {
    stopPreview();
    onLoadFile(new File([source.blob], source.name, { type: source.blob.type }), 'library');
  };

  const saveCurrent = async () => {
    if (!onSaveVersion || saving) return;
    setSaving(true);
    setError(null);
    try {
      const version = await onSaveVersion();
      if (version) await refresh();
    } catch (err) {
      setError(friendlyError(err, 'That version could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const runMix = async () => {
    if (!onMix || mixing) return;
    const a = sources.find((s) => s.id === mixA);
    const b = sources.find((s) => s.id === mixB);
    if (!a || !b || a.id === b.id) return;
    setMixing(true);
    setError(null);
    stopPreview();
    try {
      await onMix(a, b, fade);
    } catch (err) {
      setError(friendlyError(err, 'Those tracks could not be mixed.'));
    } finally {
      setMixing(false);
    }
  };

  const removeSource = async (id: string) => {
    await deleteSource(id);
    const url = urls.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urls.current.delete(id);
    }
    if (playingId === id) stopPreview();
    await refresh();
  };

  const removeVersion = async (id: string) => {
    await deleteVersion(id);
    const url = urls.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urls.current.delete(id);
    }
    if (openId === id) setOpenId(null);
    await refresh();
  };

  const mixReady = sources.length >= 2 && mixA !== mixB;
  const isEmpty = sources.length + versions.length === 0;

  // Two saves of the same song share a name; show the time so the picker is unambiguous.
  const nameCounts = new Map<string, number>();
  for (const source of sources) {
    const base = prettyName(source.name);
    nameCounts.set(base, (nameCounts.get(base) ?? 0) + 1);
  }
  const optionLabel = (source: SavedSource): string => {
    const base = prettyName(source.name);
    if ((nameCounts.get(base) ?? 0) <= 1) return base;
    const time = new Date(source.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${base} · ${time}`;
  };

  return (
    <section className="library" aria-label="Library" data-reveal>
      <div className="library__head">
        <div className="library__title">
          <span className="micro">ON THIS DEVICE</span>
          <h2>Library</h2>
        </div>
        <div className="library__toolbar">
          <span className="library__hint">
            {isEmpty ? 'Nothing saved yet' : `${sources.length} sources · ${versions.length} versions`}
          </span>
          {canSave ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveCurrent()} disabled={saving}>
              {saving ? 'Saving…' : 'Save current version'}
            </button>
          ) : null}
        </div>
      </div>

      <p className="library__note">
        Files you open are cached here, so a refresh never loses your session. Saved versions are finished masters —
        keep them, download them, or delete them.
      </p>

      {error ? <p className="library__error">{error}</p> : null}

      {isEmpty ? (
        <div className="library__empty">
          <span className="library__emptymark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2.5h5.5A2.5 2.5 0 0 1 20 10v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17V7.5Z" />
            </svg>
          </span>
          <div>
            <b>No sessions yet</b>
            <span>Load a track and it will wait for you here, even after a reload.</span>
          </div>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <>
          <h4 className="library__sub">
            SOURCES <span>{String(sources.length).padStart(2, '0')}</span>
          </h4>
          <ul className="saved">
            {sources.map((source) => (
              <li key={source.id} className="saved__item">
                <div className="saved__row">
                  <button
                    type="button"
                    className={cx('saved__play', playingId === source.id && 'is-playing')}
                    onClick={() => togglePreview(source.id, urlFor(source.id, source.blob))}
                    aria-label={playingId === source.id ? 'Pause preview' : 'Preview source'}
                  >
                    {playingId === source.id ? <Bars /> : '▶'}
                  </button>
                  <div className="saved__main">
                    <b title={source.name}>{prettyName(source.name)}</b>
                    <span>{formatBytes(source.bytes)} · cached locally</span>
                  </div>
                  <div className="saved__actions">
                    <button type="button" className="btn btn--sm" onClick={() => openSource(source)}>
                      Open
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void removeSource(source.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {versions.length > 0 ? (
        <>
          <h4 className="library__sub">
            VERSIONS <span>{String(versions.length).padStart(2, '0')}</span>
          </h4>
          <ul className="saved">
            {versions.map((version) => (
              <li key={version.id} className="saved__item">
                <div className="saved__row">
                  <button
                    type="button"
                    className={cx('saved__play', openId === version.id && 'is-playing')}
                    onClick={() => setOpenId(openId === version.id ? null : version.id)}
                    aria-label={openId === version.id ? 'Close player' : 'Play version'}
                  >
                    {openId === version.id ? '×' : '▶'}
                  </button>
                  <div className="saved__main">
                    <b title={version.name}>{version.name}</b>
                    <span>
                      {version.detail} · {formatBytes(version.bytes)}
                    </span>
                  </div>
                  <div className="saved__actions">
                    <a className="btn btn--ghost btn--sm" href={urlFor(version.id, version.blob)} download={version.name}>
                      WAV
                    </a>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void removeVersion(version.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                {openId === version.id ? (
                  <audio className="saved__audio" src={urlFor(version.id, version.blob)} controls autoPlay preload="auto" />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sources.length >= 2 ? (
        <>
          <h4 className="library__sub">MIX TWO TRACKS</h4>
          <div className="mix">
            <div className="mix__row">
              <select
                className="mix__select"
                value={mixA}
                onChange={(event) => setMixA(event.target.value)}
                aria-label="First track"
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {optionLabel(source)}
                  </option>
                ))}
              </select>
              <span className="mix__plus" aria-hidden="true">
                +
              </span>
              <select
                className="mix__select"
                value={mixB}
                onChange={(event) => setMixB(event.target.value)}
                aria-label="Second track"
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {optionLabel(source)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mix__row">
              <label className="mix__fade">
                <span>
                  Crossfade <b>{fade.toFixed(1)} s</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={0.5}
                  value={fade}
                  onChange={(event) => setFade(Number(event.target.value))}
                  aria-label="Crossfade length"
                />
              </label>
              <button type="button" className="btn btn--sm" onClick={() => void runMix()} disabled={!mixReady || mixing || !onMix}>
                {mixing ? 'Mixing…' : 'Mix tracks'}
              </button>
            </div>
            <p className="library__note">
              Joins the end of one track to the start of the other with a crossfade, then opens the result in the
              studio.
            </p>
          </div>
        </>
      ) : null}

      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => setPlayingId(null)}
        onError={() => setPlayingId(null)}
        style={{ position: 'fixed', left: '-9999px', top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
    </section>
  );
}
