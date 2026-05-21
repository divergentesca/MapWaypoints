// ========= GESTOR DE MAPAS (Lazy Loading & Cache + Performance Optimizations) =========
import { PHASES, MAPS_CONFIG, GLOBAL_CONFIG } from './config.js';

export class MapManager {
  constructor() {
    this.imageCache = new Map();
    this.currentPhase = PHASES[0]?.id || null;
    this.currentMapId = null;
    this.currentMap = null;
    this.currentStoryId = null;
    this.currentStoryUrl = null;
    this.preloadedMaps = new Set();
    this.isMobile = this.checkIsMobile();
    
    // ✨ OPTIMIZACIÓN 1: Detección de WebP
    this.supportsWebP = false;
    this.checkWebPSupport();
    
    // ✨ OPTIMIZACIÓN 2: Cache de imágenes renderizadas para iconos
    this.renderedCache = new Map();
    
    this.mediaQuery = window.matchMedia(`(max-width: ${GLOBAL_CONFIG.MOBILE_BREAKPOINT - 1}px)`);
    this.mediaQuery.addEventListener('change', (e) => {
      this.isMobile = e.matches;
    });
  }

  async loadStory(storyUrl = '/data/story.json') {
    const DEFAULT_STORY = '/data/story.json';
    this.currentStoryId = null;
    this.currentStoryUrl = storyUrl;
    try {
      const res = await fetch(storyUrl);

      // Si el servidor responde pero no es JSON válido (ej: devuelve HTML),
      // detectamos el problema antes de que explote en res.json()
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        if (storyUrl !== DEFAULT_STORY) {
          console.warn(`⚠️ Story "${storyUrl}" no encontrada, usando story default`);
          return this.loadStory(DEFAULT_STORY);
        }
        throw new Error(`HTTP ${res.status} cargando ${storyUrl}`);
      }

      const story = await res.json();

      PHASES.length = 0;
      story.phases.forEach((phase) => PHASES.push(phase));

      Object.keys(MAPS_CONFIG).forEach((key) => delete MAPS_CONFIG[key]);
      Object.assign(MAPS_CONFIG, story.mapsIndex);
      this.currentStoryId = story.id || null;

      if (!this.currentPhase && PHASES.length) {
        this.currentPhase = PHASES[0].id;
      }

      console.log(`✅ Story cargada: ${PHASES.length} fases, ${Object.keys(MAPS_CONFIG).length} mapas`);
    } catch (err) {
      // Si ya estamos en el default y falla, ahí sí es un error real
      if (storyUrl !== DEFAULT_STORY) {
        console.warn(`⚠️ Error cargando "${storyUrl}", usando story default`);
        return this.loadStory(DEFAULT_STORY);
      }
      console.error('❌ Error cargando story.json:', err);
      throw err;
    }
  }

  checkIsMobile() {
    return window.matchMedia(`(max-width: ${GLOBAL_CONFIG.MOBILE_BREAKPOINT - 1}px)`).matches;
  }

  // ========= ✨ OPTIMIZACIÓN: DETECCIÓN DE WEBP =========
  async checkWebPSupport() {
    if (!('createImageBitmap' in window)) {
      this.supportsWebP = false;
      return;
    }

    const webpData = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
    
    try {
      const img = new Image();
      const loadPromise = new Promise((resolve) => {
        img.onload = () => resolve(img.height === 1);
        img.onerror = () => resolve(false);
      });
      img.src = webpData;
      this.supportsWebP = await loadPromise;
      
      if (this.supportsWebP) {
        console.log('✅ WebP soportado - imágenes optimizadas disponibles');
      }
    } catch (e) {
      this.supportsWebP = false;
    }
  }

  // ========= ✨ OPTIMIZACIÓN: INTENTAR CARGAR WEBP PRIMERO =========
  getOptimizedImagePath(src) {
    // Si WebP no está soportado, devolver ruta original
    if (!this.supportsWebP) return src;
    
    // Si ya es WebP, no hacer nada
    if (src.endsWith('.webp')) return src;
    
    // Intentar reemplazar extensión por .webp
    return src.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  }

  // ========= CARGA DE IMÁGENES CON OPTIMIZACIÓN WEBP =========
  loadImage(src, preRenderSize = null) {
    return new Promise((resolve, reject) => {
      // Cache key incluye tamaño si hay pre-renderizado
      const cacheKey = preRenderSize ? `${src}_${preRenderSize}` : src;
      
      if (this.imageCache.has(cacheKey)) {
        return resolve(this.imageCache.get(cacheKey));
      }
      
      // ✨ OPTIMIZACIÓN: Intentar WebP primero
      const optimizedSrc = this.getOptimizedImagePath(src);
      const img = new Image();
      
      if (/^https?:\/\//i.test(optimizedSrc)) {
        img.crossOrigin = 'anonymous';
      }
      
      // Optimizaciones de carga existentes
      try { img.decoding = 'async'; } catch {}
      if ('loading' in HTMLImageElement.prototype) {
        try { img.loading = 'eager'; } catch {}
      }
      
      img.onload = () => { 
        this.imageCache.set(src, img);
        
        // ✨ OPTIMIZACIÓN: Pre-renderizar iconos si se especifica tamaño
        if (preRenderSize && 'OffscreenCanvas' in window) {
          try {
            const offscreen = new OffscreenCanvas(preRenderSize, preRenderSize);
            const ctx = offscreen.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, preRenderSize, preRenderSize);
            const rendered = offscreen.transferToImageBitmap();
            this.renderedCache.set(cacheKey, rendered);
            resolve(rendered);
          } catch (e) {
            // Fallback si OffscreenCanvas falla
            this.imageCache.set(cacheKey, img);
            resolve(img);
          }
        } else {
          resolve(img);
        }
      };
      
      img.onerror = (e) => {
        // ✨ OPTIMIZACIÓN: Fallback automático si WebP falla
        if (optimizedSrc !== src) {
          console.warn(`⚠️ WebP no disponible, usando formato original: ${src}`);
          
          const fallbackImg = new Image();
          if (/^https?:\/\//i.test(src)) fallbackImg.crossOrigin = 'anonymous';
          
          try { fallbackImg.decoding = 'async'; } catch {}
          if ('loading' in HTMLImageElement.prototype) {
            try { fallbackImg.loading = 'eager'; } catch {}
          }
          
          fallbackImg.onload = () => {
            this.imageCache.set(src, fallbackImg);
            resolve(fallbackImg);
          };
          
          fallbackImg.onerror = () => {
            console.warn('❌ No se pudo cargar imagen:', src);
            if (typeof window !== 'undefined' && window.showError) {
              try { window.showError('Error cargando imagen: ' + src); } catch {};
            }
            reject(new Error(`Failed to load: ${src}`));
          };
          
          fallbackImg.src = src;
        } else {
          // 🆕 NUEVO: si src ya es .webp, intentamos un JPG hermano
          const webpMatch = src.match(/^(.*)\.webp(\?.*)?$/i);
          if (webpMatch) {
            const jpgSrc = `${webpMatch[1]}.jpg${webpMatch[2] || ''}`;
            console.warn(`⚠️ WebP directo falló, probando JPG: ${jpgSrc}`);
            
            const fallbackImg = new Image();
            if (/^https?:\/\//i.test(jpgSrc)) fallbackImg.crossOrigin = 'anonymous';
            try { fallbackImg.decoding = 'async'; } catch {}
            if ('loading' in HTMLImageElement.prototype) {
              try { fallbackImg.loading = 'eager'; } catch {}
            }

            fallbackImg.onload = () => {
              // cacheamos usando la key original (src)
              this.imageCache.set(src, fallbackImg);
              resolve(fallbackImg);
            };

            fallbackImg.onerror = () => {
              console.warn('❌ Tampoco se pudo cargar fallback JPG:', jpgSrc);
              if (typeof window !== 'undefined' && window.showError) {
                try { window.showError('Error cargando imagen: ' + jpgSrc); } catch {};
              }
              reject(new Error(`Failed to load: ${jpgSrc}`));
            };

            fallbackImg.src = jpgSrc;
            return;
          }

          console.warn('❌ No se pudo cargar imagen:', src);
          if (typeof window !== 'undefined' && window.showError) {
            try { window.showError('Error cargando imagen: ' + src); } catch {};
          }
          reject(e);
        }
      };
      
      img.src = optimizedSrc;
    });
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  async loadMapImages(mapConfig) {
    const imageConfig = mapConfig.mapImage;
    
    const config = this.isMobile 
      ? imageConfig.mobile 
      : imageConfig.desktop;

    const imagePath = config?.src || config || imageConfig.desktop?.src || imageConfig.desktop;

    if (!imagePath) {
      throw new Error('No se especificó imagen para el mapa');
    }

    console.log(`🖼️ Cargando imagen ${this.isMobile ? 'mobile' : 'desktop'}:`, imagePath);

    try {
      const img = await this.loadImage(imagePath);
      
      // ⚠️ LÓGICA ORIGINAL INTACTA - NO TOCAR
      if (imageConfig.useNaturalSize) {
        mapConfig.mapImage.logicalW = img.naturalWidth;
        mapConfig.mapImage.logicalH = img.naturalHeight;
      } else {
        mapConfig.mapImage.logicalW = config.logicalW || imageConfig.logicalW || img.naturalWidth;
        mapConfig.mapImage.logicalH = config.logicalH || imageConfig.logicalH || img.naturalHeight;
      }

      console.log(`✅ Dimensiones lógicas: ${mapConfig.mapImage.logicalW}x${mapConfig.mapImage.logicalH}`);
      console.log(`   Imagen real: ${img.naturalWidth}x${img.naturalHeight}`);
      
      return { 
        lowRes: img,
        highRes: img,
        current: img
      };
      
    } catch (error) {
      console.error('❌ Error cargando imagen del mapa:', error);
      if (typeof window !== 'undefined' && window.showError) {
        try { window.showError('Error cargando el mapa. Intenta recargar.'); } catch {};
      }
      throw error;
    }
  }

  // ========= ✨ OPTIMIZACIÓN: PRECARGA DE ICONOS CON RENDER CACHE =========
  async preloadIcons(mapConfig) {
    const urls = new Set();
    const allIcons = mapConfig.icons || {};
    Object.values(allIcons).flat().forEach(ic => {
      if (ic?.img) urls.add(ic.img);
    });
    
    if (!urls.size) return;
    
    console.log(`📦 Precargando ${urls.size} iconos...`);
    
    // ✨ OPTIMIZACIÓN: Pre-renderizar iconos pequeños
    const iconSize = GLOBAL_CONFIG.ICON_SIZE || 36;
    const loadPromises = [...urls].map(url =>
      this.loadImage(url, iconSize)
        .then(() => ({ ok: true, url }))
        .catch(err => {
          console.warn(`⚠️ Error precargando icono ${url}:`, err);
          return { ok: false, url };
        })
    );

    const results = await Promise.all(loadPromises);
    if (results.some(r => r && r.ok === false)) {
      if (typeof window !== 'undefined' && window.showError) {
        try { window.showError('Error precargando iconos. Algunos iconos pueden no mostrarse.'); } catch {};
      }
    }
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  normalizeWaypoints(waypoints, mapW, mapH) {
    return waypoints.map(wp => {
      const config = this.isMobile ? wp.mobile : wp.desktop;
      
      if (!config) {
        console.warn('⚠️ Waypoint sin configuración mobile/desktop:', wp);
        return {
          ...wp,
          x: mapW / 2,
          y: mapH / 2,
          z: 1.0
        };
      }

      return {
        ...wp,
        x: (config.xp || 0.5) * mapW,
        y: (config.yp || 0.5) * mapH,
        z: config.z || 1.0,
        label: wp.label,
        lines: wp.lines
      };
    });
  }

  async _loadSplitIcons(mapId, mapConfig, waypointCount) {
    if (!mapConfig.iconsDir) {
      return mapConfig.icons || {};
    }

    const baseUrl = this.currentStoryId
      ? `/data/stories/${this.currentStoryId}/maps/${mapId}_icons`
      : `/data/maps/${mapId}_icons`;

    const fetches = Array.from({ length: waypointCount }, (_, i) =>
      fetch(`${baseUrl}/wp${i}.json`)
        .then(r => r.ok ? r.json() : [])
        .then(data => ({ index: i, data }))
        .catch(() => ({ index: i, data: [] }))
    );

    const results = await Promise.all(fetches);
    const icons = {};
    results.forEach(({ index, data }) => {
      if (data.length > 0) icons[String(index)] = data;
    });

    console.log(`📂 Icons split: ${Object.keys(icons).length}/${waypointCount} waypoints con hotspots (${mapId})`);
    return icons;
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  normalizeIcons(icons, mapW, mapH, waypoints) {
    const normalized = {};
    
    Object.entries(icons).forEach(([key, iconList]) => {
      const waypointIndex = parseInt(key);
      const waypoint = waypoints[waypointIndex];
      
      if (!waypoint) {
        console.warn('⚠️ No se encontró waypoint para iconos:', key);
        return;
      }

      normalized[key] = iconList.map(icon => {
        const config = this.isMobile ? icon.mobile : icon.desktop;
        
        if (!config) {
          console.warn('⚠️ Icono sin configuración mobile/desktop:', icon);
          return icon;
        }

        const type = icon.type || 'icon';

        const x = config.x !== undefined 
          ? config.x 
          : (waypoint.x + (config.offsetX || 0));
        
        const y = config.y !== undefined 
          ? config.y 
          : (waypoint.y + (config.offsetY || 0));

        let width, height;
        
        if (config.width !== undefined && config.height !== undefined) {
          width = config.width;
          height = config.height;
        } else if (config.size !== undefined) {
          width = config.size;
          height = config.size;
        } else {
          width = null;
          height = null;
        }

        const base = {
          ...icon,
          type,
          x,
          y,
          width,
          height,
          rotation: config.rotation || 0,
          _rawMobile: icon.mobile || {},
          _rawDesktop: icon.desktop || {}
        };

        if (type === 'hotspot') {
          base.radius = config.radius || 0;
          base.debugColor = icon.debugColor || 'rgba(255, 0, 0, 0.3)';
        }

        return base;
      });
    });
    
    return normalized;
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  /**
   * Carga un mapa por ID, con optimizaciones para mobile/desktop.
   * @param {string} mapId - ID del mapa a cargar.
   * @returns {Promise<Object>} - Configuración del mapa cargado.
   */
  async loadMap(mapId) {
    if (!MAPS_CONFIG[mapId]) {
      throw new Error(`❌ Mapa no encontrado en índice: ${mapId}`);
    }

    console.log(`🗺️ Cargando mapa: ${mapId} (${this.isMobile ? 'mobile' : 'desktop'})`);

    if (!MAPS_CONFIG[mapId].waypoints) {
      try {
        const mapUrl = this.currentStoryId
          ? `/data/stories/${this.currentStoryId}/maps/${mapId}.json`
          : `/data/maps/${mapId}.json`;
        const res = await fetch(mapUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fullData = await res.json();
        Object.assign(MAPS_CONFIG[mapId], fullData);
      } catch (err) {
        console.error(`❌ Error cargando mapa desde ${mapUrl}:`, err);
        throw err;
      }
    }

    const mapConfig = { ...MAPS_CONFIG[mapId] };

    const images = await this.loadMapImages(mapConfig);
    
    this.preloadIcons(mapConfig).catch(err => 
      console.warn('⚠️ Error precargando iconos:', err)
    );

    const W = mapConfig.mapImage.logicalW;
    const H = mapConfig.mapImage.logicalH;
    const normalizedWps = this.normalizeWaypoints(mapConfig.waypoints || [], W, H);

    const iconsData = await this._loadSplitIcons(mapId, mapConfig, normalizedWps.length);
    const normalizedIcons = this.normalizeIcons(iconsData, W, H, normalizedWps);

    this.currentMapId = mapId;
    this.currentMap = {
      config: mapConfig,
      images,
      waypoints: normalizedWps,
      icons: normalizedIcons
    };
    
    this.preloadedMaps.add(mapId);
    
    console.log(`✅ Mapa cargado: ${normalizedWps.length} waypoints`);
    
    return this.currentMap;
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  async preloadPhase(phaseId) {
    const phase = PHASES.find(p => p.id === phaseId);
    if (!phase) return;
    
    const tasks = phase.maps
      .filter(id => !this.preloadedMaps.has(id))
      .map(id => this.loadMap(id).catch(e => 
        console.warn(`⚠️ Error precargando ${id}:`, e)
      ));
    
    Promise.allSettled(tasks);
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  setPhase(phaseId) {
    const phase = PHASES.find(p => p.id === phaseId);
    if (!phase) return false;
    
    this.currentPhase = phaseId;
    
    const nextIndex = PHASES.findIndex(p => p.id === phaseId) + 1;
    if (nextIndex < PHASES.length) {
      this.preloadPhase(PHASES[nextIndex].id);
    }
    
    return true;
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  getCurrentPhaseMaps() {
    const phase = PHASES.find(p => p.id === this.currentPhase);
    if (!phase) return [];
    return phase.maps
      .filter(id => !!MAPS_CONFIG[id])           // guard: ignorar IDs sin entrada en índice
      .map(id => ({
        id,
        name: MAPS_CONFIG[id]?.name || id        // fallback: usar el id si no hay name
      }));
  }

  // ========= ✨ OPTIMIZACIÓN: GETTER CON SOPORTE PARA CACHE RENDERIZADO =========
  getImage(src, preferRendered = false) {
    if (!src) return null;
    
    // Intentar obtener versión renderizada si existe y se prefiere
    if (preferRendered) {
      const iconSize = GLOBAL_CONFIG.ICON_SIZE || 36;
      const renderedKey = `${src}_${iconSize}`;
      if (this.renderedCache.has(renderedKey)) {
        return this.renderedCache.get(renderedKey);
      }
    }
    
    // Fallback a imagen original
    return this.imageCache.get(src);
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  getCurrentPhaseColor() {
    const phase = PHASES.find(p => p.id === this.currentPhase);
    return phase?.color || '#1BC6EB';
  }

  // ========= ⚠️ MANTENER LÓGICA ORIGINAL - NO MODIFICAR =========
  getCurrentPhaseColorRgb() {
    const color = this.getCurrentPhaseColor();
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  // ========= ✨ OPTIMIZACIÓN: LIMPIAR CACHE AL RECARGAR =========
  async reloadCurrentMap() {
    if (!this.currentMapId) return null;
    
    console.log('🔄 Recargando mapa por cambio de viewport...');
    
    // ✨ Limpiar cache de renderizado al cambiar viewport
    this.renderedCache.clear();
    
    return await this.loadMap(this.currentMapId);
  }

  // ========= ✨ OPTIMIZACIÓN: GESTIÓN DE MEMORIA MEJORADA =========
  clearOldMaps(keepPhases = [this.currentPhase]) {
    const keep = new Set();
    PHASES
      .filter(p => keepPhases.includes(p.id))
      .forEach(p => p.maps.forEach(id => keep.add(id)));
    
    let cleared = 0;
    
    for (const id of this.preloadedMaps) {
      if (!keep.has(id)) {
        this.preloadedMaps.delete(id);
        cleared++;
      }
    }
    
    if (cleared > 0) {
      console.log(`🧹 Limpiados ${cleared} mapas de la memoria`);
    }
  }

  // ========= ✨ NUEVA FUNCIONALIDAD: ESTADÍSTICAS DE CACHÉ =========
  getCacheStats() {
    return {
      images: this.imageCache.size,
      rendered: this.renderedCache.size,
      maps: this.preloadedMaps.size,
      supportsWebP: this.supportsWebP,
      totalMemoryEstimate: `~${Math.round((this.imageCache.size + this.renderedCache.size) * 0.5)}MB`
    };
  }

  // ========= ✨ NUEVA FUNCIONALIDAD: LOG DE PERFORMANCE =========
  logPerformanceStats() {
    const stats = this.getCacheStats();
    console.log('📊 Estadísticas de MapManager:');
    console.table(stats);
  }
}

// --- [SAFE WRAP] Clamp + overflow sin romper tu normalizeWaypoints actual ---
(() => {
  try {
    // Evita doble parcheo en HMR
    if (typeof MapManager === 'undefined') return;
    if (MapManager.__overflowClampPatched) return;

    const origNormalize = MapManager.prototype.normalizeWaypoints;
    if (typeof origNormalize !== 'function') {
      console.warn('[MapManager] normalizeWaypoints no encontrado; skip overflow patch.');
      MapManager.__overflowClampPatched = true;
      return;
    }

    const clamp01 = v => Math.max(0, Math.min(1, v));
    const isFiniteNum = v => Number.isFinite(v);

    MapManager.prototype.normalizeWaypoints = function (waypoints, W, H) {
      // 1) Pre-clamp: clonar waypoints y ajustar xp/yp por vista SIN tocar fuente
      const isMobile = !!this.isMobile;
      const overflows = []; // guardamos overflow por índice y vista

      const adjusted = (waypoints || []).map((wp, idx) => {
        const clone = JSON.parse(JSON.stringify(wp || {}));
        const m = (clone.mobile  ||= {});
        const d = (clone.desktop ||= {});

        // Valores originales (pueden venir fuera de rango o indefinidos)
        const mox = isFiniteNum(m.xp) ? m.xp : 0.5;
        const moy = isFiniteNum(m.yp) ? m.yp : 0.5;
        const dox = isFiniteNum(d.xp) ? d.xp : 0.5;
        const doy = isFiniteNum(d.yp) ? d.yp : 0.5;

        const mcx = clamp01(mox), mcy = clamp01(moy);
        const dcx = clamp01(dox), dcy = clamp01(doy);

        // Guardar overflow normalizado (positivo si “se pasó” del borde)
        const overflowMobile  = { x: mox - mcx, y: moy - mcy };
        const overflowDesktop = { x: dox - dcx, y: doy - dcy };

        // Reemplazar solo en el clon
        m.xp = mcx; m.yp = mcy;
        d.xp = dcx; d.yp = dcy;

        overflows[idx] = { mobile: overflowMobile, desktop: overflowDesktop };

        // Log en dev si hubo ajuste
        if (overflowMobile.x || overflowMobile.y || overflowDesktop.x || overflowDesktop.y) {
          try { if (!import.meta.env.PROD) {
            console.warn(`⚠️ Waypoint ${idx}: clamp xp/yp aplicado`, { overflowMobile, overflowDesktop });
          } } catch (_) {}
        }
        return clone;
      });

      // 2) Delegar en tu normalize original (usa el clon ya clampeado)
      const out = origNormalize.call(this, adjusted, W, H);

      // 3) Anexar _overflow al resultado para la vista actual (mobile/desktop)
      if (Array.isArray(out)) {
        for (let i = 0; i < out.length; i++) {
          const ov = overflows[i] || { mobile: { x:0,y:0 }, desktop: { x:0,y:0 } };
          // Mantener estructura móvil/desktop para posible cambio de breakpoint
          out[i]._overflow = ov;
        }
      }

      return out;
    };

    MapManager.__overflowClampPatched = true;
    console.log('[MapManager] normalizeWaypoints envuelto con clamp+overflow (seguro).');
  } catch (err) {
    console.error('[MapManager] Error aplicando overflow clamp patch:', err);
  }
})();