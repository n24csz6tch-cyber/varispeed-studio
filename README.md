# VARISPEED Studio

Editor de audio en el navegador para hacer **sped up**, **slowed** y **nightcore**: tempo y tono independientes, control de **gain** estilo BandLab con saturación, reverb, y exportación a WAV 24-bit o MP3.

Todo el procesado ocurre en el dispositivo con [Rubber Band Library R3](https://breakfastquay.com/rubberband/) compilado a WebAssembly. Nada se sube a ningún servidor.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build     # comprueba tipos y genera dist/
npm run preview   # sirve dist/ en local
```

## Publicación

- **GitHub Pages**: el workflow de `.github/workflows/pages.yml` construye y publica `dist/` en cada push a `main`. Actívalo una vez en *Settings → Pages → Source: GitHub Actions*.
- **Con proxy de audio**: la versión desplegada en Freebuff Sites incluye un Worker (`deploy/index.js`) con `/api/proxy` y `/api/audio`, que permiten buscar en los catálogos y cargar audios desde un enlace sin problemas de CORS. En GitHub Pages esas dos rutas no existen, así que la búsqueda depende del CORS de cada API y la carga desde enlace no está disponible.
