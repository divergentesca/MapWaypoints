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
13. [Optimizaciones de performance implementadas](#13-optimizaciones-de-performance-implementadas)
14. [Pendientes y roadmap](#14-pendientes-y-roadmap)

---

## 1. Qué es este proyecto

Aplicación web de mapas interactivos narrativos para periodismo de investigación. Permite contar historias geoespaciales por fases, con waypoints, hotspots clicables, overlays animados y popups con información detallada (personas implicadas, fechas, ubicaciones, echos).

**El modelo de negocio:**
- Tú produces las historias (JSON + imágenes) y las publicas en Vercel.
- Los clientes (medios, periodistas) embeben el mapa en su WordPress con un snippet HTML o una plantilla PHP.
- Cada historia es una URL única: `tu-app.vercel.app/?story=costa-rica/expedientes/0001`

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│                  VERCEL (tu-app.vercel.app)          │
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
│   ├── DetailedPopupManager.js   ← Popups con personas, fechas, echos
│   ├── editor.js                 ← Editor visual (carga bajo demanda con ?editor=1)
│   ├── config.js                 ← GLOBAL_CONFIG técnico (sin datos de negocio)
│   ├── index.html                ← HTML base
│   ├── style.css                 ← Estilos principales
│   └── popup_styles.css          ← Estilos de popups detallados
│
├── public/                       ← Archivos estáticos (Vite los copia a dist/ sin procesar)
│   ├── assets/                   ← Imágenes, fuentes, GIFs
│   │   ├── fonts/                ← Inter woff2 (self-hosted)
│   │   ├── mapa-mobile-x4.webp   ← Imagen del mapa mobile (2338×5313px, 4 filas × 3 cols)
│   │   ├── mapa-dektop-4x.webp   ← Imagen del mapa desktop (4240×3685px, 4 filas × 3 cols)
│   │   └── persona_1-*.gif       ← Avatares animados de personas
│   │
│   └── data/                     ← Sistema de datos de historias
│       ├── story.json            ← Historia DEFAULT (fallback sin ?story=)
│       ├── index.json            ← Catálogo de todas las historias (para lobby futuro)
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

**Comandos del editor:**
- `E` — Toggle editor on/off
- `Ctrl+Z / Ctrl+Y` — Undo/Redo
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
  "id": "costa-rica/expedientes/0001",
  "title": "Expediente 0001",
  "description": "Descripción breve del caso",
  "thumbnail": "/data/stories/costa-rica/expedientes/0001/thumb.webp",
  "phases": [
    {
      "id": "fase1",
      "label": "Fase 1",
      "color": "#1BC6EB",
      "maps": ["mapa_f1"]
    }
  ],
  "mapsIndex": {
    "mapa_f1": { "id": "mapa_f1", "name": "Recorrido 1", "phase": "fase1" }
  }
}
```

### `maps/mapa_f1.json` — Estructura de un mapa

```json
{
  "id": "mapa_f1",
  "name": "Recorrido 1",
  "phase": "fase1",
  "mapImage": {
    "mobile":  { "src": "/assets/mapa-mobile-x4.webp?v=2026-05-20", "logicalW": 2338, "logicalH": 5313 },
    "desktop": { "src": "/assets/mapa-dektop-4x.webp?v=2026-05-20", "logicalW": 4240, "logicalH": 3685 },
    "useNaturalSize": false
  },
  "waypoints": [
    {
      "mobile":  { "xp": 0.17, "yp": 0.1579, "z": 0.9 },
      "desktop": { "xp": 0.18, "yp": 0.1485, "z": 1 },
      "yOffset": { "default": 0, "tall": -90, "medium": -5, "short": 40 },
      "zMobileProfile": { "default": 0.56, "tall": 0.66, "medium": 0.60, "short": 0.52 },
      "label": "Inicio del Viaje",
      "lines": ["Texto narrativo línea 1.", "Texto narrativo línea 2."]
    }
  ],
  "icons": {
    "0": [
      {
        "type": "hotspot",
        "mobile":  { "offsetX": -26, "offsetY": -301, "width": 370, "height": 200, "rotation": 9 },
        "desktop": { "offsetX": -465, "offsetY": -61, "width": 388, "height": 230, "rotation": -10 },
        "title": "Llegada al Aeropuerto",
        "image": "/assets/mapa-1.webp",
        "datetime": { "date": "15/06/2025", "time": "12:07", "timeColor": "#FF4444" },
        "location": "Aeropuerto Juan Santamaría (SJO), Alajuela.",
        "description": "Descripción del evento...",
        "involved": [
          { "id": "person1", "name": "Persona #1", "avatar": "./assets/persona_1-1.png", "role": "Pasajero" }
        ],
        "echos": {
          "person1": [
            { "datetime": { "date": "15/06/2025", "time": "12:07" }, "description": "Detalle del eco..." }
          ]
        }
      }
    ]
  }
}
```

**Campos de waypoint:**
- `xp / yp` — Posición relativa en el mapa (0.0 a 1.0). Se multiplica por `logicalW/H` para obtener coordenadas absolutas.
- `z` — Nivel de zoom en ese waypoint
- `yOffset` — Ajuste vertical según perfil de altura del dispositivo
- `zMobileProfile` — Zoom específico por perfil de pantalla mobile

**Perfiles de altura mobile:**
- `short` — pantallas ≤640px de alto
- `medium` — pantallas 641-820px de alto
- `tall` — pantallas >820px de alto

**⚠️ Al cambiar la imagen del mapa:** si el nuevo `logicalH` es distinto, los `yp` deben recalcularse. Ver sección 12.

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

| Parámetro | Tipo | Valores | Descripción |
|---|---|---|---|
| `story` | string | `costa-rica/expedientes/0001` | ID de la historia. Sin este parámetro carga el story default. |
| `popups` | boolean | `1` / `0` | Activa popups al hacer clic en hotspots. |
| `overlays` | boolean | `1` / `0` | Activa overlays DOM (iconos sobre el mapa). |
| `debug` | boolean | `1` / `0` | Muestra grilla, labels y rectángulos de hotspots. |
| `editor` | boolean | `1` / `0` | Carga el editor visual bajo demanda. |
| `mute` | boolean | `1` / `0` | Reservado para audio futuro. |
| `embed` | boolean | `1` / `0` | Indica que la app corre dentro de un iframe. |
| `scale` | número | `80`–`110` | Porcentaje de cobertura del viewport. |

**Ejemplos:**
```
# Producción
https://map-waypoints.vercel.app/?story=costa-rica/expedientes/0001&popups=1&overlays=1&mute=1

# Desarrollo con debug
http://localhost:5173/?story=costa-rica/expedientes/0001&debug=1&popups=1&overlays=1

# Editor visual
http://localhost:5173/?editor=1&debug=1
```

---

## 7. Sistema de distribución — WordPress

### Opción A — Snippet HTML

```html
<div id="mapa-wrapper" style="width:100%;background:#000;overflow:visible;margin:0;padding:0;">
  <iframe
    id="mapa-iframe"
    src="https://map-waypoints.vercel.app/?story=costa-rica/expedientes/0001&popups=1&overlays=1&mute=1"
    style="width:100%;height:100vh;min-height:500px;border:none;display:block;"
    allow="fullscreen"
    loading="eager"
    title="Expediente 0001 — Costa Rica"
    scrolling="no"
  ></iframe>
</div>
<script>
(function() {
  var iframe = document.getElementById('mapa-iframe');
  var origin = 'https://map-waypoints.vercel.app';
  var lastHeight = 0;
  window.addEventListener('message', function(e) {
    if (e.origin !== origin) return;
    if (!e.data || e.data.type !== 'mapa-resize') return;
    var h = parseInt(e.data.height, 10);
    if (!h || h < 200) return;
    if (Math.abs(h - lastHeight) < 5) return;
    lastHeight = h;
    if (iframe) iframe.style.height = h + 'px';
  });
})();
</script>
```

### Opción B — Plantilla PHP fullscreen

Archivo: `wp-content/themes/{tema-activo}/page-mapa-fullscreen.php`

```php
<?php
/**
 * Template Name: Mapa Interactivo Fullscreen
 * Template Post Type: page
 */
$story = isset($_GET['story']) ? sanitize_text_field($_GET['story']) : 'costa-rica/expedientes/0001';
$base  = 'https://map-waypoints.vercel.app';
$src   = esc_url($base . '/?story=' . $story . '&popups=1&overlays=1&mute=1');
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title><?php wp_title('|', true, 'right'); bloginfo('name'); ?></title>
  <style>
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;background:#000}
    #mapa-fs{width:100%;height:100vh;border:none;display:block}
  </style>
</head>
<body>
  <iframe
    id="mapa-fs"
    src="<?php echo $src; ?>"
    allow="fullscreen"
    loading="eager"
    title="<?php the_title(); ?>"
  ></iframe>
  <?php wp_footer(); ?>
</body>
</html>
```

**Para activar debug en desarrollo local:**
```php
$src = esc_url($base . '/?story=' . $story . '&debug=1&popups=1&overlays=1&mute=1');
```

---

## 8. Deploy — Vercel

### `vercel.json` — Headers HTTP

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options",        "value": "ALLOWALL" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors *;" },
        { "key": "X-Content-Type-Options",  "value": "nosniff" },
        { "key": "Referrer-Policy",         "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### Comandos

```bash
npm run dev      # Servidor de desarrollo en localhost:5173
npm run build    # Build de producción → genera dist/
npm run preview  # Preview del build antes de deploy

# Deploy
git add . && git commit -m "descripción" && git push
# Vercel despliega automáticamente al detectar el push

# Verificar headers en producción
curl -I https://map-waypoints.vercel.app/
```

---

## 9. Flujo de desarrollo

```bash
# 1. Iniciar servidor local
npm run dev

# 2. Abrir con parámetros de desarrollo
# http://localhost:5173/?story=costa-rica/expedientes/0001&debug=1&popups=1&overlays=1

# 3. Ajustar hotspots con el editor visual
# http://localhost:5173/?editor=1&debug=1

# 4. Build y deploy
npm run build
git add . && git commit -m "actualiza historia 0001" && git push
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
```

### Paso 2 — Actualizar `mapImage` en el JSON

```json
"mapImage": {
  "mobile":  { "src": "/assets/nueva-mobile.webp?v=YYYY-MM-DD", "logicalW": W, "logicalH": H },
  "desktop": { "src": "/assets/nueva-desktop.webp?v=YYYY-MM-DD", "logicalW": W, "logicalH": H }
}
```

El `?v=YYYY-MM-DD` fuerza al browser a no usar la versión cacheada.

### Paso 3 — Recalcular `yp` de los waypoints

Si el `logicalH` cambió, todos los `yp` deben ajustarse:

```
yp_nuevo = (yp_viejo × logicalH_viejo) / logicalH_nuevo
```

Los `offsetX/offsetY` de los hotspots **no necesitan cambio** — son relativos al waypoint y se ajustan automáticamente.

### Paso 4 — Verificar `CANVAS_LIMITS` en `src/config.js`

Límites actuales (calibrados para las imágenes 4x):

```js
CANVAS_LIMITS: {
  desktop: {
    maxWidth: 4096,
    maxHeight: 4096,
    maxPixels: 16_000_000,   // desktop 4x = 15.6M px
    maxMemoryMB: 150
  },
  mobile: {
    maxWidth: 2400,
    maxHeight: 5400,
    maxPixels: 13_000_000,   // mobile 4x = 12.4M px
    maxMemoryMB: 72
  },
  downscaleFactor: 0.8,
  warnThreshold: 0.85
},
```

Verificar en consola que aparezca sin warning de límite:
```
✅ Dimensiones lógicas: 4240x3685
✅ Imagen real: 4240x3685
```

---

## 13. Optimizaciones de performance implementadas

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

## 14. Pendientes y roadmap

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