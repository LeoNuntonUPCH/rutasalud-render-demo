/**
 * scene.js — Motor de escena lateral 2D con DOM persistente entre avances.
 * Soporta Vistas 1..4 del pasillo (4 puntos por vista) y Vista fija de Galería (3 posiciones: g0, g7, g15).
 */

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FLOOR_META = {
  1: { name: 'Piso 1 · Recepción y Consulta', cls: 'floor-p1' },
  2: { name: 'Piso 2 · Ginecología y Med. Interna', cls: 'floor-p2' },
  3: { name: 'Piso 3 · Traumatología y Cardiología', cls: 'floor-p3' },
  4: { name: 'Piso 4 · Laboratorio e Imágenes', cls: 'floor-p4' },
  5: { name: 'Piso 5 · Observación y Habitaciones', cls: 'floor-p5' },
};

const SUPPORTS_WEBP = (() => {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  if (!canvas || !canvas.getContext) return false;
  return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
})();

export function assetUrl(path) {
  if (!SUPPORTS_WEBP) return path;
  const base = String(path).replace(/_mobile(?=\.)/, '');
  return base.replace(/\.(png|jpe?g)$/i, `${window.innerWidth <= 800 ? '-mobile' : ''}.webp`);
}

function originalAsset(path) {
  return String(path).replace(/-mobile(?=\.webp)/, '').replace(/\.webp$/i,
    String(path).includes('/escena_') ? '.jpg' : '.png');
}

// A failed optimized image retries its retained original once.
document.addEventListener('error', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && /\.webp$/i.test(img.src)) {
    img.src = originalAsset(img.src);
  }
}, true);

function setSceneBackground(element, original) {
  const selected = assetUrl(original);
  element.dataset.asset = selected;
  const image = new Image();
  image.onload = () => {
    if (element.dataset.asset === selected) element.style.backgroundImage = `url('${selected}')`;
  };
  image.onerror = () => {
    if (element.dataset.asset === selected) element.style.backgroundImage = `url('${original}')`;
  };
  image.src = selected;
}

/**
 * Resuelve la posición lógica del servidor a coordenadas de escena:
 * { mode: 'corridor'|'gallery', floor, viewIndex (0..3), slotIndex (0..3 or 0..2), insideRoom: boolean, nodeId }
 */
export function resolveScenePosition(plan, nodeId) {
  const cleanId = String(nodeId || '').replace(/^fin_/, '');
  const node = plan?.nodos?.[cleanId];
  const floor = node?.piso || 1;

  if (cleanId.includes('_g')) {
    const gNum = Number(cleanId.split('_g')[1]);
    const slotIndex = gNum === 0 ? 0 : gNum === 7 ? 1 : 2;
    return { mode: 'gallery', floor, viewIndex: 0, slotIndex, insideRoom: false, nodeId: cleanId };
  }

  let corridorIdx = 0;
  let insideRoom = false;

  if (cleanId.includes('_c')) {
    corridorIdx = Number(cleanId.split('_c')[1]);
  } else if (cleanId.includes('ascensor_a')) {
    corridorIdx = 0;
  } else if (cleanId.includes('escalera')) {
    corridorIdx = 7;
  } else if (cleanId.includes('ascensor_b')) {
    corridorIdx = 15;
  } else if (node) {
    corridorIdx = Math.round(node.x / 4);
    insideRoom = node.tipo === 'seccion';
  }

  const viewIndex = Math.min(3, Math.max(0, Math.floor(corridorIdx / 4)));
  const slotIndex = corridorIdx % 4;
  return { mode: 'corridor', floor, viewIndex, slotIndex, insideRoom, nodeId: cleanId, corridorIdx };
}

function statusBadgeHtml(sec) {
  if (sec.estado === 'cerrada') {
    return `<span class="door-badge cerrada" title="${esc(sec.motivo_cierre || 'Cerrada')}">🔒 ${esc(sec.motivo_cierre || 'Cerrada')}</span>`;
  }
  if (sec.estado === 'saturada') {
    return `<span class="door-badge saturada" title="Espera ${sec.espera_segundos}s">⏱ ${sec.espera_segundos}s</span>`;
  }
  return `<span class="door-badge abierta">✓ Abierta</span>`;
}

function buildCorridorSlots(plan, floor, viewIndex, wheelchair, blocked, nameFn) {
  const start = viewIndex * 4;
  const slots = [];
  for (let offset = 0; offset < 4; offset++) {
    const idx = start + offset;
    const sec = plan.secciones.find(s => s.piso === floor && Math.round(plan.nodos[s.id].x / 4) === idx);
    const hasElevA = idx === 0;
    const hasStairs = idx === 7;
    const hasElevB = idx === 15;
    const hasGalleryGate = idx === 0 || idx === 7 || idx === 15;

    let topSignageHtml = '';
    let accessBayHtml = '';
    const connSigns = [];

    if (hasElevA) {
      const isBlocked = blocked.includes('ascensor_a');
      connSigns.push(`<div class="connector elevator ${isBlocked ? 'blocked' : ''}"><span>🛗 Ascensor A${isBlocked ? ' · ⛔ Bloqueado' : ''}</span></div>`);
      accessBayHtml = `
        <div class="access-bay elev-bay ${isBlocked ? 'blocked' : ''}" aria-hidden="true">
          <div class="elev-bay-head"><span class="elev-light"></span></div>
          <div class="elev-bay-doors"><span class="door-leaf"></span><span class="door-leaf"></span></div>
        </div>`;
    } else if (hasStairs) {
      connSigns.push(`<div class="connector stairs ${wheelchair ? 'no-wheelchair' : ''}"><span>🪜 Escalera${wheelchair ? ' · No acc.' : ''}</span></div>`);
      accessBayHtml = `
        <div class="access-bay stairs-bay ${wheelchair ? 'no-wheelchair' : ''}" aria-hidden="true">
          <div class="stairs-steps"><span></span><span></span><span></span><span></span></div>
        </div>`;
    } else if (hasElevB) {
      const isBlocked = blocked.includes('ascensor_b');
      connSigns.push(`<div class="connector elevator ${isBlocked ? 'blocked' : ''}"><span>🛗 Ascensor B${isBlocked ? ' · ⛔ Bloqueado' : ''}</span></div>`);
      accessBayHtml = `
        <div class="access-bay elev-bay ${isBlocked ? 'blocked' : ''}" aria-hidden="true">
          <div class="elev-bay-head"><span class="elev-light"></span></div>
          <div class="elev-bay-doors"><span class="door-leaf"></span><span class="door-leaf"></span></div>
        </div>`;
    }
    if (hasGalleryGate) {
      connSigns.push(`<div class="gallery-passage" title="Pasaje transitable a galería paralela">↗ Galería (g${idx})</div>`);
    }
    if (connSigns.length) {
      topSignageHtml = `<div class="slot-top-signage">${connSigns.join('')}</div>`;
    }

    let fixture = '';
    if (sec) {
      const label = `${nameFn(sec.area)} ${sec.id.split('_').at(-1)}`;
      fixture = `
        <div class="door-unit ${sec.estado}" data-node="${sec.id}">
          <div class="door-lintel-header">
            <div class="door-sign" title="${esc(label)}">${esc(label)}</div>
            ${statusBadgeHtml(sec)}
          </div>
          <div class="door-frame">
            <div class="door-leaf-panel">
              <div class="door-window"></div>
              <div class="door-handle"></div>
              <div class="door-kickplate"></div>
            </div>
          </div>
          ${sec.estado === 'saturada' ? `<img class="waiting-crowd" src="${assetUrl('/web/assets/personaje_espera_cualitativo.png')}" alt="">` : ''}
        </div>`;
    } else if (floor > 1 && idx >= 6) {
      // Regla de fidelidad topológica: pisos 2–5 sin puertas en c6..c15
      fixture = `
        <div class="wall-decor" aria-hidden="true">
          ${idx % 2 === 0 ? '<div class="decor-window"></div>' : '<div class="decor-frame"></div>'}
        </div>`;
    }

    const bayOrderClass = hasElevA ? 'bay-left' : 'bay-right';
    slots.push(`
      <div class="scene-slot ${connSigns.length ? 'has-connector' : ''}" data-slot="${idx}">
        ${topSignageHtml}
        <div class="slot-mid-wall ${bayOrderClass}">
          ${accessBayHtml}
          <div class="slot-body">${fixture}</div>
        </div>
        <div class="slot-floor-track">
          <span class="slot-marker">c${idx}</span>
        </div>
      </div>`);
  }
  return slots.join('');
}

function buildGallerySlots() {
  const stops = [
    { id: 'g0', label: 'Pasaje c0 (Ascensor A)' },
    { id: 'g7', label: 'Pasaje c7 (Escalera)' },
    { id: 'g15', label: 'Pasaje c15 (Ascensor B)' },
  ];
  return stops.map((s, i) => `
    <div class="scene-slot gallery-slot" data-gslot="${i}">
      <div class="gallery-window" aria-hidden="true"></div>
      <div class="gallery-exit">↙ Volver a ${s.label}</div>
      <span class="slot-marker">${s.id}</span>
    </div>`).join('');
}

export function getCastSprites(caseId, wheelchair = false) {
  const id = String(caseId || 'C01').toUpperCase();
  const isFemaleGuide = new Set(['C02', 'C04', 'C06', 'C08', 'C10']).has(id);
  const guideSrc = isFemaleGuide
    ? '/web/assets/personaje_orientadora_der.png'
    : '/web/assets/personaje_orientador_der.png';

  let patientSrc = '/web/assets/personaje_paciente_c01_der.png';
  let patientAlt = 'Paciente';
  if (wheelchair || ['C05', 'C06', 'C10'].includes(id)) {
    patientSrc = '/web/assets/personaje_paciente_silla_der.png';
    patientAlt = 'Paciente en silla de ruedas';
  } else if (id === 'C02') {
    patientSrc = '/web/assets/personaje_paciente_nino_der.png';
    patientAlt = 'Paciente pediátrico';
  } else if (['C04', 'C08', 'C09'].includes(id)) {
    patientSrc = '/web/assets/personaje_paciente_mujer_der.png';
    patientAlt = 'Paciente adulta';
  }
  return { isFemaleGuide, guideSrc, patientSrc, patientAlt };
}

/**
 * Monta o actualiza de forma incremental la escena lateral 2D dentro de `container`.
 * Preserva el nodo DOM de los personajes entre avances para animar transiciones CSS.
 */
export function mountOrUpdateScene(container, { plan, round, wheelchair, caseId, patientName, nameFn, nodeNameFn, prevPos }) {
  const pos = resolveScenePosition(plan, round.posicion);
  const prev = prevPos ? resolveScenePosition(plan, prevPos) : null;
  const movingLeft = prev && prev.floor === pos.floor && prev.mode === pos.mode && (
    pos.mode === 'gallery' ? pos.slotIndex < prev.slotIndex : pos.corridorIdx < prev.corridorIdx
  );

  let stage = container.querySelector('.scene-stage');
  if (!stage) {
    container.innerHTML = `
      <div class="scene-stage">
        <div class="scene-hud-top">
          <span class="scene-floor-pill"></span>
          <span class="scene-view-pill"></span>
        </div>
        <div class="scene-bg" aria-hidden="true"></div>
        <div class="scene-baseboard" aria-hidden="true"></div>
        <div class="scene-floor-lane" aria-hidden="true"></div>
        <div class="scene-slots"></div>
        <div class="scene-actors">
          <img class="actor actor-guide" src="${assetUrl('/web/assets/personaje_orientador_der.png')}" alt="Orientador hospitalario">
          <img class="actor actor-patient" src="${assetUrl('/web/assets/personaje_paciente_c01_der.png')}" alt="Paciente">
        </div>
        <img class="actor-specialist" src="${assetUrl('/web/assets/personaje_especialista_izq.png')}" alt="" hidden>
        <div class="floor-transition-overlay" aria-hidden="true">
          <div class="elev-door elev-door-left"></div>
          <div class="elev-door elev-door-right"></div>
          <span class="floor-transition-badge"></span>
        </div>
      </div>`;
    stage = container.querySelector('.scene-stage');
  }

  const floorInfo = FLOOR_META[pos.floor] || FLOOR_META[1];
  stage.className = `scene-stage ${floorInfo.cls} mode-${pos.mode} ${pos.insideRoom ? 'inside-room' : ''}`;

  const floorPill = stage.querySelector('.scene-floor-pill');
  const viewPill = stage.querySelector('.scene-view-pill');
  floorPill.textContent = `P${pos.floor} · ${floorInfo.name.split(' · ')[1]}`;
  viewPill.textContent = pos.mode === 'gallery'
    ? 'Galería paralela (3 paradas)'
    : `Vista ${pos.viewIndex + 1}/4 · ${nodeNameFn(round.posicion)}`;

  // Fondo modular: Recepción P1 para P1 Vista 1, módulo de pasillo para el resto, o galería
  const bg = stage.querySelector('.scene-bg');
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 800;
  const suffix = '.jpg';
  const bgKey = `${pos.mode === 'gallery' ? 'gallery' : (pos.floor === 1 && pos.viewIndex === 0 ? 'p1_recepcion' : 'pasillo_modulo')}${isMobile ? '_m' : ''}`;

  if (stage.dataset.bgKey !== bgKey) {
    stage.dataset.bgKey = bgKey;
    if (bgKey.startsWith('p1_recepcion')) {
      setSceneBackground(bg, `/web/assets/escena_p1_recepcion${suffix}`);
    } else if (bgKey.startsWith('pasillo_modulo')) {
      setSceneBackground(bg, `/web/assets/escena_p1_pasillo_modulo${suffix}`);
    } else {
      setSceneBackground(bg, `/web/assets/escena_galeria_paralela${suffix}`);
    }
  }

  // Actualizar sprites del elenco reutilizable + poses/expresiones dinámicas
  const cast = getCastSprites(caseId || round.escenario, wheelchair);
  const hasEvent = (round.eventos_aplicados || []).length > 0 || (round.bloqueados || []).length > 0;
  const atDest = pos.insideRoom && round.indice >= (round.ruta?.length || 1) - 2;
  let guideSrc = cast.guideSrc;
  if (!cast.isFemaleGuide) {
    if (atDest) guideSrc = '/web/assets/personaje_orientador_celebrando_der.png';
    else if (hasEvent && round.indice === 0) guideSrc = '/web/assets/personaje_orientador_preocupado_der.png';
    else if (round.indice === 0) guideSrc = '/web/assets/personaje_orientador_senalando_der.png';
  }

  let patientSrc = cast.patientSrc;
  if (!wheelchair && !['C02', 'C04', 'C08', 'C09'].includes(String(caseId || round.escenario).toUpperCase())) {
    if (atDest) patientSrc = '/web/assets/personaje_paciente_aliviado_der.png';
    else if (hasEvent && round.indice === 0) patientSrc = '/web/assets/personaje_paciente_ansioso_der.png';
  }

  const guideImg = stage.querySelector('.actor-guide');
  const guideResolved = assetUrl(guideSrc);
  if (guideImg && !guideImg.src.endsWith(guideResolved)) {
    guideImg.src = guideResolved;
  }
  const patientImg = stage.querySelector('.actor-patient');
  const patientResolved = assetUrl(patientSrc);
  if (patientImg && !patientImg.src.endsWith(patientResolved)) {
    patientImg.src = patientResolved;
  }
  if (patientImg) {
    patientImg.alt = wheelchair ? `Paciente en silla de ruedas: ${patientName || caseId}` : `${cast.patientAlt}: ${patientName || caseId}`;
  }
  const specImg = stage.querySelector('.actor-specialist');
  if (specImg) {
    specImg.hidden = !pos.insideRoom;
    specImg.alt = pos.insideRoom ? `Personal de ${nameFn(round.objetivo || 'especialidad')}` : '';
  }

  // Reconstruir solo las ranuras cuando cambia piso, vista o modo (no en cada paso dentro de la misma vista)
  const slotsKey = `${pos.mode}-${pos.floor}-${pos.viewIndex}-${(round.bloqueados || []).join(',')}`;
  const slotsEl = stage.querySelector('.scene-slots');
  if (stage.dataset.slotsKey !== slotsKey) {
    stage.dataset.slotsKey = slotsKey;
    slotsEl.innerHTML = pos.mode === 'gallery'
      ? buildGallerySlots()
      : buildCorridorSlots(plan, pos.floor, pos.viewIndex, wheelchair, round.bloqueados || [], nameFn);
  }

  // Resaltar ranura activa
  slotsEl.querySelectorAll('.scene-slot').forEach(el => {
    const active = pos.mode === 'gallery'
      ? Number(el.dataset.gslot) === pos.slotIndex
      : Number(el.dataset.slot) === pos.corridorIdx;
    el.classList.toggle('active-slot', active);
  });

  // Posicionar actores suavemente (DOM persistente)
  const actors = stage.querySelector('.scene-actors');
  const pct = pos.mode === 'gallery'
    ? [18, 50, 82][pos.slotIndex]
    : [14, 38, 62, 86][pos.slotIndex];
  actors.style.left = `${pct}%`;
  actors.classList.toggle('facing-left', Boolean(movingLeft));
  if (specImg && pos.insideRoom) {
    specImg.style.left = `${Math.min(92, pct + 11)}%`;
    specImg.style.right = 'auto';
  }

  // Fase 5: micro-animaciones breves y no bloqueantes
  if (prev && prev.nodeId !== pos.nodeId) {
    // 1. Caminata al avanzar un punto
    actors.classList.remove('is-stepping', 'entering-room');
    void actors.offsetWidth;
    actors.classList.add(pos.insideRoom && !prev.insideRoom ? 'entering-room' : 'is-stepping');

    // 2. Deslizamiento de cámara entre vistas contiguas del pasillo
    if (prev.floor === pos.floor && prev.mode === 'corridor' && pos.mode === 'corridor' && prev.viewIndex !== pos.viewIndex) {
      const slideCls = pos.viewIndex > prev.viewIndex ? 'camera-slide-next' : 'camera-slide-prev';
      slotsEl.classList.remove('camera-slide-next', 'camera-slide-prev');
      void slotsEl.offsetWidth;
      slotsEl.classList.add(slideCls);
    }

    // 3. Transición al entrar o salir de la galería paralela
    if (prev.mode !== pos.mode) {
      stage.classList.remove('gallery-fade');
      void stage.offsetWidth;
      stage.classList.add('gallery-fade');
    }

    // 4. Cambio de piso (ascensor o escalera) con cambio suave de paleta
    if (prev.floor !== pos.floor) {
      const overlay = stage.querySelector('.floor-transition-overlay');
      const badge = stage.querySelector('.floor-transition-badge');
      const viaStairs = pos.nodeId.includes('escalera') || prev.nodeId.includes('escalera');
      if (overlay && badge) {
        badge.textContent = viaStairs ? `🪜 Piso ${pos.floor}` : `🛗 Piso ${pos.floor}`;
        overlay.classList.remove('anim-elevator', 'anim-stairs');
        void overlay.offsetWidth;
        overlay.classList.add(viaStairs ? 'anim-stairs' : 'anim-elevator');
      }
    }
  }
}
