import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArchiveTrack, searchArchive, type ArchiveHit } from '../lib/archive';
import { fetchSong, searchSongs, type SongHit } from '../lib/music';
import { deleteSource, deleteVersion, listSources, listVersions, type SavedSource, type SavedVersion } from '../lib/library';
import { fetchLinkedAudio, normalizeAudioLink } from '../lib/net';
import { prettyName } from '../lib/names';
import { cx } from './ui';

export type LoadOrigin = 'upload' | 'search' | 'library';

interface LibraryProps {
  onLoadFile: (file: File, origin: LoadOrigin) => void;
  onSaveVersion: (() => Promise<SavedVersion | null>) | null;
  onMix: ((a: SavedSource, b: SavedSource, fadeSeconds: number) => Promise<void>) | null;
  canSave: boolean;
  refreshKey: number;
}

const SUGGESTIONS = ['Nightcore', 'Slowed + reverb', 'Sped up', 'Deep slowed', 'Slowed', 'Hyperpop'];

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** WebKit reports every network failure as "Load failed"; never show that raw. */
function friendlyError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : '';
  if (/load failed|failed to fetch|network|offline/i.test(message)) {
    return 'No se ha podido conectar. Comprueba tu conexión e inténtalo otra vez.';
  }
  return message || fallback;
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const [query, setQuery] = useState('');
  const [catalogue, setCatalogue] = useState<'music' | 'free'>('music');
  const [searching, setSearching] = useState(false);
  const [songs, setSongs] = useState<SongHit[]>([]);
  const [free, setFree] = useState<ArchiveHit[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
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
  const [link, setLink] = useState('');
  const [loadingLink, setLoadingLink] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seq = useRef(0);
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

  // Search as you type: no submit button, a short pause so a fast typist only pays
  // for one request, and the previous request is aborted.
  useEffect(() => {
    const term = query.trim();
    const id = ++seq.current;
    setSongs([]);
    setFree([]);
    setError(null);
    if (term.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        if (catalogue === 'free') {
          const rows = await searchArchive(term, controller.signal);
          if (id !== seq.current) return;
          setFree(rows);
          if (!rows.length) setError(`Sin resultados para “${term}” en el archivo libre.`);
        } else {
          const rows = await searchSongs(term, controller.signal);
          if (id !== seq.current) return;
          setSongs(rows);
          if (!rows.length) setError(`Sin resultados para “${term}”.`);
        }
      } catch (err) {
        if (controller.signal.aborted || id !== seq.current) return;
        setError(friendlyError(err, 'La búsqueda ha fallado.'));
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, catalogue]);

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
        setError('El navegador no deja sonar la muestra. Toca otra vez.');
      });
    },
    [playingId, stopPreview],
  );

  const loadSong = async (hit: SongHit) => {
    setLoadingId(hit.id);
    setError(null);
    stopPreview();
    try {
      onLoadFile(await fetchSong(hit), 'search');
      setQuery('');
    } catch (err) {
      setError(friendlyError(err, 'No se ha podido traer esa canción.'));
    } finally {
      setLoadingId(null);
    }
  };

  const loadFree = async (hit: ArchiveHit) => {
    setLoadingId(hit.id);
    setError(null);
    stopPreview();
    try {
      onLoadFile(await fetchArchiveTrack(hit), 'search');
      setQuery('');
    } catch (err) {
      setError(friendlyError(err, 'No se ha podido traer ese audio.'));
    } finally {
      setLoadingId(null);
    }
  };

  const loadLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!link.trim() || loadingLink) return;
    const target = normalizeAudioLink(link);
    if (!target) {
      setError('Ese enlace no es válido.');
      return;
    }
    setLoadingLink(true);
    setError(null);
    stopPreview();
    try {
      const blob = await fetchLinkedAudio(target);
      // Strip the query before taking the last segment: signed CDN links carry slashes
      // inside their token, which used to end up in the file name.
      const clean = target.split('?')[0].split('#')[0];
      const raw = decodeURIComponent(clean.split('/').pop() || '').replace(/[\\/:*?"<>|]+/g, '');
      const base = raw.slice(-70) || 'audio';
      const name = base.includes('.') ? base : `${base}.mp3`;
      onLoadFile(new File([blob], name, { type: blob.type || 'audio/mpeg' }), 'upload');
      setLink('');
    } catch (err) {
      setError(friendlyError(err, 'No se ha podido cargar ese enlace.'));
    } finally {
      setLoadingLink(false);
    }
  };

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
      setError(friendlyError(err, 'No se ha podido guardar.'));
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
      setError(friendlyError(err, 'No se han podido mezclar esos audios.'));
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

  const hasQuery = query.trim().length >= 2;
  const mixReady = sources.length >= 2 && mixA !== mixB;

  // Two saves of the same song share a name; show the time so the picker is unambiguous.
  const nameCounts = new Map<string, number>();
  for (const source of sources) {
    const base = prettyName(source.name);
    nameCounts.set(base, (nameCounts.get(base) ?? 0) + 1);
  }
  const optionLabel = (source: SavedSource): string => {
    const base = prettyName(source.name);
    if ((nameCounts.get(base) ?? 0) <= 1) return base;
    const time = new Date(source.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${base} · ${time}`;
  };

  return (
    <section className="library" aria-label="Buscar música y biblioteca" data-reveal>
      <div className="library__head">
        <div className="library__title">
          <span className="micro">EXPLORAR</span>
          <h2>Buscar música</h2>
        </div>
        <span className="library__hint">
          {sources.length + versions.length === 0
            ? 'Tu biblioteca vive en este dispositivo'
            : `${sources.length} audios · ${versions.length} versiones`}
        </span>
      </div>

      <div className="libsearch">
        <svg className="libsearch__icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={catalogue === 'music' ? 'Artistas, canciones o estilos' : 'Jazz, piano, clásica, bandas sonoras…'}
          aria-label="Buscar música"
          autoComplete="off"
          spellCheck={false}
        />
        {searching ? (
          <span className="libsearch__spin" aria-label="Buscando" />
        ) : query ? (
          <button type="button" className="libsearch__clear" onClick={() => setQuery('')} aria-label="Borrar búsqueda">
            ×
          </button>
        ) : null}
      </div>

      <div className="seg library__seg" role="group" aria-label="Catálogo">
        <button
          type="button"
          className={cx('seg__item', catalogue === 'music' && 'is-active')}
          onClick={() => setCatalogue('music')}
        >
          Música
        </button>
        <button
          type="button"
          className={cx('seg__item', catalogue === 'free' && 'is-active')}
          onClick={() => setCatalogue('free')}
        >
          Archivo libre
        </button>
      </div>

      <form className="linkform" onSubmit={(event) => void loadLink(event)}>
        <input
          className="linkform__input"
          type="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="Pega un enlace a tu audio (Drive, Dropbox, MP3…)"
          aria-label="Cargar audio desde un enlace"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn btn--sm" type="submit" disabled={!link.trim() || loadingLink}>
          {loadingLink ? 'Descargando…' : 'Cargar'}
        </button>
      </form>
      <p className="library__note">
        Para una canción completa que ya es tuya: pega el enlace (en Drive usa «Compartir → cualquier persona con el
        enlace») y se abre entera en el editor.
      </p>

      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => setPlayingId(null)}
        onError={() => setPlayingId(null)}
        style={{ position: 'fixed', left: '-9999px', top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {!hasQuery ? (
        <>
          <div className="chips" aria-label="Búsquedas rápidas">
            {SUGGESTIONS.map((term) => (
              <button key={term} type="button" className="chip" onClick={() => setQuery(term)}>
                {term}
              </button>
            ))}
          </div>
          <p className="library__note">
            {catalogue === 'music'
              ? 'Toda la lista en una búsqueda: canciones completas cuando existen y muestras de 30 s del resto (es lo único que las discográficas permiten publicar).'
              : 'Temas completos de dominio público o licencia libre (Internet Archive).'}
          </p>
        </>
      ) : null}

      {error ? <p className="library__error">{error}</p> : null}

      {searching && !songs.length && !free.length ? (
        <ol className="tracks" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="track">
              <span className="skel track__art" />
              <span className="track__meta">
                <span className="skel skel--line" style={{ width: `${52 - i * 5}%` }} />
                <span className="skel skel--line skel--dim" style={{ width: `${34 - i * 3}%` }} />
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {songs.length > 0 && songs.every((hit) => !hit.full) ? (
        <p className="library__note library__note--warn">
          De este artista solo hay muestras de 30 s en los catálogos públicos. Si tienes el archivo completo, súbelo con
          «Subir una canción» y se edita entero.
        </p>
      ) : null}

      {songs.length > 0 ? (
        <ol className="tracks">
          {songs.map((hit) => (
            <li key={hit.id} className={cx('track', playingId === hit.id && 'is-playing')}>
              <button
                type="button"
                className="track__art"
                onClick={() => togglePreview(hit.id, hit.preview)}
                aria-label={playingId === hit.id ? `Pausar ${hit.title}` : `Escuchar ${hit.title}`}
              >
                {hit.artwork ? <img src={hit.artwork} alt="" width={48} height={48} loading="lazy" /> : null}
                <span className="track__play">{playingId === hit.id ? <Bars /> : '▶'}</span>
              </button>
              <div className="track__meta">
                <b>
                  {hit.title}
                  <em className={cx('track__tag', hit.full && 'track__tag--full')}>{hit.full ? 'COMPLETA' : '30 s'}</em>
                </b>
                <span>
                  {hit.artist}
                  {hit.album ? ` · ${hit.album}` : ''}
                </span>
              </div>
              <span className="track__dur">{clock(hit.duration)}</span>
              <button
                type="button"
                className={cx('track__use', loadingId === hit.id && 'is-busy')}
                onClick={() => void loadSong(hit)}
                disabled={loadingId !== null}
              >
                {loadingId === hit.id ? 'Trayendo…' : 'Usar'}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {free.length > 0 ? (
        <ol className="tracks">
          {free.map((hit) => (
            <li key={hit.id} className="track">
              <button
                type="button"
                className="track__art"
                onClick={() => void loadFree(hit)}
                disabled={loadingId !== null}
                aria-label={`Cargar ${hit.title}`}
              >
                <span className="track__ph">♪</span>
                <span className="track__play">{loadingId === hit.id ? <span className="libsearch__spin" /> : '▶'}</span>
              </button>
              <div className="track__meta">
                <b>{hit.title}</b>
                <span>{hit.creator || 'Internet Archive'}</span>
              </div>
              <button
                type="button"
                className={cx('track__use', loadingId === hit.id && 'is-busy')}
                onClick={() => void loadFree(hit)}
                disabled={loadingId !== null}
              >
                {loadingId === hit.id ? 'Trayendo…' : 'Usar'}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {sources.length > 0 ? (
        <>
          <h4 className="library__sub">TUS AUDIOS</h4>
          <ul className="saved">
            {sources.map((source) => (
              <li key={source.id} className="saved__item">
                <div className="saved__row">
                  <button
                    type="button"
                    className="saved__play"
                    onClick={() => togglePreview(source.id, urlFor(source.id, source.blob))}
                    aria-label={playingId === source.id ? 'Pausar' : 'Escuchar'}
                  >
                    {playingId === source.id ? <Bars /> : '▶'}
                  </button>
                  <div className="saved__main">
                    <b title={source.name}>{prettyName(source.name)}</b>
                    <span>
                      {source.origin === 'search' ? 'Del buscador' : 'Subido'} · {formatBytes(source.bytes)}
                    </span>
                  </div>
                  <div className="saved__actions">
                    <button type="button" className="btn btn--sm" onClick={() => openSource(source)}>
                      Editar
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void removeSource(source.id)}>
                      Borrar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sources.length >= 2 ? (
        <>
          <h4 className="library__sub">MEZCLAR DOS CANCIONES</h4>
          <div className="mix">
            <div className="mix__row">
              <select
                className="mix__select"
                value={mixA}
                onChange={(event) => setMixA(event.target.value)}
                aria-label="Primera canción"
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
                aria-label="Segunda canción"
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
                  Fundido <b>{fade.toFixed(1)} s</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={0.5}
                  value={fade}
                  onChange={(event) => setFade(Number(event.target.value))}
                  aria-label="Duración del fundido"
                />
              </label>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void runMix()}
                disabled={!mixReady || mixing || !onMix}
              >
                {mixing ? 'Mezclando…' : 'Mezclar'}
              </button>
            </div>
            <p className="library__note">
              Une el final de una canción con el principio de la otra y ábrela en el editor. La mezcla se queda en Tus
              audios.
            </p>
          </div>
        </>
      ) : null}

      <div className="library__save">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveCurrent()} disabled={!canSave || saving}>
          {saving ? 'Guardando…' : 'Guardar versión actual'}
        </button>
      </div>

      {versions.length > 0 ? (
        <>
          <h4 className="library__sub">VERSIONES</h4>
          <ul className="saved">
            {versions.map((version) => (
              <li key={version.id} className="saved__item">
                <div className="saved__row">
                  <button
                    type="button"
                    className="saved__play"
                    onClick={() => setOpenId(openId === version.id ? null : version.id)}
                    aria-label={openId === version.id ? 'Cerrar reproductor' : 'Escuchar versión'}
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
                      Borrar
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
    </section>
  );
}
