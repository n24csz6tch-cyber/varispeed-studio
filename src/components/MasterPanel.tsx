import { formatTime } from '../audio/params';
import type { ExportFormat, RenderProgress } from '../audio/protocol';
import type { RenderStats } from '../audio/types';
import { Panel, ProgressBar, Segmented, cx } from './ui';

export interface ExportView {
  url: string;
  name: string;
  bytes: number;
  sampleRate: number;
  truePeakDb: number;
  duration: number;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

interface MasterPanelProps {
  stats: RenderStats | null;
  sampleRate: number;
  channels: number;
  originalDuration: number;
  processedDuration: number;
  format: ExportFormat;
  onFormat: (format: ExportFormat) => void;
  onExport: () => void;
  onCancelExport: () => void;
  exportProgress: RenderProgress | null;
  exportResult: ExportView | null;
}

export function MasterPanel({
  stats,
  sampleRate,
  channels,
  originalDuration,
  processedDuration,
  format,
  onFormat,
  onExport,
  onCancelExport,
  exportProgress,
  exportResult,
}: MasterPanelProps) {
  const busy = !!exportProgress;
  return (
    <Panel
      title="Master & export"
      meta={
        <>
          TRUE PEAK −1 dBTP <span className="meta-sep">·</span> {channels > 1 ? 'STEREO' : 'MONO'}
        </>
      }
    >
      <div className="stats">
        <div className="stat">
          <span>MAKEUP</span>
          <b>{stats ? `${stats.gainCompDb >= 0 ? '+' : ''}${stats.gainCompDb.toFixed(1)} dB` : '—'}</b>
        </div>
        <div className="stat">
          <span>TRUE PEAK</span>
          <b>{stats ? `${stats.truePeakDb.toFixed(1)} dBTP` : '—'}</b>
        </div>
        <div className="stat">
          <span>LIMITER GR</span>
          <b>{stats ? `${stats.gainReductionDb.toFixed(1)} dB` : '—'}</b>
        </div>
      </div>

      <div className="chainline">
        <span>STRETCH</span>
        <i />
        <span>GAIN</span>
        <i />
        <span>LIMIT</span>
      </div>

      <div className="exportmeta">
        <span>
          {formatTime(originalDuration)} <span className="arrow">→</span> <b>{formatTime(processedDuration)}</b>
        </span>
        <span>
          {sampleRate >= 1000 ? `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz` : `${sampleRate} Hz`}{' '}
          · {format === 'wav' ? '24-bit PCM' : '320 kbps'}
        </span>
      </div>

      <div className="exportrow">
        <Segmented<ExportFormat>
          label="Export format"
          value={format}
          onChange={onFormat}
          options={[
            { value: 'wav', label: 'WAV' },
            { value: 'mp3', label: 'MP3' },
          ]}
        />
        <button type="button" className={cx('btn', 'btn--primary', 'btn--grow')} onClick={onExport} disabled={busy}>
          {busy ? 'Exporting…' : `Export ${format === 'wav' ? 'WAV' : 'MP3'}`}
        </button>
      </div>

      {exportProgress ? (
        <div className="exportprogress">
          <ProgressBar value={exportProgress.value} tone="mint" />
          <div className="exportprogress__row">
            <span>
              {exportProgress.phase === 'stretch'
                ? 'Final-quality stretch'
                : exportProgress.phase === 'master'
                  ? 'Master chain'
                  : 'Encoding file'}{' '}
              · {Math.round(exportProgress.value * 100)}%
            </span>
            <button type="button" className="linkbtn" onClick={onCancelExport}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {exportResult ? (
        <div className="exportdone">
          <div>
            <span className="micro">FILE READY</span>
            <b title={exportResult.name}>{exportResult.name}</b>
            <span className="exportdone__meta">
              {formatBytes(exportResult.bytes)} · {formatTime(exportResult.duration)} ·{' '}
              {exportResult.truePeakDb.toFixed(1)} dBTP
            </span>
          </div>
          <a className="btn btn--ghost btn--sm" href={exportResult.url} download={exportResult.name}>
            Save again
          </a>
        </div>
      ) : null}
    </Panel>
  );
}
