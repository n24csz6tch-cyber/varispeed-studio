import { UploadIcon } from './ui';

export function Dropzone({
  onBrowse,
  dragging,
  compact,
}: {
  onBrowse: () => void;
  dragging: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'drop drop--compact' : 'drop'}>
      <div className="drop__art">
        <span className="drop__ring" />
        <span className="drop__ring drop__ring--2" />
        <UploadIcon />
      </div>
      <h2>{dragging ? 'Drop it' : 'Load a track'}</h2>
      <p>
        Drag &amp; drop audio, or choose a file. MP3, WAV, M4A/AAC, FLAC, OGG — anything your browser can decode.
      </p>
      <button type="button" className="btn btn--primary btn--lg" onClick={onBrowse}>
        Choose audio file
      </button>
      <ul className="drop__notes">
        <li>Processed on this device — nothing is uploaded</li>
        <li>Full-quality offline render for every export</li>
        <li>Tempo, pitch and bass are never baked in</li>
      </ul>
    </div>
  );
}
