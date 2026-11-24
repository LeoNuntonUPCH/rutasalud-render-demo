/**
 * minimap.js — Minimapa sincronizado con miniaturas y reconstrucción de ruta desde historial.
 */

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHORT_AREAS = {
  recepcion: 'Rec',
  triaje: 'Tri',
  atencion_prioritaria: 'At.P',
  medicina_general: 'Med.G',
  pediatria: 'Ped',
  ginecologia: 'Gin',
  medicina_interna: 'Med.I',
  traumatologia: 'Trau',
  cardiologia: 'Card',
  laboratorio: 'Lab',
  imagenes: 'Img',
  observacion: 'Obs',
  habitaciones: 'Hab',
};

function shortRoomLabel(sec) {
  const num = sec.id.split('_').at(-1);
  return `${SHORT_AREAS[sec.area] || sec.area.slice(0, 4)} ${num}`;
}

function xy(n) {
  return [50 + n.x * 12, 65 + (n.y - 12) * 7];
}

/**
 * Reconstruye la ruta completa del jugador desde round.historial.
 * Agrupa avances por etapa (cada 'eleccion' inicia tramo), conserva cambios de piso
 * y asocia los eventos al nodo donde ocurrieron, sin duplicar ni perder nodos.
 */
export function reconstructHistoryRoute(round) {
  const historial = round?.historial || [];
  const stages = [];
  const events = [];
  let current = null;

  for (const entry of historial) {
    if (entry.accion === 'inicio') {
      current = { algoritmo: null, nodos: [entry.posicion] };
    } else if (entry.accion === 'eleccion') {
      if (current && current.nodos.length > 1) stages.push(current);
      current = { algoritmo: entry.algoritmo, nodos: [entry.posicion] };
    } else if (entry.accion === 'avance') {
      if (!current) current = { algoritmo: null, nodos: [] };
      const pos = String(entry.posicion).replace(/^fin_/, '');
      if (current.nodos.at(-1) !== pos) current.nodos.push(pos);
    } else if (entry.accion === 'evento') {
      events.push({
        posicion: String(entry.posicion).replace(/^fin_/, ''),
        bloqueados: entry.bloqueados || [],
      });
    }
  }
  if (current && current.nodos.length) stages.push(current);

  const edgeSet = new Set();
  const visitedNodes = [];
  for (const st of stages) {
    for (let i = 0; i < st.nodos.length; i++) {
      const u = st.nodos[i];
      if (visitedNodes.at(-1) !== u) visitedNodes.push(u);
      if (i < st.nodos.length - 1) {
        const v = st.nodos[i + 1];
        if (u !== v) edgeSet.add([u, v].sort().join('|'));
      }
    }
  }
  return { stages, events, edgeSet, visitedNodes };
}

/**
 * Iconos en miniatura propios (Orientador + Paciente / Silla de ruedas).
 */
function renderThumbnails(x, y, wheelchair) {
  const guide = `
    <g class="thumb thumb-guide" transform="translate(${x - 10}, ${y - 14})">
      <circle cx="0" cy="-6" r="5" fill="#1E3F5E" stroke="#fff" stroke-width="1.8"/>
      <path d="M-6 5 C-6 -1 6 -1 6 5 Z" fill="#0F766E" stroke="#fff" stroke-width="1.5"/>
    </g>`;
  const patient = wheelchair
    ? `<g class="thumb thumb-patient" transform="translate(${x + 11}, ${y - 12})">
        <circle cx="0" cy="-7" r="4.5" fill="#B45309" stroke="#fff" stroke-width="1.6"/>
        <circle cx="-1" cy="3" r="5.5" fill="none" stroke="#1E293B" stroke-width="2.2"/>
        <path d="M-1 -2 L3 -2 L5 3" fill="none" stroke="#fff" stroke-width="1.6"/>
      </g>`
    : `<g class="thumb thumb-patient" transform="translate(${x + 10}, ${y - 14})">
        <circle cx="0" cy="-6" r="4.8" fill="#C26D4A" stroke="#fff" stroke-width="1.8"/>
        <path d="M-5.5 5 C-5.5 -1 5.5 -1 5.5 5 Z" fill="#D97757" stroke="#fff" stroke-width="1.5"/>
      </g>`;
  return `${guide}${patient}`;
}

/**
 * Dibuja el minimapa SVG del piso indicado.
 * @param {object} opts { plan, round, floor, wheelchair, nodeName, useHistory }
 */
export function renderMinimapSvg({ plan, round, floor, wheelchair = false, nodeName, useHistory = false }) {
  const nodes = plan.nodos;
  const routeEdges = new Set();
  let eventPositions = new Set();

  if (useHistory) {
    const hist = reconstructHistoryRoute(round);
    hist.edgeSet.forEach(e => routeEdges.add(e));
    eventPositions = new Set(hist.events.map(e => e.posicion));
  } else {
    const r = round.ruta || [];
    for (let i = 0; i < r.length - 1; i++) {
      routeEdges.add([r[i].replace(/^fin_/, ''), r[i + 1].replace(/^fin_/, '')].sort().join('|'));
    }
  }

  const lines = plan.conexiones
    .filter(e => nodes[e.origen].piso === floor && nodes[e.destino].piso === floor)
    .map(e => {
      const [x1, y1] = xy(nodes[e.origen]);
      const [x2, y2] = xy(nodes[e.destino]);
      const isGallery = e.origen.includes('_g') || e.destino.includes('_g');
      const on = routeEdges.has([e.origen, e.destino].sort().join('|'));
      if (on) {
        return `<line class="route-casing" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line class="route" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      }
      return `<line class="corridor ${isGallery ? 'gallery-edge' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    })
    .join('');

  let currentCoords = null;
  const circles = Object.entries(nodes)
    .filter(([, n]) => n.piso === floor)
    .map(([id, n]) => {
      const [x, y] = xy(n);
      const s = plan.secciones.find(sec => sec.id === id);
      const current = id === round.posicion;
      if (current) currentCoords = [x, y];
      const isEvent = eventPositions.has(id);
      const isGalleryNode = id.includes('_g');
      let shape = '';
      if (s) {
        if (s.estado === 'cerrada') {
          shape = `<rect class="room cerrada" x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3"/>`;
        } else if (s.estado === 'saturada') {
          shape = `<polygon class="room saturada" points="${x},${y - 10} ${x + 10},${y} ${x},${y + 10} ${x - 10},${y}"/>`;
        } else {
          shape = `<circle class="room abierta" cx="${x}" cy="${y}" r="9"/>`;
        }
      } else if (isGalleryNode) {
        shape = `<rect class="node gallery-node" x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2"/>`;
      } else {
        shape = `<circle class="node" cx="${x}" cy="${y}" r="${n.tipo === 'pasillo' ? 4 : 7}"/>`;
      }
      const eventBadge = isEvent ? `<circle class="event-pin" cx="${x}" cy="${y - 14}" r="6"/><title>Evento en ${esc(nodeName(id))}</title>` : '';
      const label = s
        ? `<text class="room-lbl" x="${x + 4}" y="${y - 13}" transform="rotate(-48 ${x + 4} ${y - 13})">${esc(shortRoomLabel(s))}</text>`
        : n.tipo !== 'pasillo'
          ? `<text x="${x}" y="${y + 24}" text-anchor="middle">${esc(nodeName(id))}</text>`
          : isGalleryNode
            ? `<text class="gallery-lbl" x="${x}" y="${y + 18}" text-anchor="middle">Galería ${id.split('_g')[1]}</text>`
            : '';
      return `<g>${shape}${eventBadge}<title>${esc(nodeName(id))}${s ? ' · ' + s.estado : ''}</title>${label}</g>`;
    })
    .join('');

  const thumbs = currentCoords
    ? `<g class="thumb-group" style="transform:translate(${currentCoords[0]}px, ${currentCoords[1]}px)">${renderThumbnails(0, 0, wheelchair)}</g>`
    : `<g class="thumb-group" style="display:none">${renderThumbnails(0, 0, wheelchair)}</g>`;

  const wheelchairLabel = wheelchair ? ' Paciente en silla de ruedas.' : '';
  return `<svg class="map" viewBox="0 8 820 264" role="img" aria-label="Minimapa del piso ${floor}. Posición: ${esc(nodeName(round.posicion))}. Las miniaturas representan al orientador y al paciente.${wheelchairLabel} La ruta y los estados de las secciones se distinguen mediante líneas y formas: círculo abierto, cuadrado cerrado, rombo saturado.">
    <text class="floor-watermark" x="795" y="256" text-anchor="end">P${floor}</text>
    <g class="map-edges">${lines}</g>
    <g class="map-nodes">${circles}</g>
    ${thumbs}
  </svg>`;
}

/**
 * Vista previa del grafo en la pantalla "Elegir algoritmo" (sin ruta resuelta).
 * Soporta:
 * - Modo 'schematic' (por defecto, Fase 10): Grafo estilo Teoría de Grafos con nodos circulares grandes (r=22px),
 *   colapsando tramos rectos del pasillo sin desvíos y mostrando el costo acumulado real en cada arista.
 * - Modo 'full': Los 16 puntos del pasillo (c0..c15) con todas las secciones.
 */
export function renderPreviewGraphSvg({ plan, round, floor, isWeighted = false, wheelchair = false, nodeName, mode = 'schematic' }) {
  return renderSchematicGraphSvg({ plan, round, floor, isWeighted, wheelchair, nodeName, expanded: mode === 'full' });
}

/**
 * Construye el modelo exacto del grafo esquemático a partir de plan.conexiones
 * y plan.secciones, garantizando 100% de fidelidad con preparar_consulta (tests/test_grafo_esquematico.py).
 * - En modo esquemático (expanded=false), colapsa únicamente puntos de pasillo
 *   con exactamente dos vecinos horizontales consecutivos (grado 2).
 * - En modo completo (expanded=true), conserva todos los puntos de pasillo sin colapsar.
 */
export function buildSchematicGraph({ plan, round, floor, isWeighted, wheelchair, expanded = false }) {
  const nodes = plan.nodos;
  const enabled = new Set(plan.pisos_habilitados);
  const blocked = new Set(round.bloqueados || []);
  const area = round.objetivo || round.pendientes?.[0];
  const graph = new Map(Object.entries(nodes).filter(([, n]) => enabled.has(n.piso)).map(([id]) => [id, []]));
  const edges = [];
  const add = (u, v, cost, directed = false) => {
    const edge = { u, v, cost, directed, path: [u, v] };
    edges.push(edge);
    graph.get(u).push(edge);
    graph.get(v).push(edge);
  };
  for (const e of plan.conexiones) {
    if (!graph.has(e.origen) || !graph.has(e.destino) || e.bloqueada || blocked.has(e.grupo) || (wheelchair && !e.accesible)) continue;
    add(e.origen, e.destino, isWeighted ? e.segundos : 1);
  }
  const destinations = [];
  for (const s of plan.secciones) {
    if (s.area !== area || s.estado === 'cerrada' || !graph.has(s.id)) continue;
    const terminal = `fin_${s.id}`;
    graph.set(terminal, []);
    add(s.id, terminal, isWeighted ? s.espera_segundos : 0, true);
    destinations.push(terminal);
  }
  const keep = new Set([round.posicion, ...destinations]);
  for (const [id, adjacent] of graph) {
    // Solo un punto de pasillo con exactamente dos vecinos horizontales
    // consecutivos es colapsable; conservar cualquier desvío real.
    const m = /^p(\d+)_c(\d+)$/.exec(id);
    if (
      expanded || !m || [0, 7, 15].includes(Number(m[2])) || adjacent.length !== 2 ||
      !adjacent.every(e => !e.directed && (() => {
        const other = e.u === id ? e.v : e.u;
        const k = /^p(\d+)_c(\d+)$/.exec(other);
        return k && k[1] === m[1] && Math.abs(Number(k[2]) - Number(m[2])) === 1;
      })())
    ) {
      keep.add(id);
    }
  }
  const visited = new Set();
  const collapsed = [];
  for (const start of keep) {
    for (const first of graph.get(start) || []) {
      if (visited.has(first)) continue;
      visited.add(first);
      let edge = first;
      let current = edge.u === start ? edge.v : edge.u;
      let cost = edge.cost;
      const path = [start, current];
      while (!keep.has(current)) {
        const next = graph.get(current).find(e => e !== edge);
        if (!next || visited.has(next)) throw new Error('Ciclo sin nodo clave en el grafo esquemático');
        visited.add(next);
        edge = next;
        current = edge.u === current ? edge.v : edge.u;
        cost += edge.cost;
        path.push(current);
      }
      // Los terminales son dirigidos: preservar la orientación original.
      if (first.directed && first.u !== start) path.reverse();
      collapsed.push({ u: path[0], v: path.at(-1), cost, directed: first.directed, path });
    }
  }
  if (visited.size !== edges.length) throw new Error('Aristas no representadas en el grafo esquemático');
  const floorOf = id => nodes[id]?.piso ?? nodes[id.replace(/^fin_/, '')]?.piso;
  return {
    nodes: [...keep].filter(id => floorOf(id) === floor),
    edges: collapsed.filter(e => floorOf(e.u) === floor || floorOf(e.v) === floor),
    destinations: destinations.filter(id => floorOf(id) === floor),
    floorOf,
  };
}

/**
 * Renderiza el grafo topológico en bandas horizontales limpias (CERO cruces diagonales):
 * - Banda 1 (arriba): Terminales dirigidos de destino (fin_*)
 * - Banda 2: Salas / Secciones (destacando origen y destinos de etapa; salas auxiliares compactas)
 * - Banda 3 (centro): Pasillo principal en línea recta horizontal (c0 ── ... ── c7 ── ... ── c15)
 * - Banda 4 (intermedia): Accesos verticales (Ascensor A, Escalera, Ascensor B) y enlaces a pisos vecinos
 * - Banda 5 (abajo): Galería paralela alineada (g0 ──── g7 ──── g15)
 */
function renderSchematicGraphSvg({ plan, round, floor, isWeighted, wheelchair, nodeName, expanded = false }) {
  const model = buildSchematicGraph({ plan, round, floor, isWeighted, wheelchair, expanded });
  const nodes = plan.nodos;
  const blocked = new Set(round.bloqueados || []);
  const pendingAreas = new Set(round.pendientes || []);
  const currentArea = round.objetivo || round.pendientes?.[0];
  const originId = String(round.posicion || '').replace(/^fin_/, '');

  const ids = new Set(model.nodes);
  for (const e of model.edges) {
    ids.add(e.u);
    ids.add(e.v);
  }

  // 1. Calcular eje X proporcional sin cruces a partir de los puntos de pasillo presentes en este piso
  const corrIndices = [];
  for (const id of ids) {
    const m = new RegExp(`^p${floor}_c(\\d+)$`).exec(id);
    if (m) corrIndices.push(Number(m[1]));
  }
  corrIndices.sort((a, b) => a - b);

  const xByCorrIdx = new Map();
  const isCompact = corrIndices.length <= 10;
  let curX = 148;
  corrIndices.forEach((idx, pos) => {
    if (pos > 0) {
      const gap = idx - corrIndices[pos - 1];
      curX += isCompact ? (gap > 1 ? 124 : 84) : 68;
    }
    xByCorrIdx.set(idx, curX);
  });

  const x0 = xByCorrIdx.get(0) ?? 148;
  const x7 = xByCorrIdx.get(7) ?? 560;
  const x15 = xByCorrIdx.get(15) ?? (curX || 880);
  const width = Math.max(920, x15 + 165);

  const Y_TERM = 38;
  const Y_ROOM = 112;
  const Y_CORR = 204;
  const Y_CONN = 286;
  const Y_GAL = 378;
  const height = 430;

  // 2. Asignar coordenadas topológicas deterministas a cada nodo
  const positions = new Map();
  const secById = new Map(plan.secciones.map(s => [s.id, s]));

  // Identificar nodos clave (grandes r=21px) frente a nodos auxiliares del piso (compactos)
  const keyCorridorSet = new Set([`p${floor}_c0`, `p${floor}_c7`, `p${floor}_c15`]);
  const isKeyNode = id => {
    if (id === originId || id.startsWith('fin_')) return true;
    const sec = secById.get(id);
    if (sec) return sec.area === currentArea || pendingAreas.has(sec.area);
    if (id.includes('_g') || id.includes('ascensor') || id.includes('escalera')) return true;
    if (keyCorridorSet.has(id)) return true;
    return false;
  };

  for (const id of ids) {
    const raw = id.replace(/^fin_/, '');
    const n = nodes[raw];
    const nodeFloor = model.floorOf(id);

    if (id.startsWith('fin_')) {
      const cIdx = Math.round((n?.x ?? 0) / 4);
      const x = xByCorrIdx.get(cIdx) ?? x0;
      keyCorridorSet.add(`p${floor}_c${cIdx}`);
      positions.set(id, [x, Y_TERM]);
    } else if (secById.has(id)) {
      const cIdx = Math.round((n?.x ?? 0) / 4);
      const x = xByCorrIdx.get(cIdx) ?? x0;
      if (id === originId || pendingAreas.has(secById.get(id).area)) {
        keyCorridorSet.add(`p${floor}_c${cIdx}`);
      }
      positions.set(id, [x, Y_ROOM]);
    } else if (new RegExp(`^p${floor}_c(\\d+)$`).test(id)) {
      const cIdx = Number(id.split('_c')[1]);
      positions.set(id, [xByCorrIdx.get(cIdx) ?? x0, Y_CORR]);
    } else if (new RegExp(`^p${floor}_g(\\d+)$`).test(id)) {
      const gIdx = Number(id.split('_g')[1]);
      positions.set(id, [xByCorrIdx.get(gIdx) ?? (gIdx === 0 ? x0 : gIdx === 7 ? x7 : x15), Y_GAL]);
    } else if (id.includes('ascensor_a')) {
      const baseX = x0 - 74;
      if (nodeFloor === floor) positions.set(id, [baseX, Y_CONN]);
      else if (nodeFloor > floor) positions.set(id, [baseX, Y_CONN - 72]);
      else positions.set(id, [baseX, Y_CONN + 72]);
    } else if (id.includes('ascensor_b')) {
      const baseX = x15 + 74;
      if (nodeFloor === floor) positions.set(id, [baseX, Y_CONN]);
      else if (nodeFloor > floor) positions.set(id, [baseX, Y_CONN - 72]);
      else positions.set(id, [baseX, Y_CONN + 72]);
    } else if (id.includes('escalera')) {
      const baseX = x7 - 68;
      if (nodeFloor === floor) positions.set(id, [baseX, Y_CONN]);
      else if (nodeFloor > floor) positions.set(id, [baseX - 96, Y_CONN - 30]);
      else positions.set(id, [baseX - 96, Y_CONN + 30]);
    } else {
      positions.set(id, [x0, Y_CORR]);
    }
  }

  // 3. Renderizar aristas con costos acumulados reales y atributos data-* exigidos por test_grafo_esquematico.py
  const drawWeightPill = (cx, cy, text, variant = '', compact = false) => {
    const h = compact ? 16 : 20;
    const w = Math.max(compact ? 24 : 34, text.length * (compact ? 5.8 : 6.6) + (compact ? 10 : 14));
    const fontCls = compact ? 'sch-weight-txt sch-wt-muted' : `sch-weight-txt ${variant ? 'sch-wt-' + variant.replace('sch-w-', '') : ''}`;
    return `<rect class="sch-weight-box ${variant} ${compact ? 'sch-w-muted' : ''}" x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="5"/><text class="${fontCls}" x="${cx.toFixed(1)}" y="${(cy + (compact ? 3 : 3.5)).toFixed(1)}" text-anchor="middle">${esc(text)}</text>`;
  };

  const edgesHtml = model.edges.map(e => {
    const [x1, y1] = positions.get(e.u);
    const [x2, y2] = positions.get(e.v);
    const isGallery = e.u.includes('_g') || e.v.includes('_g');
    const isInterFloor = model.floorOf(e.u) !== floor || model.floorOf(e.v) !== floor;
    const isVertical = isInterFloor || e.u.includes('ascensor') || e.v.includes('ascensor') || e.u.includes('escalera') || e.v.includes('escalera');
    const isSecondaryRoomEdge = !e.directed && !isGallery && !isVertical && (
      (secById.has(e.u) && !isKeyNode(e.u)) || (secById.has(e.v) && !isKeyNode(e.v))
    );
    const isSlowEdge = isWeighted && isInterFloor && e.cost >= 120;

    const unitSuffix = isWeighted ? 's' : '';
    const label = e.directed
      ? `${e.cost}${unitSuffix} →`
      : isSlowEdge
        ? `🐢 ${e.cost}s`
        : `${e.cost}${unitSuffix}`;

    let lineCls = 'sch-edge';
    let pillVariant = '';
    if (e.directed) {
      lineCls = 'sch-edge sch-directed';
      pillVariant = 'sch-w-target';
    } else if (isGallery) {
      lineCls = 'sch-edge sch-gallery';
      pillVariant = 'sch-w-gallery';
    } else if (isSlowEdge) {
      lineCls = 'sch-edge sch-slow';
      pillVariant = 'sch-w-slow';
    } else if (isVertical) {
      lineCls = 'sch-edge sch-vertical';
    } else if (isSecondaryRoomEdge) {
      lineCls = 'sch-edge sch-edge-muted';
    }

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return `<g class="sch-edge-group" data-u="${esc(e.u)}" data-v="${esc(e.v)}" data-cost="${e.cost}" data-path="${esc(e.path.join(','))}" data-directed="${e.directed}"><line class="${lineCls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${drawWeightPill(mx, my, label, pillVariant, isSecondaryRoomEdge)}</g>`;
  }).join('');

  // 4. Renderizar nodos con jerarquía visual clara (nodos clave grandes r=20..22px; salas auxiliares compactas r=11px)
  const nodesHtml = [...ids].map(id => {
    const [x, y] = positions.get(id);
    const terminal = id.startsWith('fin_');
    const raw = terminal ? id.slice(4) : id;
    const sec = secById.get(raw);
    const nodeFloor = model.floorOf(id);
    const isOtherFloor = nodeFloor !== floor;
    const isOrigin = id === originId;
    const isTargetSec = Boolean(sec && (sec.area === currentArea || pendingAreas.has(sec.area)));
    const isGallery = id.includes('_g');
    const isCorr = new RegExp(`^p${floor}_c(\\d+)$`).test(id);
    const isAscA = id.includes('ascensor_a');
    const isAscB = id.includes('ascensor_b');
    const isEsc = id.includes('escalera');
    const key = isKeyNode(id);

    const r = terminal ? 19 : key ? (isOtherFloor ? 17 : 21) : 11;

    let circleCls = 'sch-node-corridor';
    if (terminal) {
      circleCls = sec?.estado === 'saturada' ? 'sch-node-saturated' : 'sch-node-open';
    } else if (isOrigin) {
      circleCls = 'sch-node-origin';
    } else if (sec) {
      if (!isTargetSec) circleCls = 'sch-node-muted';
      else if (sec.estado === 'cerrada') circleCls = 'sch-node-closed';
      else if (sec.estado === 'saturada') circleCls = 'sch-node-saturated';
      else circleCls = 'sch-node-open';
    } else if (isGallery) {
      circleCls = 'sch-node-gallery';
    } else if (isAscA || isAscB || isEsc) {
      const connBlocked = (isAscA && blocked.has('ascensor_a')) || (isAscB && blocked.has('ascensor_b')) || (isEsc && wheelchair);
      circleCls = connBlocked ? 'sch-node-closed' : isOtherFloor ? 'sch-node-other-floor' : 'sch-node-vertical';
    } else if (isCorr && !key) {
      circleCls = 'sch-node-corridor-minor';
    }

    let codeTxt = '';
    let subTxt = '';
    let subY = y + r + 12;

    if (terminal) {
      codeTxt = `★ ${raw.split('_').at(-1)}`;
      subTxt = `Meta ${shortRoomLabel(sec)}`;
      subY = y - r - 6;
    } else if (isOrigin) {
      codeTxt = 'ORIGEN';
      subTxt = sec ? shortRoomLabel(sec) : nodeName(id);
      subY = y - r - 8;
    } else if (sec) {
      codeTxt = shortRoomLabel(sec);
      subTxt = isTargetSec ? (sec.estado === 'cerrada' ? '🔒 Cerrada' : sec.estado === 'saturada' ? `⏱ +${sec.espera_segundos}s` : '') : '';
      subY = y - r - 6;
    } else if (isCorr) {
      codeTxt = `c${id.split('_c')[1]}`;
      subTxt = '';
    } else if (isGallery) {
      codeTxt = `g${id.split('_g')[1]}`;
      subTxt = `Galería ${id.split('_g')[1]}`;
      subY = y + r + 13;
    } else if (isAscA) {
      codeTxt = isOtherFloor ? `P${nodeFloor}` : 'Asc.A';
      subTxt = isOtherFloor ? `Asc.A P${nodeFloor}` : (blocked.has('ascensor_a') ? '⛔ Bloq.' : '');
      subY = isOtherFloor ? (nodeFloor > floor ? y - r - 6 : y + r + 12) : y + r + 12;
    } else if (isAscB) {
      codeTxt = isOtherFloor ? `P${nodeFloor}` : 'Asc.B';
      subTxt = isOtherFloor ? `Asc.B P${nodeFloor}` : (blocked.has('ascensor_b') ? '⛔ Bloq.' : '');
      subY = isOtherFloor ? (nodeFloor > floor ? y - r - 6 : y + r + 12) : y + r + 12;
    } else if (isEsc) {
      codeTxt = isOtherFloor ? `P${nodeFloor}` : 'Esc.';
      subTxt = isOtherFloor ? `Esc. P${nodeFloor}` : (wheelchair ? '♿ No acc.' : 'Escalera');
      subY = isOtherFloor ? (nodeFloor > floor ? y - r - 5 : y + r + 11) : y + r + 12;
    } else {
      codeTxt = nodeName(id).slice(0, 6);
    }

    const ring = isOrigin
      ? `<circle class="sch-origin-ring" cx="${x}" cy="${y}" r="${r + 4}"/>`
      : terminal
        ? `<circle class="sch-target-ring" cx="${x}" cy="${y}" r="${r + 4}"/>`
        : '';

    const fullTitle = terminal
      ? `Destino ${nodeName(raw)} · terminal dirigido de llegada`
      : `${isOrigin ? 'Origen: ' : ''}${nodeName(id)}${isOtherFloor ? ` · P${nodeFloor}` : ''}${sec ? ` · ${sec.estado}` : ''}`;

    const codeCls = !key ? 'sch-code sch-code-muted' : 'sch-code';
    const subCls = isOrigin ? 'sch-badge-orig' : terminal ? 'sch-badge-target' : 'sch-sub';

    return `<g class="sch-node ${!key ? 'sch-node-aux' : ''}" data-node="${esc(id)}">${ring}<circle class="sch-circle ${circleCls}" cx="${x}" cy="${y}" r="${r}"/><text class="${codeCls}" x="${x}" y="${y + (key ? 3.5 : 3)}" text-anchor="middle">${esc(codeTxt)}</text>${subTxt ? `<text class="${subCls}" x="${x}" y="${subY}" text-anchor="middle">${esc(subTxt)}</text>` : ''}<title>${esc(fullTitle)}</title></g>`;
  }).join('');

  return `<svg class="map preview-map schematic-map" style="width:${width}px;height:${height}px;max-width:none" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafo del piso ${floor}; cada arista indica su costo real en ${isWeighted ? 'segundos' : 'tramos'}. Las flechas indican terminales dirigidos."><text class="floor-watermark" x="${width - 24}" y="${height - 16}" text-anchor="end">P${floor}</text><g class="sch-edges">${edgesHtml}</g><g class="sch-nodes">${nodesHtml}</g></svg>`;
}

/**
 * Monta o actualiza el minimapa de forma incremental (DOM persistente).
 * Conserva el <svg> entre avances en el mismo piso para animar suavemente
 * las miniaturas y dibujar progresivamente la ruta ámbar al calcular una nueva ruta.
 */
export function mountOrUpdateMinimap(container, opts) {
  const { plan, round, floor, wheelchair = false, nodeName, useHistory = false } = opts;
  const routeKey = useHistory
    ? `hist-${round.historial?.length || 0}`
    : (round.ruta || []).join(',');
  const mapKey = `${floor}|${routeKey}|${wheelchair}`;

  if (container.dataset.mapKey !== mapKey || !container.querySelector('svg.map')) {
    container.dataset.mapKey = mapKey;
    container.innerHTML = renderMinimapSvg(opts);
    container.querySelectorAll('line.route').forEach(line => {
      line.classList.add('route-draw');
    });
    return;
  }

  const node = plan.nodos?.[round.posicion];
  const svg = container.querySelector('svg.map');
  const group = container.querySelector('.thumb-group');
  const wheelchairLabel = wheelchair ? ' Paciente en silla de ruedas.' : '';
  if (svg) {
    svg.setAttribute('aria-label', `Minimapa del piso ${floor}. Posición: ${nodeName(round.posicion)}. Las miniaturas representan al orientador y al paciente.${wheelchairLabel} La ruta y los estados de las secciones se distinguen mediante líneas y formas: círculo abierto, cuadrado cerrado, rombo saturado.`);
  }
  if (group) {
    if (node && node.piso === floor) {
      const [x, y] = xy(node);
      group.style.display = '';
      group.style.transform = `translate(${x}px, ${y}px)`;
    } else {
      group.style.display = 'none';
    }
  }
}
