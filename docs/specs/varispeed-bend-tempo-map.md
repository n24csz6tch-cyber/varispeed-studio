# SPEC — BEND · mapa de tempo por tramos

| Campo | Valor |
| --- | --- |
| Estado | Aprobación pendiente — **no implementado** |
| Producto | VARISPEED Studio |
| Base de código | `main` @ `3e9b0b8` (“Beam 1.0”) |
| Dependencias nuevas | Ninguna |
| Superficie | Motor de audio (worker), transporte, UI del deck, export |

---

## 1. Resumen

Hoy el tempo es un valor único para toda la canción. **BEND** permite dividir la pista en
2–6 tramos y dar a cada uno su propia velocidad (0.50×–2.00×), de modo que la canción
pueda empezar a 1.00×, frenar a 0.80× en el estribillo y volver a 1.05× al final. El
resultado se renderiza como **un único buffer**, así que transporte, A/B, export, Media
Session y librería siguen funcionando sin cambios estructurales.

El nombre es literal: el hero promete “Make time bend to you” y hoy el tiempo solo se
desplaza a velocidad constante. BEND cumple esa promesa.

No estaba en la lista de mejoras anterior (selección/loop, A/B con loudness, undo,
batch, LUFS/ID3, proyectos, PWA, persistencia, lazy WASM, BPM/Camelot, reference
matching, stems). Es una dimensión nueva: **automatización del tempo en el tiempo**.

---

## 2. Alcance

### 2.1 Incluido en v1

- Activar/desactivar BEND por pista, sin perder el tempo global al desactivar.
- 1–6 tramos; cada tramo con tempo propio entre `0.50×` y `2.00×`.
- Cortes colocados sobre la línea de tiempo **en tiempo de fuente** (el de la canción
  original), con una duración mínima de 1,5 s por tramo.
- Unión de tramos con crossfade equal-power de 30 ms; sin clics ni silencios.
- Render en streaming: el preview empieza a sonar con el primer tramo ya procesado.
- Progreso ponderado por duración de fuente; cancelación entre tramos.
- Reproducción, seek, A/B y Media Session con mapeo correcto entre tiempo de fuente y
  tiempo de buffer.
- Export WAV/MP3 con el mapa aplicado, manteniendo el techo de −1 dBTP.
- Nombre de export y detalle de versión guardada indican que la pista tiene BEND.
- Guardia de duración de salida (ver §6.5).
- Accesibilidad de teclado y lectores de pantalla para los controles de BEND.

### 2.2 Fuera de alcance (explícito)

- Curva continua o dibujo a mano alzada: v1 son tramos de tempo **constante**.
- Automatización de pitch, EQ, reverb, gain o del limiter.
- Cambios de tempo en tiempo real durante la reproducción (primero se renderiza).
- Undo/redo de los cortes (el proyecto no tiene undo todavía).
- Guardar el mapa en IndexedDB o exportarlo como proyecto `.varispeed`.
- Mostrar los cortes sobre el waveform principal o hacer drag sobre él.
- Sincronización con BPM, beatgrid o Camelot.
- Más de 6 tramos o edición multipista.

---

## 3. Modelo de datos

```ts
// src/audio/types.ts
export interface BendSegment {
  /** Inicio del tramo en tiempo de fuente, en segundos. El primero siempre es 0. */
  start: number;
  /** Multiplicador de velocidad del tramo (0.5–2.0). */
  tempo: number;
}
export type BendMap = BendSegment[]; // 1..6, ordenado, start[0] === 0
```

Reglas:

- El tramo `i` cubre `[start_i, start_{i+1})`; el último termina en `sourceDuration`.
- `BendMap` con un solo tramo equivale a tempo constante, pero **no** es lo mismo que
  BEND desactivado: desactivado usa `settings.tempo` y conserva la ruta de render actual.
- Al activar BEND se siembra un tramo con el `settings.tempo` vigente.
- Al desactivar BEND, `settings.tempo` no se modifica.
- Aplicar un preset conserva los cortes y asigna a todos los tramos el tempo del preset.
- Cargar otra pista reinicia el mapa a `null`.

Constantes nuevas en `src/audio/params.ts`:

```ts
export const BEND_MIN_TEMPO = 0.5;
export const BEND_MAX_TEMPO = 2.0;
export const BEND_MAX_SEGMENTS = 6;
export const BEND_MIN_SEGMENT_SECONDS = 1.5;
export const BEND_CROSSFADE = 0.03;
export const BEND_MIN_TRACK_SECONDS = 4;
/** Techo de duración del audio procesado, en segundos. */
export const MAX_OUTPUT_SECONDS = 12 * 60;
```

Funciones puras nuevas en `src/audio/bend.ts`:

```ts
normalizeBend(map, sourceDuration): BendMap | null
validateBend(map, sourceDuration): { ok: true } | { ok: false; error: string }
bendKey(map): string                       // tempos/start a 3 decimales
bendDuration(map, sourceDuration): number  // aplica BEND_CROSSFADE
sourceToBuffer(map, sourceDuration, seconds): number
bufferToSource(map, sourceDuration, seconds): number
bendSummary(map): string                   // "Bend · 3 segments · 1.00→0.80→1.05×"
```

`bendDuration` = `Σ (len_i / tempo_i) − (n − 1) × BEND_CROSSFADE`.
Ejemplo: 60 s, `[0,30) @1.00×` + `[30,60) @0.80×` → `30 + 37.5 − 0.03 = 67.47 s`.

En la zona de crossfade dos tiempos de fuente caen en el mismo tiempo de buffer. Para
seek se elige el tramo entrante a partir del 50 % del fade; se documenta en el código.

---

## 4. UX

### 4.1 Ubicación

Nueva franja `BendLane` entre `Waveform` y los controles de transporte dentro de
`Deck`. Ocupa el mismo ancho que el canvas para que los cortes queden alineados.

### 4.2 Estados

1. **Apagado** — una sola fila: `BEND` + `Off` + botón `Add bend`. No altera el render.
2. **Encendido, un tramo** — barra única con `1.00×` y un handle `+` para dividir.
3. **Encendido, varios tramos** — una barra por tramo, etiquetada con su tempo; handles
   verticales en cada corte; botón `×` en el tramo seleccionado para eliminarlo.

### 4.3 Interacciones

- **Dividir**: clic en `+` sobre la barra crea un corte en ese punto (mín. 1,5 s a cada
  lado). El tramo nuevo hereda el tempo del tramo que lo contenía.
- **Mover un corte**: arrastre horizontal del handle, con clamp a los mínimos; el valor
  se actualiza en vivo, el render se dispara con el debounce existente (120 ms).
- **Cambiar tempo**: clic en un tramo lo selecciona; un control compacto (`−` / valor /
  `+`, paso 0.01×) y un slider permiten ajustarlo. Rango 0.50×–2.00×.
- **Eliminar**: `×` en el tramo seleccionado; el tramo vecino absorbe su rango. El
  primer tramo no se puede eliminar (solo se le cambia el tempo).
- **Reset**: `Clear bend` vuelve a un solo tramo con el tempo global y apaga BEND.
- **A/B**: el botón PROCESSED muestra la duración del mapa; ORIGINAL la original.

### 4.4 Teclado y accesibilidad

- `Tab` recorre: toggle BEND → cada tramo → cada corte.
- Tramo enfocado: `←/→` ±0.01×, `Shift+←/→` ±0.05×, `Home` = 0.50×, `End` = 2.00×.
- Corte enfocado: `←/→` ±0.1 s, `Shift+←/→` ±1 s; `Delete` lo elimina.
- Cada tramo es `role="slider"` con `aria-valuemin/max/now` y
  `aria-valuetext="Segment 2 of 3, 0.80 times, 30 to 60 seconds"`.
- Cada corte es `role="slider"` con `aria-valuetext` en tiempo `m:ss`.
- Los cambios se anuncian en una región `aria-live="polite"` con el resumen del mapa.
- Targets táctiles de 24×24 px mínimo; en anchos < 480 px las etiquetas se ocultan
  cuando el tramo mide menos de 48 px, pero siguen en el `aria-valuetext`.
- `prefers-reduced-motion`: sin transición en las barras.

### 4.5 Copy (UI en inglés)

`BEND`, `Off`, `Add bend`, `Clear bend`, `Segment`, `Bend · 3 segments`, errores:
`Segments must be at least 1.5 s long.` / `This bend would produce a 13:42 track.`

---

## 5. Pipeline técnico

### 5.1 Render en el worker

El PCM vive **solo** en el worker después de `loadSource` (los arrays se transfieren),
así que el corte y el ensamblado ocurren allí. No se copia audio al hilo principal.

```
renderMap(settings, bend, quality):
  segments = normalizeBend(bend, sourceDuration)
  totalFrames = ceil(bendDuration(segments, sourceDuration) * sampleRate)
  out = new Float32Array[nCh][totalFrames]
  write = 0
  for i, seg in segments:
    srcRange = source[start_i .. start_{i+1}]
    if |seg.tempo - 1| < 1e-9: stretched = srcRange
    else: stretched = stretchAudio(api, srcRange, sampleRate, {
      timeRatio: 1 / seg.tempo,
      pitchScale: pitchScaleFor(settings, seg.tempo),
      flags: stretchFlags(quality, usesFormant(settings)),
      preserveFormants: usesFormant(settings),
      study: quality === 'final',
      shouldCancel: () => cancelled.has(requestId),
    })
    if i > 0: write -= XFADE_FRAMES           // solape con el tramo anterior
    blend(out, stretched, write, XFADE_FRAMES) // equal-power en el borde
    write += stretched[0].length
    emit(out, lastEmitted, write - lastEmitted) // streaming al hilo principal
```

- `pitchScaleFor` reutiliza `pitchScale(settings)` y, en modo tape, multiplica por
  `seg.tempo` (el pitch sigue a la velocidad de cada tramo).
- El crossfade usa `cos/sin` como `mix.ts`, aplicado solo en el borde de unión.
- Entre tramos se comprueba `cancelled.has(requestId)`.
- `stretchAudio` se reutiliza sin cambios; no se toca su contrato.

### 5.2 Caché

`getStretched` pasa a `getStretchedMap(settings, bend, quality, …)` con clave
`stretchKey(settings, quality) + '|' + bendKey(bend)`. Sin BEND, la clave es idéntica a
la actual (compatibilidad y reutilización de caché). Un cambio de 0.001 s o 0.001×
invalida la caché; un cambio de gain/EQ la conserva.

### 5.3 Progreso y streaming

`render` y `export` en `protocol.ts` reciben `bend?: BendSegment[]`. El progreso del
stretch se pondera por segundos de fuente: cada tramo aporta
`(len_i / totalSource) · 0.9`. `MasterChain` sigue recibiendo frames en orden con
`totalFrames` conocido de antemano, por lo que `PreviewAssembler` no cambia.

### 5.4 Transporte y mapeo

`player.ts` gana `setBendMap(map | null, sourceDuration)`. Con mapa:

- `bufferPosition()` devuelve `sourceToBuffer(sourcePosition())` en la vista procesada.
- `seekBufferTime(t)` usa `bufferToSource(t)`.
- `setView()` conserva el punto musical usando el mapeo, no la tasa media.
- `sourcePosition()` con `<audio>` usa `bufferToSource(media.currentTime)`.
- `maxSourcePosition()` convierte el frontier de streaming con `sourceToBuffer`.
- `mediaRate` se mantiene como tasa media solo para `<audio>.currentTime`; el seek de
  Media Session pasa por `sourceToBuffer`.
- Sin mapa, todas las fórmulas actuales quedan intactas.

### 5.5 Export y librería

- `engine.exportTrack(settings, format, bend, onProgress)`.
- `exportFilename(title, settings, ext, bend?)` añade `Bend 3seg` cuando hay mapa.
- `saveCurrentVersion` añade `Bend ×3` al `detail`; no hay cambio de esquema en
  IndexedDB (`SavedVersion.detail` ya es texto libre).
- El techo true-peak de −1 dBTP se aplica una sola vez sobre el buffer completo, así que
  la unión no genera un pico local sin limitar.

### 5.6 Guardia de duración

Antes de renderizar o exportar:

```ts
if (bendDuration(map, sourceDuration) > MAX_OUTPUT_SECONDS) → error de UI
```

El mensaje incluye la duración resultante. La guardia también se aplica al tempo global
existente (hoy 10 min a 0.5× producen 20 min y ~460 MB de buffer); es una corrección
necesaria para que BEND no empeore un límite de memoria ya frágil.

---

## 6. Archivos a tocar

| Archivo | Cambio | Riesgo |
| --- | --- | --- |
| `src/audio/types.ts` | `BendSegment`, `BendMap` | Bajo |
| `src/audio/bend.ts` **(nuevo)** | Matemática pura, validación, mapeo, resumen | Medio (corazón de la feature) |
| `src/audio/params.ts` | Constantes BEND y `MAX_OUTPUT_SECONDS`; `exportFilename` acepta `bend` | Bajo |
| `src/audio/protocol.ts` | `bend?` en `render`/`export` | Bajo |
| `src/audio/worker.ts` | `getStretchedMap`, corte, crossfade, streaming, caché | **Alto** |
| `src/audio/stretch.ts` | Sin cambios; se reutiliza por tramo | — |
| `src/audio/engine.ts` | Pasar `bend` en `render` y `exportTrack` | Bajo |
| `src/audio/player.ts` | `setBendMap`, mapeo de posiciones y frontier | **Alto** |
| `src/App.tsx` | Estado `bend`, clave de render, export, reset, guardia, detalle guardado | Medio |
| `src/components/Deck.tsx` | Montar `BendLane` y pasar props | Bajo |
| `src/components/BendLane.tsx` **(nuevo)** | UI, drag, teclado, ARIA | Medio |
| `src/styles.css` | Estilos de la franja y handles | Bajo |
| `src/components/Waveform.tsx` | **No se toca en v1** | — |
| `src/audio/assembler.ts` | **No se toca**: `totalFrames` sigue siendo fijo | — |
| `src/lib/library.ts` | **No se toca**: `detail` es texto libre | — |

Estimación de superficie: ~500–650 líneas nuevas/modificadas, 2 archivos nuevos.

---

## 7. Criterios de aceptación

Cada criterio es verificable sin añadir un framework de tests al proyecto.

1. **Bypass exacto.** Con BEND desactivado, un fixture exportado produce el mismo WAV
   (mismos bytes, misma duración) que en `3e9b0b8`.
2. **Duración del mapa.** 60 s con `[0,30) @1.00×` + `[30,60) @0.80×` exporta
   `67,47 s ± 0,01 s`; el preview muestra la misma duración.
3. **Unión limpia.** En el WAV exportado, en ±100 ms alrededor de cada corte no hay un
   salto entre muestras consecutivas mayor que el máximo salto de los 2 s vecinos, ni
   un tramo de ≥32 muestras idénticas que no existiera en la fuente. Escucha con
   auriculares: sin clic, sin hueco, sin doble transitorio evidente.
4. **Streaming.** Con una pista de 60 s y 3 tramos, el audio procesado empieza a sonar
   antes de que el render termine; `renderProgress.value` es monótono de 0 a 1.
5. **Cancelación.** Cambiar un corte mientras renderiza cancela el job anterior y deja
   la versión anterior reproducible; no se solapan dos renders.
6. **Caché correcta.** Mover un corte 1 s con los mismos tempos dispara un render nuevo;
   un cambio solo de gain no lo dispara.
7. **Límites.** La UI impide <1,5 s por tramo, >6 tramos, tempo fuera de 0.50–2.00× y
   pistas <4 s; el worker rechaza un mapa inválido con error legible (defensa en
   profundidad).
8. **A/B.** Cambiar entre ORIGINAL y PROCESSED conserva el punto musical dentro de
   ±100 ms; hacer clic al 50 % del waveform procesado cae dentro de ±100 ms del tiempo
   de fuente mapeado.
9. **Seek durante streaming.** No se puede saltar más allá del audio ya renderizado; el
   playhead nunca queda en una zona vacía del buffer.
10. **Export.** WAV y MP3 incluyen el mapa; el nombre contiene `Bend`; el true peak
    medido sigue siendo ≤ −1 dBTP; la duración del WAV coincide con el preview.
11. **Presets.** Aplicar un preset conserva los cortes y fija el tempo de todos los
    tramos al del preset; `Clear bend` deja un tramo y apaga BEND sin tocar
    `settings.tempo`.
12. **Carga.** Cargar otra pista reinicia BEND a apagado y un tramo.
13. **Guardia.** Un mapa que supere 12:00 de salida muestra el error con la duración
    resultante y no inicia el render.
14. **Teclado.** Se puede dividir, mover, ajustar y eliminar sin ratón; el foco es
    visible; los valores se anuncian.
15. **Móvil.** A 360 px no hay overflow horizontal, los handles se agarran con el dedo y
    las etiquetas no se solapan.
16. **Build.** `node ./node_modules/typescript/bin/tsc --noEmit` y
    `node ./node_modules/vite/bin/vite.js build` pasan sin warnings nuevos.
17. **Sin red.** No se añade ninguna petición, dependencia ni permiso.

---

## 8. Plan de verificación

1. Pruebas de matemática pura en un script temporal (fuera del build): duración,
   `sourceToBuffer`/`bufferToSource` ida y vuelta, normalización, límites.
2. `tsc --noEmit` y `vite build`.
3. Fixture de 60 s, 3 tramos; medir duración del WAV exportado con `ffprobe` o script
   Node; inspeccionar los joins muestra a muestra.
4. Reproducción real: empezar en el tramo 1, cruzar el corte, hacer seek en el tramo 2,
   cambiar A/B, comprobar el playhead sobre el waveform procesado.
5. Export WAV y MP3; reproducir ambos y comparar duración/techo.
6. Teclado y viewport de 360 px; comprobar foco y anuncios.
7. Repetir con BEND apagado para confirmar que no hay regresión.

No se añade CI ni test runner: el proyecto no tiene uno y esta spec no lo requiere.

---

## 9. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| Artefactos en las uniones (comb filtering, transitorio duplicado) | Media | Alto | Crossfade equal-power de 30 ms, corte cerca de cero, límite de 6 tramos, escucha A/B obligatoria |
| Latencia inicial de Rubber Band en cada tramo deja un borde débil | Media | Medio | El crossfade cubre el borde; si se mide >10 ms de caída, añadir pre-roll de 50 ms y recortar la latencia medida |
| Render N× más lento | Alta | Medio | Omitir tramos a 1.00×; preview en calidad `preview`; caché por mapa; progreso por tramo |
| Memoria: N buffers + salida + fuente | Media | Alto | Ensamblar en una salida preasignada y liberar cada tramo; guardia de 12 min de salida; tope de 6 tramos |
| Caché obsoleta tras mover un corte | Media | Alto | `bendKey` en la clave; criterio 6 |
| Bugs de mapeo de posición (A/B, seek, frontier) | Media | Medio | Funciones puras con ida y vuelta; un solo módulo `bend.ts`; criterios 8 y 9 |
| El pitch salta en las uniones en modo tape | Alta | Bajo | Es el comportamiento esperado del modo tape; documentarlo en la UI y suavizar con el crossfade |
| Complejidad táctil: drag de cortes compite con el seek | Media | Medio | Franja separada; solo los handles son arrastrables; el resto de la franja no busca |
| Scope creep hacia curva continua o automatización de otros parámetros | Alta | Medio | Fuera de alcance explícito en §2.2; v1 solo tramos constantes |
| Regresión del render actual | Baja | Alto | Ruta sin BEND intacta y clave de caché idéntica; criterio 1 |
| Deuda de undo: borrar un corte es destructivo | Media | Bajo | `Clear bend` explícito; undo queda para otra feature |

---

## 10. Orden de implementación y estimación

| Paso | Trabajo | Estimación |
| --- | --- | --- |
| 1 | `bend.ts` + tipos + constantes + script de matemática | 0.5 día |
| 2 | Worker: corte, crossfade, streaming, caché, progreso | 1 día |
| 3 | `player.ts`: mapeo y frontier | 0.5 día |
| 4 | `BendLane` + estilos + accesibilidad | 1 día |
| 5 | `App.tsx`, export, guardia, presets | 0.5 día |
| 6 | Verificación, escucha, ajustes de crossfade | 0.5 día |
| **Total** | | **~4 días** |

Orden de merge: 1 → 2 → 3 → 5 → 4. La UI puede desarrollarse contra un mapa fijo antes
de conectar el drag.

---

## 11. Decisiones abiertas (resolver al implementar)

1. ¿El crossfade debe ser 20 ms (más definido) o 40 ms (más suave)? Empezar en 30 ms y
   ajustar con la escucha del fixture.
2. ¿Un tramo a 1.00× debe copiar la fuente sin pasar por Rubber Band? Propuesta: sí,
   para evitar latencia y costo; ya ocurre en el render global.
3. ¿El primer tramo debe heredar siempre `settings.tempo` al activar BEND, o el último
   tempo usado? Propuesta: el vigente, es lo predecible.
4. ¿Conviene dibujar los cortes también sobre el waveform procesado? v1 no; se evalúa
   después de usar la franja.

---

## 12. Precondición de implementación

El árbol de trabajo actual contiene el proyecto **LUMEN** sin commitear sobre `3e9b0b8`.
Antes de tocar VARISPEED:

```bash
git stash push -u -m "lumen-wip"     # o commit en una rama aparte
git switch -c feat/bend-tempo-map 3e9b0b8
```

No mezclar BEND con los cambios de LUMEN en el mismo commit ni en el mismo despliegue.

---

## 13. Notas de implementación (2026-11-18)

- Se añadió `src/components/ShapePanel.tsx` a la lista de archivos: con BEND activo el
  control TEMPO global y sus atajos se desactivan, para no sugerir que sigue mandando.
- `Split` vive en la fila del editor del tramo, no como `+` sobre la barra. El corte
  nuevo cae en el punto medio del tramo y desde ahí se arrastra.
- `normalizeBend` acepta mapas de un solo tramo: el tempo del tramo manda sobre
  `settings.tempo`, incluso sin corte.
- El máster copia los frames en cuanto el ensamblador se los entrega. Por eso `getBent`
  retiene los últimos 30 ms de cada tramo hasta que el crossfade siguiente está escrito;
  sin esa retención la unión no llegaba al buffer y se oía un salto de 0,49.
- Verificado en local con un fixture de 12 s: 1.00× + 0.80× da 13,47 s, salto en la
  unión 0,0346 frente a 0,0327 del entorno, export WAV de 13,47 s a −1,1 dBTP, mapeo
  A/B 10 s de buffer ↔ 9,224 s de fuente, y 3 tramos con mover y eliminar.
