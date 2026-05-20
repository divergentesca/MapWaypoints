// ========= APLICACIÓN PRINCIPAL OPTIMIZADA =========
// 🚀 OPTIMIZACIONES IMPLEMENTADAS:
// 1. Culling espacial con viewport frustum
// 2. Object pooling y eliminación de allocations
// 3. Dirty flag system con throttling inteligente
// 4. Pre-cálculo de constantes
// 5. Debounce/throttle mejorado
// 6. Gestión mejorada de memoria
// 7. Validación de dimensiones de canvas
// 8. Spatial index para waypoints

import { GLOBAL_CONFIG, MAPS_CONFIG } from './config.js';
import { MapManager } from './MapManager.js';
import { Camera } from './Camera.js';
import { UIManager } from './UIManager.js';
import { DetailedPopupManager } from './DetailedPopupManager.js';
import { OverlayLayer } from './OverlayLayer.js';

// Helper simple para mostrar errores al usuario
function showError(message) {
  try {
    alert(message); // Simple y efectivo sin dependencias
  } catch (e) {
    console.warn('showError fallback:', message);
  }
}
window.showError = showError;

// ===== Toggle dinámico para popups =====
window.togglePopupDisplay = (enable) => {
  GLOBAL_CONFIG.SHOW_POPUP_ON_CLICK = !!enable;
  console.log(`[CONFIG] Popups on click: ${GLOBAL_CONFIG.SHOW_POPUP_ON_CLICK ? 'enabled' : 'disabled'}`);
  // Opcional: fuerza redraw si necesitas visuals actualizados
  if (window.markDirty) {
    window.markDirty('elements');  // Asumiendo tu dirty flag system
  }
};

function isMobileViewport() {
  return window.matchMedia(`(max-width: ${GLOBAL_CONFIG.MOBILE_BREAKPOINT - 1}px)`).matches;
}

function getMobileHeightProfile() {
  if (typeof window === 'undefined') return 'tall';

  const h = window.innerHeight || window.screen?.height || 0;
  if (!h) return 'tall';

  if (h <= 640) return 'short';   // teléfonos bajitos
  if (h <= 820) return 'medium';  // rango intermedio (tipo 596x903 de tu screenshot)
  return 'tall';                  // teléfonos altos / phablets
}

// ===== Helpers de URL y logger (seguros) =====
function parseUrlToggles() {
  const params = new URLSearchParams(location.search);
  const toggles = {
    scale: params.get('scale'),
    debug: params.get('debug'),
    editor: params.get('editor'),
    popups: params.get('popups')
  };

  for (const key of Object.keys(toggles)) {
    const val = toggles[key];
    if (val == null) {
      toggles[key] = undefined;
      continue;
    }
    const lowered = String(val).toLowerCase();
    toggles[key] =
      lowered === '1' ||
      lowered === 'true' ||
      lowered === 'yes' ||
      lowered === 'on';
  }

  // Handle scale separately to maintain the 0.80-1.10 range
  if (toggles.scale !== undefined) {
    const n = Number(toggles.scale);
    toggles.scale = !Number.isNaN(n) ? Math.min(110, Math.max(80, n)) / 100 : undefined;
  }

  return toggles;
}

// App-level config object (reduces globals)
const appConfig = {
  toggles: parseUrlToggles(),
  editorActive: false,
};
// Expose config for debugging
window.appConfig = appConfig;

// Manejo del toggle del editor desde la URL
if (appConfig.toggles.hasOwnProperty('editor')) {
  appConfig.editorActive = !!appConfig.toggles.editor;
  window.__EDITOR_ACTIVE__ = appConfig.editorActive;
}

// Si el editor está activo, habilitamos el flag global y cargamos el módulo
if (appConfig.editorActive) {
  GLOBAL_CONFIG.EDITOR_ENABLED = true;

  import('./editor.js')
    .then((mod) => {
      console.log('🎨 Editor cargado bajo demanda (?editor=1)');

      if (mod && typeof mod.initEditor === 'function') {
        mod.initEditor(); // no pasa nada si en el futuro decides aceptarle argumentos
      } else {
        console.warn('[Editor] Módulo cargado pero sin initEditor exportado');
      }
    })
    .catch((err) => {
      console.error('[Editor] Error al cargar editor.js', err);
    });
} else {
  GLOBAL_CONFIG.EDITOR_ENABLED = false;
}

// Aplica toggle de popups desde URL si está presente
if (appConfig.toggles.hasOwnProperty('popups')) {
  GLOBAL_CONFIG.SHOW_POPUP_ON_CLICK = !!appConfig.toggles.popups;
  console.log(`[CONFIG] SHOW_POPUP_ON_CLICK set from URL: ${GLOBAL_CONFIG.SHOW_POPUP_ON_CLICK}`);
}

if (appConfig.toggles.hasOwnProperty('debug')) {
  GLOBAL_CONFIG.DEBUG_HOTSPOTS = !!appConfig.toggles.debug;
  console.log('[CONFIG] DEBUG_HOTSPOTS from URL:', GLOBAL_CONFIG.DEBUG_HOTSPOTS);
}

// Escucha cambios de estado del editor (enviado por editor.js)
window.addEventListener('editor:active', (e) => {
  appConfig.editorActive = !!(e.detail && e.detail.active);
  window.__EDITOR_ACTIVE__ = appConfig.editorActive;
  // fuerza un redraw amable en capas relevantes
  try { markDirty('camera','elements','debug','minimap'); } catch {}
});
const log = {
  info: (...a) => appConfig.toggles.debug && console.info('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

// ===== Ajuste de cobertura de viewport (sin CSS scale) =====
function applyViewportCoverage() {
  const wrapper = document.getElementById('mapa-canvas-wrapper');
  if (!wrapper) return;

  const coverage = appConfig.toggles.scale || 1.0; // 100% por defecto
  let vw = Math.floor(window.innerWidth  * coverage);
  let vh = Math.floor(window.innerHeight * coverage);

  const { VIEWPORT_GUARDS, BASE_ASPECT } = GLOBAL_CONFIG;
  const isMobile = isMobileViewport();

  if (!isMobile) {
    // Desktop: bandas problemáticas
    if (vw < VIEWPORT_GUARDS.desktop.clampBelowW) {
      // Mantener aspecto base (contain dentro del viewport), con letterbox
      const targetW = vw;
      const targetH = Math.round(targetW / BASE_ASPECT);
      // Si nos pasamos de alto, rehacemos por alto
      if (targetH > vh) {
        const h2 = vh;
        const w2 = Math.round(h2 * BASE_ASPECT);
        vw = w2; vh = h2;
      } else {
        vw = targetW; vh = targetH;
      }
      // Si caemos por debajo del hard cut → recortamos (scroll off)
      if (vw < VIEWPORT_GUARDS.desktop.hardCutBelowW) {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      } else {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      }
    } else {
      // Banda "buena": sin restricciones extra
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  } else {
    // Mobile: evita deformación por altura ultra-baja
    if (vh < VIEWPORT_GUARDS.mobile.minH) {
      vh = VIEWPORT_GUARDS.mobile.minH; // congelamos alto lógico del mapa
      // 👉 Permitimos scroll vertical para no cortar el canvas ni perder controles
      document.documentElement.style.overflowY = 'auto';
      document.body.style.overflowY = 'auto';
      // 👉 Pero bloqueamos scroll horizontal
      document.documentElement.style.overflowX = 'hidden';
      document.body.style.overflowX = 'hidden';
    } else {
      // 👉 En móviles con altura suficiente seguimos en modo "cine" sin scroll
      document.documentElement.style.overflowY = 'hidden';
      document.body.style.overflowY = 'hidden';
      document.documentElement.style.overflowX = 'hidden';
      document.body.style.overflowX = 'hidden';
    }
  }

  wrapper.style.width  = vw + 'px';
  wrapper.style.height = vh + 'px';
  document.body.style.background = '#000';

  log.info('Viewport coverage →', Math.round(coverage * 100) + '%', { vw, vh });
}

// API mínima por si prefieres controlarlo desde código
window.LayoutFill = window.LayoutFill || {
  set(pct = 100) {
    const scale = Math.min(110, Math.max(80, Number(pct))) / 100;
    // actualiza toggle y re-aplica
  appConfig.toggles.scale = scale;
    applyViewportCoverage();
    // Si tienes rutinas de canvas DPR/redraw, invócalas aquí:
    try {
      window.requestAnimationFrame(() => {
        // Si existen estas funciones en tu app, llámalas sin romper:
        window.setCanvasDPR?.();
        window.markDirty?.('camera','elements','dialog','minimap','debug');
      });
    } catch {}
  }
};


// ========= 🧭 WAYPOINT SPATIAL INDEX =========
class WaypointSpatialIndex {
  constructor(waypoints, cellSize = 500) {
    this.waypoints = waypoints;
    this.cellSize = cellSize;
    this.grid = new Map();
    this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    this.build();
  }
  build() {
    this.waypoints.forEach((wp, index) => {
      const cellX = Math.floor(wp.x / this.cellSize);
      const cellY = Math.floor(wp.y / this.cellSize);
      const key = `${cellX},${cellY}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push({ wp, originalIndex: index });
      this.bounds.minX = Math.min(this.bounds.minX, wp.x);
      this.bounds.maxX = Math.max(this.bounds.maxX, wp.x);
      this.bounds.minY = Math.min(this.bounds.minY, wp.y);
      this.bounds.maxY = Math.max(this.bounds.maxY, wp.y);
    });
  }
  query(bounds) {
    const minCellX = Math.floor(bounds.left / this.cellSize);
    const maxCellX = Math.ceil(bounds.right / this.cellSize);
    const minCellY = Math.floor(bounds.top / this.cellSize);
    const maxCellY = Math.ceil(bounds.bottom / this.cellSize);
    const results = [];
    const seen = new Set();
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        const key = `${x},${y}`;
        const cell = this.grid.get(key);
        if (cell) {
          cell.forEach(wp => {
            if (!seen.has(wp.originalIndex)) {
              seen.add(wp.originalIndex);
              results.push(wp);
            }
          });
        }
      }
    }
    return results;
  }
}

// ========= 🧠 MEMORY MONITOR =========
class MemoryMonitor {
  constructor() {
    this.samples = [];
    this.maxSamples = 60;
    this.lastSample = 0;
    this.sampleInterval = 1000;
  }
  sample() {
    if (!performance.memory) return null;
    const now = performance.now();
    if (now - this.lastSample < this.sampleInterval) return null;
    this.lastSample = now;
    const sample = {
      timestamp: now,
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      usedMB: performance.memory.usedJSHeapSize / (1024 * 1024),
      percentUsed: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100
    };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return sample;
  }
  getStats() {
    if (this.samples.length === 0) return null;
    const latest = this.samples[this.samples.length - 1];
    const avg = this.samples.reduce((sum, s) => sum + s.usedMB, 0) / this.samples.length;
    const max = Math.max(...this.samples.map(s => s.usedMB));
    return {
      current: latest.usedMB.toFixed(2) + 'MB',
      average: avg.toFixed(2) + 'MB',
      peak: max.toFixed(2) + 'MB',
      percentUsed: latest.percentUsed.toFixed(1) + '%',
      limit: (latest.jsHeapSizeLimit / (1024 * 1024)).toFixed(2) + 'MB'
    };
  }
  isMemoryPressure() {
    if (!performance.memory) return false;
    const latest = this.samples[this.samples.length - 1];
    return latest && latest.percentUsed > 85;
  }
}

// ========= 🔎 CANVAS VALIDATOR =========
function validateCanvasDimensions(width, height, isMobile) {
  const limits = isMobile 
    ? GLOBAL_CONFIG.CANVAS_LIMITS.mobile 
    : GLOBAL_CONFIG.CANVAS_LIMITS.desktop;
  let adjusted = false;
  let warnings = [];
  if (width > limits.maxWidth) { warnings.push(`Width ${width}px excede límite ${limits.maxWidth}px`); width = limits.maxWidth; adjusted = true; }
  if (height > limits.maxHeight) { warnings.push(`Height ${height}px excede límite ${limits.maxHeight}px`); height = limits.maxHeight; adjusted = true; }
  const totalPixels = width * height;
  if (totalPixels > limits.maxPixels) {
    warnings.push(`Total pixels ${totalPixels.toLocaleString()} excede límite ${limits.maxPixels.toLocaleString()}`);
    const scale = Math.sqrt(limits.maxPixels / totalPixels);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
    adjusted = true;
  }
  const estimatedMemoryMB = (width * height * 4) / (1024 * 1024);
  if (estimatedMemoryMB > limits.maxMemoryMB) {
    warnings.push(`Memoria estimada ${estimatedMemoryMB.toFixed(2)}MB excede límite ${limits.maxMemoryMB}MB`);
    const scale = Math.sqrt(limits.maxMemoryMB / estimatedMemoryMB);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
    adjusted = true;
  }
  if (warnings.length > 0) {
    console.warn('⚠️ Canvas dimensions adjusted:');
    warnings.forEach(w => console.warn('   - ' + w));
    console.warn(`   Final: ${width}×${height} (${totalPixels.toLocaleString()} px, ~${estimatedMemoryMB.toFixed(2)}MB)`);
  }
  return { width, height, adjusted, warnings, estimatedMemoryMB };
}

// ••• VARIABLES GLOBALES
let waypointSpatialIndex = null;
let memoryMonitor = new MemoryMonitor();

(() => {
  let { BASE_W, BASE_H } = GLOBAL_CONFIG;
  const { TYPE_SPEED, EASE, MARKER_R, ICON_R, ICON_SIZE, DIALOG_BOX, DPR_MAX, CANVAS_MIN_HEIGHT } = GLOBAL_CONFIG;

  // ========= 🎯 PRE-CÁLCULO DE CONSTANTES =========
  const RENDER_CONSTANTS = Object.freeze({
    TWO_PI: Math.PI * 2,
    ACTIVE_MARKER_FILL: 'rgba(255,255,255,0.95)',
    INACTIVE_MARKER_FILL: 'rgba(255,255,255,0.6)',
    MARKER_STROKE_COLOR: 'rgba(0,0,0,0.55)',
    MARKER_STROKE_WIDTH: 2,
    BLACK_BG: '#000',
    ZOOM_SQRT_CACHE: new Map()
  });

  function getCachedSqrt(z) {
    const key = z.toFixed(4);
    if (!RENDER_CONSTANTS.ZOOM_SQRT_CACHE.has(key)) {
      RENDER_CONSTANTS.ZOOM_SQRT_CACHE.set(key, Math.sqrt(z));
    }
    return RENDER_CONSTANTS.ZOOM_SQRT_CACHE.get(key);
  }

  if (GLOBAL_CONFIG.DEBUG_SHOW_MINIMAP_MOBILE) {
    document.body.classList.add('debug-minimap-mobile');
  }

  // DOM
  const wrap = document.getElementById('mapa-canvas-wrapper');
  
  function getMobileHeightProfile() {
    const h = (wrap && wrap.clientHeight) || window.innerHeight || 0;
    if (!h) return 'default';

    // Ajusta estos cortes a lo que veas en tus pruebas
    if (h <= 600) return 'short';   // móviles muy bajos
    if (h <= 740) return 'medium';  // la mayoría
    return 'tall';                  // móviles "altos"
  }
  const canvas = document.getElementById('mapa-canvas');
  if (!canvas) {
    showError('Canvas element #mapa-canvas not found in the DOM.');
    return;
  }

  const ctx = canvas.getContext && canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    showError('Unable to acquire 2D rendering context from #mapa-canvas.');
    return;
  }

  // Placeholder inicial para LCP
  function drawPlaceholder() {
    ctx.fillStyle = '#000'; // Fondo negro simple (o usa una imagen low-res si prefieres)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Opcional: carga una imagen low-res si la tienes (descomenta)
    // const placeholderImg = new Image();
    // placeholderImg.src = '/assets/low-res-map.jpg';
    // placeholderImg.onload = () => ctx.drawImage(placeholderImg, 0, 0, canvas.width, canvas.height);
  }
  // Dibuja placeholder inmediatamente para mejorar LCP
  try { drawPlaceholder(); } catch (err) { /* no bloquear si canvas no está listo */ }

  const minimap = document.getElementById('minimap');
  const mmCtx = (minimap && minimap.getContext) ? minimap.getContext('2d') : null;
  const srLive = wrap.querySelector('.sr-live');
  const uiControls = document.querySelector('.ui');

  // Managers
  const mapManager = new MapManager();

  // Overlay DOM
  const overlay = new OverlayLayer(document.getElementById('overlay-layer'));
  overlay.setDevice(mapManager.isMobile ? 'mobile' : 'desktop');
  window.overlay = overlay; // útil para depurar

  // Clicks centralizados de overlays
  let lastOverlayClick = { time: 0, key: null };
  overlay.root.addEventListener('overlay:click', (e) => {
    const { key, record } = e.detail;
    // marca el último click para evitar duplicados desde pointerup
    lastOverlayClick = { time: performance.now(), key };
    // aquí puedes abrir tu popup/drawer si quieres
    // popupManager?.open(record.meta);
    console.log('[overlay click]', key, record?.meta);
  });

  // Auto-snap fallback: si no hubo overlay:click, busca el overlay más cercano
  overlay.root.addEventListener('pointerup', (ev) => {
    const now = performance.now();
    // si hubo un overlay:click recientemente, no hacemos snap
    if (lastOverlayClick.time && now - lastOverlayClick.time < 250) return;

    try {
      const R = 24; // radio de perdón en px
      const clientX = ev.clientX;
      const clientY = ev.clientY;
      let best = null;
      let bestDist = Infinity;

      for (const [k, rec] of overlay.items) {
        if (!rec || !rec.wrap) continue;
        if (rec.wrap.style.display === 'none') continue;
        const rect = rec.wrap.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const d = Math.hypot(clientX - cx, clientY - cy);
        if (d < bestDist) { bestDist = d; best = { key: k, rec, d }; }
      }

      if (best && best.d <= R) {
        // dispara manualmente el evento para reutilizar el manejador existente
        lastOverlayClick = { time: performance.now(), key: best.key };
        overlay.root.dispatchEvent(new CustomEvent('overlay:click', {
          bubbles: true,
          detail: { key: best.key, record: best.rec }
        }));
      }
    } catch (err) {
      console.warn('overlay snap handler error', err);
    }
  }, { passive: true });

  window.mapManager = mapManager;
  let uiManager;
  let popupManager;

  // Estado
  const state = {
    idx: 0, lineIndex: 0, typedText: '', typing: false, lastTick: 0,
    currentWaypoints: [], currentIcons: {}, mapImages: null, isFirstLoad: true
  };

  const camera = { x: 0, y: 0, z: 1.0 };
  const camTarget = { x: 0, y: 0, z: 1.0 };

  const dirtyFlags = { camera:false, elements:false, dialog:false, minimap:false, debug:false, cameraMoving:false };
  function markDirty(...flags){ flags.forEach(f=>{ if (dirtyFlags.hasOwnProperty(f)) dirtyFlags[f]=true; }); }
  window.markDirty = markDirty;  // Exponer para uso global (e.g., togglePopupDisplay)
  function clearDirtyFlags(){ Object.keys(dirtyFlags).forEach(k=> dirtyFlags[k]=false); }
  function needsRedraw(){
    return (
      dirtyFlags.camera ||
      dirtyFlags.elements ||
      dirtyFlags.dialog ||
      dirtyFlags.minimap ||
      dirtyFlags.debug ||
      dirtyFlags.cameraMoving ||
      state.typing ||
      transitionState.active
    );
  }

  const transitionState = { active:false, startTime:0, duration:GLOBAL_CONFIG.CAMERA_EFFECTS.transitionDuration, startZ:1.0, targetZ:1.0, peakZOffset:GLOBAL_CONFIG.CAMERA_EFFECTS.transitionZoomOut, startPos:{x:0,y:0}, targetPos:{x:0,y:0} };

  const viewportBoundsPool = { left:0, right:0, top:0, bottom:0 };
  function updateViewportBounds(canvasW, canvasH, margin = 200) {
    const halfW = canvasW / 2 / camera.z;
    const halfH = canvasH / 2 / camera.z;
    viewportBoundsPool.left = camera.x - halfW - margin;
    viewportBoundsPool.right = camera.x + halfW + margin;
    viewportBoundsPool.top = camera.y - halfH - margin;
    viewportBoundsPool.bottom = camera.y + halfH + margin;
  }

  function isItemVisible(item, sqrtZ) {
    const safeNum = (v,f)=> (Number.isFinite(v)&&v>0)?v:f;
    const width = safeNum(item.width, ICON_SIZE);
    const height = safeNum(item.height, ICON_SIZE);
    const displayWidth = width / sqrtZ;
    const displayHeight = height / sqrtZ;
    const halfW = displayWidth * 0.5;
    const halfH = displayHeight * 0.5;
    return !(
      item.x + halfW < viewportBoundsPool.left  ||
      item.x - halfW > viewportBoundsPool.right ||
      item.y + halfH < viewportBoundsPool.top   ||
      item.y - halfH > viewportBoundsPool.bottom
    );
  }
  function filterVisibleItems(items, sqrtZ) {
    if (!items || items.length === 0) return [];
    if (appConfig.editorActive) return items;
    const visible=[]; for (let i=0;i<items.length;i++){ if (isItemVisible(items[i], sqrtZ)) visible.push(items[i]); }
    return visible;
  }

  // ========= COMUNICACIÓN CON EDITOR =========
  let editorActive = false;
  
  function toggleEditor(active) {
    // Update editor active state
    editorActive = active;
    
    // Dispatch event to notify other components
    document.dispatchEvent(new CustomEvent('editor:active', { detail: { active } }));
    
    // 🆕 Disable overlay events
    const overlayRoot = document.getElementById('overlay-layer');

    if (overlayRoot) {
      if (active) {
        overlayRoot.style.setProperty('pointer-events', 'none', 'important');
      } else {
        overlayRoot.style.removeProperty('pointer-events');
      }
    } else {
      // Fallback a individuales
      const overlayWrappers = document.querySelectorAll('.overlay-wrap');
      overlayWrappers.forEach(el => {
        if (active) {
          el.style.setProperty('pointer-events', 'none', 'important');
        } else {
          el.style.removeProperty('pointer-events');
        }
      });
      if (overlayWrappers.length === 0) console.warn('No overlays found to disable');
    }

    // 🆕 Disable popups in editor
    if (window.togglePopupDisplay) {
      window.togglePopupDisplay(!active);
    }

    // Force redraw
    if (window.markDirty) {
      window.markDirty('elements');
    }
  }
  
  window.toggleEditor = toggleEditor;
  
  window.addEventListener('editor:getMapCoords', (e) => {
    const { clientX, clientY } = e.detail;
    const coords = clientToMapCoords(clientX, clientY);
    window.dispatchEvent(new CustomEvent('editor:mapCoordsResponse', {
      detail: { x: coords.x, y: coords.y, items: state.currentIcons[state.idx] || [], waypoint: state.currentWaypoints[state.idx], waypointIndex: state.idx, camera, ICON_SIZE }
    }));
  });
  addEventListener('editor:getWaypointData', (e) => {
    const idx = e.detail.waypointIndex;
    const wps = state.currentWaypoints;
    const icons = state.currentIcons;
    const waypoint = wps[idx];
    const items = icons[idx] || [];
    const cam = { x: camera.x, y: camera.y, z: camera.z };
    window.dispatchEvent(new CustomEvent('editor:waypointDataResponse', { detail: { waypoint, items, camera: cam } }));
  });
  addEventListener('editor:updateWaypoint', (e) => {
    const { waypointIndex, device, values } = e.detail;
    const mapId = mapManager.currentMapId;
    const cfg = MAPS_CONFIG[mapId];
    if (!cfg || !cfg.waypoints || !cfg.waypoints[waypointIndex]) return;
    if (!cfg.waypoints[waypointIndex][device]) cfg.waypoints[waypointIndex][device] = {};
    Object.assign(cfg.waypoints[waypointIndex][device], values);
    const W = cfg.mapImage.logicalW, H = cfg.mapImage.logicalH;
    const normalized = mapManager.normalizeWaypoints(cfg.waypoints, W, H);
    mapManager.currentMap.waypoints = normalized;
    state.currentWaypoints = normalized;
    if (waypointSpatialIndex && GLOBAL_CONFIG.WAYPOINT_RENDERING.useSpatialIndex) {
      waypointSpatialIndex = new WaypointSpatialIndex(state.currentWaypoints, GLOBAL_CONFIG.WAYPOINT_RENDERING.cellSize);
    }
    markDirty('camera','elements','minimap');
  });
  addEventListener('editor:getWaypointCode', (e) => {
    const { waypointIndex, device } = e.detail;
    const mapId = mapManager.currentMapId;
    const cfg = MAPS_CONFIG[mapId];
    const wp = cfg.waypoints[waypointIndex][device];
    if (!wp) return;
    const code = `{ ${device}: { xp: ${wp.xp}, yp: ${wp.yp}, z: ${wp.z} } }`;
    window.dispatchEvent(new CustomEvent('editor:itemCodeResponse', { detail: { code } }));
  });
  window.addEventListener('editor:getItemCode', (e) => {
    const { waypointIndex, itemIndex } = e.detail;
    const item = state.currentIcons[waypointIndex]?.[itemIndex];
    const wp = state.currentWaypoints[waypointIndex];
    if (item && wp) {
      const offsetX = Math.round(item.x - wp.x);
      const offsetY = Math.round(item.y - wp.y);
      const code = `{
  type: '${item.type || 'hotspot'}',${item.img ? `
  img: '${item.img}',` : ''}
  mobile: { offsetX: ${offsetX}, offsetY: ${offsetY}, width: ${Math.round(item.width)}, height: ${Math.round(item.height)}, rotation: ${item.rotation || 0} },
  desktop: { offsetX: ${offsetX}, offsetY: ${offsetY}, width: ${Math.round(item.width)}, height: ${Math.round(item.height)}, rotation: ${item.rotation || 0} },
  title: '${item.title || 'Título'}',
  body: '${item.body || 'Descripción...'}'
}`;
      window.dispatchEvent(new CustomEvent('editor:itemCodeResponse', { detail: { code, item, offsetX, offsetY } }));
    }
  });
  window.addEventListener('editor:itemSelected', () => { editorActive = true; markDirty('debug'); });
  window.addEventListener('editor:itemDeselected', () => { editorActive = false; markDirty('debug'); });
  window.addEventListener('editor:redraw', () => { markDirty('camera', 'elements', 'debug'); });

  if (!GLOBAL_CONFIG.SHOW_CONTROLS) uiControls.style.display = 'none';

  // ========= PERFORMANCE MONITORING =========
  let performanceStats = { frameCount:0, lastFpsUpdate:0, fps:60, skippedFrames:0, culledItems:0, totalItems:0, visibleWaypoints:0, culledWaypoints:0 };
  function updatePerformanceStats(ts) {
    performanceStats.frameCount++;
    memoryMonitor.sample();
    if (ts - performanceStats.lastFpsUpdate >= 1000) {
      performanceStats.fps = Math.round((performanceStats.frameCount * 1000) / (ts - performanceStats.lastFpsUpdate));
      if (GLOBAL_CONFIG.PERFORMANCE?.logPerformanceStats) {
        const memStats = memoryMonitor.getStats();
        console.log(`
📊 Performance Stats:
├─ FPS: ${performanceStats.fps}
├─ Waypoints: ${performanceStats.visibleWaypoints}/${performanceStats.visibleWaypoints + performanceStats.culledWaypoints} visible
├─ Icons: ${performanceStats.totalItems - performanceStats.culledItems}/${performanceStats.totalItems} visible
├─ Skipped frames: ${performanceStats.skippedFrames}
${memStats ? `├─ Memory: ${memStats.current} (avg: ${memStats.average}, peak: ${memStats.peak})
└─ Memory usage: ${memStats.percentUsed} of ${memStats.limit}` : ''}
        `);
        if (memoryMonitor.isMemoryPressure()) {
          console.warn('⚠️ HIGH MEMORY PRESSURE DETECTED');
          if (GLOBAL_CONFIG.MEMORY_MANAGEMENT.autoCleanInactivePhases) {
            console.log('🧹 Liberando memoria automáticamente...');
            mapManager.clearOldMaps();
          }
        }
      }
      performanceStats.frameCount = 0;
      performanceStats.lastFpsUpdate = ts;
      performanceStats.skippedFrames = 0;
    }
  }

  // ========= SYNC HOTSPOT DATA =========
  function syncHotspotData(mapData) {
    if (!mapData) return;

    // Inicializar o actualizar el arreglo compartido de hotspots
    if (!window.hotspotData) {
      window.hotspotData = [];
    }

    // Actualizar hotspotData a partir del mapa
    if (mapData.hotspots && Array.isArray(mapData.hotspots)) {
      mapData.hotspots.forEach((hotspot, index) => {
        if (hotspot && hotspot.coords) {
          // Mezcla: datos nuevos + coords previas (si existían)
          window.hotspotData[index] = {
            ...hotspot,
            coords: {
              ...(window.hotspotData[index]?.coords || {}),
              ...hotspot.coords,
            },
          };
        }
      });
    }

    // Notificar que se actualizó la data de hotspots (para el editor, etc.)
    window.dispatchEvent(
      new CustomEvent('hotspotData:updated', {
        detail: { hotspots: window.hotspotData },
      })
    );

    return window.hotspotData;
  }

  // ========= LOAD MAP =========
  async function loadMap(mapId) {
    uiManager.setLoading(true);
    try {
      if (GLOBAL_CONFIG.MEMORY_MANAGEMENT.logMemoryUsage) {
        const beforeMem = memoryMonitor.sample();
        if (beforeMem) console.log('💾 Memoria antes:', beforeMem.usedMB.toFixed(2) + 'MB');
      }
      const mapData = await mapManager.loadMap(mapId);
      state.currentWaypoints = mapData.waypoints;
      state.currentIcons = mapData.icons || {};
      state.mapImages = mapData.images;
      
      // Initialize and sync hotspot data
      state.currentHotspots = syncHotspotData(mapData);

      if (GLOBAL_CONFIG.WAYPOINT_RENDERING.useSpatialIndex && state.currentWaypoints.length >= GLOBAL_CONFIG.WAYPOINT_RENDERING.spatialIndexThreshold) {
        waypointSpatialIndex = new WaypointSpatialIndex(state.currentWaypoints, GLOBAL_CONFIG.WAYPOINT_RENDERING.cellSize);
        console.log(`🗂️ Spatial index creado para ${state.currentWaypoints.length} waypoints`);
      } else {
        waypointSpatialIndex = null;
      }

      uiManager.updateProgress(state.currentWaypoints.length, 0);
      uiManager.updateDrawer(state.currentWaypoints);
      const phaseColor = mapManager.getCurrentPhaseColor();
      const phaseColorRgb = mapManager.getCurrentPhaseColorRgb();
      uiManager.updateThemeColor(phaseColor, phaseColorRgb);

      setCanvasDPR();
      // Extra seguro: si por timing necesitas re-encajar una vez más
      try {
        const m = mapManager.currentMap?.config?.mapImage;
        if (m) window.cameraInstance.fitBaseToViewport(m.logicalW, m.logicalH, 'contain');
      } catch {}
      goToWaypoint(0);
      markDirty('camera', 'elements', 'dialog', 'minimap');

      if (GLOBAL_CONFIG.MEMORY_MANAGEMENT.logMemoryUsage) {
        setTimeout(() => {
          const afterMem = memoryMonitor.sample();
          if (afterMem) console.log('💾 Memoria después:', afterMem.usedMB.toFixed(2) + 'MB');
        }, 100);
      }
    } catch (err) {
      console.error('Error cargando mapa:', err);
      if (typeof window !== 'undefined' && window.showError) {
        try { window.showError('Error cargando el mapa. Intenta recargar.'); } catch {};
      }
    } finally {
      uiManager.setLoading(false);
    }
  }

  async function handlePhaseChange(phaseId, firstMapId) {
    await loadMap(firstMapId);
    uiManager.updateMapSelector();
  }

  async function handleMapChange(mapId) {
    await loadMap(mapId);
  }

  function goToWaypoint(i) {
    if (!state.currentWaypoints.length) return;

    state.idx = i;
    state.lineIndex = 0;
    const wp = state.currentWaypoints[i];
    if (!wp) return;

    const isMobile = isMobileViewport();

    // 1) Offset vertical base global
    const defaultOffset = isMobile
      ? GLOBAL_CONFIG.WAYPOINT_OFFSET.mobile
      : GLOBAL_CONFIG.WAYPOINT_OFFSET.desktop;

    let offsetValue = defaultOffset;

    // 2) Override opcional por waypoint (numérico u objeto por altura)
    if (wp.yOffset !== null && wp.yOffset !== undefined) {
      if (typeof wp.yOffset === 'number') {
        // Comportamiento antiguo 1:1 (no rompes nada existente)
        offsetValue = wp.yOffset;
      } else if (isMobile && typeof wp.yOffset === 'object') {
        const profile = getMobileHeightProfile(); // 'short' | 'medium' | 'tall' | 'default'
        const cfg = wp.yOffset;

        if (profile && typeof cfg[profile] === 'number') {
          offsetValue = cfg[profile];
        } else if (typeof cfg.default === 'number') {
          offsetValue = cfg.default;
        }
        // Si tampoco hay default, se queda con defaultOffset
      }
    }

    // 3) Z base: lo que venga del waypoint, o el default global
    let baseZ = wp.z || (isMobile
      ? GLOBAL_CONFIG.CAM.defaultZMobile
      : GLOBAL_CONFIG.CAM.defaultZDesktop);

    // 3.1) Override opcional: perfil de Z solo para mobile según altura de pantalla
    if (isMobile && wp.zMobileProfile && typeof wp.zMobileProfile === 'object') {
      const profile = getMobileHeightProfile();  // 'short' | 'medium' | 'tall' | 'default'
      const cfgZ = wp.zMobileProfile;

      if (profile && typeof cfgZ[profile] === 'number') {
        baseZ = cfgZ[profile];
      } else if (typeof cfgZ.default === 'number') {
        baseZ = cfgZ.default;
      }
      // Si no hay ni perfil ni default, se queda con baseZ tal cual.
    }

    // 4) Clamp sencillo a los límites globales
    const newTargetZ = clamp(
      baseZ,
      GLOBAL_CONFIG.CAM.minZ,
      GLOBAL_CONFIG.CAM.maxZ
    );

    // 5) Offset vertical normalizado por el zoom
    const yOffset = offsetValue / newTargetZ;

    const newTargetX = wp.x;
    const newTargetY = wp.y + yOffset;

    // 6) Posicionamiento inicial / transición cinemática
    if (state.isFirstLoad) {
      camera.x = newTargetX;
      camera.y = newTargetY;
      camera.z = newTargetZ;

      camTarget.x = newTargetX;
      camTarget.y = newTargetY;
      camTarget.z = newTargetZ;

      state.isFirstLoad = false;
    } else if (GLOBAL_CONFIG.CAMERA_EFFECTS.transitionEnabled) {
      transitionState.active = true;
      transitionState.startTime = performance.now();

      // 🆕 Duración según device
      const effects = GLOBAL_CONFIG.CAMERA_EFFECTS;
      const isMobile = isMobileViewport();
      transitionState.duration =
        isMobile && effects.transitionDurationMobile
          ? effects.transitionDurationMobile
          : effects.transitionDuration;

      transitionState.startZ = camera.z;
      transitionState.targetZ = newTargetZ;
      transitionState.startPos = { x: camera.x, y: camera.y };
      transitionState.targetPos = { x: newTargetX, y: newTargetY };
    }

    // 7) Actualizar target aunque no haya transición
    camTarget.x = newTargetX;
    camTarget.y = newTargetY;
    camTarget.z = newTargetZ;

    startTyping();
    uiManager.updateProgress(state.currentWaypoints.length, i);
    markDirty('camera', 'elements', 'dialog', 'minimap');
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a + (b - a) * t; }

  function ease(t, type = GLOBAL_CONFIG.CAMERA_EFFECTS.transitionEasing) {
    switch(type) {
      case 'linear': return t;
      case 'ease-in': return t * t;
      case 'ease-out': return t * (2 - t);
      case 'ease-in-out':
      default: return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
  }

  function updateTransition(ts) {
    if (!transitionState.active) return;

    const elapsed = ts - transitionState.startTime;
    const progress = Math.min(elapsed / transitionState.duration, 1);
    const eased = ease(progress);

    // Zoom "cinemático"
    const zProgress = Math.sin(eased * Math.PI);
    const zModifier =
      transitionState.startZ -
      (transitionState.startZ * transitionState.peakZOffset * zProgress);

    // Interpolación de posición
    const currentX =
      transitionState.startPos.x +
      (transitionState.targetPos.x - transitionState.startPos.x) * eased;
    const currentY =
      transitionState.startPos.y +
      (transitionState.targetPos.y - transitionState.startPos.y) * eased;

    // Durante la transición usamos el z "modificado"
    camTarget.x = currentX;
    camTarget.y = currentY;
    camTarget.z = clamp(zModifier, 0.4, 3.0);

    // Al terminar, confiamos 100% en el target que fijó goToWaypoint
    if (progress >= 1) {
      transitionState.active = false;
      if (transitionState.targetPos) {
        camTarget.x = transitionState.targetPos.x;
        camTarget.y = transitionState.targetPos.y;
      }
      if (typeof transitionState.targetZ === 'number') {
        camTarget.z = transitionState.targetZ;
      }
    }

    markDirty('camera', 'elements', 'minimap');
  }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapLines(str, maxWidth, fontSize = DIALOG_BOX.textSize) {
    ctx.save();
    ctx.font = `400 ${fontSize}px ${DIALOG_BOX.fontStack}`;
    const words = str.split(' '), lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth) { line = test; }
      else { if (line) lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    ctx.restore();
    return lines;
  }

  // ========= 🎯 HOTSPOT RENDERING =========
  function drawHotspotsOnCanvas() {
    if (!GLOBAL_CONFIG.DRAW_HOTSPOTS_ON_CANVAS || !window.hotspotData) return;
    
    const hotspots = window.hotspotData;
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;
    
    // Get current camera state
    const cam = camera || { x: 0, y: 0, z: 1 };
    const sqrtZ = Math.sqrt(cam.z);
    
    // Calculate viewport bounds for culling
    const vw = canvasLogicalW / cam.z;
    const vh = canvasLogicalH / cam.z;
    const vx = cam.x - vw/2;
    const vy = cam.y - vh/2;
    
    // Cache styles for better performance
    const styles = GLOBAL_CONFIG.CANVAS_HOTSPOT_STYLES || {
      fill: 'rgba(132, 255, 0, 0.1)',
      stroke: 'rgba(0, 209, 255, 0.5)',
      lineWidth: 1,
      activeFill: 'rgba(0, 209, 255, 0.2)',
      activeStroke: 'rgba(255, 255, 255, 0.8)'
    };
    
    ctx.save();
    
    // Apply camera transform
    ctx.setTransform(
      dpr * cam.z, 0,
      0, dpr * cam.z,
      dpr * (-cam.x * cam.z + canvasLogicalW/2),
      dpr * (-cam.y * cam.z + canvasLogicalH/2)
    );
    
    // Draw each hotspot
    hotspots.forEach((hs, index) => {
      if (!hs || !hs.coords) return;
      
      const { xp, yp, width = 50, height = 50 } = hs.coords;
      const x = xp * mapManager.currentMap?.config.mapImage.logicalW || 0;
      const y = yp * mapManager.currentMap?.config.mapImage.logicalH || 0;
      
      // Simple viewport culling
      if (x + width < vx || x > vx + vw || y + height < vy || y > vy + vh) {
        return; // Skip off-screen hotspots
      }
      
      const isActive = editorActive && editor?.selectedItem?.index === index;
      
      // Draw hotspot rectangle
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      
      // Apply styles
      ctx.fillStyle = isActive ? styles.activeFill : styles.fill;
      ctx.strokeStyle = isActive ? styles.activeStroke : styles.stroke;
      ctx.lineWidth = (isActive ? 2 : 1) / sqrtZ;
      
      // Draw
      ctx.fill();
      ctx.stroke();
      
      // Draw index label for debugging
      if (GLOBAL_CONFIG.DEBUG_HOTSPOTS) {
        ctx.save();
        ctx.font = `${10 / sqrtZ}px Inter, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(index.toString(), x + width/2, y + height/2);
        ctx.restore();
      }
    });
    
    ctx.restore();
  }

  function drawMapAndMarkers() {
    if (!state.mapImages || !mapManager.currentMap) return;
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;
    const sqrtZ = getCachedSqrt(camera.z);
  updateViewportBounds(canvasLogicalW, canvasLogicalH, appConfig.editorActive ? 600 : 200);

    ctx.save();
    ctx.translate(canvasLogicalW / 2, canvasLogicalH / 2);
    ctx.scale(camera.z, camera.z);
    ctx.translate(-camera.x, -camera.y);

    ctx.fillStyle = RENDER_CONSTANTS.BLACK_BG;
    const margin = 100;
    ctx.fillRect( camera.x - (canvasLogicalW / (2 * camera.z)) - margin, 
                  camera.y - (canvasLogicalH / (2 * camera.z)) - margin, 
                  (canvasLogicalW / camera.z) + (margin * 2), 
                  (canvasLogicalH / camera.z) + (margin * 2) );

    const mapImg = state.mapImages.highRes || state.mapImages.lowRes;
    if (mapImg) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mapImg, 0, 0, mapImg.naturalWidth, mapImg.naturalHeight);
    }

    let waypointsToRender;
    if (GLOBAL_CONFIG.WAYPOINT_RENDERING.enableCulling) {
      if (waypointSpatialIndex) {
        waypointsToRender = waypointSpatialIndex.query(viewportBoundsPool);
      } else {
        waypointsToRender = state.currentWaypoints.filter(wp => !(
          wp.x + MARKER_R < viewportBoundsPool.left ||
          wp.x - MARKER_R > viewportBoundsPool.right ||
          wp.y + MARKER_R < viewportBoundsPool.top ||
          wp.y - MARKER_R > viewportBoundsPool.bottom
        )).map((wp,i)=> ({...wp, originalIndex:i}));
      }
      if (GLOBAL_CONFIG.WAYPOINT_RENDERING.maxVisibleWaypoints && waypointsToRender.length > GLOBAL_CONFIG.WAYPOINT_RENDERING.maxVisibleWaypoints) {
        waypointsToRender.sort((a,b)=> Math.hypot(a.x - camera.x, a.y - camera.y) - Math.hypot(b.x - camera.x, b.y - camera.y));
        waypointsToRender = waypointsToRender.slice(0, GLOBAL_CONFIG.WAYPOINT_RENDERING.maxVisibleWaypoints);
      }
    } else {
      waypointsToRender = state.currentWaypoints.map((wp,i)=> ({...wp, originalIndex:i}));
    }

    waypointsToRender.forEach(wp => {
      const i = wp.originalIndex !== undefined ? wp.originalIndex : state.currentWaypoints.indexOf(wp);
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, MARKER_R, 0, RENDER_CONSTANTS.TWO_PI);
      ctx.fillStyle = i === state.idx ? RENDER_CONSTANTS.ACTIVE_MARKER_FILL : RENDER_CONSTANTS.INACTIVE_MARKER_FILL;
      ctx.fill();
      ctx.lineWidth = RENDER_CONSTANTS.MARKER_STROKE_WIDTH;
      ctx.strokeStyle = RENDER_CONSTANTS.MARKER_STROKE_COLOR;
      ctx.stroke();
    });

    if (GLOBAL_CONFIG.PERFORMANCE?.logPerformanceStats) {
      performanceStats.visibleWaypoints = waypointsToRender.length;
      performanceStats.culledWaypoints = state.currentWaypoints.length - waypointsToRender.length;
    }

    const items = state.currentIcons[state.idx] || [];
    const visibleItems = filterVisibleItems(items, sqrtZ);
    performanceStats.totalItems = items.length;
    performanceStats.culledItems = items.length - visibleItems.length;

    for (let i=0;i<visibleItems.length;i++){
      const item = visibleItems[i];
      const type = item.type || 'icon';
      const baseW = Number.isFinite(item.width) ? item.width : ICON_SIZE;
      const baseH = Number.isFinite(item.height) ? item.height : ICON_SIZE;
      const width  = Math.max(1, baseW);
      const height = Math.max(1, baseH);
      let displayWidth, displayHeight;

      const lockByPolicy =
        (mapManager.isMobile && GLOBAL_CONFIG.RESPONSIVE_SIZING?.mobile?.lockItemWidthToScreenPx) ||
        (item.lockScreenSize && item.lockScreenSize.widthPx);

      if (lockByPolicy) {
        const targetCssW = item.lockScreenSize?.widthPx ?? width;
        displayWidth = targetCssW / camera.z;
        if (item.lockScreenSize?.keepAspect && item.img) {
          const img = mapManager.getImage(item.img);
          if (img && img.naturalWidth && img.naturalHeight) {
            const aspect = img.naturalWidth / img.naturalHeight;
            displayHeight = displayWidth / aspect;
          } else {
            displayHeight = (height / width) * displayWidth;
          }
        } else {
          const targetCssH = item.lockScreenSize?.heightPx ?? height;
          displayHeight = targetCssH / camera.z;
        }
      } else {
        displayWidth = width / sqrtZ;
        displayHeight = height / sqrtZ;
      }

      const halfW = displayWidth * 0.5;
      const halfH = displayHeight * 0.5;
      ctx.save();
      if (item.rotation) {
        ctx.translate(item.x, item.y);
        ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.translate(-item.x, -item.y);
      }
      if (type === 'icon') {
        const img = mapManager.getImage(item.img);
        if (GLOBAL_CONFIG.ICON_STYLES.showBackground) {
          ctx.beginPath();
          ctx.arc(item.x, item.y, ICON_R, 0, RENDER_CONSTANTS.TWO_PI);
          ctx.fillStyle = GLOBAL_CONFIG.ICON_STYLES.backgroundColor;
          ctx.fill();
        }
        if (img) ctx.drawImage(img, item.x - halfW, item.y - halfH, displayWidth, displayHeight);
        if (GLOBAL_CONFIG.ICON_STYLES.showBackground) {
          ctx.beginPath();
          ctx.arc(item.x, item.y, ICON_R, 0, RENDER_CONSTANTS.TWO_PI);
          ctx.strokeStyle = GLOBAL_CONFIG.ICON_STYLES.borderColor;
          ctx.lineWidth = GLOBAL_CONFIG.ICON_STYLES.borderWidth;
          ctx.stroke();
        }
      } else if (type === 'hotspot') {
        if (GLOBAL_CONFIG.DEBUG_HOTSPOTS) {
          const radius = (item.radius || 0) / sqrtZ;
          ctx.fillStyle = item.debugColor || 'rgba(40, 150, 229, 0.3)3)';
          ctx.strokeStyle = 'rgba(9, 16, 51, 0.8)';
          ctx.lineWidth = 2 / sqrtZ;
          ctx.beginPath();
          const x = item.x - halfW;
          const y = item.y - halfH;
          ctx.moveTo(x + radius, y);
          ctx.arcTo(x + displayWidth, y, x + displayWidth, y + displayHeight, radius);
          ctx.arcTo(x + displayWidth, y + displayHeight, x, y + displayHeight, radius);
          ctx.arcTo(x, y + displayHeight, x, y, radius);
          ctx.arcTo(x, y, x + displayWidth, y, radius);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.font = `${12 / sqrtZ}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('HOTSPOT', item.x, item.y);
        }
      } else if (type === 'image') {
        const img = mapManager.getImage(item.img);
        if (img) {
          ctx.drawImage(img, item.x - halfW, item.y - halfH, displayWidth, displayHeight);
          if (GLOBAL_CONFIG.DEBUG_HOTSPOTS) {
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.lineWidth = 2 / sqrtZ;
            ctx.strokeRect(item.x - halfW, item.y - halfH, displayWidth, displayHeight);
          }
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDebugOverlay() {
    if (!GLOBAL_CONFIG.DEBUG_HOTSPOTS) return;
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;
    ctx.save();
    ctx.translate(canvasLogicalW / 2, canvasLogicalH / 2);
    ctx.scale(camera.z, camera.z);
    ctx.translate(-camera.x, -camera.y);

    const mapW = mapManager.currentMap?.config.mapImage.logicalW || 2858;
    const mapH = mapManager.currentMap?.config.mapImage.logicalH || 2858;
    const sqrtZ = getCachedSqrt(camera.z);

    if (GLOBAL_CONFIG.DEBUG_SHOW_GRID) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1 / camera.z;
      ctx.setLineDash([5 / camera.z, 5 / camera.z]);
      for (let i = 0; i <= 10; i++) { const x = (mapW / 10) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapH); ctx.stroke(); }
      for (let i = 0; i <= 10; i++) { const y = (mapH / 10) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapW, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    if (GLOBAL_CONFIG.DEBUG_SHOW_COORDS && state.currentWaypoints.length > 0) {
      const items = state.currentIcons[state.idx] || [];
      const wp = state.currentWaypoints[state.idx];
      if (wp) {
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          const offsetX = Math.round(item.x - wp.x);
          const offsetY = Math.round(item.y - wp.y);
          const text = `#${index}: (${offsetX}, ${offsetY})`;
          ctx.font = `${14 / sqrtZ}px monospace`;
          ctx.textAlign = 'center';
          const metrics = ctx.measureText(text);
          const textW = metrics.width;
          const textH = 16 / sqrtZ;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.fillRect( item.x - textW / 2 - 4, item.y - textH - 8, textW + 8, textH + 4 );
          ctx.fillStyle = '#FFD700';
          ctx.fillText(text, item.x, item.y - 8);
        }
      }
    }

    if (GLOBAL_CONFIG.DEBUG_SHOW_WAYPOINT_LABELS) {
      for (let i = 0; i < state.currentWaypoints.length; i++) {
        const wp = state.currentWaypoints[i];
        ctx.font = `bold ${16 / sqrtZ}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = i === state.idx ? '#000' : '#fff';
        ctx.fillText(i, wp.x, wp.y);
        const coordText = `(${Math.round(wp.x)}, ${Math.round(wp.y)})`;
        ctx.font = `${12 / sqrtZ}px monospace`;
        ctx.fillStyle = '#1BC6EB';
        ctx.fillText(coordText, wp.x, wp.y + 20 / sqrtZ);
      }
    }

    // HUD de Waypoint
    if (GLOBAL_CONFIG.DEBUG_SHOW_WAYPOINT_HUD && state.currentWaypoints && state.currentWaypoints.length) {
      const device = mapManager.isMobile ? 'mobile' : 'desktop';
      const mapId  = mapManager.currentMapId;
      const cfg    = MAPS_CONFIG[mapId];
      const pad   = 10 / sqrtZ;
      const r     = 10 / sqrtZ;
      const lineH = 18 / sqrtZ;
      const boxW  = 260 / sqrtZ;
      const boxH  = 86  / sqrtZ;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `${14 / sqrtZ}px monospace`;

      for (let i = 0; i < state.currentWaypoints.length; i++) {
        const wp = state.currentWaypoints[i];
        const zCfg = cfg?.waypoints?.[i]?.[device]?.z;
        const zVal = (zCfg !== undefined ? zCfg : (wp.z ?? 1));
        const mapW = mapManager.currentMap?.config.mapImage.logicalW || 2858;
        const mapH = mapManager.currentMap?.config.mapImage.logicalH || 2858;
        const xp = (wp.x / mapW);
        const yp = (wp.y / mapH);
        let bx = wp.x + 16 / sqrtZ;
        let by = wp.y - (boxH + 16 / sqrtZ);
        if (bx + boxW > mapW) bx = mapW - boxW - 8 / sqrtZ;
        if (by < 0)          by = wp.y + 16 / sqrtZ;

        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + boxW, by,          bx + boxW, by + boxH, r);
        ctx.arcTo(bx + boxW, by + boxH,   bx,        by + boxH, r);
        ctx.arcTo(bx,        by + boxH,   bx,        by,        r);
        ctx.arcTo(bx,        by,          bx + boxW, by,        r);
        ctx.closePath();
        ctx.fillStyle   = 'rgba(0,0,0,0.75)';
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth   = 1 / sqrtZ;
        ctx.fill(); ctx.stroke();
        let xText = bx + pad, yText = by + pad;
        ctx.fillStyle = '#B7FBFF';
        ctx.font = `bold ${14 / sqrtZ}px monospace`;
        ctx.fillText(`📍 Waypoint #${i} (${device})`, xText, yText);
        ctx.font = `${14 / sqrtZ}px monospace`;
        ctx.fillStyle = '#9FF1FF';
        yText += lineH; ctx.fillText(`abs: x:${Math.round(wp.x)} y:${Math.round(wp.y)} z:${zVal}`, xText, yText);
        yText += lineH; ctx.fillText(`norm: xp:${xp.toFixed(4)} yp:${yp.toFixed(4)}`, xText, yText);
      }
    }
    ctx.restore();
  }

  function drawDialog() {
    if (!GLOBAL_CONFIG.SHOW_DIALOGS) return;
    if (!state.currentWaypoints.length) return;
    const wp = state.currentWaypoints[state.idx];
    const textFull = (wp.lines && wp.lines[state.lineIndex]) || '';
    const text = state.typing ? state.typedText : textFull;

    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;
    const isMobile = isMobileViewport();
    const dialogX = isMobile ? 0 : DIALOG_BOX.x;
    const dialogW = isMobile ? canvasLogicalW : DIALOG_BOX.w;
    const dialogH = isMobile ? 160 : DIALOG_BOX.h;
    const dialogY = canvasLogicalH - dialogH - (isMobile ? 10 : 0);

    ctx.save();
    ctx.fillStyle = DIALOG_BOX.bg;
    ctx.strokeStyle = DIALOG_BOX.border;
    roundRect(dialogX, dialogY, dialogW, dialogH, isMobile ? 0 : DIALOG_BOX.radius);
    ctx.fill();
    if (!isMobile) ctx.stroke();

    const nameSize = isMobile ? 18 : DIALOG_BOX.nameSize;
    const textSize = isMobile ? 14 : DIALOG_BOX.textSize;
    const lineHeight = isMobile ? 22 : DIALOG_BOX.lineHeight;
    const padding = isMobile ? 12 : DIALOG_BOX.padding;

    ctx.font = `600 ${nameSize}px ${DIALOG_BOX.fontStack}`;
    ctx.fillStyle = DIALOG_BOX.nameColor;
    ctx.fillText(wp.label || 'Punto', dialogX + padding, dialogY + padding + nameSize);

    ctx.font = `400 ${textSize}px ${DIALOG_BOX.fontStack}`;
    ctx.fillStyle = DIALOG_BOX.textColor;
    const maxW = dialogW - padding * 2;
    const startY = dialogY + padding + nameSize + 8 + lineHeight;
    const lines = wrapLines(text, maxW, textSize);
    let y = startY;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      ctx.fillText(ln, dialogX + padding, y);
      y += lineHeight;
      if (y > dialogY + dialogH - padding) break;
    }
    ctx.restore();
  }

  function drawMinimap() {
    // 👇 minimapa desactivado en mobile para ahorrar CPU/GPU
    if (window.innerWidth < 600) return;

    if (!state.mapImages || !mapManager.currentMap) return;
    if (!mmCtx) return; // minimap canvas or 2D context not available
    const mapConfig = mapManager.currentMap.config.mapImage;
    const mmW = minimap.width, mmH = minimap.height;
    mmCtx.clearRect(0, 0, mmW, mmH);
    const mapImg = state.mapImages.highRes || state.mapImages.lowRes;
    if (!mapImg) return;

    const rMap = mapImg.naturalWidth / mapImg.naturalHeight;
    const rMM = mmW / mmH;
    let dw, dh, dx, dy;
    if (rMap > rMM) { dw = mmW; dh = dw / rMap; dx = 0; dy = (mmH - dh) / 2; }
    else { dh = mmH; dw = dh * rMap; dy = 0; dx = (mmW - dw) / 2; }
    mmCtx.drawImage(mapImg, dx, dy, dw, dh);

    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;

    const scaleX = dw / mapConfig.logicalW;
    const scaleY = dh / mapConfig.logicalH;
    const viewW_map = canvasLogicalW / camera.z;
    const viewH_map = canvasLogicalH / camera.z;
    const vx_map = camera.x - viewW_map / 2;
    const vy_map = camera.y - viewH_map / 2;
    const vx = dx + vx_map * scaleX;
    const vy = dy + vy_map * scaleY;
    const vw = viewW_map * scaleX;
    const vh = viewH_map * scaleY;

    mmCtx.strokeStyle = '#00d1ff';
    mmCtx.lineWidth = 2;
    mmCtx.strokeRect(vx, vy, vw, vh);
  }

  function draw() {
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;

    // --- Overlay DOM (por frame) ---
    // Note: beginFrame() is called once at the start of the render loop

    // Render hotspots from window.hotspotData for editor sync
    if (window.hotspotData && window.hotspotData.length > 0) {
      window.hotspotData.forEach((hotspot, index) => {
        if (!hotspot || !hotspot.coords) return;
        const coords = hotspot.coords;

        // 1) Always start from normalized coordinates (xp, yp, wp, hp).
        //    If only fixed sizes (px) are provided, convert them to normalized in this frame.
        const mapImgCfg = mapManager.currentMap?.config?.mapImage;
        if (!mapImgCfg) return;
        const { logicalW, logicalH } = mapImgCfg;

        const dpr = Math.min(GLOBAL_CONFIG.DPR_MAX, window.devicePixelRatio || 1);
        const canvasLogicalW = canvas.width / dpr;
        const canvasLogicalH = canvas.height / dpr;

        // CSS pixels → world units per axis with zoom
        const worldPerCssX = logicalW / (canvasLogicalW / camera.z);
        const worldPerCssY = logicalH / (canvasLogicalH / camera.z);

        let xp = coords.xp;
        let yp = coords.yp;
        let wp = coords.wp;
        let hp = coords.hp;

        // If fixed sizes in px are provided, convert them to normalized for this frame
        if ((!wp || !hp) && (coords.width || coords.height)) {
          if (!wp && coords.width)  wp = (coords.width  * worldPerCssX) / logicalW;
          if (!hp && coords.height) hp = (coords.height * worldPerCssY) / logicalH;
        }

        // Safety fallback
        if (!Number.isFinite(xp) || !Number.isFinite(yp)) return;
        if (!Number.isFinite(wp) || !Number.isFinite(hp)) { wp = 0.05; hp = 0.05; } // reasonable minimum size

        // 2) Convert normalized → world space (single source of truth)
        const wx = xp * logicalW;
        const wy = yp * logicalH;
        const ww = wp * logicalW;
        const wh = hp * logicalH;

        // Culling with world dimensions
        const viewW = canvasLogicalW / camera.z;
        const viewH = canvasLogicalH / camera.z;
        const viewX = camera.x - viewW/2;
        const viewY = camera.y - viewH/2;
        
        const halfWorldW = ww / 2;
        const halfWorldH = wh / 2;
        
        if (wx + halfWorldW < viewX || 
            wx - halfWorldW > viewX + viewW || 
            wy + halfWorldH < viewY || 
            wy - halfWorldH > viewY + viewH) {
          return; // Skip off-screen hotspots
        }

        // Calculate screen size based on current zoom
        const screenWidth = ww * camera.z;
        const screenHeight = wh * camera.z;
        
        // Apply minimum touch target size if needed
        const minTapSize = mapManager.isMobile ? 56 : 48;
        
        // Use the larger of calculated size and minimum touch target
        const finalWidth = Math.max(screenWidth, minTapSize);
        const finalHeight = Math.max(screenHeight, minTapSize);
        
        // Selection state (for editor)
        const isActive = appConfig.editorActive && editor?.selectedItem?.index === index;
        
        // 3) Always deliver world space to overlay (center anchor)
        overlay.upsert({
          key: `hotspot_${index}`,
          src: hotspot.src || '/default-icon.png',
          worldX: wx,  // Center in world coordinates
          worldY: wy,
          rotationDeg: coords.rotate || 0,
          lockWidthPx: finalWidth,  // Responds to camera zoom
          z: hotspot.z || 2,
          meta: {
            shape: hotspot.shape || 'rect',
            compact: !mapManager.isMobile,
            hitSlop: 6,
            minTap: minTapSize,
            visualH: finalHeight,  // Maintains correct aspect ratio
            title: hotspot.title || `Hotspot ${index}`,
            hotspot: hotspot,
            isHotspot: true,
            hotspotIndex: index
          }
        });
      });
    }
    
    // Render regular waypoint icons
    const iconsForWaypoint = state.currentIcons[state.idx] || [];
    iconsForWaypoint.forEach((icon, i) => {
      // Skip if this is a hotspot (already handled)
      if (icon.isHotspot) return;
      
      // 🎯 Reglas de UX para shapes:
      const isRoundByType = ['pin', 'marker', 'bubble', 'diana', 'dot'].includes(icon.type);
      const isRoundByKind = ['pin', 'circle'].includes(icon.kind);
      const shouldBeRound = isRoundByType || isRoundByKind || icon.shape === 'circle';

      // 📏 Tamaños mínimos táctiles
      const isCard = icon.type === 'card' || icon.type === 'label' || icon.type === 'pill';
      const baseSize = icon.width || (GLOBAL_CONFIG.ICON_SIZE || 36);
      const minTapSize = isCard ? 48 : 56; // cards pueden ser algo más pequeñas

      overlay.upsert({
        key: `waypoint_${state.idx}:${i}`,
        src: icon.img,
        worldX: icon.x,
        worldY: icon.y,
        rotationDeg: icon.rotation || 0,
        lockWidthPx: Math.max(baseSize, minTapSize),
        z: icon.z || 2,
        meta: {
          // 🔑 Auto-detección inteligente de forma
          shape: icon.shape || (shouldBeRound ? 'circle' : 'rect'),
          
          // 🎯 Control preciso del hitbox
          compact: icon.compact ?? (!mapManager.isMobile && !isCard), // compacto en desktop excepto cards
          
          // 🧤 Margen extra según tipo
          hitSlop: icon.hitSlop ?? (shouldBeRound ? 8 : 6),
          
          // 📏 Mínimo táctil según contexto (solo si no es compacto)
          minTap: icon.minTap ?? minTapSize,
          
          // 📐 Alto visual independiente
          visualH: isCard ? (icon.height || baseSize) : icon.height,

          // Metadata para popups
          title: icon.title,
          hotspot: icon.hotspotData
        }
      });
    });

    // Dibuja el mapa y elementos
    ctx.fillStyle = RENDER_CONSTANTS.BLACK_BG;
    ctx.fillRect(0, 0, canvasLogicalW, canvasLogicalH);
    drawMapAndMarkers();
    drawHotspotsOnCanvas();
    drawDebugOverlay();
    drawDialog();
    drawMinimap();
    
    // Eventos del editor si está activo
    if (appConfig.editorActive) window.dispatchEvent(new CustomEvent('editor:redraw'));
  }

  function typeNext(delta) {
    if (!state.currentWaypoints.length || !state.typing) return;
    const wp = state.currentWaypoints[state.idx];
    const full = (wp.lines && wp.lines[state.lineIndex]) || '';
    state.lastTick += delta;
    let hasTyped = false;
    while (state.lastTick >= TYPE_SPEED && state.typing) {
      state.lastTick -= TYPE_SPEED;
      const nextChar = full[state.typedText.length];
      if (nextChar !== undefined) { state.typedText += nextChar; srLive.textContent = state.typedText; hasTyped = true; }
      else { state.typing = false; }
    }
    if (hasTyped) markDirty('dialog');
  }
  function startTyping(){ state.typing = true; state.typedText = ''; state.lastTick = 0; srLive.textContent = ''; markDirty('dialog'); }

  function showFullLineOrNext() {
    if (!state.currentWaypoints.length) return;
    const wp = state.currentWaypoints[state.idx];
    if (!GLOBAL_CONFIG.SHOW_DIALOGS) {
      if (state.idx < state.currentWaypoints.length - 1) { goToWaypoint(state.idx + 1); }
      else { goToWaypoint(0); }
      return;
    }
    const full = (wp.lines && wp.lines[state.lineIndex]) || '';
    if (state.typing) { state.typing = false; state.typedText = full; srLive.textContent = full; markDirty('dialog'); return; }
    if (state.lineIndex < (wp.lines ? wp.lines.length - 1 : -1)) { state.lineIndex++; startTyping(); return; }
    if (state.idx < state.currentWaypoints.length - 1) { goToWaypoint(state.idx + 1); } else { goToWaypoint(0); }
  }
  function prev() {
    if (!state.currentWaypoints.length) return;
    if (!GLOBAL_CONFIG.SHOW_DIALOGS) { if (state.idx > 0) goToWaypoint(state.idx - 1); return; }
    if (state.typing) {
      state.typing = false;
      const full = (state.currentWaypoints[state.idx].lines || [''])[state.lineIndex] || '';
      state.typedText = full; srLive.textContent = full; markDirty('dialog'); return;
    }
    if (state.lineIndex > 0) { state.lineIndex--; startTyping(); }
    else if (state.idx > 0) { goToWaypoint(state.idx - 1); }
  }


  const popup = document.getElementById('popup');
  const popupBackdrop = document.getElementById('popup-backdrop');
  const popupTitle = document.getElementById('popup-title');
  const popupBody = document.getElementById('popup-body');
  const popupClose = document.getElementById('popup-close');

  function openPopup(hotspot) { if (popupManager) popupManager.openPopup(hotspot); }
  function closePopup() { if (popupManager) popupManager.closeAll(); }

  document.querySelector('.btn.next').addEventListener('click', showFullLineOrNext);
  document.querySelector('.btn.prev').addEventListener('click', prev);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popup.hidden) { closePopup(); return; }
    if (['ArrowRight', 'Enter', ' '].includes(e.key)) { e.preventDefault(); showFullLineOrNext(); }
    if (['ArrowLeft', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
  });

  canvas.addEventListener('mousedown', (e) => {
  if (appConfig.editorActive) {
    console.log('🎨 Editor activo - evento bloqueado');
    return;
  }

  // Solo botón izquierdo (evita rarezas con click derecho o rueda)
  if (e.button !== 0) return;

  const { x, y } = clientToMapCoords(e.clientX, e.clientY);

  // 1) Primero: probar iconos / hotspots
  const items = state.currentIcons[state.idx] || [];
  for (const item of items) {
    const type = item.type || 'icon';
    const width = item.width || ICON_SIZE;
    const height = item.height || ICON_SIZE;
    const sqrtZ = getCachedSqrt(camera.z);
    const displayWidth = width / sqrtZ;
    const displayHeight = height / sqrtZ;
    let isHit = false;

    if (type === 'icon') {
      const dx = x - item.x;
      const dy = y - item.y;
      const clickRadius = ICON_R;
      isHit = (dx * dx + dy * dy) <= (clickRadius * clickRadius);
    } else if (type === 'hotspot' || type === 'image') {
      const halfW = displayWidth * 0.5;
      const halfH = displayHeight * 0.5;
      isHit = (
        x >= item.x - halfW && x <= item.x + halfW &&
        y >= item.y - halfH && y <= item.y + halfH
      );
    }

    if (isHit) {
      openPopup(item);
      return;
    }
  }

  // 2) Luego: probar click directo sobre waypoint
  for (let i = 0; i < state.currentWaypoints.length; i++) {
    const wp = state.currentWaypoints[i];
    const dx = x - wp.x;
    const dy = y - wp.y;
    if (dx * dx + dy * dy <= MARKER_R * MARKER_R) {
      goToWaypoint(i);
      return;
    }
  }

  // 3) Si no le diste a nada, usamos la posición horizontal del click
  const rect = canvas.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width; // 0 = borde izq, 1 = borde der

  if (relX < 0.33) {
    // tercio izquierdo = retroceder
    prev();
  } else if (relX > 0.66) {
    // tercio derecho = avanzar
    showFullLineOrNext();
  } else {
    // zona central: mantengo el comportamiento actual de "avanzar"
    // si quieres que no haga nada, cambia esta línea por "return;"
    showFullLineOrNext();
  }
});


  function clientToMapCoords(cx, cy) {
    if (!mapManager.currentMap) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const canvasLogicalW = canvas.width / dpr;
    const canvasLogicalH = canvas.height / dpr;
    const px = (cx - rect.left) / rect.width * canvasLogicalW;
    const py = (cy - rect.top) / rect.height * canvasLogicalH;
    const mx = (px - canvasLogicalW/2) / camera.z + camera.x;
    const my = (py - canvasLogicalH/2) / camera.z + camera.y;
    return { x: mx, y: my };
  }

  // ========= 🆕 CONTROL DE LLENADO DESDE CÓDIGO =========
  const rootEl  = document.documentElement;
  const bodyEl  = document.body;
  const shellEl = document.querySelector('.novela');

  function applyFillScale(fill) {
    rootEl.style.setProperty('--fill-scale', fill);
    // Si es menos de 100% puedes querer bordes redondeados (ya no en full-bleed)
    // Si es mayor a 100%, bloqueamos scroll de ser necesario
    bodyEl.classList.toggle('overflow-lock', fill > 1);
    bodyEl.style.background = '#000';
    // Forzamos que el contenedor use el modo full-bleed
    shellEl?.classList.add('full-bleed');
    // Recalcular canvas al cambiar tamaño
    setCanvasDPR();
    markDirty('camera','elements','minimap','dialog');
  }

  window.LayoutFill = {
    set(percent) {
      const fill = Math.max(0.8, Math.min(1.2, percent / 100)); // clamp de seguridad
      applyFillScale(fill);
    },
    get() {
      const v = getComputedStyle(rootEl).getPropertyValue('--fill-scale').trim();
      return Math.round(parseFloat(v) * 1000) / 10; // ej: 98.0
    }
  };

  // ========= 🎛️ FUNCIÓN COMPLETA DE CANVAS DPR (ajustada) =========
  function setCanvasDPR() {
    if (!mapManager.currentMap) return;

    const mapConfig = mapManager.currentMap.config.mapImage;
    const isMobile = mapManager.isMobile;
    const isFullBleed = shellEl?.classList.contains('full-bleed');
    
    // 1. Obtener el canvas y su contenedor
    const canvas = document.getElementById('mapa-canvas');
    const wrapper = document.getElementById('mapa-canvas-wrapper');
    if (!canvas || !wrapper) return;
    
    // 2. Obtener dimensiones del contenedor
    const rect = wrapper.getBoundingClientRect();
    let canvasW = Math.round(rect.width);
    let canvasH = Math.max(Math.round(rect.height), CANVAS_MIN_HEIGHT);

    // 2.1 Aplicar fill scale basado en la relación de aspecto
    const bucket = aspectBucket(canvasW, canvasH);
    let fill = 1.00;
    switch (bucket) {
      case 'ultra-alto': fill = 1.02; break;
      case 'alto':       fill = 1.00; break;
      case 'medio':      fill = 0.99; break;
      case 'ancho':      fill = 0.98; break;
    }
    applyFillScale(fill); // Ajusta el alto visible sin deformar el bitmap

    // 3. Canvas siempre full wrapper: el recorte lo controla la cámara/waypoints
    let displayW = canvasW;
    let displayH = canvasH;
 
    // 4. Validar dimensiones
    const validation = validateCanvasDimensions(displayW, displayH, isMobile);
    if (validation.adjusted) {
      displayW = validation.width;
      displayH = validation.height;
    }

    // 5. Calcular DPR y dimensiones físicas
    const dpr = Math.min(GLOBAL_CONFIG.DPR_MAX, window.devicePixelRatio || 1);
    const finalW = Math.round(displayW * dpr);
    const finalH = Math.round(displayH * dpr);
    
    // 6. Actualizar tamaño físico del canvas (device pixels)
    if (canvas.width !== finalW || canvas.height !== finalH) {
      canvas.width = finalW;
      canvas.height = finalH;
    }
    
    // 7. Aplicar estilos CSS (tamaño lógico)
    if (canvas.style.width !== `${displayW}px` || canvas.style.height !== `${displayH}px`) {
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
    }
    
    // 8. Configurar transformación del contexto
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    
    // 9. Resetear estilos de transformación si existen
    if (canvas.style.transform) {
      canvas.style.transform = '';
    }

    // 10. Actualizar viewport de la cámara con las dimensiones lógicas
    if (window.cameraInstance) {
      // Solo actualizamos el tamaño del viewport;
      // NO tocamos x, y, z de la cámara aquí para no romper los waypoints.
      window.cameraInstance.setViewport(displayW, displayH);
    }
    
    // 11. Ahora que el canvas está configurado, actualizar el overlay
    // con las dimensiones lógicas finales
    if (typeof overlay?.resize === 'function') {
      overlay.resize(displayW, displayH);
    }
    
    // 12. Actualizar dimensiones del cuadro de diálogo
    if (DIALOG_BOX) {
      DIALOG_BOX.w = displayW - 32; // Usar displayW en lugar de canvas.width/dpr
    }

    // 13. Forzar redibujado
    markDirty('camera', 'elements', 'dialog', 'minimap');

    // Log de depuración si está habilitado
    if (GLOBAL_CONFIG.PERFORMANCE?.logPerformanceStats) {
      console.log('🖼️ Canvas configurado:', {
        logical: `${displayW}×${displayH}`,
        physical: `${finalW}×${finalH}`,
        dpr: dpr,
        pixels: (finalW * finalH).toLocaleString(),
        memory: validation?.estimatedMemoryMB ? `~${validation.estimatedMemoryMB.toFixed(2)}MB` : 'N/A',
        adjusted: validation?.adjusted || false,
        device: isMobile ? 'mobile' : (isFullBleed ? 'desktop/full-bleed' : 'desktop/card'),
        overlaySize: overlay ? 'updated' : 'no-overlay'
      });
    }
  }

  // ========= ASPECT RATIO UTILITIES =========
  function aspectBucket(vw, vh) {
    const a = vw / Math.max(1, vh);
    if (a <= 0.55) return 'ultra-alto';
    if (a <= 0.65) return 'alto';
    if (a <= 0.75) return 'medio';
    return 'ancho';
  }

  function applyFillScale(fill = 1.00) {
    document.documentElement.style.setProperty('--fill-scale', String(fill));
  }

  // ========= RESIZE HANDLERS =========
  let resizeTO; let lastResize = 0;
  const RESIZE_THROTTLE = 16; // ~60fps
  const RESIZE_DEBOUNCE = 150;

  function handleResize() {
    const now = performance.now();
    
    // Actualizar modo del dispositivo (mobile/desktop)
    const isMobile = isMobileViewport();
    if (overlay?.setDevice) {
      overlay.setDevice(isMobile ? 'mobile' : 'desktop');
    }
    
    if (now - lastResize < RESIZE_THROTTLE) {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(() => { 
        if (window.cameraInstance) {
          window.cameraInstance.dirty = true;
        }
        setCanvasDPR();
        lastResize = performance.now(); 
      }, RESIZE_DEBOUNCE);
      return;
    }
    
    resizeTO = setTimeout(() => { 
      if (window.cameraInstance) {
        window.cameraInstance.dirty = true;
      }
      setCanvasDPR();
      lastResize = performance.now(); 
    }, RESIZE_DEBOUNCE);
  }

  window.addEventListener('resize', handleResize, { passive: true });

  try {
    if ('ResizeObserver' in window && wrap) {
      const ro = new ResizeObserver(() => {
        markDirty('camera','elements','minimap');
        const now = performance.now();
        if (now - lastResize > RESIZE_THROTTLE) { 
          setCanvasDPR();
          lastResize = now; 
        }
      });
      ro.observe(wrap);
    }
  } catch (err) { console.debug('ResizeObserver no disponible', err); }

  // Visual Viewport handling for mobile browsers (keyboard show/hide, etc.)
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', () => {
      // Use requestAnimationFrame to ensure this runs in the next frame
      requestAnimationFrame(() => {
        const now = performance.now();
        if (now - lastResize > RESIZE_THROTTLE) {
          setCanvasDPR();
          markDirty('camera', 'elements', 'minimap');
          lastResize = now;
        }
      });
    }, { passive: true });
  }

  // Handle device orientation changes with a small delay
  window.addEventListener('orientationchange', () => {
    // Small delay to ensure the viewport has updated
    setTimeout(() => {
      setCanvasDPR();
      markDirty('camera', 'elements', 'minimap');
    }, 200);
  }, { passive: true });

  let rafId, running = true;
  function loop(ts) {
    if (!loop.prev) loop.prev = ts;
    const delta = ts - loop.prev; loop.prev = ts;
    if (GLOBAL_CONFIG.CAMERA_EFFECTS.transitionEnabled) updateTransition(ts);
    
    // Update overlay at the start of each frame
    overlay.beginFrame();

    let breathOffsetY = 0, breathOffsetZ = 0;
    const effects = GLOBAL_CONFIG.CAMERA_EFFECTS;
    const isMobile = isMobileViewport();

    const breathingAllowed =
      effects.breathingEnabled &&
      (!isMobile || effects.breathingMobileEnabled !== false) &&
      !appConfig.editorActive &&
      (!effects.disableBreathingDuringTransition || !transitionState.active);

    if (breathingAllowed) {
      const breathCfg =
        isMobile && effects.breathingMobile
          ? effects.breathingMobile
          : {
              amount: effects.breathingAmount,
              speed: effects.breathingSpeed,
              zAmount: effects.breathingZAmount
            };

      const speed = breathCfg.speed ?? effects.breathingSpeed;
      const amount = breathCfg.amount ?? effects.breathingAmount;
      const zAmount = breathCfg.zAmount ?? effects.breathingZAmount;

      const breath = Math.sin(ts * speed);
      breathOffsetY = breath * amount;
      breathOffsetZ = breath * zAmount;

      if (Math.abs(breathOffsetY) > 0.1 || Math.abs(breathOffsetZ) > 0.0001) {
        markDirty('camera');
      }
    }

    const prevCameraX = camera.x, prevCameraY = camera.y, prevCameraZ = camera.z;
  if (appConfig.editorActive) {
      camera.x = camTarget.x; camera.y = camTarget.y; camera.z = camTarget.z;
    } else {
      camera.x = lerp(camera.x, camTarget.x, EASE);
      camera.y = lerp(camera.y, camTarget.y + breathOffsetY, EASE);
      camera.z = lerp(camera.z, camTarget.z + breathOffsetZ, EASE);
    }

    const cameraDeltaX = Math.abs(camera.x - prevCameraX);
    const cameraDeltaY = Math.abs(camera.y - prevCameraY);
    const cameraDeltaZ = Math.abs(camera.z - prevCameraZ);
    if (cameraDeltaX > 0.1 || cameraDeltaY > 0.1 || cameraDeltaZ > 0.001) { dirtyFlags.cameraMoving = true; markDirty('camera','minimap'); }
    else { dirtyFlags.cameraMoving = false; }

    typeNext(delta);
    if (needsRedraw()) { 
      draw(); 
      // Finaliza overlay con cámara global y viewport LÓGICO
      if (overlay?.endFrame) {
        const dpr = Math.min(GLOBAL_CONFIG.DPR_MAX, window.devicePixelRatio || 1);
        const logicalW = (parseInt(canvas.style.width, 10)) || (canvas.width / dpr);
        const logicalH = (parseInt(canvas.style.height, 10)) || (canvas.height / dpr);
        overlay.endFrame(window.cameraInstance, logicalW, logicalH);
      }
      clearDirtyFlags(); 
    } else { 
      performanceStats.skippedFrames++; 
    }
    updatePerformanceStats(ts);
    if (running) rafId = requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; cancelAnimationFrame(rafId); }
    else { running = true; loop.prev = 0; markDirty('camera','elements','dialog','minimap'); rafId = requestAnimationFrame(loop); }
  });

  // ========= DRAWER =========
  const hamburger = document.querySelector('.hamburger');
  const drawerBackdrop = document.querySelector('.drawer-backdrop');
  const drawerClose = document.getElementById('menu-puntos').querySelector('.drawer__close');
  hamburger.addEventListener('click', () => {
    const open = hamburger.getAttribute('aria-expanded') === 'true';
    if (open) uiManager.closeDrawer(); else uiManager.openDrawer();
  });
  drawerClose.addEventListener('click', () => uiManager.closeDrawer());
  drawerBackdrop.addEventListener('click', () => uiManager.closeDrawer());

  // ========= INICIO =========
  // Initialize camera instance
  const cameraInstance = new Camera({ 
    x: 0, 
    y: 0, 
    z: 1, 
    viewportW: wrap.clientWidth, 
    viewportH: wrap.clientHeight 
  });
  window.cameraInstance = cameraInstance; // Make it globally available for debugging

  (async function start() {
    // 🆕 Activamos el modo controlado por código
    document.querySelector('.novela')?.classList.add('full-bleed');
    // Valor inicial: 100%
    window.LayoutFill.set(100);

    await mapManager.loadStory('/data/story.json');

    uiManager = new UIManager(mapManager, handlePhaseChange, handleMapChange);
    popupManager = new DetailedPopupManager();
    
    // === Editor: carga bajo demanda con ?editor=1 ===
    if (appConfig.editorActive) {
      GLOBAL_CONFIG.EDITOR_ENABLED = true;

      import('./editor.js')
        .then((mod) => {
          console.log('🎨 Editor cargado bajo demanda (?editor=1)');
          mod.initEditor({
            mapManager,
            uiManager,
            camera: cameraInstance,
            appConfig,
            rootElement: document.getElementById('editor-layer')
          });
        })
        .catch((err) => {
          console.error('[Editor] Error al cargar editor.js', err);
        });
    }

    const firstMap = mapManager.getCurrentPhaseMaps()[0];
    if (firstMap) await loadMap(firstMap.id);
    setCanvasDPR();

    performanceStats.lastFpsUpdate = performance.now();
    requestAnimationFrame(loop);
    document.body.classList.add('overlays-ready');
  })();
  

})();
  // === Boot de cobertura y resize ===
  (function bootCoverageWhenReady() {
    const start = () => {
      applyViewportCoverage();
      window.addEventListener('resize', applyViewportCoverage, { passive: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  })();

function safeMemory() {
  try {
    return (performance && performance.memory) ? performance.memory : null;
  } catch { return null; }
}

// Uso (solo log en debug)
if (appConfig.toggles.debug) {
  const mem = safeMemory();
  if (mem) log.info('Mem MB', Math.round(mem.usedJSHeapSize / 1048576));
}
