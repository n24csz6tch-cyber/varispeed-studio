import type { CSSProperties } from 'react';
import { NodeField } from './NodeField';
import { ArrowIcon, UploadIcon } from './ui';

const WAVE = Array.from({ length: 54 }, (_, i) =>
  Math.round(16 + Math.abs(Math.sin(i * 0.58) * Math.cos(i * 0.17)) * 80),
);

const TICKER = [
  'INDEPENDENT TEMPO',
  'FORMANT-SAFE PITCH',
  'BANDLAB-STYLE GAIN',
  'TRUE-PEAK LIMITING',
  '24-BIT WAV',
  '320 KBPS MP3',
  'RUBBER BAND R3',
  'ZERO UPLOADS',
];

const STAGES = [
  {
    title: 'Stretch',
    copy: 'Rubber Band R3 moves time without smearing transients, from half speed to double time.',
  },
  {
    title: 'Shift',
    copy: 'Move pitch up to ±5 semitones on its own, with the vocal formants kept in place.',
  },
  {
    title: 'Drive',
    copy: 'Push the BandLab-style gain to +24 dB and let the soft clipper saturate the low end.',
  },
  {
    title: 'Print',
    copy: 'Choose a −1 dBTP ceiling, then export a 24-bit WAV or a 320 kbps MP3 offline.',
  },
];

export function Hero({ onBrowse }: { onBrowse: () => void }) {
  return (
    <>
      <section className="hero">
        <NodeField />
        <div className="hero__veil" aria-hidden="true" />

        <div className="hero__inner">
          <div className="hero__copy">
            <p className="kicker" data-reveal>
              <span className="kicker__dot" />
              On-device audio lab
              <span className="kicker__sep">/</span>
              <span className="kicker__dim">Rubber Band R3</span>
            </p>

            <h1 className="hero__title">
              <span className="hero__word" data-reveal style={{ '--d': '60ms' } as CSSProperties}>
                Stretch
              </span>
              <span className="hero__word hero__word--serif" data-reveal style={{ '--d': '160ms' } as CSSProperties}>
                the moment
              </span>
            </h1>

            <p className="hero__lede" data-reveal style={{ '--d': '260ms' } as CSSProperties}>
              Sped up, slowed and nightcore edits built on a studio-grade time stretcher. Move tempo and pitch
              independently, drive the gain until it bites, and print a clean master — all inside this tab.
            </p>

            <div className="hero__actions" data-reveal style={{ '--d': '340ms' } as CSSProperties}>
              <button type="button" className="btn btn--primary btn--lg" onClick={onBrowse}>
                Load a track
                <ArrowIcon />
              </button>
              <a className="btn btn--ghost btn--lg" href="#chain">
                See the signal path
              </a>
            </div>

            <ul className="hero__facts" data-reveal style={{ '--d': '420ms' } as CSSProperties}>
              <li>
                <b>0.50–2.00×</b>
                <span>Independent tempo</span>
              </li>
              <li>
                <b>±5 st</b>
                <span>Formant-safe pitch</span>
              </li>
              <li>
                <b>−1 dBTP</b>
                <span>True-peak ceiling</span>
              </li>
            </ul>
          </div>

          <div
            className="herocard"
            role="button"
            tabIndex={0}
            onClick={onBrowse}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onBrowse();
              }
            }}
            aria-label="Load an audio file from this device"
            data-reveal
            style={{ '--d': '240ms' } as CSSProperties}
          >
            <div className="herocard__bar">
              <span className="herocard__tag">
                <i />
                INPUT
              </span>
              <span className="herocard__fmt">MP3 · WAV · FLAC · M4A · OGG</span>
            </div>

            <div className="herocard__wave" aria-hidden="true">
              {WAVE.map((height, index) => (
                <i
                  key={index}
                  style={{ '--h': height, '--i': index } as CSSProperties}
                />
              ))}
            </div>

            <div className="herocard__read" aria-hidden="true">
              <div>
                <span>TEMPO</span>
                <b>1.20×</b>
              </div>
              <div>
                <span>PITCH</span>
                <b>+0.0 st</b>
              </div>
              <div>
                <span>GAIN</span>
                <b>+6.0 dB</b>
              </div>
            </div>

            <div className="herocard__drop">
              <span className="herocard__icon">
                <UploadIcon />
              </span>
              <span className="herocard__dropcopy">
                <b>Drop your audio</b>
                <em>or click anywhere in this card to browse</em>
              </span>
              <span className="herocard__local">Local only</span>
            </div>
          </div>
        </div>

        <div className="ticker" aria-hidden="true">
          <div className="ticker__track">
            {[0, 1].map((copy) => (
              <span className="ticker__set" key={copy}>
                {TICKER.map((item) => (
                  <span className="ticker__item" key={`${copy}-${item}`}>
                    {item}
                    <i />
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="chain" id="chain" aria-label="How the engine works">
        <header className="chain__head" data-reveal>
          <span className="micro">THE SIGNAL PATH</span>
          <h3>
            Four stages. <em>One render.</em>
          </h3>
        </header>

        <ol className="chain__grid">
          {STAGES.map((stage, index) => (
            <li className="chain__card" key={stage.title} data-reveal style={{ '--d': `${index * 70}ms` } as CSSProperties}>
              <span className="chain__idx">{String(index + 1).padStart(2, '0')}</span>
              <h4>{stage.title}</h4>
              <p>{stage.copy}</p>
            </li>
          ))}
        </ol>

        <div className="statement" data-reveal>
          <p>
            Everything runs on <em>your</em> machine. No account, no upload bar, no copy of your music anywhere but
            this tab.
          </p>
          <span className="micro">LOCAL-FIRST BY DESIGN</span>
        </div>
      </section>
    </>
  );
}
