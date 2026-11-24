/**
 * multifloor_graph.js — Grafo multipiso unificado apilado verticalmente (Piso 1 → Piso N).
 * Soporta modo esquemático topológico por defecto (colapsando tramos rectos de grado 2 con
 * su costo acumulado real) y modo expandido (16 puntos del pasillo), en los tres modos:
 * - 'preview': estructura, costos reales, origen, destinos y restricciones (Elegir estrategia)
 * - 'walk': avance sincronizado en vivo con "Avanzar al siguiente punto" (Recorrido)
 * - 'trace': exploración paso a paso desde traza_busqueda (Exploración del Algoritmo en Resultado)
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

const FLOOR_THEME = {
  1: { bg: '#EFF6FF', border: '#93C5FD', badge: '#2B5B84', accent: '#1D4ED8' },
  2: { bg: '#F5F3FF', border: '#C4B5FD', badge: '#6D28D9', accent: '#5B21B6' },
  3: { bg: '#ECFEFF', border: '#67E8F9', badge: '#0E7490', accent: '#0E7490' },
  4: { bg: '#F1F5F9', border: '#CBD5E1', badge: '#475569', accent: '#334155' },
  5: { bg: '#FDF2F8', border: '#F9A8D4', badge: '#BE185D', accent: '#9D174D' },
};

function cleanId(id) {
  return String(id || '').replace(/^fin_/, '');
}

function shortLabel(id, plan) {
  const clean = cleanId(id);
  const sec = plan?.secciones?.find(s => s.id === clean);
  if (sec) return `${SHORT_AREAS[sec.area] || sec.area.slice(0, 4)} ${clean.split('_').at(-1)}`;
  if (clean.includes('ascensor_a')) return 'Asc.A';
  if (clean.includes('ascensor_b')) return 'Asc.B';
  if (clean.includes('escalera')) return 'Esc.';
  if (clean.includes('_g')) return `g${clean.split('_g')[1]}`;
  if (clean.includes('_c')) return `c${clean.split('_c')[1]}`;
  return clean;
}

/**
 * Construye el modelo exacto del grafo multipiso a partir de plan.conexiones y plan.secciones.
 * - Cuando expanded=false (esquemático por defecto), colapsa únicamente puntos de pasillo
 *   horizontales de grado 2 (sin desvíos) acumulando el costo real de sus aristas.
 * - Cuando expanded=true (completo 16 pts), conserva todos los puntos del pasillo sin colapsar.
 * Contrasta 1-a-1 con preparar_consulta en C01–C10, restricciones y eventos.
 */
export function buildMultiFloorSchematicGraph({
  plan,
  round,
  isWeighted = false,
  wheelchair = false,
  expanded = false,
  relevantIds = null,
}) {
  const nodes = plan.nodos || {};
  const floors = [...(plan.pisos_habilitados || [1])].sort((a, b) => a - b);
  const enabled = new Set(floors);
  const blocked = new Set(round?.bloqueados || []);
  const area = round?.objetivo || round?.pendientes?.[0];
  const originId = cleanId(round?.posicion);

  const graph = new Map(
    Object.entries(nodes)
      .filter(([, n]) => enabled.has(n.piso))
      .map(([id]) => [id, []])
  );
  const edges = [];
  const add = (u, v, cost, directed = false) => {
    const edge = { u, v, cost, directed, path: [u, v] };
    edges.push(edge);
    graph.get(u).push(edge);
    graph.get(v).push(edge);
  };

  for (const e of plan.conexiones || []) {
    if (!graph.has(e.origen) || !graph.has(e.destino)) continue;
    if (e.bloqueada || (e.grupo && blocked.has(e.grupo)) || (wheelchair && !e.accesible)) continue;
    add(e.origen, e.destino, isWeighted ? e.segundos : 1, false);
  }

  const destinations = [];
  for (const s of plan.secciones || []) {
    if (s.area !== area || s.estado === 'cerrada' || !graph.has(s.id)) continue;
    const terminal = `fin_${s.id}`;
    graph.set(terminal, []);
    add(s.id, terminal, isWeighted ? s.espera_segundos : 0, true);
    destinations.push(terminal);
  }

  const keep = new Set([originId, ...destinations].filter(id => graph.has(id)));
  if (relevantIds) {
    for (const rId of relevantIds) {
      if (!rId) continue;
      const sId = String(rId);
      const clean = cleanId(sId);
      if (graph.has(sId)) keep.add(sId);
      if (graph.has(clean)) keep.add(clean);
    }
  }
  for (const [id, adjacent] of graph) {
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
        if (!next || visited.has(next)) {
          throw new Error('Ciclo sin nodo clave en el grafo multipiso esquemático');
        }
        visited.add(next);
        edge = next;
        current = edge.u === current ? edge.v : edge.u;
        cost += edge.cost;
        path.push(current);
      }
      if (first.directed && first.u !== start) path.reverse();
      collapsed.push({ u: path[0], v: path.at(-1), cost, directed: first.directed, path });
    }
  }
  if (visited.size !== edges.length) {
    throw new Error('Aristas no representadas en el grafo multipiso esquemático');
  }

  const floorOf = id => nodes[id]?.piso ?? nodes[cleanId(id)]?.piso;
  return {
    floors,
    nodes: [...keep],
    edges: collapsed,
    destinations,
    floorOf,
  };
}

/**
 * Construye el camino ya recorrido hasta el paso actual del jugador en modo 'walk'.
 */
function extractWalkProgress(round) {
  const visitedNodes = new Set();
  const walkedEdges = new Set();
  const historial = round?.historial || [];
  let prev = null;

  for (const entry of historial) {
    if (entry.accion === 'inicio' || entry.accion === 'eleccion' || entry.accion === 'avance') {
      const pos = cleanId(entry.posicion);
      if (pos) {
        visitedNodes.add(pos);
        if (prev && prev !== pos && entry.accion === 'avance') {
          walkedEdges.add([prev, pos].sort().join('|'));
        }
        prev = pos;
      }
    }
  }
  const currentPos = cleanId(round?.posicion);
  if (currentPos) visitedNodes.add(currentPos);
  return { visitedNodes, walkedEdges, currentPos };
}

/**
 * Extrae todos los identificadores de nodos tocados en una traza de búsqueda:
 * origen, objetivo, destinos, y en cada evento: nodo, desde, frontera y ruta.
 */
export function extractTraceRelevantNodes(trace) {
  if (!trace) return null;
  const set = new Set();
  if (trace.origen) {
    set.add(String(trace.origen));
    set.add(cleanId(trace.origen));
  }
  if (Array.isArray(trace.destinos)) {
    for (const d of trace.destinos) {
      if (d) {
        set.add(String(d));
        set.add(cleanId(d));
      }
    }
  }
  if (Array.isArray(trace.eventos)) {
    for (const ev of trace.eventos) {
      if (!ev) continue;
      if (ev.nodo) {
        set.add(String(ev.nodo));
        set.add(cleanId(ev.nodo));
      }
      if (ev.desde) {
        set.add(String(ev.desde));
        set.add(cleanId(ev.desde));
      }
      if (Array.isArray(ev.frontera)) {
        for (const f of ev.frontera) {
          if (f) {
            set.add(String(f));
            set.add(cleanId(f));
          }
        }
      }
      if (Array.isArray(ev.ruta)) {
        for (const r of ev.ruta) {
          if (r) {
            set.add(String(r));
            set.add(cleanId(r));
          }
        }
      }
    }
  }
  return set;
}

/**
 * Extrae todos los identificadores de nodos relevantes en el modo 'walk' (recorrido):
 * ruta planificada de la etapa actual, historial recorrido y posición actual.
 */
export function extractWalkRelevantNodes(round) {
  if (!round) return null;
  const set = new Set();
  if (round.posicion) {
    set.add(String(round.posicion));
    set.add(cleanId(round.posicion));
  }
  if (Array.isArray(round.ruta)) {
    for (const r of round.ruta) {
      if (r) {
        set.add(String(r));
        set.add(cleanId(r));
      }
    }
  }
  if (Array.isArray(round.historial)) {
    for (const h of round.historial) {
      if (h && h.posicion) {
        set.add(String(h.posicion));
        set.add(cleanId(h.posicion));
      }
    }
  }
  return set;
}

/**
 * Renderiza el grafo multipiso unificado apilado verticalmente.
 * @param {object} opts { plan, round, mode, isWeighted, wheelchair, nodeName, traceSnap, expanded, relevantIds }
 */
export function renderMultiFloorGraphSvg({
  plan,
  round,
  mode = 'preview',
  isWeighted = false,
  wheelchair = false,
  nodeName,
  traceSnap = null,
  expanded = false,
  describedById = '',
  relevantIds = null,
  trace = null,
  traza = null,
}) {
  let activeRelevant = relevantIds;
  if (!activeRelevant) {
    if (mode === 'trace') {
      const activeTrace = trace || traza || round?.segmentos?.at(-1)?.traza_busqueda || round?.segmentos?.[0]?.traza_busqueda;
      activeRelevant = extractTraceRelevantNodes(activeTrace);
    } else if (mode === 'walk') {
      activeRelevant = extractWalkRelevantNodes(round);
    }
  }
  const useExpanded = Boolean(expanded);
  const model = buildMultiFloorSchematicGraph({
    plan,
    round,
    isWeighted,
    wheelchair,
    expanded: useExpanded,
    relevantIds: activeRelevant,
  });

  const floors = model.floors;
  const nodes = plan.nodos || {};
  const blocked = new Set(round?.bloqueados || []);
  const pendingAreas = new Set(round?.pendientes || []);
  const currentTargetArea = round?.objetivo || round?.pendientes?.[0];
  const originId = cleanId(round?.posicion);
  const secById = new Map((plan.secciones || []).map(s => [s.id, s]));
  const keptNodeSet = new Set(model.nodes);

  const isPreview = mode === 'preview';
  const BAND_H = isPreview ? 310 : 180;
  const PAD_TOP = 12;
  const WIDTH = isPreview ? 1320 : 936;
  const HEIGHT = PAD_TOP + floors.length * BAND_H + 12;

  const floorBandTop = new Map();
  floors.forEach((f, idx) => floorBandTop.set(f, PAD_TOP + idx * BAND_H));

  const xForCol = col => (isPreview ? 156 + col * 68 : 116 + col * 48);

  const posOf = id => {
    const isTerm = String(id).startsWith('fin_');
    const clean = cleanId(id);
    const n = nodes[clean];
    if (!n || !floorBandTop.has(n.piso)) return null;
    const top = floorBandTop.get(n.piso);
    const col = Math.round(n.x / 4);
    const baseX = xForCol(col);

    if (isPreview) {
      if (isTerm) return [baseX, top + 38];
      if (n.tipo === 'seccion') return [baseX, top + 106];
      if (clean.includes('_g')) return [baseX, top + 266];
      if (clean.includes('ascensor_a')) return [baseX - 68, top + 224];
      if (clean.includes('escalera')) return [baseX - 68, top + 224];
      if (clean.includes('ascensor_b')) return [baseX + 68, top + 224];
      return [baseX, top + 178];
    }

    if (isTerm) return [baseX, top + 24];
    if (n.tipo === 'seccion') return [baseX, top + 58];
    if (clean.includes('_g')) return [baseX, top + 150];
    if (clean.includes('ascensor_a')) return [baseX - 36, top + 122];
    if (clean.includes('escalera')) return [baseX - 34, top + 122];
    if (clean.includes('ascensor_b')) return [baseX + 36, top + 122];
    return [baseX, top + 100];
  };

  const walk = mode === 'walk' ? extractWalkProgress(round) : null;

  // 1. Bandas de fondo por piso con selector estable data-floor
  const bandsSvg = floors.map(f => {
    const top = floorBandTop.get(f);
    const th = FLOOR_THEME[f] || FLOOR_THEME[1];
    return `<g class="mf-floor-band" data-floor="${f}"><rect x="8" y="${top}" width="${WIDTH - 16}" height="${BAND_H - 10}" rx="12" fill="${th.bg}" stroke="${th.border}" stroke-width="1.5"/><rect x="16" y="${top + 8}" width="62" height="22" rx="6" fill="${th.badge}"/><text class="mf-floor-tag" x="47" y="${top + 23}" text-anchor="middle">PISO ${f}</text></g>`;
  }).join('');

  // 2a. Aristas bloqueadas o inaccesibles (solo guía visual, SIN data-path)
  const blockedEdgesSvg = (plan.conexiones || []).map(e => {
    const na = nodes[e.origen];
    const nb = nodes[e.destino];
    if (!na || !nb || !floorBandTop.has(na.piso) || !floorBandTop.has(nb.piso)) return '';
    const isBlocked = e.bloqueada || (e.grupo && blocked.has(e.grupo));
    const isInaccessible = wheelchair && !e.accesible;
    if (!isBlocked && !isInaccessible) return '';
    const p1 = posOf(e.origen);
    const p2 = posOf(e.destino);
    if (!p1 || !p2) return '';
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const txt = isBlocked ? '⛔' : '♿';
    const pw = isPreview ? 30 : 24;
    const ph = isPreview ? 22 : 16;
    return `<g class="mf-edge-disabled"><line class="mf-edge mf-edge-blocked" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><rect class="mf-wpill mf-wpill-blocked" x="${mx - pw / 2}" y="${my - ph / 2}" width="${pw}" height="${ph}" rx="5"/><text class="mf-wtxt ${isPreview ? 'mf-wtxt-lg' : ''} mf-wtxt-blocked" x="${mx}" y="${my + (isPreview ? 4.5 : 3)}" text-anchor="middle">${txt}</text></g>`;
  }).join('');

  // 2b. Aristas accesibles reales del modelo (con data-u, data-v, data-cost, data-path, data-directed)
  const edgesSvg = model.edges.map(e => {
    const p1 = posOf(e.u);
    const p2 = posOf(e.v);
    if (!p1 || !p2) return '';
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const fU = model.floorOf(e.u);
    const fV = model.floorOf(e.v);
    const isInterFloor = fU !== fV;
    const isGallery = e.u.includes('_g') || e.v.includes('_g');
    const isCollapsed = e.path.length > 2;
    const isSlow = isWeighted && isInterFloor && e.cost >= 120;
    const edgeKey = [cleanId(e.u), cleanId(e.v)].sort().join('|');

    let cls = 'mf-edge';
    if (e.directed) {
      cls += ' mf-edge-directed';
    } else if (mode === 'walk' && walk.walkedEdges.has(edgeKey)) {
      cls += ' mf-edge-walked';
    } else if (mode === 'trace' && traceSnap) {
      const isFinal = traceSnap.finalEdgeSet.has(edgeKey);
      const isActiveEdge = (traceSnap.activeNode === cleanId(e.u) && traceSnap.activeFrom === cleanId(e.v))
        || (traceSnap.activeNode === cleanId(e.v) && traceSnap.activeFrom === cleanId(e.u));
      const isTreeEdge = traceSnap.treeEdges.get(cleanId(e.u)) === cleanId(e.v)
        || traceSnap.treeEdges.get(cleanId(e.v)) === cleanId(e.u);
      if (isFinal) cls += ' mf-edge-final';
      else if (isActiveEdge) cls += ' mf-edge-active';
      else if (isTreeEdge) cls += ' mf-edge-tree';
      else if (isInterFloor) cls += ' mf-edge-inter';
      else if (isGallery) cls += ' mf-edge-gallery';
    } else {
      if (isSlow) cls += ' mf-edge-slow';
      else if (isInterFloor) cls += ' mf-edge-inter';
      else if (isGallery) cls += ' mf-edge-gallery';
      else if (isCollapsed) cls += ' mf-edge-collapsed';
    }

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const unitSuffix = isWeighted ? 's' : '';
    const costLabel = e.directed
      ? `${e.cost}${unitSuffix}→`
      : isSlow
        ? `🐢${e.cost}s`
        : `${e.cost}${unitSuffix}`;

    const showPill = isCollapsed || isInterFloor || e.directed || (isGallery && e.u.includes('_g') && e.v.includes('_g'));
    let labelHtml = '';
    if (showPill) {
      const pillCls = e.directed
        ? 'mf-wpill-term'
        : isSlow
          ? 'mf-wpill-slow'
          : isCollapsed
            ? 'mf-wpill-collapsed'
            : isGallery
              ? 'mf-wpill-gal'
              : 'mf-wpill-inter';
      const ph = isPreview ? 22 : 18;
      const w = isPreview
        ? Math.max(32, costLabel.length * 7.6 + 14)
        : Math.max(26, costLabel.length * 6.4 + 10);
      const dy = isPreview ? 4.5 : 3.5;
      labelHtml = `<rect class="mf-wpill ${pillCls}" x="${(mx - w / 2).toFixed(1)}" y="${(my - ph / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${ph}" rx="${isPreview ? 6 : 4}"/><text class="mf-wtxt ${isPreview ? 'mf-wtxt-lg' : ''}" x="${mx.toFixed(1)}" y="${(my + dy).toFixed(1)}" text-anchor="middle">${esc(costLabel)}</text>`;
    } else if (isPreview) {
      const w = Math.max(24, costLabel.length * 7 + 10);
      labelHtml = `<rect class="mf-wpill mf-wpill-mini" x="${(mx - w / 2).toFixed(1)}" y="${(my - 9.5).toFixed(1)}" width="${w.toFixed(1)}" height="19" rx="5"/><text class="mf-wmini mf-wmini-lg" x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle">${esc(costLabel)}</text>`;
    } else {
      labelHtml = `<text class="mf-wmini" x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" text-anchor="middle">${esc(costLabel)}</text>`;
    }

    return `<g class="mf-edge-group" data-u="${esc(e.u)}" data-v="${esc(e.v)}" data-cost="${e.cost}" data-path="${esc(e.path.join(','))}" data-directed="${e.directed}"><line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${labelHtml}</g>`;
  }).join('');

  // 3. Nodos (conservando todos los nodos clave/relevantes del modelo + salas cerradas)
  const renderIds = new Set(model.nodes);
  for (const s of plan.secciones || []) {
    if (floorBandTop.has(s.piso) && s.estado === 'cerrada') renderIds.add(s.id);
  }

  const nodesSvg = [...renderIds].map(id => {
    const p = posOf(id);
    if (!p) return '';
    const [x, y] = p;
    const isTerm = id.startsWith('fin_');
    const clean = cleanId(id);
    const n = nodes[clean];
    const sec = secById.get(clean);
    const isGallery = !isTerm && clean.includes('_g');
    const isConn = !isTerm && (clean.includes('ascensor') || clean.includes('escalera'));
    const isOrigin = !isTerm && clean === originId;
    const isTarget = Boolean(!isTerm && sec && (sec.area === currentTargetArea || pendingAreas.has(sec.area)));
    const th = FLOOR_THEME[n.piso] || FLOOR_THEME[1];

    let shape = '';
    let halo = '';
    let titleExtra = '';

    if (isTerm) {
      const rTerm = isPreview ? 20 : 7.5;
      halo = `<circle class="mf-target-halo" cx="${x}" cy="${y}" r="${rTerm + 4}"/>`;
      shape = `<circle class="mf-dot ${sec?.estado === 'saturada' ? 'mf-sat' : 'mf-open'}" cx="${x}" cy="${y}" r="${rTerm}"/><text class="${isPreview ? 'mf-code-lg mf-code-light' : 'mf-sym'}" x="${x}" y="${y + (isPreview ? 4 : 3)}" text-anchor="middle">${isPreview ? `★ ${clean.split('_').at(-1)}` : '★'}</text>`;
      titleExtra = ' · Terminal de destino';
    } else if (sec && sec.estado === 'cerrada') {
      const half = isPreview ? 19 : 8;
      shape = `<rect class="mf-room mf-closed" x="${x - half}" y="${y - half}" width="${half * 2}" height="${half * 2}" rx="${isPreview ? 6 : 3}"/><text class="${isPreview ? 'mf-code-lg mf-code-light' : 'mf-sym'}" x="${x}" y="${y + (isPreview ? 4 : 3)}" text-anchor="middle">${isPreview ? '🔒' : '✕'}</text>`;
      titleExtra = ' · Cerrada';
    } else if (mode === 'trace' && traceSnap) {
      const st = traceSnap.nodeStatus.get(clean);
      const isActive = traceSnap.activeNode === clean;
      const isDiscarded = isActive && traceSnap.currentEv?.tipo === 'descartar';
      const isFinal = traceSnap.finalRoute.has(clean);
      const inFrontier = traceSnap.frontierSet.has(clean);
      const r = sec ? 9 : isConn ? 8.5 : isGallery ? 7 : 5.5;

      if (isDiscarded) {
        shape = `<polygon class="mf-dot mf-tr-discarded" points="${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}"/><text class="mf-sym" x="${x}" y="${y + 3}" text-anchor="middle">✕</text>`;
        titleExtra = ' · Descartado';
      } else if (isFinal) {
        shape = `<circle class="mf-dot mf-tr-final" cx="${x}" cy="${y}" r="${Math.max(r, 8.5)}"/><text class="mf-sym" x="${x}" y="${y + 3}" text-anchor="middle">★</text>`;
        titleExtra = ' · Ruta final';
      } else if (st?.status === 'processed' || st?.status === 'goal') {
        shape = `<circle class="mf-dot mf-tr-processed" cx="${x}" cy="${y}" r="${Math.max(r, 8)}"/><text class="mf-sym" x="${x}" y="${y + 3}" text-anchor="middle">✓</text>`;
        titleExtra = ' · Procesado (+1 exp.)';
      } else if (st?.status === 'discovered' || inFrontier) {
        shape = `<circle class="mf-dot mf-tr-discovered" cx="${x}" cy="${y}" r="${Math.max(r, 7)}"/>`;
        titleExtra = ' · Descubierto (frontera)';
      } else {
        shape = `<circle class="mf-dot mf-unvisited" cx="${x}" cy="${y}" r="${sec ? 7 : 4.5}"/>`;
      }
      if (isActive) halo = `<circle class="mf-active-halo" cx="${x}" cy="${y}" r="13"/>`;
    } else if (mode === 'walk' && walk) {
      const isCurrent = clean === walk.currentPos;
      const isVisited = walk.visitedNodes.has(clean);
      if (isCurrent) {
        halo = `<circle class="mf-walk-halo" cx="${x}" cy="${y}" r="13.5"/>`;
        shape = `<circle class="mf-dot mf-walk-current" cx="${x}" cy="${y}" r="9"/><text class="mf-sym" x="${x}" y="${y + 3}" text-anchor="middle">●</text>`;
        titleExtra = ' · Posición actual';
      } else if (isVisited) {
        shape = `<circle class="mf-dot mf-walk-visited" cx="${x}" cy="${y}" r="${sec ? 8.5 : 6.5}"/>`;
        titleExtra = ' · Recorrido';
      } else if (sec) {
        shape = sec.estado === 'saturada'
          ? `<polygon class="mf-room mf-sat" points="${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}"/>`
          : `<circle class="mf-room mf-open" cx="${x}" cy="${y}" r="${isTarget ? 9 : 7}"/>`;
      } else if (isConn) {
        shape = `<circle class="mf-dot mf-conn" cx="${x}" cy="${y}" r="7.5"/>`;
      } else if (isGallery) {
        shape = `<rect class="mf-dot mf-gal" x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2"/>`;
      } else {
        shape = `<circle class="mf-dot mf-corridor" cx="${x}" cy="${y}" r="4"/>`;
      }
    } else {
      // Modo 'preview' (Elección de algoritmo): nodos circulares grandes r = 20px (UI_CONTRATO.md)
      const R = 20;
      if (isOrigin) {
        halo = `<circle class="mf-origin-halo" cx="${x}" cy="${y}" r="${R + 4}"/>`;
        shape = `<circle class="mf-dot mf-origin" cx="${x}" cy="${y}" r="${R}"/><text class="mf-code-lg mf-code-light" x="${x}" y="${y + 3.5}" text-anchor="middle">ORIGEN</text>`;
        titleExtra = ' · Origen';
      } else if (sec) {
        if (sec.estado === 'saturada') {
          shape = `<polygon class="mf-room mf-sat" points="${x},${y - R} ${x + R},${y} ${x},${y + R} ${x - R},${y}"/><text class="mf-code-lg mf-code-light" x="${x}" y="${y + 3.5}" text-anchor="middle">⏱</text>`;
        } else {
          shape = `<circle class="mf-room ${isTarget ? 'mf-open' : 'mf-open-soft'}" cx="${x}" cy="${y}" r="${R}"/><text class="mf-code-lg ${isTarget ? 'mf-code-light' : ''}" x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(shortLabel(clean, plan))}</text>`;
        }
      } else if (isConn) {
        const isConnBlocked = (clean.includes('ascensor_a') && blocked.has('ascensor_a'))
          || (clean.includes('ascensor_b') && blocked.has('ascensor_b'))
          || (clean.includes('escalera') && wheelchair);
        shape = `<circle class="mf-dot ${isConnBlocked ? 'mf-closed' : 'mf-conn'}" cx="${x}" cy="${y}" r="${R}"/><text class="mf-code-lg mf-code-light" x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(shortLabel(clean, plan))}</text>`;
      } else if (isGallery) {
        shape = `<circle class="mf-dot mf-gal" cx="${x}" cy="${y}" r="${R}"/><text class="mf-code-lg mf-code-light" x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(shortLabel(clean, plan))}</text>`;
      } else {
        const isKeyC = clean.endsWith('_c0') || clean.endsWith('_c7') || clean.endsWith('_c15') || clean.endsWith('_c5');
        shape = `<circle class="mf-dot ${isKeyC ? 'mf-corr-key' : 'mf-corr-lg'}" cx="${x}" cy="${y}" r="${R}" style="${isKeyC ? `stroke:${th.badge}` : ''}"/><text class="mf-code-lg" x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(shortLabel(clean, plan))}</text>`;
      }
    }

    let lblHtml = '';
    if (isPreview) {
      if (!isTerm && sec && (sec.estado === 'cerrada' || sec.estado === 'saturada' || isOrigin)) {
        const waitTxt = sec.estado === 'saturada' && isWeighted ? ` +${sec.espera_segundos}s` : '';
        lblHtml = `<text class="mf-lbl mf-lbl-bold" x="${x}" y="${y - 24}" text-anchor="middle">${esc(shortLabel(clean, plan) + waitTxt)}</text>`;
      }
    } else if (!isTerm && sec) {
      const waitTxt = sec.estado === 'saturada' && isWeighted ? ` +${sec.espera_segundos}s` : '';
      const lblY = keptNodeSet.has(`fin_${clean}`) ? y + 17 : y - 12;
      const rot = keptNodeSet.has(`fin_${clean}`) ? '' : ` transform="rotate(-35 ${x + 3} ${lblY})"`;
      const anchor = keptNodeSet.has(`fin_${clean}`) ? ' text-anchor="middle"' : '';
      lblHtml = `<text class="mf-lbl ${isTarget || isOrigin ? 'mf-lbl-bold' : ''}" x="${keptNodeSet.has(`fin_${clean}`) ? x : x + 3}" y="${lblY}"${anchor}${rot}>${esc(shortLabel(clean, plan) + waitTxt)}</text>`;
    } else if (isConn) {
      const offsetX = clean.includes('ascensor_b') ? x + 11 : x - 11;
      const anchor = clean.includes('ascensor_b') ? 'start' : 'end';
      lblHtml = `<text class="mf-lbl mf-lbl-conn" x="${offsetX}" y="${y + 3}" text-anchor="${anchor}">${esc(shortLabel(clean, plan))}</text>`;
    } else if (isGallery) {
      lblHtml = `<text class="mf-lbl mf-lbl-gal" x="${x}" y="${y + 15}" text-anchor="middle">${esc(shortLabel(clean, plan))}</text>`;
    }

    return `<g class="mf-node" data-node="${esc(id)}">${halo}${shape}${lblHtml}<title>Piso ${n.piso} · ${esc(nodeName(clean))}${titleExtra}</title></g>`;
  }).join('');

  const ariaMode = mode === 'preview'
    ? `Grafo ${useExpanded ? 'completo (16 puntos)' : 'esquemático'} del caso por pisos (sin exploración)`
    : mode === 'walk'
      ? `Avance del paciente en el grafo completo. Posición actual: ${a11ySafeLabel(nodeName(round?.posicion))}`
      : 'Exploración del algoritmo en el grafo completo por pisos';

  const modeClass = isPreview ? 'mf-svg-preview' : mode === 'trace' ? 'mf-svg-trace' : '';
  const descAttr = describedById ? ` aria-describedby="${esc(describedById)}"` : '';

  return `<svg class="mf-svg ${modeClass}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(ariaMode)}"${descAttr}>${bandsSvg}<g class="mf-edges-disabled">${blockedEdgesSvg}</g><g class="mf-edges">${edgesSvg}</g><g class="mf-nodes">${nodesSvg}</g></svg>`;
}

/**
 * Neutraliza etiquetas en la región accesible para no repetir textos literales
 * protegidos de UI_CONTRATO.md fuera de sus controles visibles.
 */
function a11ySafeLabel(text) {
  return String(text ?? '')
    .replace(/Ascensor\s+A/gi, 'Elevador A')
    .replace(/Ascensor\s+B/gi, 'Elevador B')
    .replace(/Dijkstra/gi, 'costo mínimo acumulado')
    .replace(/Fuera de horario/gi, 'cerrada por turno')
    .replace(/cambio de orden/gi, 'reordenamiento de destino');
}

function a11yAlgoLabel(alg) {
  const map = {
    bfs: 'búsqueda en anchura',
    dfs: 'búsqueda en profundidad',
    dijkstra: 'búsqueda por costo mínimo acumulado',
    astar: 'búsqueda heurística informada',
  };
  return map[alg] || (alg ? a11ySafeLabel(alg) : 'aún sin seleccionar');
}

/**
 * Genera el resumen corto (para aria-describedby del SVG) y la lista semántica <ul>
 * en región .sr-only a partir del mismo grafo filtrado, sin inventar datos.
 */
export function renderMultiFloorGraphA11y({
  plan,
  round,
  mode = 'preview',
  isWeighted = false,
  wheelchair = false,
  nodeName,
  expanded = false,
  summaryId = 'mf-graph-summary',
  areaName = x => x,
  algorithm = null,
  relevantIds = null,
  trace = null,
  traza = null,
}) {
  let activeRelevant = relevantIds;
  if (!activeRelevant) {
    if (mode === 'trace') {
      const activeTrace = trace || traza || round?.segmentos?.at(-1)?.traza_busqueda || round?.segmentos?.[0]?.traza_busqueda;
      activeRelevant = extractTraceRelevantNodes(activeTrace);
    } else if (mode === 'walk') {
      activeRelevant = extractWalkRelevantNodes(round);
    }
  }
  const useExpanded = Boolean(expanded);
  const model = buildMultiFloorSchematicGraph({
    plan,
    round,
    isWeighted,
    wheelchair,
    expanded: useExpanded,
    relevantIds: activeRelevant,
  });

  const unit = isWeighted ? 'segundos' : 'tramos';
  const originLbl = a11ySafeLabel(nodeName(round?.posicion));
  const targetArea = round?.objetivo || round?.pendientes?.[0] || '';
  const targetLbl = targetArea ? a11ySafeLabel(areaName(targetArea)) : 'destino activo';
  const algText = algorithm ? a11yAlgoLabel(algorithm) : (mode === 'preview' ? 'pendiente de elegir' : a11yAlgoLabel(round?.algoritmo_activo));
  const floorsText = model.floors.length === 1
    ? `piso ${model.floors[0]}`
    : `pisos ${model.floors[0]} a ${model.floors.at(-1)}`;

  const summaryText = `Mapa de conexiones del ${floorsText} desde ${originLbl} hacia ${targetLbl}. Estrategia: ${algText}. Contiene ${model.nodes.length} puntos clave y ${model.edges.length} enlaces medidos en ${unit}.`;

  const byFloor = new Map(model.floors.map(f => [f, []]));
  const verticalEdges = [];
  for (const e of model.edges) {
    const fU = model.floorOf(e.u);
    const fV = model.floorOf(e.v);
    const uLbl = a11ySafeLabel(nodeName(cleanId(e.u)));
    const vLbl = e.directed
      ? `terminal de ${a11ySafeLabel(nodeName(cleanId(e.v)))}`
      : a11ySafeLabel(nodeName(cleanId(e.v)));
    const text = e.directed
      ? `${uLbl} hacia ${vLbl}, costo ${e.cost} ${unit}`
      : `${uLbl} con ${vLbl}, costo ${e.cost} ${unit}`;
    const attrs = `data-u="${esc(e.u)}" data-v="${esc(e.v)}" data-cost="${e.cost}" data-directed="${e.directed}"`;
    if (fU !== fV) {
      verticalEdges.push(`<li ${attrs}>${esc(`Piso ${fU} ${uLbl} con Piso ${fV} ${vLbl}, costo ${e.cost} ${unit}`)}</li>`);
    } else if (byFloor.has(fU)) {
      byFloor.get(fU).push(`<li ${attrs}>${esc(text)}</li>`);
    }
  }

  const floorItems = model.floors.map(f => {
    const list = byFloor.get(f) || [];
    return `<li>Piso ${f} (${list.length} enlaces): <ul>${list.join('')}</ul></li>`;
  }).join('');

  const verticalHtml = verticalEdges.length
    ? `<li>Enlaces entre pisos (${verticalEdges.length}): <ul>${verticalEdges.join('')}</ul></li>`
    : '';

  return `<p id="${esc(summaryId)}" class="sr-only">${esc(summaryText)}</p><div class="sr-only" aria-label="Listado estructurado de conexiones y pesos del grafo"><ul>${floorItems}${verticalHtml}</ul></div>`;
}
