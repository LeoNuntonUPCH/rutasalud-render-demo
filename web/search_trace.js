/**
 * search_trace.js — Exploración del Algoritmo (Reproductor Paso a Paso sobre el grafo multipiso completo).
 * Sin pestañas de piso: muestra todos los pisos habilitados apilados verticalmente.
 */
import { renderMultiFloorGraphSvg, renderMultiFloorGraphA11y, extractTraceRelevantNodes } from './multifloor_graph.js?v=13.8';

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = x => (x === null || x === undefined || Number.isNaN(Number(x)))
  ? '—'
  : new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(Number(x));

const MOTIVO_LABELS = {
  ya_procesado: 'nodo ya procesado (cerrado)',
  ya_descubierto: 'nodo ya descubierto previamente en la frontera',
  costo_no_mejor: 'el nuevo camino no mejora el costo acumulado conocido',
  entrada_obsoleta: 'entrada obsoleta en la cola de prioridad',
  entrada_obsoleta_o_cerrada: 'entrada obsoleta o ya cerrada en este frente',
};

const TIPO_BADGES = {
  descubrir: { label: '◎ Descubierto', cls: 'ev-discover' },
  actualizar_costo: { label: '↻ Mejor costo', cls: 'ev-update' },
  procesar: { label: '★ Procesado (Expansión)', cls: 'ev-process' },
  descartar: { label: '✕ Descartado', cls: 'ev-discard' },
  objetivo_alcanzado: { label: '⚑ Objetivo alcanzado', cls: 'ev-goal' },
  ruta_final: { label: '━ Ruta final', cls: 'ev-final' },
};

function cleanNodeId(id) {
  return String(id || '').replace(/^fin_/, '');
}

const playerState = {
  roundId: null,
  segIndex: 0,
  stepIndex: 0,
  playing: false,
  speed: 1,
  timer: null,
};

export function stopTracePlayback() {
  playerState.playing = false;
  if (playerState.timer) {
    clearInterval(playerState.timer);
    playerState.timer = null;
  }
}

function syncPlayerWithRound(round, defaultSegIndex) {
  const segs = round?.segmentos || [];
  const wantedSeg = defaultSegIndex ?? Math.max(0, segs.length - 1);
  const trace = segs[wantedSeg]?.traza_busqueda;
  const events = trace?.eventos || [];
  const key = `${round?.id || ''}|${segs.length}`;

  if (playerState.roundId !== key) {
    stopTracePlayback();
    playerState.roundId = key;
    playerState.segIndex = wantedSeg;
    playerState.stepIndex = Math.max(0, events.length - 1);
  } else if (playerState.segIndex >= segs.length) {
    playerState.segIndex = Math.max(0, segs.length - 1);
    playerState.stepIndex = Math.max(0, (segs[playerState.segIndex]?.traza_busqueda?.eventos?.length || 1) - 1);
  }
}

function computeTraceStateAtStep(trace, stepIndex) {
  const events = trace?.eventos || [];
  const maxIdx = Math.min(Math.max(0, stepIndex), Math.max(0, events.length - 1));
  const nodeStatus = new Map();
  const treeEdges = new Map();
  let expansionsSoFar = 0;
  let finalRoute = [];

  for (let i = 0; i <= maxIdx; i++) {
    const ev = events[i];
    if (!ev) continue;
    const cid = cleanNodeId(ev.nodo);
    const prev = nodeStatus.get(cid) || { status: 'unvisited', fronts: new Set(), terminal: false };
    if (ev.metricas?.frente) prev.fronts.add(ev.metricas.frente);
    if (ev.terminal_seccion) prev.terminal = true;

    if (ev.tipo === 'descubrir' || ev.tipo === 'actualizar_costo') {
      if (prev.status !== 'processed') prev.status = 'discovered';
      if (ev.desde) {
        const fromClean = cleanNodeId(ev.desde);
        if (fromClean !== cid) treeEdges.set(cid, fromClean);
      }
    } else if (ev.tipo === 'procesar') {
      prev.status = 'processed';
      expansionsSoFar += 1;
    } else if (ev.tipo === 'objetivo_alcanzado') {
      prev.status = 'goal';
    } else if (ev.tipo === 'ruta_final' && Array.isArray(ev.ruta)) {
      finalRoute = ev.ruta.map(cleanNodeId);
    }
    nodeStatus.set(cid, prev);
  }

  const currentEv = events[maxIdx] || null;
  const activeNode = currentEv ? cleanNodeId(currentEv.nodo) : null;
  const activeFrom = currentEv?.desde ? cleanNodeId(currentEv.desde) : null;
  const frontierSet = new Set((currentEv?.frontera || []).map(cleanNodeId));

  const finalEdgeSet = new Set();
  for (let i = 0; i < finalRoute.length - 1; i++) {
    if (finalRoute[i] !== finalRoute[i + 1]) {
      finalEdgeSet.add([finalRoute[i], finalRoute[i + 1]].sort().join('|'));
    }
  }

  return {
    currentEv,
    maxIdx,
    totalEvents: events.length,
    expansionsSoFar,
    nodeStatus,
    treeEdges,
    activeNode,
    activeFrom,
    frontierSet,
    finalRoute: new Set(finalRoute),
    finalEdgeSet,
  };
}

function buildStepExplanation(trace, ev, nodeName, nameFn) {
  if (!ev) return 'Sin eventos de búsqueda registrados.';
  const unit = trace.unidad_costo === 'tramos' ? 'tramos' : 's';
  const targetLabel = ev.terminal_seccion
    ? `terminal de ${nodeName(cleanNodeId(ev.nodo))} (${ev.nodo})`
    : nodeName(ev.nodo);
  const fromLabel = ev.desde ? nodeName(cleanNodeId(ev.desde)) : null;
  const edgeInfo = ev.costo_arista !== null && ev.costo_arista !== undefined
    ? ` (arista: +${num(ev.costo_arista)} ${unit})`
    : '';

  if (ev.tipo === 'descubrir') {
    if (!fromLabel) return `Paso ${ev.paso}: Semilla inicial en ${targetLabel}. Se inserta en la frontera.`;
    return `Paso ${ev.paso}: Se descubre ${targetLabel} desde ${fromLabel}${edgeInfo} y entra a la frontera.`;
  }
  if (ev.tipo === 'actualizar_costo') {
    const ant = ev.metricas?.costo_anterior ?? ev.metricas?.g_anterior;
    const act = ev.metricas?.costo_acumulado ?? ev.metricas?.g;
    return `Paso ${ev.paso}: Se mejora el camino hacia ${targetLabel} desde ${fromLabel}${edgeInfo} (antes ${num(ant)}, ahora ${num(act)} ${unit}).`;
  }
  if (ev.tipo === 'procesar') {
    return `Paso ${ev.paso}: Se extrae y expande ${targetLabel} (cuenta como +1 expansión; evalúa sus vecinos).`;
  }
  if (ev.tipo === 'descartar') {
    const reason = MOTIVO_LABELS[ev.motivo] || ev.motivo || 'no mejora';
    return `Paso ${ev.paso}: Se descarta ${targetLabel}${fromLabel ? ` desde ${fromLabel}` : ''} porque es ${reason}.`;
  }
  if (ev.tipo === 'objetivo_alcanzado') {
    return `Paso ${ev.paso}: ¡Objetivo ${nameFn(trace.objetivo)} alcanzado en ${targetLabel}! Finaliza la exploración.`;
  }
  if (ev.tipo === 'ruta_final') {
    return `Paso ${ev.paso}: Reconstrucción de la ruta final (${(ev.ruta || []).length} nodos, costo total ${num(ev.costo)} ${unit}). No suma expansiones.`;
  }
  return `Paso ${ev.paso}: ${ev.tipo} en ${targetLabel}.`;
}

function buildAlgorithmMetricsHtml(trace, snap, nodeName) {
  const alg = trace.algoritmo;
  const ev = snap.currentEv;
  const m = ev?.metricas || {};
  const unit = trace.unidad_costo === 'tramos' ? 'tramos' : 's';
  const chips = [];

  if (alg === 'bfs' || alg === 'dfs') {
    chips.push(`<div class="trace-metric"><span>Estructura</span><strong>${alg === 'bfs' ? 'Cola FIFO (anchura)' : 'Pila LIFO (profundidad)'}</strong></div>`);
    chips.push(`<div class="trace-metric"><span>Profundidad del nodo</span><strong>Nivel ${num(m.profundidad)}</strong></div>`);
  } else if (alg === 'dijkstra') {
    chips.push(`<div class="trace-metric"><span>Costo acumulado g(n)</span><strong>${num(m.costo_acumulado)} ${unit}</strong></div>`);
    chips.push(`<div class="trace-metric"><span>Costo previo</span><strong>${m.costo_anterior !== null && m.costo_anterior !== undefined ? `${num(m.costo_anterior)} ${unit}` : 'Sin registro'}</strong></div>`);
  } else if (alg === 'astar') {
    chips.push(`<div class="trace-metric"><span>Costo real g(n)</span><strong>${num(m.g)} ${unit}</strong></div>`);
    chips.push(`<div class="trace-metric"><span>Heurística h(n)</span><strong>${num(m.h)} ${unit}</strong></div>`);
    chips.push(`<div class="trace-metric"><span>Prioridad f(n) = g + h</span><strong>${num(m.f)} ${unit}</strong></div>`);
  }

  chips.push(`<div class="trace-metric"><span>Expansiones acumuladas</span><strong>${snap.expansionsSoFar} / ${trace.total_expansiones_registradas}</strong></div>`);

  const frontierPreview = (ev?.frontera || []).slice(0, 7).map(id => esc(nodeName(cleanNodeId(id)))).join(', ');
  const moreCount = Math.max(0, (ev?.frontera?.length || 0) - 7);

  return `
    <div class="trace-metrics-grid">${chips.join('')}</div>
    <div class="trace-frontier-bar">
      <strong>Frontera actual (${ev?.frontera?.length || 0}):</strong>
      <span>${frontierPreview ? `${frontierPreview}${moreCount ? ` (+${moreCount} más)` : ''}` : 'Vacía'}</span>
    </div>`;
}

/**
 * Monta o actualiza el reproductor "Exploración del Algoritmo" con grafo multipiso completo.
 */
export function mountOrUpdateSearchTrace(container, { plan, round, wheelchair = false, nameFn, nodeNameFn }) {
  if (!container || !round?.segmentos?.length) return;
  syncPlayerWithRound(round);

  const segs = round.segmentos;
  const seg = segs[playerState.segIndex] || segs.at(-1);
  const trace = seg?.traza_busqueda;
  if (!trace || !trace.eventos?.length) {
    container.innerHTML = '<p class="muted">No hay traza de búsqueda disponible para esta etapa.</p>';
    return;
  }

  const snap = computeTraceStateAtStep(trace, playerState.stepIndex);
  const ev = snap.currentEv;
  const badge = TIPO_BADGES[ev?.tipo] || { label: ev?.tipo || 'Paso', cls: 'ev-discover' };
  const explanation = buildStepExplanation(trace, ev, nodeNameFn, nameFn);
  const isWeighted = trace.unidad_costo === 'segundos';
  const relevantIds = extractTraceRelevantNodes(trace);

  const segTabsHtml = segs.length > 1
    ? `<div class="trace-seg-tabs" role="tablist" aria-label="Etapas de búsqueda registradas">
        ${segs.map((s, idx) => {
          const t = s.traza_busqueda;
          const lbl = `Etapa ${idx + 1}: ${nameFn(t?.objetivo || '')} (${nameFn(t?.algoritmo || '')})`;
          return `<button type="button" class="trace-seg-tab ${idx === playerState.segIndex ? 'active' : ''}" data-trace-seg="${idx}" aria-pressed="${idx === playerState.segIndex}">${esc(lbl)}</button>`;
        }).join('')}
      </div>`
    : '';

  container.innerHTML = `
    <div class="trace-player">
      ${segTabsHtml}
      <div class="trace-toolbar">
        <div class="trace-controls">
          <button type="button" class="trace-btn" data-trace-action="first" ${snap.maxIdx === 0 ? 'disabled' : ''} aria-label="Primer paso">|&lt;</button>
          <button type="button" class="trace-btn" data-trace-action="prev" ${snap.maxIdx === 0 ? 'disabled' : ''} aria-label="Paso anterior">&lt; Anterior</button>
          <button type="button" class="trace-btn primary" data-trace-action="toggle" aria-pressed="${playerState.playing}">${playerState.playing ? '⏸ Pausar' : '▶ Reproducir'}</button>
          <button type="button" class="trace-btn" data-trace-action="next" ${snap.maxIdx >= snap.totalEvents - 1 ? 'disabled' : ''} aria-label="Siguiente paso">Siguiente &gt;</button>
          <button type="button" class="trace-btn" data-trace-action="last" ${snap.maxIdx >= snap.totalEvents - 1 ? 'disabled' : ''} aria-label="Último paso">&gt;|</button>
        </div>
        <div class="trace-speeds" aria-label="Velocidad de reproducción">
          ${[0.5, 1, 2].map(sp => `<button type="button" class="trace-speed ${playerState.speed === sp ? 'active' : ''}" data-trace-speed="${sp}" aria-pressed="${playerState.speed === sp}">${sp}x</button>`).join('')}
        </div>
      </div>

      <div class="trace-scrubber-row">
        <span class="trace-step-badge ${badge.cls}">${badge.label}</span>
        <input type="range" class="trace-slider" min="0" max="${snap.totalEvents - 1}" value="${snap.maxIdx}" aria-label="Paso de exploración">
        <span class="trace-step-counter">Paso <strong>${snap.maxIdx + 1}</strong> / ${snap.totalEvents}</span>
      </div>

      <p class="trace-explanation" role="status" aria-live="polite">${esc(explanation)}</p>

      ${buildAlgorithmMetricsHtml(trace, snap, nodeNameFn)}

      <div class="mf-pan-hint mobile-only" aria-hidden="true">↔ Desliza horizontalmente para ver todo el piso</div>
      <div class="mf-svg-wrap" tabindex="0" role="region" aria-label="Contenedor desplazable de la exploración del algoritmo">
        ${renderMultiFloorGraphSvg({
          plan,
          round,
          mode: 'trace',
          isWeighted,
          wheelchair,
          nodeName: nodeNameFn,
          traceSnap: snap,
          describedById: 'trace-graph-summary',
          relevantIds,
        })}
      </div>
      ${renderMultiFloorGraphA11y({
        plan,
        round,
        mode: 'trace',
        isWeighted,
        wheelchair,
        nodeName: nodeNameFn,
        summaryId: 'trace-graph-summary',
        areaName: nameFn,
        algorithm: trace.algoritmo,
        relevantIds,
      })}

      <div class="trace-legend">
        <span><b class="lg-disc">◎</b> Descubierto (frontera)</span>
        <span><b class="lg-proc">✓</b> Procesado (+1 expansión)</span>
        <span><b class="lg-discard">✕</b> Descartado</span>
        <span><b class="lg-final">★ ━</b> Ruta final</span>
        <span>■ Cerrada</span>
      </div>
    </div>`;

  if (!container.dataset.traceBound) {
    container.dataset.traceBound = '1';
    const rerender = () => mountOrUpdateSearchTrace(container, { plan, round, wheelchair, nameFn, nodeNameFn });

    container.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();

      if (btn.dataset.traceSeg !== undefined) {
        stopTracePlayback();
        playerState.segIndex = Number(btn.dataset.traceSeg);
        const targetEvents = round.segmentos[playerState.segIndex]?.traza_busqueda?.eventos || [];
        playerState.stepIndex = Math.max(0, targetEvents.length - 1);
        rerender();
        container.querySelector(`button[data-trace-seg="${playerState.segIndex}"]`)?.focus();
        return;
      }

      if (btn.dataset.traceSpeed !== undefined) {
        playerState.speed = Number(btn.dataset.traceSpeed);
        if (playerState.playing) {
          stopTracePlayback();
          startAutoPlay(container, { plan, round, wheelchair, nameFn, nodeNameFn });
        } else {
          rerender();
        }
        container.querySelector(`button[data-trace-speed="${playerState.speed}"]`)?.focus();
        return;
      }

      const act = btn.dataset.traceAction;
      if (!act) return;
      const maxStep = (round.segmentos[playerState.segIndex]?.traza_busqueda?.eventos?.length || 1) - 1;

      if (act === 'first') {
        stopTracePlayback();
        playerState.stepIndex = 0;
        rerender();
        container.querySelector('button[data-trace-action="first"]')?.focus();
      } else if (act === 'prev') {
        stopTracePlayback();
        playerState.stepIndex = Math.max(0, playerState.stepIndex - 1);
        rerender();
        container.querySelector('button[data-trace-action="prev"]')?.focus();
      } else if (act === 'next') {
        stopTracePlayback();
        playerState.stepIndex = Math.min(maxStep, playerState.stepIndex + 1);
        rerender();
        container.querySelector('button[data-trace-action="next"]')?.focus();
      } else if (act === 'last') {
        stopTracePlayback();
        playerState.stepIndex = maxStep;
        rerender();
        container.querySelector('button[data-trace-action="last"]')?.focus();
      } else if (act === 'toggle') {
        if (playerState.playing) {
          stopTracePlayback();
          rerender();
        } else {
          if (playerState.stepIndex >= maxStep) playerState.stepIndex = 0;
          startAutoPlay(container, { plan, round, wheelchair, nameFn, nodeNameFn });
        }
        container.querySelector('button[data-trace-action="toggle"]')?.focus();
      }
    });

    container.addEventListener('input', e => {
      if (!e.target.classList.contains('trace-slider')) return;
      stopTracePlayback();
      playerState.stepIndex = Number(e.target.value);
      rerender();
      container.querySelector('.trace-slider')?.focus();
    });
  }
}

function startAutoPlay(container, ctx) {
  stopTracePlayback();
  playerState.playing = true;
  const intervalMs = Math.round(480 / (playerState.speed || 1));
  const rerender = () => mountOrUpdateSearchTrace(container, ctx);
  rerender();

  playerState.timer = setInterval(() => {
    const events = ctx.round.segmentos?.[playerState.segIndex]?.traza_busqueda?.eventos || [];
    if (playerState.stepIndex < events.length - 1) {
      playerState.stepIndex += 1;
      rerender();
    } else {
      stopTracePlayback();
      rerender();
    }
  }, intervalMs);
}
