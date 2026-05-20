// config.js — Solo configuración técnica, sin datos de negocio

// PHASES y MAPS_CONFIG ya no se definen aquí.
// Los datos viven en /data/story.json y /data/maps/*.json
// y se cargan en runtime por MapManager.

export const PHASES = [];        // Se puebla desde story.json en runtime
export const MAPS_CONFIG = {};   // Se puebla desde story.json en runtime

// ========= CONFIG GLOBAL (OPTIMIZADO CON NUEVAS FUNCIONES) =========
export const GLOBAL_CONFIG = {
  // Control de visibilidad SEPARADO
  SHOW_DIALOGS: false,   // Controla los cuadros de diálogo de texto
  SHOW_CONTROLS: true,  // Controla los botones de navegación (prev/next/progress)
  
  // ========= DEBUG Y VISUALIZACIÓN =========
  // DEBUG_HOTSPOTS: true,
  
  // Estilos para iconos y hotspots
  ICON_STYLES: {
    showBackground: true,  // Fondo semi-transparente en debug (opcional)
    backgroundColor: 'rgba(0, 209, 255, 0)',  // Fondo azul claro
    borderColor: 'rgba(255, 255, 255, 1)',  // Color del marco blanco semi-transparente
    borderWidth: 5,  // Grosor del marco (aumentado a 3px para mejor visibilidad en mobile)
    debugFill: 'rgba(255,0,0,0)'  // Fondo rojo sutil para hotspots en debug
  },
  
  // Configuración de toque
  TOUCH: {
    mobileMin: 56,  // Tamaño mínimo en mobile para toque
    desktopMin: 40,  // Tamaño mínimo en desktop
    hitSlop: 4  // Margen invisible extra para clics
  },
  
  // ========= EFECTOS DE CÁMARA =========
  CAMERA_EFFECTS: {
    // Movimiento sutil constante (breathing) – DESKTOP (defaults)
    breathingEnabled: true,
    breathingAmount: 11,        // Píxeles de movimiento en Y
    breathingSpeed: 0.0011,     // Velocidad de oscilación (más bajo = más lento)
    breathingZAmount: 0.0030,   // Cambio sutil en zoom

    // 🆕 Perfil específico para mobile
    breathingMobileEnabled: true, // ponlo en false si quieres apagar breathing en mobile
    breathingMobile: {
      amount: 7,        // menos movimiento en Y para pantallas chicas
      speed: 0.0010,    // puedes bajarlo aún más si quieres más "lento"
      zAmount: 0.0020   // cambio de zoom más sutil
    },

    // Transición cinemática entre waypoints
    transitionEnabled: true,
    transitionDuration: 1100,       // Desktop
    // 🆕 Duración específica para mobile
    transitionDurationMobile: 800,  // Mobile (ajusta al gusto)
    transitionZoomOut: 0.20,        // Cuánto hacer zoom out (0.25 = -25% del zoom actual)
    transitionEasing: 'ease-in-out', // 'linear', 'ease-in', 'ease-out', 'ease-in-out'

    // 🆕 Opcional: evitar breathing durante la transición
    disableBreathingDuringTransition: true
  },
  
  // ========= 🆕 LÍMITES DE CANVAS OPTIMIZADOS =========
  CANVAS_LIMITS: {
    desktop: {
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 12_000_000,  // ~4000×3000
      maxMemoryMB: 150
    },
    mobile: {
      maxWidth: 1600,
      maxHeight: 3200,        // ✅ Soporta 4000px altura
      maxPixels: 3_000_000,   // ~2000×4000
      maxMemoryMB: 48
    },
    downscaleFactor: 0.8,
    warnThreshold: 0.85       // Alertar cuando use >85% del límite
  },
  
  // ========= 🛡️ GUARDIANES DE VIEWPORT =========
  // RANGOS DE VIEWPORT DONDE BLOQUEAMOS/RECORTAMOS PARA NO DEFORMAR
  VIEWPORT_GUARDS: {
    desktop: {
      // Si el ancho lógico cae por debajo de 1183 → forzamos contain+letterbox
      clampBelowW: 800,
      // Corte duro (overflow hidden) si baja más de 900
      hardCutBelowW: 800
    },
    mobile: {
      // Si la altura lógica baja de 606 → congelamos a 606 y recortamos
      minH: 0
    }
  },
  // Relación de aspecto base del mapa (si tu base es 1280x720, ajusta)
  BASE_ASPECT: 4240/2608,
  
  // ========= 🆕 OPTIMIZACIÓN DE WAYPOINTS =========
  WAYPOINT_RENDERING: {
    enableCulling: true,
    cullingMargin: 300,
    maxVisibleWaypoints: 20,
    useSpatialIndex: true,
    spatialIndexThreshold: 15,  // Usar index si hay >15 waypoints
    cellSize: 500                // Tamaño de celda para spatial grid
  },
  
  // ========= 🆕 GESTIÓN DE MEMORIA =========
  MEMORY_MANAGEMENT: {
    maxActivePhaseCaches: 1,          // Solo 1 fase en memoria
    autoCleanInactivePhases: true,    // Limpiar automáticamente
    unloadAfterPhaseChange: true,     // Liberar memoria al cambiar
    forceClearCache: true,            // Forzar limpieza de cache
    logMemoryUsage: false              // Log de uso de memoria
  },
  
  // ========= 🆕 OPTIMIZACIONES MOBILE =========
  MOBILE_OPTIMIZATIONS: {
    maxDPR: 1.5,                      // Limitar DPR en mobile
    disableBreathingOnLowEnd: true,   // Desactivar breathing si FPS <45
    reduceTransitionQuality: true,    // Transiciones más simples
    targetFPS: 45,                    // FPS objetivo en mobile
    aggressiveCulling: true           // Culling más agresivo
  },

  RESPONSIVE_SIZING: {
  mobile:  { lockItemWidthToScreenPx: false },  // activa ancho fijo en mobile
  desktop: { lockItemWidthToScreenPx: false }  // desktop se mantiene igual
},

  
  // ========= MODO DEBUG MEJORADO =========
  EDITOR_ENABLED: false,
  // 🔴 Debug en CANVAS (los rectángulos que quieres conservar)
  DEBUG_HOTSPOTS: true,

  // 🟥 Debug de WRAPPERS DOM (cuadros rojos enormes que quieres eliminar)
  DEBUG_OVERLAY_WRAPS: false,
  
  DRAW_HOTSPOTS_ON_CANVAS: false,     // Dibujar hotspots en canvas para referencia/editor
  SHOW_POPUP_ON_CLICK: true,
  DEBUG_SHOW_GRID: true,             // Mostrar cuadrícula de referencia cada 10%
  DEBUG_SHOW_COORDS: false,           // Mostrar coordenadas en cada área
  DEBUG_SHOW_MINIMAP_MOBILE: false,   // Mostrar minimap en mobile
  DEBUG_SHOW_WAYPOINT_LABELS: false,  // Mostrar números en waypoints
  DEBUG_SHOW_MEMORY_STATS: false,     // 🆕 Mostrar uso de memoria
  DEBUG_SHOW_WAYPOINT_HUD: false,
  
  // Estilos de iconos
  ICON_STYLES: {
    showBackground: true,
    backgroundColor: 'rgba(0, 209, 255, .18)',
    borderColor: 'rgba(255,255,255,.55)',
    borderWidth: 1.5
  },
  
  // ===== CANVAS HOTSPOTS & EDITOR =====
  DRAW_HOTSPOTS_ON_CANVAS: true,     // Dibujar hotspots en canvas para referencia/editor
  SYNC_OVERLAYS_WITH_EDITOR: false,   // Sincronización automática de overlays con el editor
  
  // Estilos para los hotspots en canvas
  CANVAS_HOTSPOT_STYLES: {
    fill: 'rgba(0, 209, 255, 0.1)',    // Color de relleno con transparencia
    stroke: 'rgba(0, 209, 255, 0.5)',  // Color del borde
    lineWidth: 1,                      // Grosor del borde
    activeFill: 'rgba(0, 209, 255, 0.2)',   // Color al estar activo
    activeStroke: 'rgba(255, 255, 255, 0.8)' // Borde al estar activo
  },
  
  WAYPOINT_OFFSET: {
    mobile: -10,
    desktop: -5
  },

  BASE_W: 1280,
  BASE_H: 720,
  TYPE_SPEED: 18,
  EASE: 0.10,
  MARKER_R: 8,
  ICON_R: 18,
  ICON_SIZE: 36,
  DPR_MAX: 1.6,
  
  MOBILE_BREAKPOINT: 800,
  CANVAS_MIN_HEIGHT: 920,
  
  DIALOG_BOX: {
    x: 16, 
    y: 720 - 220, 
    w: 1280 - 32, 
    h: 180,
    bg: 'rgba(0,0,0,0.55)', 
    border: 'rgba(255,255,255,0.18)', 
    radius: 14, 
    padding: 16,
    nameColor: '#89e0ff', 
    textColor: '#fff',
    fontStack: "'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    nameSize: 22, 
    textSize: 18, 
    lineHeight: 28
  },
  
  CAM: {
    minZ: 0.25, 
    maxZ: 3.2,
    defaultZMobile: 1.2, 
    defaultZDesktop: 0.8
  },

  PERFORMANCE: {
    spatialGridSize: 200,
    idleFPS: 30,
    useOffscreenCanvas: true,
    prefetchNextWaypoint: true,
    autoCleanOldMaps: true,
    preferWebP: true,
    logPerformanceStats: false,
    logMemoryStats: false          // 🆕 Log de memoria
  },

  ICON_TRANSITION: {
    enabled: true,
    easingIn: 'ease-out',
    easingOut: 'ease-in',
    durationIn: 400,
    durationOut: 300,
    delayBetweenIcons: 50,
    scaleFrom: 0.3,
    opacityFrom: 0
  }
};