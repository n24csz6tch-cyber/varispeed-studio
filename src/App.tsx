import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PreviewAssembler } from './audio/assembler';
import { decodeAudioFile } from './audio/decode';
import { engine, JobCancelled } from './audio/engine';
import { ActivePresetId, PRESETS, computePeaks, exportFilename, stretchKey } from './audio/params';
import { player } from './audio/player';
import type { ExportFormat, RenderProgress } from './audio/protocol';
import type { Peaks, RenderStats, Settings } from './audio/types';
import { encodeWav16 } from './audio/compat';
import { crossfadeBuffers } from './audio/mix';
import { saveSource, saveVersion, type SavedSource, type SavedVersion } from './lib/library';
import { prettyName } from './lib/names';
import { GainPanel } from './components/GainPanel';
import { Deck } from './components/Deck';
import { Hero } from './components/Hero';
import { FxPanel } from './components/FxPanel';
import { Library, type LoadOrigin } from './components/Library';
import { MasterPanel, type ExportView } from './components/MasterPanel';
import { MiniBar } from './components/MiniBar';
import { ShapePanel } from './components/ShapePanel';
import { cx } from './components/ui';

interface Track {
  id: number;
  name: string;
  buffer: AudioBuffer;
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  channelCount: number;
  peaks: Peaks;
}

interface ProcessedView {
  peaks: Peaks;
  duration: number;
  /** Null while the track is still streaming in, so the master panel shows dashes. */
  stats: RenderStats | null;
}

const MAX_BYTES = 96 * 1024 * 1024;
// Memory guard: the source, the worker copy and the rendered buffers all live at
// once, so very long files would exhaust a phone's tab budget.
const MAX_DURATION = 10 * 60;

// Development-only inspection hook (stripped from production builds).
if (import.meta.env.DEV) {
  (window as unknown as { __studio?: unknown }).__studio = { player, engine };
}

function downmix(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(2, buffer.length, buffer.sampleRate);
  out.copyToChannel(buffer.getChannelData(0), 0);
  out.copyToChannel(buffer.getChannelData(1), 1);
  return out;
}

export default function App() {
  const [track, setTrack] = useState<Track | null>(null);
  const [settings, setSettings] = useState<Settings>(PRESETS[0].settings);
  const [processed, setProcessed] = useState<ProcessedView | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [exportProgress, setExportProgress] = useState<RenderProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceTick, setSourceTick] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const trackId = useRef(1);
  const renderSeq = useRef(0);
  const lastStretch = useRef('');
  const switched = useRef(false);
  const dragDepth = useRef(0);
  const exportUrl = useRef<string | null>(null);

  const snapshot = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  const activePreset = ActivePresetId(settings);

  // ---- Load & decode -------------------------------------------------------
  const loadFile = useCallback(async (file: File, origin: LoadOrigin = 'upload') => {
    setError(null);
    try {
      if (file.size > MAX_BYTES) throw new Error('That file is larger than 96 MB. Try a shorter track or a compressed format.');

      const ctx = player.ensure();
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
      const bytes = await file.arrayBuffer();

      let decoded: AudioBuffer;
      try {
        decoded = await decodeAudioFile(bytes, ctx);
      } catch {
        throw new Error(
          'This file could not be decoded. Try MP3, WAV, M4A/AAC or FLAC — browsers cannot decode every container.',
        );
      }
      if (!decoded.length) throw new Error('That file contains no audio.');
      if (decoded.duration > MAX_DURATION) throw new Error('Tracks up to 10 minutes are supported on this device.');

      const buffer = decoded.numberOfChannels > 2 ? downmix(ctx, decoded) : decoded;
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        channels.push(new Float32Array(buffer.getChannelData(c)));
      }

      player.pause();
      player.setOriginal(buffer);
      player.setTitle(file.name.replace(/\.[^.]+$/, ''));
      player.seekSourceTime(0);

      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      exportUrl.current = null;
      setExportResult(null);
      setExportProgress(null);
      setProcessed(null);
      setRenderProgress(null);
      switched.current = false;
      lastStretch.current = '';
      renderSeq.current += 1;
      setSettings(PRESETS[0].settings);
      // Mixes are saved as 16-bit WAV and land around 30 MB, so the library cap has to
      // sit above them; the load limit (96 MB) still guards the decoder.
      if (origin !== 'library' && file.size <= 60 * 1024 * 1024) {
        void saveSource({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          bytes: file.size,
          createdAt: Date.now(),
          origin: 'upload',
          blob: file,
        })
          .then(() => setSourceTick((n) => n + 1))
          .catch(() => undefined);
      }

      setTrack({
        id: trackId.current++,
        name: prettyName(file.name),
        buffer,
        channels,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        channelCount: buffer.numberOfChannels,
        peaks: computePeaks(channels, 1800),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be loaded.');
    }
  }, []);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  // ---- Render preview whenever settings change -----------------------------
  useEffect(() => {
    if (!track) return;
    const stretch = stretchKey(settings, 'preview');
    // First render after a load: start immediately, the user is waiting. Later changes
    // get a debounce so dragging a slider does not queue a render per pixel.
    const delay = lastStretch.current === '' ? 40 : stretch === lastStretch.current ? 90 : 120;
    const seq = ++renderSeq.current;
    // A tap must visibly do something straight away: show the render state before
    // the debounce and before the worker has produced a single chunk.
    setRenderProgress({ phase: 'stretch', value: 0.01 });

    const timer = window.setTimeout(async () => {
      lastStretch.current = stretch;
      setRenderProgress({ phase: 'stretch', value: 0.01 });
      try {
        await engine.loadSource(track.id, track.channels, track.sampleRate);
        const sink = new PreviewAssembler(player.ensure(), player.processedBuffer());
        // Adopt the audio chunk by chunk as it is mastered. That works from the very
        // first render (playback starts in about two seconds) and also for a re-render
        // that reuses the attached buffer, which then keeps playing without a seam.
        const hadProcessed = player.getSnapshot().hasProcessed;
        // A freshly dropped track starts playing by itself as soon as there is audio.
        const autoplay = !hadProcessed;
        let autoStarted = false;
        let swapped = false;
        let publishedAt = 0;

        const publish = (restart = false) => {
          if (!sink.buffer) return;
          player.setProcessed(sink.buffer, {
            bufferedUntil: sink.complete ? Infinity : sink.frontier,
            restart,
          });
          setProcessed({ peaks: sink.peaksSnapshot(), duration: sink.duration, stats: null });
          if (!switched.current) {
            switched.current = true;
            player.setView('processed');
          }
          if (autoplay && !autoStarted) {
            autoStarted = true;
            void player.play();
          }
        };

        const result = await engine.render(
          settings,
          'preview',
          (progress) => {
            if (seq === renderSeq.current) setRenderProgress(progress);
          },
          (chunk) => {
            if (seq !== renderSeq.current) return;
            sink.push(chunk.channels, chunk.startFrame, chunk.totalFrames, chunk.sampleRate);
            if (!swapped) {
              // A tempo change produces a buffer with a new length: adopt it right
              // away and let the transport restart on it at the same point in the
              // song. Waiting for the whole render left the controls looking dead
              // for a minute on a phone.
              swapped = true;
              publishedAt = performance.now();
              // Re-renders re-seat the transport so the new audio is what you hear,
              // whether the buffer was replaced or rewritten in place.
              publish(hadProcessed);
              return;
            }
            const now = performance.now();
            if (now - publishedAt > 140) {
              publishedAt = now;
              publish();
            }
          },
        );
        if (seq !== renderSeq.current) return;
        if (!sink.buffer) throw new Error('The render produced no audio.');

        player.setProcessed(sink.buffer, { bufferedUntil: Infinity });
        setProcessed({ peaks: sink.peaksSnapshot(), duration: result.duration, stats: result.stats });
        setRenderProgress(null);
        setError(null);
        if (!switched.current) {
          switched.current = true;
          player.setView('processed');
        }
      } catch (err) {
        if (seq !== renderSeq.current) return;
        setRenderProgress(null);
        if (err instanceof JobCancelled) return;
        setError(err instanceof Error ? err.message : 'Rendering failed.');
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [track, settings]);

  // ---- Export --------------------------------------------------------------
  const handleExport = useCallback(async () => {
    if (!track || exportProgress) return;
    setError(null);
    try {
      setExportProgress({ phase: 'stretch', value: 0 });
      await engine.loadSource(track.id, track.channels, track.sampleRate);
      const result = await engine.exportTrack(settings, exportFormat, (progress) => setExportProgress(progress));

      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      const url = URL.createObjectURL(result.blob);
      exportUrl.current = url;
      const name = exportFilename(track.name, settings, exportFormat);
      setExportResult({
        url,
        name,
        bytes: result.bytes,
        sampleRate: result.sampleRate,
        truePeakDb: result.stats.truePeakDb,
        duration: result.duration,
      });
      setExportProgress(null);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setExportProgress(null);
      if (err instanceof JobCancelled) return;
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  }, [track, settings, exportFormat, exportProgress]);

  const handleCancelExport = useCallback(() => {
    engine.cancelExport();
    setExportProgress(null);
  }, []);

  // ---- Drag & drop ---------------------------------------------------------
  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  // ---- Keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'BUTTON', 'A', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (!track) return;
      event.preventDefault();
      void player.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [track]);

  useEffect(() => {
    // Spin the worker up now so the WASM engine is compiled before a file is dropped.
    engine.warm();
    // Browsers only allow audio to start from a user gesture: take the first one
    // that happens anywhere in the page.
    const unlock = () => {
      void player.unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      engine.cancel();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const saveCurrentVersion = useCallback(async (): Promise<SavedVersion | null> => {
    const buffer = player.processedBuffer();
    if (!buffer || !track) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const blob = encodeWav16(channels, buffer.sampleRate);
    const version: SavedVersion = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: exportFilename(track.name, settings, 'wav'),
      detail: `${settings.tempo.toFixed(2)}× · ${settings.mode} · reverb ${Math.round(settings.reverb)}% · gain +${settings.gain.toFixed(0)} dB`,
      duration: buffer.duration,
      bytes: blob.size,
      createdAt: Date.now(),
      blob,
    };
    await saveVersion(version);
    return version;
  }, [track, settings]);

  const handleMix = useCallback(
    async (a: SavedSource, b: SavedSource, fadeSeconds: number) => {
      const ctx = player.ensure();
      try {
        const [bufA, bufB] = await Promise.all([
          decodeAudioFile(await a.blob.arrayBuffer(), ctx),
          decodeAudioFile(await b.blob.arrayBuffer(), ctx),
        ]);
        const mixed = crossfadeBuffers(ctx, bufA, bufB, fadeSeconds);
        const channels: Float32Array[] = [];
        for (let c = 0; c < mixed.numberOfChannels; c++) channels.push(mixed.getChannelData(c));
        const wav = encodeWav16(channels, mixed.sampleRate);
        const name = `Mezcla — ${a.name.replace(/\.[^.]+$/, '')} + ${b.name.replace(/\.[^.]+$/, '')}.wav`;
        await loadFile(new File([wav], name, { type: 'audio/wav' }), 'upload');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Those files could not be mixed.');
      }
    },
    [loadFile],
  );

  // While a re-render is in flight the readout follows the new tempo immediately,
  // so the numbers respond on the same tap as the control.
  const expectedDuration = track ? track.duration / settings.tempo : 0;
  const processedDuration = renderProgress || !processed ? expectedDuration : processed.duration;

  return (
    <div className="app" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
      <header className="topbar" id="top">
        <a className="brand" href="#top" aria-label="VARISPEED Studio">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path
                d="M4 19c2.6 0 3.6-8 6.2-8s3.6 14 6.2 14 3.6-11 6.2-11 3 5 5.4 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="brand__text">
            <b>VARISPEED</b>
            <i>STUDIO</i>
          </span>
        </a>
        <div className="topbar__meta">
          <span className="chipstat">
            <i className="chipstat__dot" />
            R3 ENGINE
          </span>
          <span className="chipstat chipstat--ghost">LOCAL ONLY</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={openPicker}>
            Load audio
          </button>
        </div>
        <span className="topbar__progress" aria-hidden="true" />
      </header>

      <main className="main">
        {error ? (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              Dismiss
            </button>
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff,.webm"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = '';
          }}
        />

        {track ? (
          <div className="studio">
            <Deck
              name={track.name}
              sampleRate={track.sampleRate}
              channels={track.channelCount}
              duration={track.duration}
              peaks={track.peaks}
              processedPeaks={processed?.peaks ?? null}
              processedDuration={processedDuration}
              snapshot={snapshot}
              renderProgress={renderProgress}
              player={player}
              onReplace={openPicker}
            />

            <section className="presets" aria-label="Presets" data-reveal>
              <div className="presets__head">
                <span className="micro">STARTING POINTS</span>
                <span className="presets__hint">Pick a flavour — every value stays editable.</span>
              </div>
              <div className="presets__grid">
                {PRESETS.map((preset, index) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cx('preset', activePreset === preset.id && 'is-active')}
                    onClick={() => setSettings(preset.settings)}
                  >
                    <span className="preset__idx">{String(index + 1).padStart(2, '0')}</span>
                    <span className="preset__name">{preset.name}</span>
                    <span className="preset__detail">{preset.detail}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="grid" data-reveal>
              <div className="col">
                <ShapePanel settings={settings} onChange={update} />
                <FxPanel settings={settings} onChange={update} />
              </div>
              <div className="col">
                <GainPanel settings={settings} onChange={update} />
                <MasterPanel
                  stats={processed?.stats ?? null}
                  sampleRate={track.sampleRate}
                  channels={track.channelCount}
                  originalDuration={track.duration}
                  processedDuration={processedDuration}
                  format={exportFormat}
                  onFormat={setExportFormat}
                  onExport={() => void handleExport()}
                  onCancelExport={handleCancelExport}
                  exportProgress={exportProgress}
                  exportResult={exportResult}
                />
              </div>
            </div>
          </div>
        ) : (
          <Hero onBrowse={openPicker} />
        )}

        <Library
          onLoadFile={(file, origin) => void loadFile(file, origin)}
          onSaveVersion={saveCurrentVersion}
          onMix={handleMix}
          canSave={!!processed && !!track}
          refreshKey={sourceTick}
        />

        <footer className="footer" data-reveal>
          <div className="footer__brand">
            <span>VARISPEED</span>
            <em>STUDIO</em>
          </div>
          <span className="footer__note">
            Engine: Rubber Band Library R3 (GPLv2) via rubberband-wasm · LAME (LGPL) for MP3 · Web Audio API
          </span>
          <span className="footer__note footer__note--last">Processed on your device. Nothing is uploaded.</span>
        </footer>
      </main>

      {track ? <MiniBar player={player} snapshot={snapshot} /> : null}

      {dragging && track ? <div className="dropoverlay">Drop to replace the current track</div> : null}
    </div>
  );
}
