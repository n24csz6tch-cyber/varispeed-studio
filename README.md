# VARISPEED Studio

A browser audio lab for **sped up**, **slowed** and **nightcore** edits: independent tempo and pitch, a
BandLab-style gain stage with soft-clip saturation, stereo reverb, and offline export to 24-bit WAV or
320 kbps MP3.

Everything runs on the device with [Rubber Band Library R3](https://breakfastquay.com/rubberband/)
compiled to WebAssembly. Nothing is uploaded, no account is needed, and the source audio never leaves
the tab.

## Stack

- React 19 + TypeScript + Vite
- Rubber Band R3 via `rubberband-wasm`, driven from a Web Worker
- Web Audio API transport with A/B between the original and the processed buffer
- Canvas waveform, spectrum analyser and the hero ribbon field
- IndexedDB for the local library (cached sources and printed versions)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build     # typecheck and emit dist/
npm run preview   # serve dist/ locally
```

## Deployment

The GitHub Actions workflow in `.github/workflows/pages.yml` typechecks, builds and publishes `dist/`
to GitHub Pages on every push to `main` (Settings → Pages → Source: GitHub Actions).

The app is a static bundle: no server, no proxy, no environment variables.
