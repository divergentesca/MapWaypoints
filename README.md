# Mapa Interactivo Multi-Fase — Documentación Técnica

> **Estado actual:** Producción-ready. Desplegado en Vercel. Integrado en WordPress vía iframe + plantilla PHP fullscreen.

---

## Índice

1. [Qué es este proyecto](#1-qué-es-este-proyecto)
2. [Arquitectura general](#2-arquitectura-general)
3. [Estructura de archivos](#3-estructura-de-archivos)
4. [Módulos JavaScript](#4-módulos-javascript)
5. [Sistema de datos — Historias y Mapas](#5-sistema-de-datos--historias-y-mapas)
6. [Parámetros URL](#6-parámetros-url)
7. [Sistema de distribución — WordPress](#7-sistema-de-distribución--wordpress)
8. [Deploy — Vercel](#8-deploy--vercel)
9. [Flujo de desarrollo](#9-flujo-de-desarrollo)
10. [Agregar una nueva historia](#10-agregar-una-nueva-historia)
11. [Agregar un nuevo mapa a una historia](#11-agregar-un-nuevo-mapa-a-una-historia)
12. [Cambiar la imagen del mapa](#12-cambiar-la-imagen-del-mapa)
13. [Sistema de layout y viewport](#13-sistema-de-layout-y-viewport)
14. [Optimizaciones de performance implementadas](#14-optimizaciones-de-performance-implementadas)
15. [Pendientes y roadmap](#15-pendientes-y-roadmap)

---

## 1. Qué es este proyecto

Aplicación web de mapas interactivos narrativos para periodismo de investigación. Permite contar historias geoespaciales por fases, con waypoints, hotspots clicables, overlays animados y popups con información detallada (personas implicadas, fechas, ubicaciones, hechos).

**El modelo de negocio:**
- Tú produces las historias (JSON + imágenes) y las publicas en Vercel.
- Los clientes (medios, periodistas) embeben el mapa en su WordPress con un snippet HTML o una plantilla PHP.
- Cada historia es una URL única: `map-waypoints.vercel.app/?story=costa-rica/expedientes/0001`

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│           VERCEL (map-waypoints.vercel.app)          │
│                                                     │
│  ┌──────────┐  fetch   ┌──────────────────────┐    │
│  │  app.js  │ ──────► │  /data/story.json     │    │
│  │ (Canvas  │          │  /data/stories/       │    │
│  │  + UI)   │ ──────► │    {id}/story.json    │    │
│  └──────────┘          │    {id}/maps/*.json   │    │
│       │                └──────────────────────┘    │
│       │ postMessage(height)                         │
└───────┼─────────────────────────────────────────────┘
        │ iframe
┌───────┼─────────────────────────────────────────────┐
│       ▼          WORDPRESS (cliente)                │
│  ┌──────────┐                                       │
│  │  iframe  │  ← snippet HTML o plantilla PHP       │
│  └──────────┘                                       │
└─────────────────────────────────────────────────────┘
```

**Flujo de carga:**
1. WordPress carga la página con el iframe apuntando a Vercel
2. La app en Vercel arranca y lee `/data/story.json` (o el específico via `?story=`)
3. Se carga el primer mapa lazy (`/data/stories/{id}/maps/mapa_f1.json`)
4. Canvas renderiza el mapa con waypoints, overlays y hotspots
5. `postMessage` comunica la altura al iframe padre en WordPress

---

## 3. Estructura de archivos

```
map-waypoints/
├── src/                          ← Código fuente (Vite lo compila)
│   ├── app.js                    ← Entrada principal, loop de render, boot
│   ├── MapManager.js             ← Carga de historias, mapas, caché de imágenes
│   ├── Camera.js                 ← Sistema de cámara, zoom, pan, transiciones
│   ├── UIManager.js              ← Filtros de fase, drawer, progress, selector de mapas
│   ├── OverlayLayer.js           ← Overlays DOM (iconos clicables sobre el canvas)
│   ├── DetailedPopupManager.js   ← Popups con personas, fechas, hechos
│   ├── editor.js                 ← Editor visual (carga bajo demanda con ?editor=1)
│   ├── config.js                 ← GLOBAL_CONFIG técnico (sin datos de negocio)
│   ├── index.html                ← HTML base
│   ├── style.css                 ← Estilos principales
│   └── popup_styles.css          ← Estilos de popups detallados
│
├── public/                       ← Archivos estáticos (Vite los copia a dist/ sin procesar)
│   ├── assets/                   ← Imágenes, fuentes, GIFs
│   │   ├── fonts/                ← Inter woff2 (self-hosted)
│   │   ├── mapa-mobile.webp         ← Imagen mapa mobile (1400×3181px, logicalW:1400 logicalH:3181)
│   │   ├── mapa-dektop-4x.webp      ← Imagen mapa desktop (4240×2608px)
│   │   ├── fase-2-mapa-mobile-x4.webp  ← Fase 2 mobile
│   │   ├── fase-2-mapa-dektop-4x.webp  ← Fase 2 desktop
│   │   ├── fase-3-mapa-mobile-x4.webp  ← Fase 3 mobile
│   │   ├── fase-3-mapa-dektop-4x.webp  ← Fase 3 desktop
│   │   └── persona_1-*.gif       ← Avatares animados de personas
│   │
│   └── data/                     ← Sistema de datos de historias
│       ├── story.json            ← Historia DEFAULT (fallback sin ?story=)
│       ├── index.json            ← Catálogo de todas las historias
│       ├── maps/                 ← Mapas del story default
│       │   ├── mapa_f1.json
│       │   ├── mapa_f2.json
│       │   └── mapa_f3.json
│       └── stories/              ← Historias nombradas
│           └── costa-rica/
│               └── expedientes/
│                   └── 0001/     ← Primera historia real
│                       ├── story.json
│                       └── maps/
│                           ├── mapa_f1.json
│                           ├── mapa_f2.json
│                           └── mapa_f3.json
│
├── dist/                         ← Build de producción (generado por npm run build)
├── vercel.json                   ← Headers HTTP para iframe y seguridad
├── vite.config.js                ← Configuración de build
└── package.json                  ← Scripts y dependencias
```

---

## 4. Módulos JavaScript

### `app.js` — Orquestador principal
Contiene el loop de animación (`requestAnimationFrame`), el sistema de dirty flags, el boot de la aplicación y la lógica de viewport/resize.

**Responsabilidades clave:**
- Parsear parámetros URL (`parseUrlToggles`)
- Inicializar todos los módulos en orden correcto
- Ejecutar `mapManager.loadStory()` antes de instanciar `UIManager`
- Comunicar altura al iframe padre via `postMessage`
- Loop de render con dirty flags (solo redibuja cuando hay cambios)

**Sistema dirty flags:**
```js
markDirty('camera', 'elements', 'dialog', 'minimap', 'debug')
// Solo redibuja las capas marcadas como sucias
```

**Toggle de popups en runtime:**
```js
window.togglePopupDisplay(true/false)  // habilita/deshabilita popups sin recargar
```

### `MapManager.js` — Gestor de datos y caché
Maneja la carga de historias, mapas e imágenes con caché inteligente.

**Métodos principales:**
```js
mapManager.loadStory(url)         // Carga story.json, puebla PHASES y MAPS_CONFIG
mapManager.loadMap(mapId)         // Fetch lazy del JSON del mapa, cachea en MAPS_CONFIG
mapManager.getCurrentPhaseMaps()  // Retorna mapas de la fase activa
mapManager.setPhase(phaseId)      // Cambia fase y pre-carga la siguiente
```

**Resolución de rutas de mapas:**
```
Si hay historia activa (currentStoryId):
  → /data/stories/{currentStoryId}/maps/{mapId}.json

Si no hay historia (fallback default):
  → /data/maps/{mapId}.json
```

**Caché de imágenes:**
- `imageCache` — Map de imágenes cargadas por URL
- `renderedCache` — Map de ImageBitmap pre-renderizados (OffscreenCanvas)
- Detección automática de WebP con fallback a JPG

### `Camera.js` — Sistema de cámara
Maneja zoom, pan, transiciones cinematográficas entre waypoints y el efecto breathing.

**Efectos configurables en `GLOBAL_CONFIG.CAMERA_EFFECTS`:**
- `breathingEnabled` — Movimiento sutil constante del mapa
- `transitionEnabled` — Zoom-out suave entre waypoints
- `transitionDuration` — 1100ms desktop, 800ms mobile
- `disableBreathingDuringTransition` — Evita conflicto entre efectos

### `OverlayLayer.js` — Overlays DOM
Crea elementos `<div>` sobre el canvas para los iconos clicables (hotspots). Usa coordenadas del mundo del mapa y las transforma a coordenadas de pantalla en cada frame.

**Características:**
- Culling automático — oculta overlays fuera del viewport
- Hit testing con margen configurable (`TOUCH.hitSlop`)
- Tamaño mínimo de toque: 56px mobile, 40px desktop
- Dispara `overlay:click` → abre popup via `popupManager`

### `DetailedPopupManager.js` — Popups
Sistema de popups modales con estructura detallada: imagen principal, fecha/hora, ubicación, descripción, personas implicadas y echos (eventos relacionados por persona).

### `UIManager.js` — Interfaz de usuario
Renderiza el filtro de fases (botones superiores), el selector de mapas, el drawer lateral mobile y los puntos de progreso.

### `editor.js` — Editor visual
Herramienta de desarrollo para posicionar hotspots y overlays visualmente. Se carga **solo** con `?editor=1` — no afecta el bundle de producción.

**Atajos de teclado:**
- `E` — Toggle editor on/off
- `Ctrl+Z / Ctrl+Y` — Undo/Redo (hasta 50 pasos)
- `Ctrl+D` — Duplicar item
- `Ctrl+C / Ctrl+V` — Copiar/Pegar
- `H` — Hide UI
- `F` — Focus item seleccionado
- `Ctrl+S` — Guardar preset

---

## 5. Sistema de datos — Historias y Mapas

### `story.json` — Estructura de una historia

```json
{
  "phases": [
    {
      "id": "fase1",
      "label": "Fase 1",
      "color": "#1BC6EB",
      "maps": ["mapa_f1"]
    }
  ],
  "mapsIndex": {
    "mapa_f1": {
      "id": "mapa_f1",
      "name": "Recorrido 1",
      "phase": "fase1"
    }
  }
}
```

### `mapa_fN.json` — Estructura de un mapa con waypoints

```json
{
  "id": "mapa_f1",
  "name": "Recorrido 1",
  "phase": "fase1",
  "mapImage": {
    "mobile": {
      "src": "/assets/mapa-mobile.webp?v=2026-05-21",
      "logicalW": 2336,
      "logicalH": 4192
    },
    "desktop": {
      "src": "/assets/mapa-dektop.webp?v=2026-05-21",
      "logicalW": 4240,
      "logicalH": 2608
    },
    "useNaturalSize": false
  },
  "waypoints": [
    {
      "mobile":  { "xp": 0.17, "yp": 0.20, "z": 0.9 },
      "desktop": { "xp": 0.18, "yp": 0.21, "z": 1.0 },
      "yOffset": { "default": 0, "tall": -90, "medium": -5, "short": 40 },
      "zMobileProfile": { "default": 0.56, "tall": 0.66, "medium": 0.60, "short": 0.52 },
      "label": "Inicio del Viaje",
      "lines": ["Texto de la escena.", "Segunda línea opcional."],
      "hotspots": [
        {
          "id": "hs1",
          "type": "persona",
          "offsetX": 120,
          "offsetY": -80,
          "popup": {
            "title": "Nombre",
            "image": "/assets/persona_1-1.gif",
            "date": "2024-01-15",
            "location": "San José, Costa Rica",
            "description": "Descripción detallada.",
            "personas": []
          }
        }
      ]
    }
  ]
}
```

### `index.json` — Catálogo de historias

```json
{
  "stories": [
    {
      "id": "costa-rica/expedientes/0001",
      "title": "Expediente 0001",
      "description": "Descripción breve del caso",
      "thumbnail": "/data/stories/costa-rica/expedientes/0001/thumb.webp",
      "url": "/?story=costa-rica/expedientes/0001",
      "published": true,
      "date": "2025-06-01",
      "country": "Costa Rica",
      "tags": ["expediente"]
    }
  ]
}
```

---

## 6. Parámetros URL

| Parámetro | Tipo | Descripción |
|---|---|---|
| `?story=` | string | ID de la historia (ej: `costa-rica/expedientes/0001`) |
| `?debug=1` | boolean | Muestra grilla, labels y logs de hotspots |
| `?editor=1` | boolean | Carga el editor visual de posicionamiento |
| `?popups=1` | boolean | Activa/desactiva popups al clicar hotspots |
| `?overlays=0` | boolean | Activa/desactiva overlays DOM |
| `?embed=1` | boolean | Modo embed (sin chrome del WordPress) |
| `?scale=` | number | Cobertura de viewport (legacy, afecta solo el alto) |

```js
// Acceso en código via:
appConfig.toggles.debug    // boolean
appConfig.toggles.story    // string
// etc.
```

---

## 7. Sistema de distribución — WordPress

**Snippet HTML básico:**
```html
<iframe
  src="https://map-waypoints.vercel.app/?story=costa-rica/expedientes/0001"
  width="100%"
  height="100vh"
  frameborder="0"
  allow="fullscreen"
  style="border:none; display:block;"
></iframe>
```

**Plantilla PHP fullscreen:** Disponible como plantilla de página de WordPress que ocupa el 100% del viewport eliminando header/footer. La app envía `postMessage` con su altura para que el iframe pueda ajustarse.

---

## 8. Deploy — Vercel

```bash
git add . && git commit -m "descripción" && git push
# Vercel detecta el push y despliega automáticamente
# URL de producción: https://map-waypoints.vercel.app/
```

Headers configurados en `vercel.json`:
- `X-Frame-Options: ALLOWALL` — permite embedding en iframe
- Cache headers para assets estáticos

---

## 9. Flujo de desarrollo

```bash
# 1. Arrancar dev server
npm run dev
# → http://localhost:5173

# 2. Desarrollar con historia real + debug
http://localhost:5173/?story=costa-rica/expedientes/0001&debug=1&popups=1&overlays=1

# 3. Posicionar hotspots con el editor
http://localhost:5173/?editor=1&debug=1&story=costa-rica/expedientes/0001

# 4. Verificar solo canvas (sin overlays)
http://localhost:5173/?story=costa-rica/expedientes/0001&popups=0&overlays=0&debug=1

# 5. Build y deploy
npm run build
git add . && git commit -m "..." && git push
```

---

## 10. Agregar una nueva historia

```bash
# 1. Crear carpeta
mkdir -p public/data/stories/panama/expedientes/0001/maps

# 2. Copiar y editar story.json
cp public/data/stories/costa-rica/expedientes/0001/story.json \
   public/data/stories/panama/expedientes/0001/story.json

# 3. Copiar y editar mapas
cp public/data/stories/costa-rica/expedientes/0001/maps/mapa_f1.json \
   public/data/stories/panama/expedientes/0001/maps/mapa_f1.json

# 4. Registrar en index.json (agregar entrada al array "stories")

# 5. Verificar y deploy
# http://localhost:5173/?story=panama/expedientes/0001&debug=1&popups=1
npm run build && git add . && git commit -m "agrega Panama 0001" && git push
```

---

## 11. Agregar un nuevo mapa a una historia

En `story.json`, agregar el ID al array `maps` de la fase y una entrada en `mapsIndex`:

```json
{
  "phases": [{ "id": "fase1", "maps": ["mapa_f1", "mapa_f1b"] }],
  "mapsIndex": {
    "mapa_f1":  { "id": "mapa_f1",  "name": "Recorrido 1",  "phase": "fase1" },
    "mapa_f1b": { "id": "mapa_f1b", "name": "Recorrido 1B", "phase": "fase1" }
  }
}
```

Crear el archivo del mapa nuevo copiando uno existente y editando imagen y waypoints. El selector de mapas en la UI aparece automáticamente cuando hay más de uno por fase.

---

## 12. Cambiar la imagen del mapa

### Paso 1 — Obtener dimensiones reales

```bash
sips -g pixelWidth -g pixelHeight public/assets/nueva-imagen.webp
# O en Linux:
identify public/assets/nueva-imagen.webp
```

### Paso 2 — Actualizar `mapImage` en el JSON

```json
"mapImage": {
  "mobile":  { "src": "/assets/nueva-mobile.webp?v=YYYY-MM-DD", "logicalW": W, "logicalH": H },
  "desktop": { "src": "/assets/nueva-desktop.webp?v=YYYY-MM-DD", "logicalW": W, "logicalH": H }
}
```

El `?v=YYYY-MM-DD` fuerza al browser a no usar la versión cacheada.

### Paso 3 — Sobre los waypoints

Los waypoints usan `xp/yp` normalizados (0.0–1.0). Si la nueva imagen mantiene
la misma proporción que el logicalW/H declarado, **no hay que recalcular nada** —
el sistema escala la imagen para llenar el espacio lógico exactamente.

Solo recalculá si cambiás el logicalH a un valor diferente:
```
yp_nuevo = (yp_viejo × logicalH_viejo) / logicalH_nuevo
```

Regla práctica: mantené siempre la proporción `logicalW:logicalH` al generar
nuevas imágenes y los waypoints quedan intactos.

### Paso 4 — Verificar `CANVAS_LIMITS` en `src/config.js`

Límites actuales (calibrados para las imágenes 4x):

```js
CANVAS_LIMITS: {
  desktop: {
    maxWidth: 4096,
    maxHeight: 4096,
    maxPixels: 16_000_000,
    maxMemoryMB: 150
  },
  mobile: {
    maxWidth: 2400,
    maxHeight: 5400,
    maxPixels: 13_000_000,
    maxMemoryMB: 72
  }
}
```

---

## 13. Sistema de layout y viewport

### Cómo funciona el sizing del canvas

El canvas **no tiene tamaño fijo** — sus dimensiones en px son un snapshot calculado en cada resize. La cadena es:

```
window.resize / ResizeObserver
  → applyViewportCoverage()   ← calcula vw/vh del wrapper
  → setCanvasDPR()            ← lee wrapper.getBoundingClientRect()
  → canvas.style.width/height = displayW/H + 'px'
  → cameraInstance.setViewport(displayW, displayH)
  → overlay.resize(displayW, displayH)
```

### Reglas actuales de viewport

| Dimensión | Comportamiento |
|---|---|
| **Ancho** | Siempre `window.innerWidth` — ocupa el 100% del viewport horizontal |
| **Alto** | Siempre `window.innerHeight` — ocupa el 100% del viewport vertical |
| **fill-scale** | Variable CSS `--fill-scale` que solo afecta el `transform: scale()` visual de `.novela.full-bleed` |
| **coverage** | Parámetro `?scale=` que históricamente reducía ambas dimensiones; actualmente solo afecta el alto (deprecated) |

### CSS crítico del layout

```css
/* El wrapper siempre ocupa todo el viewport — JS sobreescribe con px exactos */
#mapa-canvas-wrapper {
  position: relative;
  margin: 0 auto;
  display: block;
}

/* full-bleed: modo principal en producción */
.novela.full-bleed {
  width: 100%;
  height: 100%;
  transform: scale(var(--fill-scale));
  transform-origin: top center;
}

#main-content {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  width: 100%;
  height: 100%;
}
```

### Por qué el canvas escribe px fijos (y está bien)

El elemento `<canvas>` requiere dimensiones absolutas para que el bitmap de dibujo coincida exactamente con el display size — de lo contrario hay distorsión. El JS calcula los px correctos en cada resize y los escribe via `style.width/height`. Esto es correcto e intencional, no un bug.

### Debug del layout

```js
// En consola del browser:
const w = document.getElementById('mapa-canvas-wrapper');
console.log(w.getBoundingClientRect());
console.log(getComputedStyle(w).margin);

// Ver fill-scale actual:
window.LayoutFill.get(); // → ej: 98.0

// Cambiar fill-scale desde consola:
window.LayoutFill.set(100); // 100 = sin reducción
```

---

## 14. Optimizaciones de performance implementadas

| Optimización | Descripción |
|---|---|
| **Dirty flag system** | El canvas solo se redibuja cuando alguna capa está marcada como sucia. En reposo: 0 redraws/s. |
| **Spatial index** | WaypointSpatialIndex con grid de celdas para culling O(1). Se activa con >15 waypoints. |
| **Viewport culling** | Overlays y waypoints fuera del viewport no se renderizan. |
| **WebP automático** | MapManager detecta soporte WebP y sirve el formato óptimo con fallback a JPG. |
| **OffscreenCanvas** | Íconos pequeños se pre-renderizan en OffscreenCanvas para evitar re-decode en cada frame. |
| **Lazy loading de mapas** | Los JSON de mapas se fetchean solo cuando se navega a esa fase. Se cachean en memoria. |
| **Preload de fase siguiente** | Al cargar una fase, la siguiente se pre-carga en background. |
| **Memory monitor** | Muestrea uso de heap. Si supera 85% activa warnings. |
| **DPR limitado** | devicePixelRatio máximo: 1.6 desktop, 1.5 mobile. Evita canvas gigantes. |
| **Canvas size validation** | Valida y ajusta dimensiones del canvas según `CANVAS_LIMITS` en `config.js`. |
| **Idle FPS throttling** | Cuando no hay animación activa, el loop corre a 30fps en vez de 60fps. |
| **Editor bajo demanda** | `editor.js` solo se carga con `?editor=1`. No está en el bundle de producción. |

---

## 15. Pendientes y roadmap

### Pendiente inmediato
- [ ] Contenido real del Expediente 0001 — reemplazar imágenes de prueba y datos de waypoints con el caso real
- [ ] `thumb.webp` para el catálogo `index.json`
- [ ] Resolver el colapso del iframe en WordPress online (divergentes.com) — guard de altura mínima en el listener

### Corto plazo
- [ ] Plugin WordPress con shortcode `[mapa_interactivo story="..."]` y panel de ajustes
- [ ] LRU cache para imágenes (límite de ~30 entradas en `imageCache` — hoy crece ilimitado)
- [ ] Virtualización de overlays DOM fuera de viewport

### Mediano plazo
- [ ] Lobby — página que lee `index.json` y muestra tarjetas de historias (activar cuando haya 2+ historias)
- [ ] Segunda historia para validar el sistema multi-historia completo
- [ ] Hotspots con coordenadas proporcionales (`xp/yp`) en vez de `offsetX/offsetY` en píxeles

### Futuro
- [ ] Web Component `<mapa-interactivo>` para distribución sin iframe
- [ ] Panel de administración para editar historias sin tocar JSON
- [ ] Audio/narración sincronizada con waypoints