// ========= 🎨 EDITOR VISUAL AVANZADO - FULL FEATURED =========
// Versión modular para carga bajo demanda

import { GLOBAL_CONFIG } from './config.js';

export function initEditor() {
  // Respeta el flag global
  if (!GLOBAL_CONFIG.EDITOR_ENABLED) {
    console.log('🎨 Editor desactivado (EDITOR_ENABLED = false)');
    return;
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  🎨 EDITOR PRO - ADVANCED                               ║
║  E = Toggle | Ctrl+Z = Undo | Ctrl+Y = Redo            ║
║  Ctrl+D = Duplicate | Ctrl+C = Copy | Ctrl+V = Paste   ║
║  H = Hide UI | F = Focus Item | Ctrl+S = Save Preset   ║
╚══════════════════════════════════════════════════════════╝
  `);

  const canvas = document.getElementById('mapa-canvas');
  const overlay = document.getElementById('editor-layer');
  if (!canvas || !overlay) return;

  const ctx = overlay.getContext('2d');
  if (!ctx) return;

  // ========= ESTADO EXTENDIDO =========
  const editor = {
    active: false,
    selectedItem: null,
    selectedItems: new Set(), // 🆕 Multi-select
    mode: null,
    corner: null,
    dragStart: { x: 0, y: 0 },
    itemStart: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
    camera: { x: 0, y: 0, z: 1 },
    waypoint: null,
    items: [],
    waypointIndex: 0,
    showGrid: true,
    showRulers: true,
    gridSnap: false,
    gridSize: 10,
    needsRedraw: true,
    uiCollapsed: false,
    isMobile: window.matchMedia(`(max-width: ${GLOBAL_CONFIG.MOBILE_BREAKPOINT - 1}px)`).matches,
    
    
    // Waypoint edit mode
    editWaypointMode: false,
    isDragging: false,
// 🆕 HISTORIA PARA UNDO/REDO
    history: [],
    historyIndex: -1,
    maxHistory: 50,
    
    // 🆕 CLIPBOARD
    clipboard: null,
    
    // 🆕 PRESETS
    presets: loadPresetsFromStorage()
  };

  window.__EDITOR_ACTIVE__ = false;

  // ========= 🆕 SISTEMA DE HISTORIA (UNDO/REDO) =========
  function saveState(action = 'edit') {
    if (!editor.selectedItem) return;
    
    
    // Limitar el historial a 50 acciones
    if (editor.historyIndex < editor.history.length - 1) {
      editor.history = editor.history.slice(0, editor.historyIndex + 1);
    }
    
    editor.history.push({
      action,
      items: JSON.parse(JSON.stringify(editor.items)),
      item: editor.selectedItem ? { ...editor.selectedItem.item } : null,
      itemIndex: editor.selectedItem?.index
    });
    
    editor.historyIndex = editor.history.length - 1;
    updateHistoryUI();
    
    // Sincronizar con los datos globales de hotspots si está habilitado
    if (window.GLOBAL_CONFIG?.SYNC_OVERLAYS_WITH_EDITOR && window.hotspotData) {
      const editedItem = editor.selectedItem?.item;
      if (editedItem && editedItem.index !== undefined) {
        window.hotspotData[editedItem.index] = {
          ...window.hotspotData[editedItem.index],
          coords: {
            ...window.hotspotData[editedItem.index]?.coords,
            xp: editedItem.x,
            yp: editedItem.y,
            width: editedItem.width,
            height: editedItem.height
          }
        };
        
        // Forzar actualización de la UI si es necesario
        if (window.markDirty) {
          window.markDirty('elements');
        }
      }
    }
    
    // Notificar cambios
    window.dispatchEvent(new CustomEvent('editor:change', {
      detail: { action, items: editor.items }
    }));
  }

  function undo() {
    if (editor.historyIndex <= 0) {
      console.log('⚠️ No hay más acciones para deshacer');
      return;
    }
    
    editor.historyIndex--;
    const state = editor.history[editor.historyIndex];
    
    // Restaurar estado
    if (state.waypointIndex === editor.waypointIndex) {
      const item = editor.items[state.itemIndex];
      Object.assign(item, state.item);
      
      editor.selectedItem = { item, index: state.itemIndex };
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      
      console.log('↶ Undo:', state.action);
      updateHistoryUI();
    }
  }

  function redo() {
    if (editor.historyIndex >= editor.history.length - 1) {
      console.log('⚠️ No hay más acciones para rehacer');
      return;
    }
    
    editor.historyIndex++;
    const state = editor.history[editor.historyIndex];
    
    // Aplicar estado
    if (state.waypointIndex === editor.waypointIndex) {
      const item = editor.items[state.itemIndex];
      Object.assign(item, state.item);
      
      editor.selectedItem = { item, index: state.itemIndex };
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      
      console.log('↷ Redo:', state.action);
      updateHistoryUI();
    }
  }

  function updateHistoryUI() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    
    if (undoBtn) {
      undoBtn.disabled = editor.historyIndex <= 0;
      undoBtn.style.opacity = undoBtn.disabled ? '0.3' : '1';
    }
    
    if (redoBtn) {
      redoBtn.disabled = editor.historyIndex >= editor.history.length - 1;
      redoBtn.style.opacity = redoBtn.disabled ? '0.3' : '1';
    }
  }

  // ========= 🆕 COPIAR/PEGAR =========
  function copyItem() {
    if (!editor.selectedItem) {
      console.log('⚠️ No hay item seleccionado para copiar');
      return;
    }
    
    const item = editor.items[editor.selectedItem.index];
    editor.clipboard = JSON.parse(JSON.stringify(item));
    
    console.log('📋 Item copiado:', editor.clipboard.type || 'hotspot');
    updateClipboardUI();
  }

  function pasteItem() {
    if (!editor.clipboard) {
      console.log('⚠️ Clipboard vacío');
      return;
    }
    
    // Crear nuevo item con offset
    const newItem = JSON.parse(JSON.stringify(editor.clipboard));
    newItem.x += 20;
    newItem.y += 20;
    
    editor.items.push(newItem);
    editor.selectedItem = { item: newItem, index: editor.items.length - 1 };
    
    updatePropertiesPanel();
    editor.needsRedraw = true;
    window.dispatchEvent(new CustomEvent('editor:redraw'));
    
    console.log('📌 Item pegado');
    saveState('paste');
  }

  function duplicateItem() {
    if (!editor.selectedItem) {
      console.log('⚠️ No hay item seleccionado para duplicar');
      return;
    }
    
    const item = editor.items[editor.selectedItem.index];
    const duplicate = JSON.parse(JSON.stringify(item));
    duplicate.x += 30;
    duplicate.y += 30;
    
    editor.items.push(duplicate);
    editor.selectedItem = { item: duplicate, index: editor.items.length - 1 };
    
    updatePropertiesPanel();
    editor.needsRedraw = true;
    window.dispatchEvent(new CustomEvent('editor:redraw'));
    
    console.log('🔄 Item duplicado');
    saveState('duplicate');
  }

  function updateClipboardUI() {
    const pasteBtn = document.getElementById('paste-btn');
    if (pasteBtn) {
      pasteBtn.disabled = !editor.clipboard;
      pasteBtn.style.opacity = pasteBtn.disabled ? '0.3' : '1';
    }
  }

  // ========= 🆕 SISTEMA DE PRESETS =========
  function loadPresetsFromStorage() {
    try {
      const stored = localStorage.getItem('editor-presets');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  function savePresetsToStorage() {
    try {
      localStorage.setItem('editor-presets', JSON.stringify(editor.presets));
    } catch (e) {
      console.warn('⚠️ No se pudo guardar preset:', e);
    }
  }

  function savePreset() {
    if (!editor.selectedItem) {
      console.log('⚠️ No hay item seleccionado');
      return;
    }
    
    const name = prompt('Nombre del preset:', `preset_${Date.now()}`);
    if (!name) return;
    
    const item = editor.items[editor.selectedItem.index];
    editor.presets[name] = {
      width: item.width,
      height: item.height,
      rotation: item.rotation || 0,
      type: item.type || 'hotspot'
    };
    
    savePresetsToStorage();
    updatePresetsUI();
    console.log('💾 Preset guardado:', name);
  }

  function loadPreset(name) {
    if (!editor.selectedItem || !editor.presets[name]) return;
    
    const preset = editor.presets[name];
    const item = editor.items[editor.selectedItem.index];
    
    item.width = preset.width;
    item.height = preset.height;
    item.rotation = preset.rotation;
    
    updatePropertiesPanel();
    editor.needsRedraw = true;
    window.dispatchEvent(new CustomEvent('editor:redraw'));
    
    console.log('📥 Preset aplicado:', name);
    saveState('load-preset');
  }

  function deletePreset(name) {
    if (!confirm(`¿Eliminar preset "${name}"?`)) return;
    
    delete editor.presets[name];
    savePresetsToStorage();
    updatePresetsUI();
    console.log('🗑️ Preset eliminado:', name);
  }

  function updatePresetsUI() {
    const container = document.getElementById('presets-list');
    if (!container) return;
    
    const presetNames = Object.keys(editor.presets);
    
    if (presetNames.length === 0) {
      container.innerHTML = '<div style="color:#666;font-size:10px;text-align:center;padding:8px;">No hay presets guardados</div>';
      return;
    }
    
    container.innerHTML = presetNames.map(name => {
      const p = editor.presets[name];
      return `
        <div style="display:flex;align-items:center;gap:4px;padding:4px;background:rgba(255,255,255,0.05);border-radius:4px;margin-bottom:4px;">
          <button class="preset-load-btn" data-preset="${name}" style="flex:1;padding:4px 6px;background:#00BFFF;border:none;border-radius:4px;cursor:pointer;font-size:10px;color:#000;font-weight:bold;">
            ${name}
          </button>
          <button class="preset-delete-btn" data-preset="${name}" style="padding:4px 6px;background:rgba(255,0,0,0.3);border:none;border-radius:4px;cursor:pointer;font-size:10px;color:#fff;">
            ×
          </button>
        </div>
        <div style="font-size:9px;color:#666;margin-bottom:6px;padding-left:4px;">
          ${p.width}×${p.height} | ${p.rotation}° | ${p.type}
        </div>
      `;
    }).join('');
    
    // Event listeners
    container.querySelectorAll('.preset-load-btn').forEach(btn => {
      btn.addEventListener('click', () => loadPreset(btn.dataset.preset));
    });
    
    container.querySelectorAll('.preset-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deletePreset(btn.dataset.preset));
    });
  }

  // ========= 🆕 FOCUS EN ITEM (CENTRAR CÁMARA) =========
  function focusOnItem() {
    if (!editor.selectedItem) {
      console.log('⚠️ No hay item seleccionado');
      return;
    }
    
    const item = editor.items[editor.selectedItem.index];
    
    // Disparar evento para mover cámara
    window.dispatchEvent(new CustomEvent('editor:focusItem', {
      detail: { x: item.x, y: item.y }
    }));
    
    console.log('🎯 Focus en item:', editor.selectedItem.index);
  }

  // ========= 🆕 SELECTOR DE WAYPOINTS CON LISTA ACTUALIZADA =========
  function createWaypointSelector() {
    const existingSelector = document.getElementById('waypoint-selector-panel');
    if (existingSelector) {
      existingSelector.remove();
    }

    const panel = document.createElement('div');
    panel.id = 'waypoint-selector-panel';
    panel.style.cssText = `
      position: fixed;
      ${editor.isMobile ? 'bottom: 20px; left: 50%; transform: translateX(-50%);' : 'top: 80px; left: 20px;'}
      background: rgba(0, 0, 0, 0.95);
      padding: ${editor.isMobile ? '12px' : '15px'};
      border-radius: 8px;
      border: 2px solid #FF00FF;
      z-index: 10001;
      font-family: monospace;
      color: white;
      ${editor.isMobile ? 'width: 90%; max-width: 400px;' : 'min-width: 250px;'}
      box-shadow: 0 4px 20px rgba(255, 0, 255, 0.3);
      max-height: ${editor.isMobile ? '60vh' : '80vh'};
      overflow-y: auto;
    `;

    const title = document.createElement('div');
    title.style.cssText = `
      color: #FF00FF;
      font-weight: bold;
      margin-bottom: 10px;
      font-size: ${editor.isMobile ? '14px' : '16px'};
      text-align: center;
    `;
    title.textContent = '📍 Seleccionar Waypoint';

    const list = document.createElement('div');
    list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    // 🆕 LISTAS ACTUALIZADAS DE WAYPOINTS
    const count = (window.mapManager?.currentMap?.waypoints?.length ?? 0);
    const indices = Array.from({length: count}, (_, i) => i);

    indices.forEach((index) => {
      const btn = document.createElement('button');
      const wpData = window.mapManager?.currentMap?.waypoints?.[index];
      const wpId = wpData?.id ? ` · ${wpData.id}` : '';
      const wpLabel = wpData?.label ? ` — ${wpData.label}` : '';
      btn.textContent = `#${index}${wpId}${wpLabel}`;
      btn.style.cssText = `
        background: ${editor.waypointIndex === index ? 'rgba(255, 0, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
        border: 2px solid ${editor.waypointIndex === index ? '#FF00FF' : 'rgba(255, 255, 255, 0.3)'};
        color: white;
        padding: ${editor.isMobile ? '10px' : '12px'};
        border-radius: 6px;
        cursor: pointer;
        font-family: monospace;
        font-size: ${editor.isMobile ? '13px' : '14px'};
        transition: all 0.2s;
        font-weight: ${editor.waypointIndex === index ? 'bold' : 'normal'};
      `;

      btn.onmouseover = () => {
        if (editor.waypointIndex !== index) {
          btn.style.background = 'rgba(255, 255, 255, 0.2)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.5)';
        }
      };

      btn.onmouseout = () => {
        if (editor.waypointIndex !== index) {
          btn.style.background = 'rgba(255, 255, 255, 0.1)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        }
      };

      btn.onclick = () => {
        editor.waypointIndex = index;
        
        // Disparar evento para cargar datos del waypoint
        window.dispatchEvent(new CustomEvent('editor:getWaypointData', {
          detail: { waypointIndex: index }
        }));

        window.addEventListener('editor:waypointDataResponse', function handler(ev) {
          window.removeEventListener('editor:waypointDataResponse', handler);
          const { waypoint, items, camera } = ev.detail;
          
          editor.waypoint = waypoint;
          editor.items = items;
          editor.camera = camera;
          editor.selectedItem = null;
          
          updateInfo(`Waypoint #${index} cargado<br>${items.length} items`);
          updatePropertiesPanel();
          editor.needsRedraw = true;
          window.dispatchEvent(new CustomEvent('editor:redraw'));
        }, { once: true });
        
        // Actualizar estilos de todos los botones
        list.querySelectorAll('button').forEach((b, i) => {
          b.style.background = i === index ? 'rgba(255, 0, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)';
          b.style.borderColor = i === index ? '#FF00FF' : 'rgba(255, 255, 255, 0.3)';
          b.style.fontWeight = i === index ? 'bold' : 'normal';
        });

        const btn = document.getElementById('waypoint-selector-btn');
        if (btn) {
          const wpData = window.mapManager?.currentMap?.waypoints?.[index];
          const wpId = wpData?.id ? ` · ${wpData.id}` : '';
          btn.textContent = `📍 #${index}${wpId}`;
        }

        console.log(`%c📍 Waypoint cambiado a: #${index}${(() => { const w = window.mapManager?.currentMap?.waypoints?.[index]; return w?.id ? ' · ' + w.id : ''; })()}`, 'color:#FF00FF;font-weight:bold;font-size:14px');
      };

      list.appendChild(btn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Cerrar';
    closeBtn.style.cssText = `
      width: 100%;
      padding: ${editor.isMobile ? '10px' : '12px'};
      margin-top: 10px;
      background: rgba(255, 0, 0, 0.3);
      border: 2px solid rgba(255, 0, 0, 0.5);
      color: white;
      border-radius: 6px;
      cursor: pointer;
      font-family: monospace;
      font-size: ${editor.isMobile ? '13px' : '14px'};
      font-weight: bold;
    `;

    closeBtn.onclick = () => {
      panel.remove();
    };

    panel.appendChild(title);
    panel.appendChild(list);
    panel.appendChild(closeBtn);
    document.body.appendChild(panel);
  }

  // ========= HELPERS (MANTENIDOS) =========
  const sqrt = (z) => Math.sqrt(z);
  
  function ensureSize(item, def = 36) {
    if (!Number.isFinite(item.width) || item.width <= 0) item.width = def;
    if (!Number.isFinite(item.height) || item.height <= 0) item.height = def;
  }

  function getDisplaySize(item) {
    const s = sqrt(editor.camera.z);
    return {
      width: (item.width || 36) / s,
      height: (item.height || 36) / s
    };
  }

  function snap(val, grid) {
    return Math.round(val / grid) * grid;
  }

  function getMapSize() {
    return window.mapManager?.currentMap?.config?.mapImage 
      ? { w: window.mapManager.currentMap.config.mapImage.logicalW || 2858,
          h: window.mapManager.currentMap.config.mapImage.logicalH || 1761 }
      : { w: 2858, h: 1761 };
  }

  // ========= 🎨 RENDERIZADO (MANTENIDO) =========
  function drawEditor() {
    if (!editor.active || !editor.needsRedraw) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(editor.camera.z, editor.camera.z);
    ctx.translate(-editor.camera.x, -editor.camera.y);

    if (editor.selectedItem) {
      drawHandles();
      drawInfo();
    }

    ctx.restore();
    editor.needsRedraw = false;
  }

  function drawGrid() {
    const { w, h } = getMapSize();
    const grid = editor.gridSize;
    const cam = editor.camera;

    ctx.strokeStyle = 'rgba(0, 255, 100, 0.2)';
    ctx.lineWidth = 1 / cam.z;
    ctx.setLineDash([4 / cam.z, 4 / cam.z]);

    for (let x = 0; x <= w; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let y = 0; y <= h; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  function drawRulers() {
    const item = editor.items[editor.selectedItem?.index];
    if (!item) return;

    const { h } = getMapSize();
    const cam = editor.camera;

    ctx.strokeStyle = 'rgba(255, 200, 0, 0.6)';
    ctx.lineWidth = 1.5 / cam.z;
    ctx.setLineDash([8 / cam.z, 4 / cam.z]);

    ctx.beginPath();
    ctx.moveTo(item.x, 0);
    ctx.lineTo(item.x, h);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, item.y);
    ctx.lineTo(3000, item.y);
    ctx.stroke();

    ctx.setLineDash([]);
  }

  function drawHandles() {
    const item = editor.items[editor.selectedItem.index];
    if (!item) return;

    ensureSize(item);
    const { width: dw, height: dh } = getDisplaySize(item);
    const hw = dw / 2;
    const hh = dh / 2;
    const cam = editor.camera;

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3 / cam.z;
    ctx.setLineDash([10 / cam.z, 5 / cam.z]);

    if (item.rotation) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.strokeRect(-hw, -hh, dw, dh);
      ctx.restore();
    } else {
      ctx.strokeRect(item.x - hw, item.y - hh, dw, dh);
    }
    
    ctx.setLineDash([]);

    const hs = 14 / cam.z;
    ctx.fillStyle = '#00FF00';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2 / cam.z;
    
    const corners = [
      { x: item.x - hw, y: item.y - hh },
      { x: item.x + hw, y: item.y - hh },
      { x: item.x - hw, y: item.y + hh },
      { x: item.x + hw, y: item.y + hh },
    ];
    
    corners.forEach(c => {
      ctx.fillRect(c.x - hs/2, c.y - hs/2, hs, hs);
      ctx.strokeRect(c.x - hs/2, c.y - hs/2, hs, hs);
    });

    const rotY = item.y - hh - 35 / cam.z;
    ctx.beginPath();
    ctx.arc(item.x, rotY, hs/2, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD700';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2 / cam.z;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(item.x, item.y - hh);
    ctx.lineTo(item.x, rotY);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2 / cam.z;
    ctx.setLineDash([6 / cam.z, 4 / cam.z]);
    ctx.stroke();
    ctx.setLineDash([]);

    const cs = 8 / cam.z;
    ctx.strokeStyle = '#FF00FF';
    ctx.lineWidth = 2 / cam.z;
    ctx.beginPath();
    ctx.moveTo(item.x - cs, item.y);
    ctx.lineTo(item.x + cs, item.y);
    ctx.moveTo(item.x, item.y - cs);
    ctx.lineTo(item.x, item.y + cs);
    ctx.stroke();
  }

  function drawInfo() {
    const item = editor.items[editor.selectedItem.index];
    if (!item || !editor.waypoint) return;

    const cam = editor.camera;
    const ox = Math.round(item.x - editor.waypoint.x);
    const oy = Math.round(item.y - editor.waypoint.y);
    
    const { width: dw } = getDisplaySize(item);
    const iy = item.y - dw/2 - 50 / cam.z;

    const text = `(${ox}, ${oy}) | ${Math.round(item.width)}×${Math.round(item.height)} | ${item.rotation || 0}°`;
    const fs = 14 / cam.z;
    ctx.font = `bold ${fs}px monospace`;
    const m = ctx.measureText(text);
    const pad = 8 / cam.z;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(item.x - m.width/2 - pad, iy - fs - pad, m.width + pad*2, fs + pad*2);

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2 / cam.z;
    ctx.strokeRect(item.x - m.width/2 - pad, iy - fs - pad, m.width + pad*2, fs + pad*2);

    ctx.fillStyle = '#00FF00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(text, item.x, iy - fs);
  }

  // ========= 🎨 UI AVANZADA =========
  function createUI() {
    const ui = document.createElement('div');
    ui.id = 'editor-pro-ui';
    ui.className = editor.isMobile ? 'editor-mobile' : '';
    ui.style.cssText = `
      position: fixed;
      ${editor.isMobile ? 'bottom: 10px; left: 10px; right: 10px;' : 'top: 140px; left: 20px;'}
      background: rgba(0, 0, 0, 0.95);
      color: #00FF00;
      padding: ${editor.isMobile ? '12px' : '20px'};
      border-radius: 12px;
      font-family: monospace;
      font-size: ${editor.isMobile ? '11px' : '13px'};
      z-index: 10000;
      border: 3px solid #00FF00;
      max-width: ${editor.isMobile ? 'none' : '360px'};
      max-height: ${editor.isMobile ? '60vh' : '80vh'};
      overflow-y: auto;
      transition: transform 0.3s ease;
    `;

    ui.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="font-weight: bold; font-size: ${editor.isMobile ? '14px' : '16px'}; color: #FFD700;">
          🎨 EDITOR ADVANCED
        </div>
        <button id="toggle-ui-collapse" style="
          padding: 4px 10px;
          background: #FFD700;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: 13px;
          line-height: 1;
        " title="Colapsar panel (C)">
          ${editor.uiCollapsed ? '▲' : '▼'}
        </button>
      </div>

      <div id="editor-content" style="display: ${editor.uiCollapsed ? 'none' : 'block'};">
        
        <!-- 🆕 BARRA DE ACCIONES -->
        <div style="display: grid; grid-template-columns: repeat(${editor.isMobile ? '2' : '3'}, 1fr); gap: 6px; margin-bottom: 12px;">
          <button id="undo-btn" title="Undo (Ctrl+Z)" style="padding: 6px; background: #666; border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: #fff;">
            ↶ Undo
          </button>
          <button id="redo-btn" title="Redo (Ctrl+Y)" style="padding: 6px; background: #666; border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: #fff;">
            ↷ Redo
          </button>
          <button id="duplicate-btn" title="Duplicate (Ctrl+D)" style="padding: 6px; background: #9C27B0; border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: #fff;">
            🔄 Dup
          </button>
          <button id="copy-btn" title="Copy (Ctrl+C)" style="padding: 6px; background: #2196F3; border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: #fff;">
            📋 Copy
          </button>
          <button id="paste-btn" title="Paste (Ctrl+V)" style="padding: 6px; background: #4CAF50; border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: #fff;" disabled>
            📌 Paste
          </button>
          <button id="focus-btn" title="Focus (F)" style="padding: 6px; background: #FF9800; border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: #fff;">
            🎯 Focus
          </button>
        </div>

        <!-- 🆕 SELECTOR DE WAYPOINTS CON LISTA ACTUALIZADA -->
        <div style="margin-bottom: 12px; padding: 10px; background: rgba(255, 100, 255, 0.15); border-radius: 8px; border: 1px solid #FF00FF;">
          <button id="waypoint-selector-btn" style="width: 100%; padding: 8px; background: #FF00FF; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 11px; color: #fff;">
            📍 #${editor.waypointIndex}${(() => { const wp = window.mapManager?.currentMap?.waypoints?.[editor.waypointIndex]; return wp?.id ? ' · ' + wp.id : ''; })()}
          </button>
        </div>

        <!-- CONTROLES GRID/RULERS -->
        <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
          <button id="toggle-grid" style="flex: 1; min-width: 80px; padding: 6px; background: #00FF00; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 10px;">
            GRID: ON
          </button>
          <button id="toggle-rulers" style="flex: 1; min-width: 80px; padding: 6px; background: #FFD700; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 10px;">
            RULERS: ON
          </button>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 6px; font-size: 10px; color: #FFD700;">
            Grid Size: <span id="grid-size-value">10px</span>
          </label>
          <input 
            type="range" 
            id="grid-size" 
            min="5" 
            max="50" 
            value="10" 
            step="5"
            style="width: 100%; accent-color: #00FF00;"
          />
        </div>

        <!-- WAYPOINT TOOLS -->
        <div id="wp-tools" style="padding:10px;background:rgba(0,191,255,.08);border:1px solid #00BFFF;border-radius:8px;margin-bottom:12px;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button id="toggle-wp-mode" style="padding:6px 8px;background:#00BFFF;border:none;border-radius:6px;color:#000;font-weight:700;cursor:pointer;">✥ Editar Waypoint</button>
            <label style="font-size:11px;color:#00BFFF;">X: <input id="wp-x" type="number" class="prop-input" style="width:90px;"></label>
            <label style="font-size:11px;color:#00BFFF;">Y: <input id="wp-y" type="number" class="prop-input" style="width:90px;"></label>
            <label style="font-size:11px;color:#00BFFF;">Z: <input id="wp-z" type="number" step="0.01" class="prop-input" style="width:80px;"></label>
            <button id="save-wp" style="padding:6px 8px;background:#00FF88;border:none;border-radius:6px;color:#000;font-weight:700;cursor:pointer;">💾 Guardar</button>
          </div>
          <div style="font-size:10px;color:#7fd8ff;margin-top:6px;">Arrastra en canvas cuando “Editar Waypoint” esté activo. Los valores son absolutos (px del mapa) y z es zoom.</div>
        </div>
        <!-- PROPIEDADES -->
        <div id="properties-panel" style="display: none; padding: 12px; background: rgba(0, 100, 255, 0.15); border-radius: 8px; border: 1px solid #00BFFF; margin-bottom: 12px;">
          <div style="font-size: 11px; color: #00BFFF; margin-bottom: 8px; font-weight: bold;">✏️ PROPIEDADES:</div>
          <div style="display: grid; grid-template-columns: ${editor.isMobile ? '1fr 1fr' : 'auto 1fr'}; gap: 6px; font-size: 11px;">
            <label>X:</label><input type="number" id="prop-x" class="prop-input">
            <label>Y:</label><input type="number" id="prop-y" class="prop-input">
            <label>W:</label><input type="number" id="prop-w" class="prop-input">
            <label>H:</label><input type="number" id="prop-h" class="prop-input">
            <label>Rot:</label><input type="number" id="prop-rot" class="prop-input">
          </div>
          <button id="export-json-btn" style="
            margin-top:8px; width:100%; padding:8px;
            background:#FF6B00; border:none; border-radius:6px;
            color:#fff; font-weight:bold; cursor:pointer; font-size:12px;
          ">📋 Copy JSON</button>
        </div>

        <!-- 🆕 PRESETS -->
        <div style="padding: 12px; background: rgba(255, 100, 0, 0.1); border-radius: 8px; border: 1px solid #FF6B00; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 11px; color: #FF6B00; font-weight: bold;">💾 PRESETS:</div>
            <button id="save-preset-btn" style="padding: 4px 8px; background: #FF6B00; border: none; border-radius: 4px; cursor: pointer; font-size: 10px; color: #fff;">
              Save
            </button>
          </div>
          <div id="presets-list" style="max-height: 120px; overflow-y: auto;"></div>
        </div>

        ${!editor.isMobile ? `
        <div style="padding: 10px; background: rgba(0, 255, 0, 0.1); border-radius: 8px; border: 1px solid #00FF00; margin-bottom: 12px;">
          <div style="font-size: 10px; color: #FFD700; margin-bottom: 6px;">⌨️ SHORTCUTS:</div>
          <div style="font-size: 9px; line-height: 1.6; column-count: 2; column-gap: 10px;">
            <div>E = Toggle</div>
            <div>G = Grid</div>
            <div>R = Rulers</div>
            <div>H = Hide UI</div>
            <div>F = Focus</div>
            <div>Esc = Deselect</div>
            <div>↑↓←→ = Move</div>
            <div>Shift+Arrow = 10px</div>
            <div>[ ] = Rotate</div>
            <div>- + = Resize</div>
            <div>Ctrl+Z = Undo</div>
            <div>Ctrl+Y = Redo</div>
            <div>Ctrl+D = Duplicate</div>
            <div>Ctrl+C = Copy</div>
            <div>Ctrl+V = Paste</div>
            <div>Ctrl+S = Save Preset</div>
          </div>
        </div>
        ` : ''}

        <div id="editor-info" style="padding: 10px; background: rgba(255, 215, 0, 0.15); border-radius: 8px; border: 1px solid #FFD700; font-size: ${editor.isMobile ? '10px' : '12px'}; color: #FFD700; line-height: 1.4;">
          No item selected
        </div>
      </div>
    `;

    // Estilos para inputs
    const style = document.createElement('style');
    style.textContent = `
      .prop-input {
        width: 100%;
        padding: 4px;
        background: #111;
        color: #0FF;
        border: 1px solid #00BFFF;
        border-radius: 4px;
        font-size: 11px;
      }
      .prop-input:focus {
        outline: none;
        border-color: #00FF00;
        box-shadow: 0 0 4px rgba(0, 255, 255, 0.5);
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(ui);

    // 🆕 Event Listeners para nuevas funciones
    document.getElementById('undo-btn')?.addEventListener('click', undo);
    document.getElementById('redo-btn')?.addEventListener('click', redo);
    document.getElementById('duplicate-btn')?.addEventListener('click', duplicateItem);
    document.getElementById('copy-btn')?.addEventListener('click', copyItem);
    document.getElementById('paste-btn')?.addEventListener('click', pasteItem);
    document.getElementById('focus-btn')?.addEventListener('click', focusOnItem);
    document.getElementById('save-preset-btn')?.addEventListener('click', savePreset);
    document.getElementById('export-json-btn')?.addEventListener('click', exportItemJSON);
    document.getElementById('waypoint-selector-btn')?.addEventListener('click', createWaypointSelector);

    const collapseBtn = document.getElementById('toggle-ui-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        editor.uiCollapsed = !editor.uiCollapsed;
        const content = document.getElementById('editor-content');
        const btn = document.getElementById('toggle-ui-collapse');
        
        if (editor.uiCollapsed) {
          content.style.display = 'none';
          btn.textContent = '▲';
        } else {
          content.style.display = 'block';
          btn.textContent = '▼';
        }
      });
    }

    document.getElementById('toggle-grid').addEventListener('click', () => {
      editor.showGrid = !editor.showGrid;
      const btn = document.getElementById('toggle-grid');
      btn.textContent = `GRID: ${editor.showGrid ? 'ON' : 'OFF'}`;
      btn.style.background = editor.showGrid ? '#00FF00' : '#333';
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
    });

    document.getElementById('toggle-rulers').addEventListener('click', () => {
      editor.showRulers = !editor.showRulers;
      const btn = document.getElementById('toggle-rulers');
      btn.textContent = `RULERS: ${editor.showRulers ? 'ON' : 'OFF'}`;
      btn.style.background = editor.showRulers ? '#FFD700' : '#333';
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
    });
    // 🧭 Bind Waypoint controls (outside other handlers)
    (function bindWaypointControls(){
      const btnWp = document.getElementById('toggle-wp-mode');
      const btnWpSave = document.getElementById('save-wp');
      const inX = document.getElementById('wp-x');
      const inY = document.getElementById('wp-y');
      const inZ = document.getElementById('wp-z');
      if (btnWp) {
        btnWp.addEventListener('click', () => {
          editor.editWaypointMode = !editor.editWaypointMode;
          btnWp.textContent = editor.editWaypointMode ? '✥ Editando Waypoint…' : '✥ Editar Waypoint';
          btnWp.style.background = editor.editWaypointMode ? '#FFD700' : '#00BFFF';
          if (editor.waypoint) {
            inX.value = Math.round(editor.waypoint.x);
            inY.value = Math.round(editor.waypoint.y);
            inZ.value = Number(editor.waypoint.z || 1).toFixed(2);
          }
          editor.needsRedraw = true;
          window.dispatchEvent(new CustomEvent('editor:redraw'));
        });
      }
      if (btnWpSave) {
        btnWpSave.addEventListener('click', () => {
          if (!editor.waypoint) return;
          const x = parseInt(inX.value) || editor.waypoint.x;
          const y = parseInt(inY.value) || editor.waypoint.y;
          const z = parseFloat(inZ.value) || editor.waypoint.z || 1;
          saveWaypointPosition(x, y, z);
        });
      }
    })();
;

    document.getElementById('grid-size').addEventListener('input', (e) => {
      editor.gridSize = parseInt(e.target.value);
      document.getElementById('grid-size-value').textContent = `${editor.gridSize}px`;
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
    });

    document.querySelectorAll('.prop-input').forEach(input => {
      input.addEventListener('input', () => {
        if (!editor.selectedItem) return;
        applyPropertiesFromInputs();
      });
    });

    updatePresetsUI();
    updateHistoryUI();
    updateClipboardUI();

    return ui;
  }

  function updateInfo(html) {
    const el = document.getElementById('editor-info');
    if (el) el.innerHTML = html;
  }

  function updatePropertiesPanel() {
    const panel = document.getElementById('properties-panel');
    if (!editor.selectedItem) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'block';
    const item = editor.items[editor.selectedItem.index];
    
    const ox = Math.round(item.x - editor.waypoint.x);
    const oy = Math.round(item.y - editor.waypoint.y);
    
    document.getElementById('prop-x').value = ox;
    document.getElementById('prop-y').value = oy;
    document.getElementById('prop-w').value = Math.round(item.width);
    document.getElementById('prop-h').value = Math.round(item.height);
    document.getElementById('prop-rot').value = Math.round(item.rotation || 0);
  }

  function applyPropertiesFromInputs() {
    if (!editor.selectedItem) return;
    
    const item = editor.items[editor.selectedItem.index];
    
    const ox = parseInt(document.getElementById('prop-x').value) || 0;
    const oy = parseInt(document.getElementById('prop-y').value) || 0;
    const w = parseInt(document.getElementById('prop-w').value) || 36;
    const h = parseInt(document.getElementById('prop-h').value) || 36;
    const rot = parseInt(document.getElementById('prop-rot').value) || 0;
    
    item.x = editor.waypoint.x + ox;
    item.y = editor.waypoint.y + oy;
    item.width = Math.max(10, w);
    item.height = Math.max(10, h);
    item.rotation = rot % 360;
    
    editor.needsRedraw = true;
    window.dispatchEvent(new CustomEvent('editor:redraw'));
    
    generateCode();
  }
  // ========= 🧭 GUARDAR POSICIÓN DEL WAYPOINT (persistente en config.js) =========
  function saveWaypointPosition(x, y, z = 1) {
    if (!editor.waypoint) return;
    const { w, h } = getMapSize();
    const xp = Math.max(0, Math.min(1, x / w));
    const yp = Math.max(0, Math.min(1, y / h));
    const values = { xp: Number(xp.toFixed(6)), yp: Number(yp.toFixed(6)), z: Number((z || 1).toFixed(2)) };

    // Disparar evento para que app.js escriba en MAPS_CONFIG y re-normalice
    window.dispatchEvent(new CustomEvent('editor:updateWaypoint', {
      detail: {
        waypointIndex: editor.waypointIndex,
        device: editor.isMobile ? 'mobile' : 'desktop',
        values
      }
    }));

    // Generar código del waypoint y mostrarlo en consola para copiar al JSON
    const device = editor.isMobile ? 'mobile' : 'desktop';
    window.dispatchEvent(new CustomEvent('editor:getWaypointCode', {
      detail: { waypointIndex: editor.waypointIndex, device }
    }));
    window.addEventListener('editor:itemCodeResponse', function handler(ev) {
      window.removeEventListener('editor:itemCodeResponse', handler);
      const code = typeof ev.detail.code === 'string'
        ? ev.detail.code
        : JSON.stringify(ev.detail.code, null, 2);
      console.log(
        `%c📋 Waypoint #${editor.waypointIndex} [${device}] — pega esto en el JSON:`,
        'color:#FFD700;font-size:13px;font-weight:bold'
      );
      console.log(`%c${code}`, 'color:#00FF88;font-family:monospace;font-size:12px');
      try {
        navigator.clipboard.writeText(code);
        console.log('%c✅ Copiado al clipboard', 'color:#00FF88');
      } catch {}
    }, { once: true });

    // Refrescar datos del waypoint desde el runtime
    window.dispatchEvent(new CustomEvent('editor:getWaypointData', {
      detail: { waypointIndex: editor.waypointIndex }
    }));
    window.addEventListener('editor:waypointDataResponse', function handler(ev) {
      window.removeEventListener('editor:waypointDataResponse', handler);
      const { waypoint, items, camera } = ev.detail;
      editor.waypoint = waypoint;
      editor.items = items;
      editor.camera = camera;
      editor.selectedItem = null;
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      updateInfo(`💾 Waypoint #${editor.waypointIndex} guardado — código en consola`);
    }, { once: true });
  }


  // ========= 🎮 CONTROLES =========
  function toggle() {
    editor.active = !editor.active;
    window.__EDITOR_ACTIVE__ = editor.active;

    // Notifica a app.js
    window.dispatchEvent(new CustomEvent('editor:active', {
      detail: { active: editor.active }
    }));

    if (editor.active) {
      console.log('%c🎨 EDITOR ACTIVADO', 'color:#00FF00;font-size:16px;font-weight:bold');
      canvas.style.cursor = 'crosshair';

      try {
        // UI avanzada
        createUI();
      } catch (err) {
        console.error('Editor UI error, usando fallback:', err);
        // UI mínima infalible
        const fallback = document.createElement('div');
        fallback.id = 'editor-lite';
        fallback.style.cssText = `
          position: fixed; top: 12px; left: 12px; z-index: 99999;
          background: rgba(0,0,0,.85); color: #0f0; font: 12px/1.4 monospace;
          padding: 10px 12px; border: 2px solid #0f0; border-radius: 8px;
        `;
        fallback.innerHTML = `
          <div><strong>EDITOR (fallback)</strong></div>
          <div>Presiona E para ocultar</div>
        `;
        document.body.appendChild(fallback);
      }

      // Deshabilita interacción de overlays para facilitar selección en editor
      try {
        const overlayWrappers = document.querySelectorAll('.overlay-wrap');
        overlayWrappers.forEach(el => {
          el.style.setProperty('pointer-events', 'none', 'important');
        });
      } catch {}

      // Desactiva popups mientras el editor está activo
      try { if (window.togglePopupDisplay) window.togglePopupDisplay(false); } catch {}

      editor.needsRedraw = true;
    } else {
      console.log('%c⏹️  EDITOR DESACTIVADO', 'color:#FF6B6B;font-size:16px');
      canvas.style.cursor = 'default';
      document.getElementById('editor-pro-ui')?.remove?.();
      document.getElementById('editor-lite')?.remove?.();
      editor.selectedItem = null;

      // Restaura interacción de overlays al desactivar el editor
      try {
        const overlayWrappers = document.querySelectorAll('.overlay-wrap');
        overlayWrappers.forEach(el => {
          el.style.removeProperty('pointer-events');
        });
      } catch {}

      // Reactiva popups cuando el editor está inactivo
      try { if (window.togglePopupDisplay) window.togglePopupDisplay(true); } catch {}
    }

    window.dispatchEvent(new CustomEvent('editor:redraw'));
  }

  // ========= KEYBOARD CONTROLS =========
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    // Toggle Editor
    if (e.key === 'e' || e.key === 'E') {
      toggle();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (!editor.active) return;

    // 🆕 Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      undo();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      redo();
      e.preventDefault();
      return;
    }

    // 🆕 Copy/Paste/Duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      copyItem();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      pasteItem();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      duplicateItem();
      e.preventDefault();
      return;
    }

    // 🆕 Save Preset
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      savePreset();
      e.preventDefault();
      return;
    }

    // 🆕 Focus
    if (e.key === 'f' || e.key === 'F') {
      focusOnItem();
      e.preventDefault();
      return;
    }

    // Grid/Rulers/Hide/Collapse
    if (e.key === 'g' || e.key === 'G') {
      document.getElementById('toggle-grid')?.click();
      e.preventDefault();
    }
    if (e.key === 'r' || e.key === 'R') {
      document.getElementById('toggle-rulers')?.click();
      e.preventDefault();
    }
    if (e.key === 'h' || e.key === 'H') {
      if (editor.isMobile) document.getElementById('toggle-ui-collapse')?.click();
      e.preventDefault();
    }
    if (e.key === 'c' || e.key === 'C') {
      if (!e.ctrlKey && !e.metaKey) {
        document.getElementById('toggle-ui-collapse')?.click();
        e.preventDefault();
      }
    }

    editor.gridSnap = e.shiftKey;

    // Deselect/Delete
    if (e.key === 'Escape' && editor.selectedItem) {
      editor.selectedItem = null;
      updateInfo('No item selected');
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      e.preventDefault();
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedItem) {
      console.log('🗑️ Item eliminado');
      editor.selectedItem = null;
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      e.preventDefault();
      return;
    }

    // Movement
    if (editor.selectedItem && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const item = editor.items[editor.selectedItem.index];
      const step = e.shiftKey ? 10 : 1;
      
      switch(e.key) {
        case 'ArrowUp':    item.y -= step; break;
        case 'ArrowDown':  item.y += step; break;
        case 'ArrowLeft':  item.x -= step; break;
        case 'ArrowRight': item.x += step; break;
      }
      
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      saveState('move');
      e.preventDefault();
      return;
    }

    // Rotation
    if (editor.selectedItem && (e.key === '[' || e.key === ']')) {
      const item = editor.items[editor.selectedItem.index];
      const step = e.shiftKey ? 15 : 5;
      item.rotation = (item.rotation || 0) + (e.key === '[' ? -step : step);
      item.rotation = item.rotation % 360;
      
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      saveState('rotate');
      e.preventDefault();
      return;
    }

    // Resize
    if (editor.selectedItem && (e.key === '-' || e.key === '+' || e.key === '=')) {
      const item = editor.items[editor.selectedItem.index];
      const step = e.shiftKey ? 20 : 10;
      const delta = (e.key === '-') ? -step : step;
      
      item.width = Math.max(10, item.width + delta);
      item.height = Math.max(10, item.height + delta);
      
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      saveState('resize');
      e.preventDefault();
      return;
    }

    // 🆕 Cambiar waypoint con números 0-9
    if (!e.ctrlKey && !e.metaKey && e.key >= '0' && e.key <= '9') {
      const index = parseInt(e.key);
      const maxIndex = editor.isMobile ? 5 : 7; // 6 waypoints en mobile, 8 en desktop
      if (index <= maxIndex) {
        editor.waypointIndex = index;
        
        // Disparar evento para cargar datos del waypoint
        window.dispatchEvent(new CustomEvent('editor:getWaypointData', {
          detail: { waypointIndex: index }
        }));

        window.addEventListener('editor:waypointDataResponse', function handler(ev) {
          window.removeEventListener('editor:waypointDataResponse', handler);
          const { waypoint, items, camera } = ev.detail;
          
          editor.waypoint = waypoint;
          editor.items = items;
          editor.camera = camera;
          editor.selectedItem = null;
          
          updateInfo(`Waypoint #${index} cargado<br>${items.length} items`);
          updatePropertiesPanel();
          editor.needsRedraw = true;
          window.dispatchEvent(new CustomEvent('editor:redraw'));
        }, { once: true });
        
        const btn = document.getElementById('waypoint-selector-btn');
        if (btn) {
          const wpData = window.mapManager?.currentMap?.waypoints?.[index];
          const wpId = wpData?.id ? ` · ${wpData.id}` : '';
          btn.textContent = `📍 #${index}${wpId}`;
        }
        
        const wpCurrent = window.mapManager?.currentMap?.waypoints?.[index];
        const wpIdLog = wpCurrent?.id || '';
        console.log(`%c📍 Waypoint cambiado a: #${index}${wpIdLog ? ' · ' + wpIdLog : ''}`, 'color:#FF00FF;font-weight:bold;font-size:14px');
      }
      return;
    }

  }, true);

  window.addEventListener('keyup', (e) => {
    editor.gridSnap = e.shiftKey;
  });

  // ========= SYNC & MOUSE (MANTENIDOS - resto del código igual) =========
  
  window.addEventListener('editor:mapCoordsResponse', (e) => {
    if (!editor.active) return;
    const { camera, items, waypoint, waypointIndex } = e.detail;
    editor.camera = camera;
    editor.items = items;
    editor.waypoint = waypoint;
    editor.waypointIndex = waypointIndex;
    editor.needsRedraw = true;
  });

  window.addEventListener('editor:redraw', () => {
    if (editor.active) requestAnimationFrame(drawEditor);
  });

  // Mouse handlers (igual que antes)
  if (canvas) {
    canvas.addEventListener('mousedown', handleDown, { capture: true });
    canvas.addEventListener('mousemove', handleMove, { capture: true });
    canvas.addEventListener('mouseup', handleUp, { capture: true });
    canvas.addEventListener('mouseleave', handleUp, { capture: true });
  } else {
    console.warn('Canvas not found - editor mouse listeners skipped');
  }
  window.addEventListener('mouseup', handleUp, { capture: true });

  function handleDown(e) {
    if (!editor.active) return;
    
    // 🆕 Null guards
    if (!e || !e.target) {
      console.warn('handleDown: Invalid event target');
      return;
    }
    
    
    e.stopImmediatePropagation();

    // 🆕 Detecta eventos táctiles sintetizados
    const isTouch = e?.isTouch === true || String(e.type).startsWith('touch');

    // Clear previous debug highlights if any
    if (editor.selectedItem) {
      const prevItem = editor.items[editor.selectedItem.index];
      if (prevItem && prevItem.wrap) {
        prevItem.wrap.style.outline = '';
        prevItem.wrap.style.outlineOffset = '';
      }
    }

    editor.isDragging = true;

    window.dispatchEvent(new CustomEvent('editor:getMapCoords', {
      detail: { clientX: e.clientX, clientY: e.clientY }
    }));

    window.addEventListener('editor:mapCoordsResponse', function handler(ev) {
      window.removeEventListener('editor:mapCoordsResponse', handler);

      if (!editor.isDragging) return;

      const { x, y } = ev.detail;
      const cam = editor.camera;
      const hs = 15 / cam.z;

      // ✅ WAYPOINT DRAG — hit-test prioritario cuando editWaypointMode está activo
      if (editor.editWaypointMode && editor.waypoint) {
        const wpRadius = 24 / cam.z; // radio de hit del círculo del waypoint
        if (Math.hypot(x - editor.waypoint.x, y - editor.waypoint.y) < wpRadius) {
          editor.mode = 'drag-wp';
          editor.dragStart = { x, y };
          editor.itemStart = { x: editor.waypoint.x, y: editor.waypoint.y };
          canvas.style.cursor = 'move';
          updateInfo(`<b style="color:#00BFFF;">⬡ Waypoint #${editor.waypointIndex}</b><br>Arrastrando... suelta para guardar`);
          return;
        }
      }

      if (editor.selectedItem) {
        const item = editor.items[editor.selectedItem.index];
        if (item) {
          ensureSize(item);
          const { width: dw, height: dh } = getDisplaySize(item);
          const hw = dw / 2;
          const hh = dh / 2;

          const rotY = item.y - hh - 35 / cam.z;
          if (Math.hypot(x - item.x, y - rotY) < hs) {
            editor.mode = 'rotate';
            editor.dragStart = { x, y };
            editor.itemStart = { ...item };
            canvas.style.cursor = 'grabbing';
            return;
          }

          const corners = [
            { x: item.x - hw, y: item.y - hh, name: 'tl' },
            { x: item.x + hw, y: item.y - hh, name: 'tr' },
            { x: item.x - hw, y: item.y + hh, name: 'bl' },
            { x: item.x + hw, y: item.y + hh, name: 'br' },
          ];

          for (const c of corners) {
            if (Math.hypot(x - c.x, y - c.y) < hs) {
              editor.mode = 'resize';
              editor.corner = c.name;
              editor.dragStart = { x, y };
              editor.itemStart = { ...item };
              canvas.style.cursor = 'nwse-resize';
              return;
            }
          }

          if (x >= item.x - hw && x <= item.x + hw && y >= item.y - hh && y <= item.y + hh) {
            editor.mode = 'drag';
            editor.dragStart = { x, y };
            editor.itemStart = { ...item };
            editor.hasMoved = false;
            canvas.style.cursor = 'move';
            return;
          }
        }
      }

      let hit = false;
      for (let i = editor.items.length - 1; i >= 0; i--) {
        const item = editor.items[i];
        if (!item) continue;  // 🆕 Skip null items
        ensureSize(item);
        const { width: dw, height: dh } = getDisplaySize(item);
        const hw = dw / 2;
        const hh = dh / 2;

        if (x >= item.x - hw && x <= item.x + hw && y >= item.y - hh && y <= item.y + hh) {
          editor.selectedItem = { item, index: i };
          window.__editorSelectedIndex = i; // sync badge highlight en canvas
          editor.mode = 'drag';
          editor.dragStart = { x, y };
          editor.itemStart = { ...item };
          canvas.style.cursor = 'move';

          const ox = Math.round(item.x - editor.waypoint.x);
          const oy = Math.round(item.y - editor.waypoint.y);

          // Highlight selected item in the DOM for debugging
          if (item.wrap) {
            item.wrap.style.outline = '2px dashed #00FF00';
            item.wrap.style.outlineOffset = '2px';
          }

          console.log(`%c📍 Item #${i}${item.id ? ' · ' + item.id : ''}`, 'color:#00FF00;font-weight:bold');
          
          
          console.table({
            index: i,
            type: item.type || 'hotspot',
            mapCoords: `(${Math.round(item.x)}, ${Math.round(item.y)})`,
            offsetFromWaypoint: `(${ox}, ${oy})`,
            size: `${Math.round(item.width)}×${Math.round(item.height)}`,
            rotation: `${item.rotation || 0}°`,
            zIndex: item.z || 0,
            meta: item.meta ? '...' : 'none',
            waypointIndex: item.waypointIndex !== undefined ? item.waypointIndex : 'none'
          });
          
          // Log detailed debug info
          if (GLOBAL_CONFIG.DEBUG_HOTSPOTS) {
            console.groupCollapsed('🔍 Detailed Hotspot Info');
            console.log('🔹 Element:', item.wrap || 'No DOM element');
            console.log('🔹 Bounding Box:', {
              left: Math.round(item.x - item.width/2),
              top: Math.round(item.y - item.height/2),
              right: Math.round(item.x + item.width/2),
              bottom: Math.round(item.y + item.height/2)
            });
            console.log('🔹 Style:', {
              position: 'absolute',
              width: `${item.width}px`,
              height: `${item.height}px`,
              transform: `translate(-50%, -50%) rotate(${item.rotation || 0}deg)`
            });
            console.groupEnd();
          }

          updateInfo(`
            <b style="color:#00FF00;">Item #${i}${item.id ? '<br><span style="color:#FFD700;font-size:10px;">' + item.id + '</span>' : ''}</b><br>
            Type: ${item.type || 'hotspot'}<br>
            Offset: (${ox}, ${oy})<br>
            Size: ${Math.round(item.width)}×${Math.round(item.height)}<br>
            Rotation: ${item.rotation || 0}°
          `);

          updatePropertiesPanel();
          editor.needsRedraw = true;
          window.dispatchEvent(new CustomEvent('editor:redraw'));
          hit = true;
          return;
        }
      }

      if (!hit) {
        editor.selectedItem = null;
        editor.mode = null;
        canvas.style.cursor = 'crosshair';
        updateInfo('No item selected');
        updatePropertiesPanel();
        editor.needsRedraw = true;
        window.dispatchEvent(new CustomEvent('editor:redraw'));
      }

      // 🆕 Solo bloquear comportamiento táctil si hubo hit
      try { if (hit && isTouch && typeof e.preventDefault === 'function') e.preventDefault(); } catch {}
    }, { once: true });
  }

  function handleMove(e) { 
    if (!editor.active || !editor.mode) return;
    
    // 🆕 Null guards
    if (!e) {
      console.warn('handleMove: Invalid event');
      return;
    }
    
    e.stopImmediatePropagation();
    const isTouch = e?.isTouch === true || String(e.type).startsWith('touch');

    window.dispatchEvent(new CustomEvent('editor:getMapCoords', {
      detail: { clientX: e.clientX, clientY: e.clientY }
    }));

    window.addEventListener('editor:mapCoordsResponse', function handler(ev) {
      window.removeEventListener('editor:mapCoordsResponse', handler);

      if (!editor.mode) return;

      let { x, y } = ev.detail;
      if (editor.editWaypointMode && editor.mode === 'drag-wp' && editor.waypoint) {
        if (editor.gridSnap) { x = snap(x, editor.gridSize); y = snap(y, editor.gridSize); }
        editor.waypoint.x = editor.itemStart.x + (x - editor.dragStart.x);
        editor.waypoint.y = editor.itemStart.y + (y - editor.dragStart.y);
        const ix = document.getElementById('wp-x'); const iy = document.getElementById('wp-y');
        if (ix) ix.value = Math.round(editor.waypoint.x);
        if (iy) iy.value = Math.round(editor.waypoint.y);
        updateInfo(`<b style=\"color:#00BFFF;\">Waypoint #${editor.waypointIndex}</b><br>Pos: (${Math.round(editor.waypoint.x)}, ${Math.round(editor.waypoint.y)})  Z:${(editor.waypoint.z||1).toFixed(2)}${editor.gridSnap ? '<br><b style=\"color:#FFD700;\">🔒 SNAP</b>' : ''}`);
        editor.needsRedraw = true;
        window.dispatchEvent(new CustomEvent('editor:redraw'));
        return;
      }
      const item = editor.selectedItem.item;

      if (editor.gridSnap) {
        x = snap(x, editor.gridSize);
        y = snap(y, editor.gridSize);
      }

      if (editor.mode === 'drag') {
        const dx = x - editor.dragStart.x;
        const dy = y - editor.dragStart.y;
        item.x = editor.itemStart.x + dx;
        item.y = editor.itemStart.y + dy;
        editor.hasMoved = true;
      } else if (editor.mode === 'resize') {
        const dx = x - editor.dragStart.x;
        const dy = y - editor.dragStart.y;

        let nw = editor.itemStart.width;
        let nh = editor.itemStart.height;
        let nx = editor.itemStart.x;
        let ny = editor.itemStart.y;

        if (editor.corner.includes('r')) nw = Math.max(20, editor.itemStart.width + dx * 2);
        if (editor.corner.includes('l')) {
          nw = Math.max(20, editor.itemStart.width - dx * 2);
          nx = editor.itemStart.x + dx;
        }
        if (editor.corner.includes('b')) nh = Math.max(20, editor.itemStart.height + dy * 2);
        if (editor.corner.includes('t')) {
          nh = Math.max(20, editor.itemStart.height - dy * 2);
          ny = editor.itemStart.y + dy;
        }

        item.width = Math.round(nw);
        item.height = Math.round(nh);
        item.x = nx;
        item.y = ny;
      } else if (editor.mode === 'rotate') {
        const angle = Math.atan2(y - editor.itemStart.y, x - editor.itemStart.x) * (180 / Math.PI);
        item.rotation = Math.round(angle + 90);
      }

      const ox = Math.round(item.x - editor.waypoint.x);
      const oy = Math.round(item.y - editor.waypoint.y);
      updateInfo(`
        <b style="color:#00FF00;">Item #${editor.selectedItem.index}</b><br>
        Type: ${item.type || 'hotspot'}<br>
        Offset: (${ox}, ${oy})<br>
        Size: ${Math.round(item.width)}×${Math.round(item.height)}<br>
        Rotation: ${item.rotation || 0}°
        ${editor.gridSnap ? '<br><b style="color:#FFD700;">🔒 SNAP</b>' : ''}
      `);

      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
    }, { once: true });
  }

  function handleUp(e) {
    if (!editor.active) return;
    
    // 🆕 Null guards
    if (!e) {
      console.warn('handleUp: Invalid event');
      return;
    }
    
    e.stopImmediatePropagation();
    e.preventDefault();

    // Si fue drag sin movimiento = click → deseleccionar
    if (editor.mode === 'drag' && !editor.hasMoved && editor.selectedItem) {
      editor.selectedItem = null;
      editor.mode = null;
      editor.isDragging = false;
      canvas.style.cursor = 'crosshair';
      updateInfo('No item selected');
      updatePropertiesPanel();
      editor.needsRedraw = true;
      window.dispatchEvent(new CustomEvent('editor:redraw'));
      return;
    }

    if (editor.mode === 'drag-wp') { saveState('move-waypoint'); } else if (editor.selectedItem && editor.mode) {
      saveState(editor.mode);
      generateCode();
    }

    editor.mode = null;
    editor.corner = null;
    editor.isDragging = false;
    canvas.style.cursor = editor.active ? 'crosshair' : 'default';
    editor.needsRedraw = true;
    window.dispatchEvent(new CustomEvent('editor:redraw'));
  }

  function exportItemJSON() {
    if (!editor.selectedItem) return;

    const item = editor.items[editor.selectedItem.index];
    if (!item || !editor.waypoint) return;

    const wp = editor.waypoint;
    const offsetX = Math.round(item.x - wp.x);
    const offsetY = Math.round(item.y - wp.y);
    const width    = Math.round(item.width);
    const height   = Math.round(item.height);
    const rotation = Math.round(item.rotation || 0);
    const radius   = item.radius || 0;

    const STRIP = new Set(['x','y','waypointIndex','debugColor','_editorId','_rawMobile','_rawDesktop']);

    const mobileBase = item._rawMobile || {};
    const desktopBase = item._rawDesktop || {};

    const mobileOut  = { ...mobileBase,  offsetX, offsetY, width, height, rotation, radius };
    const desktopOut = { ...desktopBase, offsetX, offsetY, width, height, rotation, radius };

    if (radius === 0 && !('radius' in mobileBase))  delete mobileOut.radius;
    if (radius === 0 && !('radius' in desktopBase)) delete desktopOut.radius;

    const json = {};
    if (item._note) json._note = item._note;
    json.type    = item.type || 'hotspot';
    json.mobile  = mobileOut;
    json.desktop = desktopOut;

    const ORDER = ['title','image','datetime','location','description','involved','echos','body'];
    ORDER.forEach(k => { if (item[k] !== undefined) json[k] = item[k]; });

    Object.keys(item).forEach(k => {
      if (!STRIP.has(k) && !(k in json) && !['type','mobile','desktop','_note'].includes(k)) {
        json[k] = item[k];
      }
    });

    const str = JSON.stringify(json, null, 2);
    navigator.clipboard.writeText(str).then(() => {
      updateInfo('✅ JSON completo copiado — pega directo en wpN.json');
      console.log('%c📋 JSON completo copiado', 'color:#FF6B00;font-weight:bold');
      console.log('%c' + str, 'color:#00FF88;font-family:monospace;font-size:12px');
    }).catch(() => {
      console.log('%c📋 JSON completo:', 'color:#FF6B00;font-weight:bold');
      console.log(str);
      updateInfo('⚠️ No se pudo copiar — JSON en consola');
    });
  }

  function generateCode() {
    if (!editor.selectedItem) {
      console.log('%c⚠️ No item selected', 'color:#FFA500;font-weight:bold');
      return;
    }

    window.dispatchEvent(new CustomEvent('editor:getItemCode', {
      detail: {
        waypointIndex: editor.waypointIndex,
        itemIndex: editor.selectedItem.index
      }
    }));

    window.addEventListener('editor:itemCodeResponse', function handler(ev) {
      window.removeEventListener('editor:itemCodeResponse', handler);
      const { code } = ev.detail;
      
      // Enhanced debug output with syntax highlighting
      console.log('%c✅ Código actualizado:', 'color:#00FF00;font-size:14px;font-weight:bold');
      
      // Create a more readable output with syntax highlighting
      const item = editor.items[editor.selectedItem.index];
      console.groupCollapsed('%c📋 Item Details', 'font-weight:bold');
      console.log('%cType:', 'color:#4CAF50;font-weight:bold', item.type || 'hotspot');
      console.log('%cPosition:', 'color:#2196F3;font-weight:bold', 
        `x: ${Math.round(item.x)}, y: ${Math.round(item.y)}`);
      console.log('%cSize:', 'color:#9C27B0;font-weight:bold', 
        `${Math.round(item.width)}×${Math.round(item.height)}`);
      console.log('%cRotation:', 'color:#FF9800;font-weight:bold', 
        `${item.rotation || 0}°`);
      
      // Show the generated code in a collapsible group
      console.groupCollapsed('%cGenerated Code', 'font-weight:bold');
      try {
        console.log(JSON.parse(code));
      } catch {
        console.log(code);
      }
      console.groupEnd();
      
      console.groupEnd(); // End item details group
      
      // Copy to clipboard if possible
      try {
        navigator.clipboard.writeText(JSON.stringify(JSON.parse(code), null, 2));
        console.log('%c📋 Copied to clipboard!', 'color:#4CAF50;font-weight:bold');
      } catch (err) {
        console.warn('Failed to copy to clipboard:', err);
      }
    }, { once: true });
  }

  // Touch support with guards (passive to avoid interventions)
  if (canvas) {
    canvas.addEventListener('touchstart', (e) => {
      if (!editor.active || !e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      if (!t) return;  // 🆕 Guard against empty touches
      const syntheticEv = new MouseEvent('mousedown', {
        bubbles: true,
        clientX: t.clientX,
        clientY: t.clientY
      });
      // Marca como evento táctil para manejo condicional
      syntheticEv.isTouch = true;
      handleDown(syntheticEv);
    }, { capture: true, passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (!editor.active || !editor.selectedItem || !e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      if (!t) return;  // 🆕 Guard against empty touches
      const syntheticEv = new MouseEvent('mousemove', {
        bubbles: true,
        clientX: t.clientX,
        clientY: t.clientY
      });
      syntheticEv.isTouch = true;
      handleMove(syntheticEv);
    }, { capture: true, passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (!editor.active) return;
      handleUp(new MouseEvent('mouseup', { bubbles: true }));
    }, { capture: true, passive: true });
  } else {
    console.warn('Canvas not found - editor touch listeners skipped');
  }

  console.log('✅ Editor Pro Advanced cargado. Presiona "E"');
    // --- HMR: limpia y re-monta UI si estaba activo
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        try { document.getElementById('editor-pro-ui')?.remove?.(); } catch {}
      });

      import.meta.hot.accept(() => {
        if (window.__EDITOR_ACTIVE__ && !document.getElementById('editor-pro-ui')) {
          try { createUI(); } catch {}
          window.dispatchEvent(new CustomEvent('editor:active', { detail: { active: true } }));
        }
      });
    }
} // ← cierra initEditor