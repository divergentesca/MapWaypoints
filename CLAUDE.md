# CLAUDE.md — Contexto del proyecto para asistencia con IA

> Este archivo le da contexto a Claude (u otros LLMs) sobre la arquitectura, convenciones y decisiones de diseño del proyecto. Leerlo antes de cualquier tarea.

---

## Qué es este proyecto

Aplicación web de **mapas interactivos narrativos para periodismo de investigación**. Vanilla JS + Canvas 2D + Vite. Sin frameworks de UI. Desplegado en Vercel, embebido en WordPress vía iframe.

**Stack:**
- Runtime: Vanilla JS ES modules (no React, no Vue)
- Build: Vite
- Render: Canvas 2D API + overlays DOM
- Deploy: Vercel (auto-deploy desde git push)
- Distribución: iframe en WordPress

---

## Arquitectura clave — leer antes de tocar código

### El loop de render usa dirty flags

**NUNCA** llames directamente a funciones de dibujo. Siempre usa:
```js
markDirty('camera', 'elements', 'dialog', 'minimap', 'debug')
```
El loop de `requestAnimationFrame` solo redibuja las capas marcadas. Llamar draw() directamente rompe el sistema de performance.

### El sizing del canvas es controlado por JS, no CSS

El canvas tiene `style.width/height` en px absolutos escritos por `setCanvasDPR()`. **No intentes controlar el tamaño del canvas con CSS** — los px de CSS serán sobreescritos en el próximo resize. El flujo correcto es:

```
resize → applyViewportCoverage() → setCanvasDPR() → canvas.style.*px
```

Las dimensiones actuales:
- **Ancho:** siempre `window.innerWidth`
- **Alto:** siempre `window.innerHeight`
- `--fill-scale` solo afecta el `transform: scale()` visual de `.novela.full-bleed`

### Coordenadas: tres sistemas distintos

1. **World space** — píxeles del mapa completo (ej: `logicalW=4240, logicalH=3685`). Los waypoints usan `xp/yp` normalizados (0.0–1.0) que se multiplican por estas dimensiones.
2. **CSS space** — píxeles lógicos del canvas en pantalla (sin DPR). La cámara opera aquí.
3. **Device space** — píxeles físicos (`CSS × DPR`). El bitmap del canvas opera aquí.

Para convertir entre sistemas usa la cámara:
```js
camera.worldToCss(worldX, worldY)  // world → pantalla
camera.cssToWorld(cssX, cssY)      // pantalla → world
```

### Los overlays DOM viven en `OverlayLayer.js`

Los hotspots e iconos son `<div>` posicionados sobre el canvas, **no** dibujados en el canvas. Se actualizan cada frame en `overlay.endFrame(camera, canvasW, canvasH)`. Si un overlay no aparece, primero verifica que `overlay.upsert()` se esté llamando con `frameLiveKeys` correctos.

---

## Archivos más importantes

| Archivo | Qué hace | Cuándo tocarlo |
|---|---|---|
| `src/app.js` | Boot, loop RAF, resize, dirty flags | Layout, viewport, resize bugs |
| `src/config.js` | `GLOBAL_CONFIG` — todos los parámetros técnicos | Ajustar límites, timeouts, breakpoints |
| `src/MapManager.js` | Carga story.json, mapas, imágenes, caché | Agregar campos a JSON, cambiar rutas |
| `src/Camera.js` | Zoom, pan, transiciones, breathing | Comportamiento de cámara |
| `src/OverlayLayer.js` | Overlays DOM, culling, hit testing | Posicionamiento de hotspots |
| `src/UIManager.js` | Fases, drawer, progreso, selector | UI chrome (no canvas) |
| `src/style.css` | Layout, `.novela`, `#mapa-canvas-wrapper` | Estilos visuales |
| `public/data/story.json` | Historia default (fallback) | Datos de prueba |
| `public/data/stories/*/story.json` | Historias reales | Contenido editorial |

---

## Convenciones de datos

### Waypoints: `xp/yp` son normalizados (0.0–1.0)

```js
// Coordenada absoluta en world space:
const wx = waypoint.xp * mapConfig.logicalW;
const wy = waypoint.yp * mapConfig.logicalH;
```

Si cambias `logicalW/H` al actualizar una imagen, **todos los `xp/yp` deben recalcularse**:
```
yp_nuevo = (yp_viejo × logicalH_viejo) / logicalH_nuevo
```

### Hotspot offsets: son relativos al waypoint en px del mundo

```js
// offsetX/offsetY son desplazamientos desde el waypoint en coordenadas world
const iconX = waypoint.x + icon.offsetX;
const iconY = waypoint.y + icon.offsetY;
```

No necesitan recalcularse al cambiar la imagen — solo los waypoints base cambian.

### Versionado de imágenes con query string

```json
"src": "/assets/mapa-mobile.webp?v=2026-05-20"
```

Cambiar la fecha fuerza al browser a no usar caché. **Siempre actualiza la versión al reemplazar una imagen.**

---

## Breakpoints y perfiles de dispositivo

```js
// Breakpoint mobile/desktop
GLOBAL_CONFIG.MOBILE_BREAKPOINT = 900  // px

// Detección en runtime
isMobileViewport()  // → true si window.innerWidth < 900

// Perfiles de altura mobile
getMobileHeightProfile()
// → 'short'  si clientHeight <= 600
// → 'medium' si clientHeight <= 740
// → 'tall'   si clientHeight > 740
```

Los waypoints pueden tener configuración diferente por perfil:
```json
"yOffset": { "default": 0, "tall": -90, "medium": -5, "short": 40 },
"zMobileProfile": { "default": 0.56, "tall": 0.66, "medium": 0.60, "short": 0.52 }
```

---

## Parámetros URL que afectan el comportamiento

```js
// Acceso via appConfig.toggles.*
appConfig.toggles.debug    // boolean — muestra grilla y labels de hotspots
appConfig.toggles.editor   // boolean — carga editor.js bajo demanda
appConfig.toggles.popups   // boolean — activa popups al clicar hotspots
appConfig.toggles.overlays // boolean — activa overlays DOM
appConfig.toggles.story    // string  — ID de la historia
appConfig.toggles.scale    // number  — cobertura de viewport (legacy, afecta solo el alto)
```

---

## Límites del canvas — no exceder

```js
CANVAS_LIMITS: {
  desktop: { maxWidth: 4096, maxHeight: 4096, maxPixels: 16_000_000, maxMemoryMB: 150 },
  mobile:  { maxWidth: 2400, maxHeight: 5400, maxPixels: 13_000_000, maxMemoryMB: 72 }
}
```

Si una nueva imagen excede estos límites, `validateCanvasDimensions()` la escala automáticamente y loguea un warning. Ver los logs en consola con `?debug=1`.

---

## Editor visual (?editor=1)

El editor (`src/editor.js`) se carga **solo** con `?editor=1`. No está en el bundle de producción. Permite posicionar hotspots visualmente y exportar las coordenadas como JSON.

**No modifiques `editor.js` para features de producción.** Es una herramienta de desarrollo que corre en el mismo contexto que la app pero no afecta el runtime normal.

---

## Cosas que NO hacer

| ❌ No hacer | ✅ Hacer en cambio |
|---|---|
| Escribir CSS para controlar el tamaño del canvas | Modificar `setCanvasDPR()` en `app.js` |
| Llamar funciones de dibujo directamente | `markDirty('camera', 'elements', ...)` |
| Agregar `margin: 0 auto` al canvas directamente | Modificar el wrapper con cuidado |
| Usar `canvas.width / canvas.height` para coordenadas lógicas | Usar `canvas.width / dpr` o `canvas.style.width` |
| Guardar estado mutable en módulos ES sin una clase | Usar la clase correspondiente (Camera, MapManager, etc.) |
| Importar librerías pesadas | El proyecto es vanilla JS intencional — sin dependencias de runtime |
| Modificar `GLOBAL_CONFIG` en runtime | Leer de `appConfig.toggles` para flags de runtime |

---

## Comandos útiles de desarrollo

```bash
npm run dev      # localhost:5173

# URLs de desarrollo más usadas:
# Con debug:
# http://localhost:5173/?story=costa-rica/expedientes/0001&debug=1&popups=1&overlays=1
# Con editor:
# http://localhost:5173/?editor=1&debug=1&story=costa-rica/expedientes/0001
# Sin overlays (solo canvas):
# http://localhost:5173/?story=costa-rica/expedientes/0001&popups=0&overlays=0&debug=1

npm run build    # Genera dist/
npm run preview  # Preview del build en localhost:4173
```

---

## Deploy

```bash
git add . && git commit -m "descripción" && git push
# Vercel detecta el push y despliega automáticamente
# URL de producción: https://map-waypoints.vercel.app/
```

---

## Estado del proyecto (Mayo 2026)

- Layout fullscreen estable: ancho y alto siempre `window.innerWidth/Height`
- Multi-historia funcional via `?story=` 
- Editor visual funcional con undo/redo
- Primer expediente real (Costa Rica 0001) en progreso — imágenes de prueba activas
- WordPress embed via iframe probado localmente, pendiente fix en divergentes.com