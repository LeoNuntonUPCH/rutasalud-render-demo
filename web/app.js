import { mountOrUpdateScene, getCastSprites, assetUrl } from './scene.js?v=13.8';
import { mountOrUpdateSearchTrace, stopTracePlayback } from './search_trace.js?v=13.8';
import { renderMultiFloorGraphSvg, renderMultiFloorGraphA11y, extractWalkRelevantNodes } from './multifloor_graph.js?v=13.8';

const app = document.querySelector('#app');
const stepLabel = document.querySelector('#step-label');

const state = {
  cases: [],
  case: null,
  plan: null,
  round: null,
  score: null,
  selected: null,
  floor: 1,
  previewMode: 'schematic',
  busy: false,
  prevPos: null,
  screen: new URLSearchParams(location.search).has('data') ? 'cases' : 'welcome',
};

const names = {
  recepcion: 'Recepción',
  triaje: 'Triaje',
  atencion_prioritaria: 'Atención prioritaria',
  medicina_general: 'Medicina general',
  pediatria: 'Pediatría',
  ginecologia: 'Ginecología',
  medicina_interna: 'Medicina interna',
  traumatologia: 'Traumatología',
  cardiologia: 'Cardiología',
  laboratorio: 'Laboratorio',
  imagenes: 'Imágenes',
  observacion: 'Observación',
  habitaciones: 'Habitaciones',
  ascensor_a: 'Ascensor A',
  ascensor_b: 'Ascensor B',
  escalera: 'Escalera',
  bfs: 'BFS',
  dfs: 'DFS',
  dijkstra: 'Dijkstra',
  astar: 'A*',
};

const name = id => names[id] || String(id || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

const nodeName = id => {
  if (!id) return '—';
  const clean = String(id).replace(/^fin_/, '');
  const room = state.plan?.secciones.find(s => s.id === clean);
  if (room) return `${name(room.area)} ${clean.split('_').at(-1)}`;
  if (clean.includes('ascensor')) return name(clean.split('_').slice(1).join('_'));
  if (clean.includes('escalera')) return 'Escalera';
  if (clean.includes('_g')) return `Galería ${clean.split('_g')[1]}`;
  if (clean.includes('_c')) return `Pasillo ${clean.split('_c')[1]}`;
  return name(clean);
};

const num = x => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(Number(x) || 0);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function request(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'No se pudo completar la operación.');
  return data;
}

function error(e) {
  const box = document.querySelector('#toast');
  box.textContent = `${e.message} Intenta nuevamente o reinicia el caso.`;
  box.hidden = false;
  clearTimeout(error.timer);
  error.timer = setTimeout(() => { box.hidden = true; }, 6500);
}

async function action(fn) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
  } catch (e) {
    error(e);
  } finally {
    state.busy = false;
    render();
  }
}

const title = (h, p) => `<div class="page-head"><div><h1>${h}</h1><p>${p}</p></div></div>`;

function algoIcon(a) {
  const icons = {
    bfs: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="6" cy="14" r="3" fill="currentColor"/><circle cx="15" cy="8" r="3" fill="currentColor" opacity=".75"/><circle cx="15" cy="20" r="3" fill="currentColor" opacity=".75"/><circle cx="23" cy="14" r="3" fill="currentColor" opacity=".45"/><path d="M8 13 L13 9 M8 15 L13 19 M17 9 L21 13 M17 19 L21 15" stroke="currentColor" stroke-width="2"/></svg>',
    dfs: '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 7 H15 V14 H23 V22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="7" r="2.8" fill="currentColor"/><circle cx="23" cy="22" r="2.8" fill="currentColor"/></svg>',
    dijkstra: '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 20 L12 10 L24 8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="4" cy="20" r="3" fill="currentColor"/><circle cx="12" cy="10" r="3" fill="currentColor"/><circle cx="24" cy="8" r="3" fill="#F59E0B"/></svg>',
    astar: '<svg viewBox="0 0 28 28" aria-hidden="true"><polygon points="14,3 17,10 25,11 19,16 21,24 14,20 7,24 9,16 3,11 11,10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  };
  return icons[a] || '';
}

function algorithmMeta(a, hasHeuristic = true) {
  return {
    bfs: {
      tag: 'Cola FIFO · O(V+E)',
      hint: 'Explora por capas desde el origen. Minimiza la cantidad de saltos cuando las conexiones tienen peso uniforme.',
    },
    dfs: {
      tag: 'Pila LIFO · O(V+E)',
      hint: 'Avanza en profundidad y retrocede (backtracking). No garantiza ruta mínima ni por saltos ni por tiempo.',
    },
    dijkstra: {
      tag: 'Cola de prioridad · g(n)',
      hint: 'Expande siempre el menor costo acumulado g. Garantiza costo mínimo con pesos no negativos; equivale a A* con h = 0.',
    },
    astar: {
      tag: hasHeuristic ? 'Cola de prioridad · f = g + h' : 'Cola de prioridad · h = 0',
      hint: hasHeuristic
        ? 'Combina costo acumulado g y estimación h. Con heurística admisible y consistente garantiza óptimo y puede reducir expansiones.'
        : 'Sin heurística informativa disponible: opera con h = 0, equivalente a Dijkstra en prioridad.',
    },
  }[a] || { tag: '', hint: '' };
}

function formatIncidentDesc(text) {
  return String(text || '')
    .replaceAll('ascensor_a', 'Ascensor A')
    .replaceAll('ascensor_b', 'Ascensor B');
}

function renderIncidenciasList(list) {
  if (!list || !list.length) {
    return '<div class="incidencias-empty">✓ Sin incidencias reportadas en el centro médico (accesos y salas operan con normalidad).</div>';
  }
  const items = list.map(i => {
    if (i.tipo === 'movilidad') {
      return `<li class="inc-item inc-warn"><span class="inc-icon">♿</span><div><strong>Movilidad reducida (silla de ruedas)</strong><span>${esc(formatIncidentDesc(i.descripcion) || 'Escalera no accesible')}</span></div></li>`;
    }
    if (i.tipo === 'ascensor_bloqueado') {
      return `<li class="inc-item inc-closed"><span class="inc-icon">⛔</span><div><strong>${esc(name(i.grupo))} fuera de servicio</strong><span>${esc(formatIncidentDesc(i.descripcion))}</span></div></li>`;
    }
    if (i.tipo === 'ascensor_lento') {
      return `<li class="inc-item inc-warn"><span class="inc-icon">🐢</span><div><strong>${esc(name(i.grupo))} con demora</strong><span>${esc(formatIncidentDesc(i.descripcion))}</span></div></li>`;
    }
    if (i.tipo === 'conexion_bloqueada') {
      return `<li class="inc-item inc-closed"><span class="inc-icon">⛔</span><div><strong>Conexión bloqueada</strong><span>${esc(formatIncidentDesc(i.descripcion))}</span></div></li>`;
    }
    if (i.tipo === 'sala_cerrada') {
      return `<li class="inc-item inc-closed"><span class="inc-icon">🔒</span><div><strong>${esc(nodeName(i.seccion))} · Cerrada</strong>${i.motivo ? `<small class="reason">${esc(i.motivo)}</small>` : ''}</div></li>`;
    }
    if (i.tipo === 'sala_saturada') {
      return `<li class="inc-item inc-warn"><span class="inc-icon">⏱</span><div><strong>${esc(nodeName(i.seccion))} · Saturada</strong><span>Espera adicional de +${num(i.espera_segundos)} s</span></div></li>`;
    }
    return `<li class="inc-item"><span class="inc-icon">•</span><div><span>${esc(i.descripcion || name(i.seccion || i.tipo))}</span></div></li>`;
  }).join('');
  return `<ul class="incidencias-list">${items}</ul>`;
}

function welcome() {
  stepLabel.textContent = 'Inicio';
  const cast = getCastSprites('C01', false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 800;
  const heroBg = isMobile
    ? '/web/assets/escena_p1_recepcion_mobile.jpg'
    : '/web/assets/escena_p1_recepcion.jpg';
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Encuentra la ruta. Entiende por qué funciona.</h1>
        <p>Juega como orientador hospitalario. Recibe una orden de destino, elige un algoritmo y acompaña al paciente por cada sección. La ruta más corta y el trabajo de búsqueda cuentan por separado.</p>
        <div class="actions">
          <button class="button" data-action="cases">Explorar los 10 casos</button>
        </div>
      </div>
      <div class="hero-art hero-scene-preview" aria-hidden="true">
        <img class="hero-bg-img" src="${assetUrl(heroBg)}" alt="">
        <div class="hero-sprites">
          <img src="${assetUrl(cast.guideSrc)}" alt="">
          <img src="${assetUrl(cast.patientSrc)}" alt="">
        </div>
      </div>
    </section>`;
}

function catalogData() {
  const mode = new URLSearchParams(location.search).get('data');
  if (!location.hostname.match(/^(localhost|127\.0\.0\.1)$/)) return state.cases;
  if (mode === 'empty') return [];
  if (mode === 'one') return state.cases.slice(0, 1);
  if (mode === 'worst') {
    return state.cases.map((c, i) => ({
      ...c,
      paciente: i === 0
        ? 'María José de la Cruz y Fernández, acompañada por su familia'
        : i === 1
          ? 'Consulta de orientación con indicación extensa para atención prioritaria y movilidad reducida'
          : i === 2
            ? '王秀英 · revisión de especialidad'
            : c.paciente,
      orden: i === 0 ? 'Traumatología 2 abierta con espera estimada y acceso por ascensor B' : c.orden,
    }));
  }
  if (mode === 'huge') {
    return Array.from({ length: 1000 }, (_, i) => ({
      ...state.cases[i % state.cases.length],
      id: `D${String(i + 1).padStart(4, '0')}`,
    }));
  }
  return state.cases;
}

function cases() {
  stepLabel.textContent = 'Elegir caso';
  const data = catalogData();
  const dev = location.hostname.match(/^(localhost|127\.0\.0\.1)$/);
  const mode = new URLSearchParams(location.search).get('data') || 'demo';
  const levelTitles = {
    1: 'Nivel 1 · Piso 1 (tramos)',
    2: 'Nivel 2 · Pisos 1 a 3 (segundos)',
    3: 'Nivel 3 · Pisos 1 a 5 (cierres y esperas)',
    4: 'Nivel 4 · Pisos 1 a 5 (eventos en recorrido)',
  };
  const renderCard = c => {
    const hasEvent = c.id === 'C09' || c.id === 'C10';
    return `
      <button class="case" data-case="${c.id}" ${c.id.startsWith('D') ? 'disabled' : ''}>
        <span>
          <strong>${esc(c.paciente)}</strong>
          <small>${esc(c.dificultad)} · Nivel ${c.nivel} · Orden: ${esc(c.orden)}${c.movilidad_reducida ? ' · Movilidad reducida' : ''}</small>
          <span class="case-badges">
            ${c.movilidad_reducida ? '<span class="badge-chip wheelchair">♿ Silla de ruedas</span>' : ''}
            ${hasEvent ? '<span class="badge-chip event-chip">⚡ Evento</span>' : ''}
            ${!c.heuristica_disponible ? '<span class="badge-chip info-chip">Sin heurística</span>' : ''}
          </span>
        </span>
        <span class="case-id">${c.id}</span>
      </button>`;
  };
  let bodyHtml = '<div class="card"><h2>No hay casos en esta vista</h2><p>Selecciona «Demo» para volver al catálogo de diez casos.</p></div>';
  if (data.length) {
    if (mode === 'huge') {
      bodyHtml = `<div class="case-grid">${data.map(renderCard).join('')}</div>`;
    } else {
      const levels = [1, 2, 3, 4].filter(lvl => data.some(c => c.nivel === lvl));
      bodyHtml = levels.map(lvl => `
        <section class="level-group">
          <h2 class="level-heading">${levelTitles[lvl] || `Nivel ${lvl}`}</h2>
          <div class="case-grid">${data.filter(c => c.nivel === lvl).map(renderCard).join('')}</div>
        </section>`).join('');
    }
  }
  app.innerHTML =
    title('Elige un caso', 'Cuatro niveles, diez órdenes de destino y restricciones progresivas.') +
    bodyHtml +
    (dev
      ? `<nav class="fixture-toggle" aria-label="Datos de prueba">${[['demo', 'Demo'], ['worst', 'Worst case'], ['empty', 'Vacío'], ['one', 'Uno'], ['huge', '1000']].map(([value, label]) => `<a href="?data=${value}" class="${mode === value ? 'active' : ''}">${label}</a>`).join('')}</nav>`
      : '');
}

function patient() {
  const c = state.case;
  stepLabel.textContent = `${c.id} · Paciente`;
  app.innerHTML =
    title('Conoce al paciente', 'La orden del personal del caso define el destino. No se infiere un diagnóstico.') +
    `<div class="layout">
      <div class="card">
        <div class="patient-header">
          <img class="patient-portrait" src="${assetUrl(getCastSprites(c.id, c.movilidad_reducida).patientSrc)}" alt="${c.movilidad_reducida ? `Paciente en silla de ruedas: ${esc(c.paciente)}` : `Paciente: ${esc(c.paciente)}`}">
          <div>
            <h2>${esc(c.paciente)}</h2>
            <p class="note"><strong>Orden de destino:</strong> ${esc(c.orden)}.</p>
          </div>
        </div>
        <h2>Etapas previstas</h2>
        <div class="stage-list">${c.etapas.map((x, i) => `<span class="stage ${i === 0 ? 'current' : ''}">${i + 1}. ${name(x)}</span>`).join('')}</div>
        <p class="muted">Los eventos del nivel 4 pueden cambiar la orden durante el recorrido. Se recalcula desde la posición alcanzada.</p>
        <div class="actions">
          <button class="button" data-action="start">Iniciar ronda</button>
          <button class="button ghost" data-action="cases">Cambiar caso</button>
        </div>
      </div>
      <div class="card">
        <h2>Incidencias del centro médico</h2>
        ${renderIncidenciasList(state.plan?.incidencias_clinica)}
        <h2 style="margin-top:18px">Reglas de esta ronda</h2>
        <p>Eliges <strong>un solo algoritmo</strong> para acompañar al paciente por todas las etapas. Solo volverás a elegir si ocurre un evento imprevisto durante el recorrido.</p>
        <p>${c.movilidad_reducida ? 'Este paciente no puede usar escaleras.' : 'Revisa el parte de incidencias antes de elegir estrategia.'}</p>
        <p class="muted">Es una simulación académica, no una indicación de atención médica.</p>
      </div>
    </div>`;
}

function facts() {
  const r = state.round;
  const c = state.case;
  return `<div class="fact-list">
    <div class="fact"><span>Destino actual</span><b>${name(r.objetivo || r.pendientes[0] || 'Completado')}</b></div>
    <div class="fact"><span>Presupuesto de búsqueda · Mediana superior</span><b>${num(r.presupuesto ?? r.segmentos.at(-1)?.presupuesto ?? 0)} expansiones</b></div>
    <div class="fact"><span>Posición actual</span><b>Piso ${state.plan.nodos[r.posicion]?.piso || '—'} · ${esc(nodeName(r.posicion))}</b></div>
    <div class="fact"><span>Restricciones</span><b>${c.movilidad_reducida ? 'Sin escaleras' : 'Movilidad habitual'}${r.bloqueados.length ? ' · ' + r.bloqueados.map(name).join(', ') + ' bloqueado' : ''}</b></div>
  </div>`;
}

function areas() {
  const relevant = new Set(state.round.pendientes);
  const sections = state.plan.secciones.filter(s => relevant.has(s.area));
  return `<div class="card">
    <h2>Estado de las áreas</h2>
    <p class="muted">Hora del caso: ${esc(state.plan.hora_caso)}. La espera de una sala saturada se suma al costo.</p>
    <table class="area-table">
      <thead><tr><th>Sección</th><th>Piso</th><th>Estado</th><th>Horario</th></tr></thead>
      <tbody>${sections.map(s => `
        <tr>
          <td>${name(s.area)} ${s.id.split('_').at(-1)}</td>
          <td>${s.piso}</td>
          <td>
            <span class="status ${s.estado}">${s.estado === 'cerrada' ? '🔒 Cerrada hoy' : s.estado === 'saturada' ? `⏱ Con espera · ${num(s.espera_segundos)} s` : '✓ Abierta'}</span>
            ${s.motivo_cierre ? `<small class="reason">${esc(s.motivo_cierre)}</small>` : ''}
          </td>
          <td>${esc(s.horario)}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function selection() {
  const r = state.round;
  const ev = r.historial.filter(x => x.accion === 'evento').at(-1);
  const isWeighted = state.case.nivel > 1;
  const targetFloors = new Set(
    state.plan.secciones
      .filter(s => r.pendientes.includes(s.area) && s.estado !== 'cerrada')
      .map(s => s.piso)
  );
  const originFloor = state.plan.nodos[r.posicion]?.piso || 1;
  const relevantAreas = new Set(r.pendientes);
  const relevantSections = state.plan.secciones.filter(s => relevantAreas.has(s.area));

  stepLabel.textContent = `${state.case.id} · Elegir algoritmo`;
  app.innerHTML =
    title('Elige la estrategia', 'Analiza los ciclos y pesos del grafo esquemático antes de elegir el algoritmo.') +
    `<div class="selection-top-bar card">
      ${ev ? `<div class="event event-enter"><strong>Evento del caso:</strong> ${ev.bloqueados.length ? `${ev.bloqueados.map(name).join(', ')} bloqueado. Elige otra ruta desde ${esc(nodeName(r.posicion))}.` : `La orden cambió. El nuevo destino es ${name(r.objetivo)}; recalcula desde ${esc(nodeName(r.posicion))}.`}</div>` : ''}
      <div class="selection-meta-row">
        <div class="sel-order-summary">
          <strong>Orden:</strong> Traslada al paciente a <b>${name(r.objetivo)}</b>
          <span class="stage-list inline-stages">${r.pendientes.map((x, i) => `<span class="stage ${i === 0 ? 'current' : ''}">E${i + 1}: ${name(x)}</span>`).join('')}</span>
        </div>
        <div class="sel-compact-facts">
          <span class="cfact"><em>Origen:</em> <b>P${originFloor} · ${esc(nodeName(r.posicion))}</b></span>
          <span class="cfact"><em>Presupuesto (mediana sup.):</em> <b>${num(r.presupuesto ?? r.segmentos.at(-1)?.presupuesto ?? 0)} exp.</b></span>
          <span class="cfact"><em>Movilidad:</em> <b>${state.case.movilidad_reducida ? '♿ Sin escaleras' : 'Habitual'}${r.bloqueados.length ? ' · ⛔ ' + r.bloqueados.map(name).join(', ') : ''}</b></span>
        </div>
      </div>
    </div>

    <div class="layout selection-layout">
      <div class="stack selection-main-col">
        <section class="card map-card preview-graph-card" aria-label="Grafo completo del caso">
          <div class="preview-graph-head">
            <div class="preview-head-left">
              <h2 id="preview-minimap-title">Grafo del caso (${state.plan.pisos_habilitados.length === 1 ? 'Piso 1' : `Pisos ${state.plan.pisos_habilitados[0]}–${state.plan.pisos_habilitados.at(-1)}`})</h2>
              <span class="graph-nature-badge ${isWeighted ? 'weighted' : 'unweighted'}">
                ${isWeighted ? '⏱️ Ponderado en segundos (pasillo 4s, galería 16–32s, ascensor y espera)' : '⚖️ Costos en tramos: conexión física 1; terminal de llegada 0'}
              </span>
            </div>
            <div class="preview-head-controls">
              <div class="preview-mode-toggle" role="group" aria-label="Modo de visualización del grafo">
                <button type="button" class="pmode-btn ${state.previewMode === 'schematic' ? 'active' : ''}" data-preview-mode="schematic" aria-pressed="${state.previewMode === 'schematic'}">Esquemático</button>
                <button type="button" class="pmode-btn ${state.previewMode === 'full' ? 'active' : ''}" data-preview-mode="full" aria-pressed="${state.previewMode === 'full'}">Completo (16 pts)</button>
              </div>
            </div>
          </div>
          <div class="mf-pan-hint" aria-hidden="true">↔ Desliza horizontalmente para ver todo el piso</div>
          <div id="preview-minimap-wrap" class="mf-svg-wrap" tabindex="0" role="region" aria-label="Contenedor desplazable del grafo del caso">
            ${renderMultiFloorGraphSvg({
              plan: state.plan,
              round: r,
              mode: 'preview',
              isWeighted,
              wheelchair: state.case.movilidad_reducida,
              nodeName,
              expanded: state.previewMode === 'full',
              describedById: 'preview-graph-summary',
            })}
          </div>
          <div id="preview-graph-a11y">${renderMultiFloorGraphA11y({
            plan: state.plan,
            round: r,
            mode: 'preview',
            isWeighted,
            wheelchair: state.case.movilidad_reducida,
            nodeName,
            expanded: state.previewMode === 'full',
            summaryId: 'preview-graph-summary',
            areaName: name,
            algorithm: state.selected,
          })}</div>
          <div class="map-legend">
            <span><b class="lg-orig">●</b> Origen (${esc(nodeName(r.posicion))})</span>
            <span><b class="lg-target">★</b> Destino de etapa</span>
            <span>■ 🔒 Cerrada</span>
            <span>◆ ⏱ Saturada</span>
            <span><b class="lg-discard">⛔ / ♿</b> Acceso bloqueado o no accesible</span>
          </div>
        </section>

        <div class="card compact-algo-card">
          <div class="algo-bar-head">
            <div>
              <h2>Duelo de algoritmos (${r.algoritmos.map(a => name(a)).join(' vs. ')})</h2>
              <p class="muted">Elige una de las dos estrategias en duelo. Se reutilizará automáticamente en las etapas siguientes salvo evento imprevisto.</p>
            </div>
            <div class="actions algo-cta-actions">
              <button class="button" data-action="choose" ${state.selected ? '' : 'disabled'}>Calcular ruta</button>
              <button class="button ghost" data-action="cases">Ver otros casos</button>
            </div>
          </div>
          ${r.pista_analitica ? `<p class="duel-hint-bar"><strong>Pista analítica:</strong> ${esc(r.pista_analitica)}</p>` : ''}
          ${!state.case.heuristica_disponible ? '<p class="note">En este reto no se ofrece una heurística informativa: A* opera con <strong>h = 0</strong> (misma prioridad que Dijkstra).</p>' : ''}
          <div class="option-grid duel-grid">
            ${r.algoritmos.map((a, idx) => {
              const meta = algorithmMeta(a, state.case.heuristica_disponible);
              const vsDivider = idx === 0 && r.algoritmos.length === 2
                ? '<span class="duel-vs" aria-hidden="true">VS</span>'
                : '';
              return `
                <button class="option duel-option ${state.selected === a ? 'selected' : ''}" data-algorithm="${a}" aria-pressed="${state.selected === a}">
                  <div class="duel-opt-head">
                    <span class="option-icon">${algoIcon(a)}</span>
                    <div>
                      <strong>${name(a)}</strong>
                      <span class="option-tag">${esc(meta.tag)}</span>
                    </div>
                  </div>
                  <p class="option-desc">${esc(meta.hint)}</p>
                </button>${vsDivider}`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="stack selection-side-col">
        <div class="card compact-incidencias-card">
          <h2>Incidencias del centro médico</h2>
          ${renderIncidenciasList(r.incidencias_clinica)}
          <details class="areas-accordion" ${relevantSections.some(s => s.estado !== 'abierta') ? 'open' : ''}>
            <summary class="areas-summary">Estado de las áreas (${relevantSections.length} secciones · ${esc(state.plan.hora_caso)})</summary>
            <table class="area-table compact-area-table">
              <thead><tr><th>Sección</th><th>Piso</th><th>Estado</th><th>Horario</th></tr></thead>
              <tbody>${relevantSections.map(s => `
                <tr>
                  <td>${name(s.area)} ${s.id.split('_').at(-1)}</td>
                  <td>${s.piso}</td>
                  <td>
                    <span class="status ${s.estado}">${s.estado === 'cerrada' ? '🔒 Cerrada hoy' : s.estado === 'saturada' ? `⏱ +${num(s.espera_segundos)} s` : '✓ Abierta'}</span>
                    ${s.motivo_cierre ? `<small class="reason">${esc(s.motivo_cierre)}</small>` : ''}
                  </td>
                  <td>${esc(s.horario)}</td>
                </tr>`).join('')}</tbody>
            </table>
          </details>
        </div>
      </div>
    </div>`;
}

function meterBar(label, value, refValue, unit) {
  const pct = refValue > 0 ? Math.min(100, Math.round((refValue / Math.max(value, refValue)) * 100)) : 100;
  const good = value <= refValue;
  return `<div class="meter-row">
    <div class="meter-head"><span>${label}</span><strong>${num(value)} / ${num(refValue)} ${unit}</strong></div>
    <div class="meter-track"><div class="meter-fill ${good ? 'good' : 'warn'}" style="width:${pct}%"></div></div>
  </div>`;
}

function map() {
  const r = state.round;
  stepLabel.textContent = `${state.case.id} · Recorrido`;
  const remaining = r.ruta.length - 1 - r.indice;
  const isWeighted = state.case.nivel > 1;

  // Montaje persistente del shell de recorrido:
  // Arriba: Escena 2D (izq) + Estado de las áreas (der); Abajo: Grafo multipiso avanzando en vivo.
  let shell = app.querySelector('#recorrido-shell');
  if (!shell) {
    app.innerHTML =
      title('Acompaña al paciente', 'Avanza un punto por vez. El estado y la posición se guardan en el servidor.') +
      `<div id="recorrido-shell" class="recorrido-stack">
        <div class="layout recorrido-layout">
          <div class="stack recorrido-main-col">
            <div class="card scene-card">
              <div id="scene-mount"></div>
              <div class="scene-footer">
                <div class="step-info">
                  <p id="step-now" role="status" aria-live="polite" aria-atomic="true"></p>
                  <p id="step-next"></p>
                  <p id="step-rem" class="muted"></p>
                </div>
                <div class="move-bar">
                  <p id="step-dest"></p>
                  <button class="button" data-action="advance">Avanzar al siguiente punto</button>
                </div>
              </div>
            </div>
          </div>
          <div class="stack recorrido-side-col">
            <div id="areas-mount"></div>
          </div>
        </div>
        <section class="card map-card walk-graph-card" aria-label="Avance en el grafo del caso">
          <div class="preview-graph-head">
            <div class="preview-head-left">
              <h2>Avance en el grafo · ${name(r.algoritmo_activo || '')}</h2>
              <span id="walk-step-pill" class="graph-nature-badge ${isWeighted ? 'weighted' : 'unweighted'}"></span>
            </div>
          </div>
          <div class="mf-pan-hint mobile-only" aria-hidden="true">↔ Desliza horizontalmente para ver todo el piso</div>
          <div id="walk-graph-mount" class="mf-svg-wrap" tabindex="0" role="region" aria-label="Contenedor desplazable del avance en el grafo"></div>
          <div id="walk-graph-a11y"></div>
          <div class="map-legend">
            <span class="leg-route">● ━ Recorrido avanzado</span>
            <span><b class="lg-target">★</b> Destino actual</span>
            <span>● Abierta</span>
            <span>■ Cerrada</span>
            <span>◆ Saturada</span>
          </div>
        </section>
      </div>`;
    shell = app.querySelector('#recorrido-shell');
  }

  // 1. Actualizar escena lateral 2D (DOM persistente)
  mountOrUpdateScene(shell.querySelector('#scene-mount'), {
    plan: state.plan,
    round: r,
    wheelchair: state.case.movilidad_reducida,
    caseId: state.case.id,
    patientName: state.case.paciente,
    nameFn: name,
    nodeNameFn: nodeName,
    prevPos: state.prevPos,
  });

  // 2. Actualizar textos paso a paso
  shell.querySelector('#step-now').innerHTML = `<strong>Ahora:</strong> piso ${state.plan.nodos[r.posicion]?.piso} · ${esc(nodeName(r.posicion))}`;
  shell.querySelector('#step-next').innerHTML = `<strong>Siguiente:</strong> ${remaining ? esc(nodeName(r.ruta[r.indice + 1].replace(/^fin_/, ''))) : 'Destino alcanzado'}`;
  shell.querySelector('#step-rem').textContent = `Quedan ${remaining} ${remaining === 1 ? 'punto' : 'puntos'} para esta etapa.`;
  shell.querySelector('#step-dest').innerHTML = `Destino: <strong>${name(r.pendientes[0])}</strong>`;

  // 3. Actualizar Estado de las áreas en la columna derecha
  shell.querySelector('#areas-mount').innerHTML = areas();

  // 4. Actualizar el grafo multipiso en sincronía con cada clic en "Avanzar al siguiente punto"
  const walkPill = shell.querySelector('#walk-step-pill');
  if (walkPill) {
    walkPill.textContent = `Paso ${r.indice + 1} de ${r.ruta.length} · Piso ${state.plan.nodos[r.posicion]?.piso || 1} (${nodeName(r.posicion)})`;
  }
  const walkRelevantIds = extractWalkRelevantNodes(r);
  shell.querySelector('#walk-graph-mount').innerHTML = renderMultiFloorGraphSvg({
    plan: state.plan,
    round: r,
    mode: 'walk',
    isWeighted,
    wheelchair: state.case.movilidad_reducida,
    nodeName,
    describedById: 'walk-graph-summary',
    relevantIds: walkRelevantIds,
  });
  const walkA11y = shell.querySelector('#walk-graph-a11y');
  if (walkA11y) {
    walkA11y.innerHTML = renderMultiFloorGraphA11y({
      plan: state.plan,
      round: r,
      mode: 'walk',
      isWeighted,
      wheelchair: state.case.movilidad_reducida,
      nodeName,
      summaryId: 'walk-graph-summary',
      areaName: name,
      algorithm: r.algoritmo_activo,
      relevantIds: walkRelevantIds,
    });
  }
}

function buildCaseContext(caseData, plan, round) {
  const isUnweighted = caseData.nivel === 1;
  if (isUnweighted) return 'En este grafo de tramos uniformes en Piso 1';

  const incidencias = plan?.incidencias_clinica || [];
  const parts = [];
  if (!caseData.heuristica_disponible) parts.push('sin heurística informativa (h = 0)');
  if (caseData.movilidad_reducida) parts.push('silla de ruedas (sin escaleras)');
  const slowElev = incidencias.find(i => i.tipo === 'ascensor_lento');
  if (slowElev) parts.push(`${name(slowElev.grupo)} lento (${num(slowElev.segundos_por_piso)} s/piso)`);
  const initBlocked = incidencias.find(i => i.tipo === 'ascensor_bloqueado');
  if (initBlocked) parts.push(`${name(initBlocked.grupo)} bloqueado`);
  if (incidencias.some(i => i.tipo === 'sala_cerrada')) parts.push('salas cerradas por horario');
  if (incidencias.some(i => i.tipo === 'sala_saturada')) parts.push('espera por saturación');

  const evs = (round?.historial || []).filter(x => x.accion === 'evento');
  if (evs.length) {
    const lastEv = evs.at(-1);
    parts.push(
      lastEv.bloqueados?.length
        ? `bloqueo repentino de ${lastEv.bloqueados.map(name).join(', ')} en ruta`
        : 'cambio de orden en ruta'
    );
  }
  if (!parts.length) return 'En este caso ponderado en segundos';
  const joined = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
  return `En este caso ponderado con ${joined}`;
}

function buildCaseExplanation(x, idx, duelRanking, { caseData, plan, round, unit }) {
  const ctx = buildCaseContext(caseData, plan, round);
  const isUnweighted = caseData.nivel === 1;
  const hasHeuristic = caseData.heuristica_disponible;
  const primero = duelRanking[0];
  const rival = duelRanking[1];

  let exec = '';
  if (x.algoritmo === 'bfs') {
    exec = isUnweighted
      ? `${ctx}, <strong>BFS</strong> exploró por capas (cola FIFO) y <strong>aseguró la ruta mínima de ${num(x.costo)} ${unit}</strong> con ${num(x.expansiones)} expansiones (presupuesto ${num(x.presupuesto)}).`
      : `${ctx}, <strong>BFS</strong> priorizó menos saltos sin ponderar segundos, cerrando en <strong>${num(x.costo)} ${unit}</strong> (óptimo ${num(x.optimo)}) con ${num(x.expansiones)} expansiones.`;
  } else if (x.algoritmo === 'dfs') {
    exec = `${ctx}, <strong>DFS</strong> profundizó por una rama con retroceso (pila LIFO) sin evaluar el costo mínimo, recorriendo <strong>${num(x.costo)} ${unit}</strong> frente al óptimo de ${num(x.optimo)} con ${num(x.expansiones)} expansiones.`;
  } else if (x.algoritmo === 'dijkstra') {
    exec = !hasHeuristic
      ? `${ctx}, <strong>Dijkstra</strong> ordenó por costo acumulado <strong>g(n)</strong>, evitando penalizaciones lentas y logrando el <strong>óptimo de ${num(x.costo)} ${unit}</strong> con ${num(x.expansiones)} expansiones.`
      : `${ctx}, <strong>Dijkstra</strong> expandió por menor costo acumulado <strong>g(n)</strong> sin guía heurística hacia el destino, logrando el <strong>óptimo de ${num(x.costo)} ${unit}</strong> con ${num(x.expansiones)} expansiones (presupuesto ${num(x.presupuesto)}).`;
  } else {
    exec = !hasHeuristic
      ? `${ctx}, <strong>A*</strong> operó con <strong>h = 0</strong> (misma prioridad que Dijkstra), evitando penalizaciones lentas y logrando el <strong>óptimo de ${num(x.costo)} ${unit}</strong> con ${num(x.expansiones)} expansiones.`
      : `${ctx}, <strong>A*</strong> combinó costo acumulado y heurística (<strong>f = g + h</strong>) para orientar la búsqueda hacia el destino, logrando el <strong>óptimo de ${num(x.costo)} ${unit}</strong> con solo <strong>${num(x.expansiones)} expansiones</strong> (presupuesto ${num(x.presupuesto)}).`;
  }

  let verdict = '';
  if (idx === 0) {
    if (rival && x.total === rival.total && x.costo === rival.costo && x.expansiones === rival.expansiones) {
      verdict = `<strong>Empate técnico exacto con ${esc(rival.nombre_legible)}</strong> (${num(x.costo)} ${unit} y ${num(x.expansiones)} expansiones): ambos fueron igual de eficientes y el orden se resuelve solo por identificador.`;
    } else if (rival && rival.costo > x.costo) {
      verdict = `<strong>Fue el más eficiente del duelo:</strong> ahorró <strong>${num(rival.costo - x.costo)} ${unit}</strong> frente a ${esc(rival.nombre_legible)} cumpliendo todas las restricciones.`;
    } else if (rival && rival.expansiones > x.expansiones) {
      verdict = `<strong>Fue el más eficiente del duelo:</strong> igualó el costo óptimo pero exploró <strong>${num(rival.expansiones - x.expansiones)} nodos menos</strong> que ${esc(rival.nombre_legible)}, reduciendo el trabajo de búsqueda.`;
    } else {
      verdict = `<strong>Lideró el duelo</strong> con <strong>${num(x.total)}/100 pts</strong> por su mejor balance entre costo óptimo y trabajo de búsqueda.`;
    }
  } else if (primero) {
    if (x.total === primero.total && x.costo === primero.costo && x.expansiones === primero.expansiones) {
      verdict = `<strong>Totalmente utilizable y en empate técnico con ${esc(primero.nombre_legible)}:</strong> logró el mismo óptimo (${num(x.costo)} ${unit}) y las mismas ${num(x.expansiones)} expansiones; figura ${idx + 1}° solo por desempate alfabético.`;
    } else if (x.costo > x.optimo) {
      verdict = `<strong>Aunque fue utilizable</strong> (llegó a una sala válida), <strong>no fue suficientemente eficiente:</strong> sumó <strong>${num(x.costo - x.optimo)} ${unit} extra</strong> sobre su óptimo${x.total < 80 ? ' y quedó bajo 80 pts' : ''}, superado por ${esc(primero.nombre_legible)}.`;
    } else if (x.expansiones > primero.expansiones) {
      verdict = `<strong>Aunque fue utilizable y logró el costo óptimo</strong>, <strong>no fue tan eficiente como ${esc(primero.nombre_legible)}:</strong> sin guía heurística necesitó <strong>${num(x.expansiones - primero.expansiones)} expansiones más</strong> para el mismo destino.`;
    } else {
      verdict = `<strong>Fue utilizable</strong> para completar el caso, pero quedó detrás de ${esc(primero.nombre_legible)} por menor puntuación total (<strong>${num(x.total)}</strong> frente a ${num(primero.total)} pts).`;
    }
  }
  return `${exec} ${verdict}`;
}

function result() {
  const r = state.round;
  const s = state.score;
  const segs = r.segmentos;
  const cost = segs.reduce((x, y) => x + y.costo, 0);
  const opt = segs.reduce((x, y) => x + y.optimo, 0);
  const exp = segs.reduce((x, y) => x + y.expansiones, 0);
  const budget = segs.reduce((x, y) => x + y.presupuesto, 0);
  const unit = state.case.nivel === 1 ? 'tramos' : 'segundos';

  const choicesByAlg = new Map();
  segs.forEach((seg, i) => {
    if (!seg.algoritmo) return;
    if (!choicesByAlg.has(seg.algoritmo)) choicesByAlg.set(seg.algoritmo, []);
    choicesByAlg.get(seg.algoritmo).push(i + 1);
  });
  const usedAlgs = new Set(r.historial.filter(x => x.accion === 'eleccion').map(x => x.algoritmo));
  const isMixedRound = usedAlgs.size > 1;
  const duelosHtml = (s.duelos_presentados || []).map((d, i) => `
    <span class="duel-pill">
      <em>Decisión ${i + 1} (${esc(name(d.objetivo))}):</em>
      <b>${d.algoritmos.map(a => esc(name(a))).join(' vs. ')}</b>
    </span>`).join('');
  const offeredOnly = (s.ranking_algoritmos || []).filter(x => x.ofrecido === true);
  const duelRanking = offeredOnly.length ? offeredOnly : (s.ranking_algoritmos || []);
  const primero = duelRanking[0];
  const isExactTie = (a, b) => Boolean(a && b && a.total === b.total && a.costo === b.costo && a.expansiones === b.expansiones);
  const topTied = duelRanking.length > 1 && isExactTie(duelRanking[0], duelRanking[1]);
  const mixedNoteHtml = isMixedRound
    ? `<p class="ranking-mixed-note"><strong>Tu combinación real (${segs.map((seg, i) => `Etapa ${i + 1}: ${esc(name(seg.algoritmo))}`).join(' → ')}) obtuvo ${num(s.total)}/100 pts.</strong> Cada tarjeta siguiente simula un algoritmo aplicado como <em>estrategia fija durante toda la ronda</em> como referencia comparativa.</p>`
    : '';
  const rankingHtml = duelRanking.map((x, idx) => {
    const pos = idx + 1;
    const isPlayer = usedAlgs.has(x.algoritmo);
    const stages = choicesByAlg.get(x.algoritmo) || [];
    const isTiedAtTop = topTied && isExactTie(x, primero);
    const isTopWinner = !topTied && pos === 1;
    const tiedOptimal = !isMixedRound && isPlayer && x.total === 100 && primero && x.costo === primero.costo;
    const topChip = isTiedAtTop
      ? '<span class="rank-chip tie-choice">🤝 Empate técnico</span>'
      : isTopWinner
        ? `<span class="rank-chip top-choice">${duelRanking.length === 2 ? '🏆 Ganador del duelo' : '🏆 1° Puesto'}</span>`
        : '';
    const playerChip = isPlayer
      ? (isMixedRound
          ? `<span class="rank-chip player-stage-choice">★ Elegido en ${stages.length === 1 ? `Etapa ${stages[0]}` : `Etapas ${stages.join(', ')}`}</span><span class="rank-chip ref-sim-chip">Simulación fija toda la ronda</span>`
          : '<span class="rank-chip player-choice">★ Tu elección</span>')
      : (isMixedRound ? '<span class="rank-chip ref-sim-chip">Simulación fija toda la ronda</span>' : '');
    return `
      <li class="ranking-item ${isTopWinner || isTiedAtTop ? 'rank-1' : ''} ${isPlayer ? 'is-player' : ''}">
        <div class="rank-head">
          <span class="rank-pos">${pos}°</span>
          <span class="rank-icon">${algoIcon(x.algoritmo)}</span>
          <div class="rank-title">
            <strong>${esc(x.nombre_legible)}</strong>
            <div class="rank-chips">
              ${topChip}
              ${playerChip}
              ${tiedOptimal ? '<span class="rank-chip optimal-choice">✓ Óptimo alcanzado</span>' : ''}
            </div>
          </div>
          <div class="rank-score"><strong>${num(x.total)}</strong><small>/100 pts</small></div>
        </div>
        <div class="rank-metrics">
          <span>Costo: <b>${num(x.costo)}</b> / ópt. ${num(x.optimo)} ${unit}${x.optimo !== opt ? ' <em class="opt-door-note">(por puerta alcanzada en etapa 1)</em>' : ''}</span>
          <span>Expansiones: <b>${num(x.expansiones)}</b> / pres. ${num(x.presupuesto)}</span>
        </div>
        <p class="rank-why">${buildCaseExplanation(x, idx, duelRanking, { caseData: state.case, plan: state.plan, round: r, unit })}</p>
      </li>`;
  }).join('');

  stepLabel.textContent = `${state.case.id} · Resultado`;
  app.innerHTML =
    title(s.victoria ? 'Ronda superada' : 'Recorrido completado', 'Llegaste a una sección válida. Revisa cómo influyeron la ruta y la búsqueda.') +
    `<div class="layout result-layout">
      <div class="stack">
        <section class="card ranking-card">
          <h2>Ranking comparativo</h2>
          <p class="muted">${duelRanking.length === 2 ? 'Cara a cara entre los 2 algoritmos ofrecidos en el duelo de este caso bajo las mismas condiciones.' : 'Comparación de los algoritmos ofrecidos en los duelos de esta ronda bajo las mismas condiciones y eventos.'}</p>
          ${duelosHtml ? `<div class="duel-history-bar" aria-label="Duelos presentados en la ronda">${duelosHtml}</div>` : ''}
          ${mixedNoteHtml}
          <ol class="ranking-list">${rankingHtml}</ol>
        </section>
        <section class="card exploration-card" aria-label="Exploración del Algoritmo">
          <h2>Exploración del Algoritmo</h2>
          <p class="muted">Reproduce paso a paso cómo exploró el algoritmo el grafo completo del edificio.</p>
          <div id="result-phase8-slot" class="phase8-slot"></div>
        </section>
        <div class="card">
          <h2>Detalle por etapa</h2>
          <table class="area-table">
            <thead><tr><th>Etapa</th><th>Costo</th><th>Óptimo por etapa</th><th>Expansiones</th><th>Presupuesto</th></tr></thead>
            <tbody>${segs.map((x, i) => `<tr><td>${i + 1}</td><td>${num(x.costo)}</td><td>${num(x.optimo)}</td><td>${num(x.expansiones)}</td><td>${num(x.presupuesto)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="stack">
        <div class="card result-enter result-summary-card">
          <div class="result-summary-head">
            <div>
              <h2>Tu evaluación</h2>
              <p class="muted result-verdict">${s.victoria ? 'Superaste el umbral de 80 puntos.' : 'Puedes mejorar tu estrategia para superar 80 puntos.'}</p>
            </div>
            <div class="score compact-score">${num(s.total)}<small>/100</small></div>
          </div>
          <div class="metrics compact-result-metrics">
            <div class="metric"><span>Costo</span><strong>${num(cost)}</strong></div>
            <div class="metric"><span>Óptimo por etapa</span><strong>${num(opt)}</strong></div>
            <div class="metric"><span>Nodos explorados</span><strong>${num(exp)}</strong></div>
            <div class="metric"><span>Presupuesto</span><strong>${num(budget)}</strong></div>
          </div>
          <div class="meters compact-result-meters">
            ${meterBar('Costo real vs. óptimo por etapa', cost, opt, unit)}
            ${meterBar('Expansiones vs. presupuesto', exp, budget, 'exp.')}
          </div>
          <p class="muted result-summary-note">${cost === opt ? 'Tu ruta empata la suma de óptimos por etapa (condicionados a la puerta alcanzada).' : `Diferencia de costo: ${num(cost - opt)} ${unit}.`} ${exp <= budget ? 'Búsqueda dentro del presupuesto.' : `Exceso: ${num(exp - budget)} exp.`}</p>
          <div class="actions compact-result-actions">
            <button class="button" data-action="restart">Repetir este caso</button>
            <button class="button ghost" data-action="cases">Elegir otro caso</button>
          </div>
        </div>
        <div class="card">
          <h2>Cómo se suman los puntos</h2>
          <ul class="breakdown">
            <li>
              <div class="bd-row"><span>Estrategia ${segs.every(x => x.garantizado) ? 'con garantía' : 'sin garantía en alguna etapa'}</span><strong>${num(s.componentes.estrategia)}/20</strong></div>
              <div class="meter-track"><div class="meter-fill good" style="width:${Math.round((s.componentes.estrategia / 20) * 100)}%"></div></div>
            </li>
            <li>
              <div class="bd-row"><span>Calidad de la ruta · 40 × óptimo / costo</span><strong>${num(s.componentes.calidad)}/40</strong></div>
              <div class="meter-track"><div class="meter-fill good" style="width:${Math.round((s.componentes.calidad / 40) * 100)}%"></div></div>
            </li>
            <li>
              <div class="bd-row"><span>Trabajo de búsqueda · 25 × mín(1, presupuesto / expansiones)</span><strong>${num(s.componentes.exploracion)}/25</strong></div>
              <div class="meter-track"><div class="meter-fill ${s.componentes.exploracion >= 25 ? 'good' : 'warn'}" style="width:${Math.round((s.componentes.exploracion / 25) * 100)}%"></div></div>
            </li>
            <li>
              <div class="bd-row"><span>Restricciones cumplidas</span><strong>${num(s.componentes.restricciones)}/15</strong></div>
              <div class="meter-track"><div class="meter-fill good" style="width:${Math.round((s.componentes.restricciones / 15) * 100)}%"></div></div>
            </li>
          </ul>
          <p class="muted">La puntuación se calcula en servidor. Una ruta óptima con un algoritmo sin garantía puede recibir 10 puntos de estrategia; superar el presupuesto conserva parte de los puntos de búsqueda.</p>
        </div>
        <div class="card">
          <h2>Decisiones y eventos</h2>
          <ol class="history">${r.historial.filter(x => ['eleccion', 'evento'].includes(x.accion)).map(x => `<li>${x.accion === 'eleccion' ? `En ${esc(nodeName(x.posicion))}: ${name(x.algoritmo)}${x.automatica ? ' (continuación automática)' : ' (elección)'} · presupuesto ${num(x.presupuesto)}` : `Evento: ${x.bloqueados.length ? x.bloqueados.map(name).join(', ') + ' bloqueado' : 'cambio de orden'} desde ${esc(nodeName(x.posicion))}`}</li>`).join('')}</ol>
        </div>
      </div>
    </div>`;
  mountOrUpdateSearchTrace(app.querySelector('#result-phase8-slot'), {
    plan: state.plan,
    round: r,
    wheelchair: state.case.movilidad_reducida,
    nameFn: name,
    nodeNameFn: nodeName,
  });
}

function render() {
  if (state.screen === 'welcome' || !state.cases.length) return welcome();
  if (!state.case) return cases();
  if (!state.round) return patient();
  if (state.round.estado === 'eleccion') return selection();
  if (state.round.estado === 'recorrido') return map();
  if (state.score) return result();
  app.innerHTML = '<p>Calculando evaluación…</p>';
}

const currentUrl = () => `${location.pathname}${location.search}`;
const isRoundActive = () => Boolean(state.round && (state.round.estado === 'eleccion' || state.round.estado === 'recorrido'));

let leaveModalEl = null;
let lastFocusedBeforeModal = null;

function closeLeaveModal() {
  if (!leaveModalEl || leaveModalEl.hidden) return;
  leaveModalEl.hidden = true;
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}

function openLeaveModal() {
  if (!leaveModalEl) {
    leaveModalEl = document.createElement('div');
    leaveModalEl.id = 'leave-modal';
    leaveModalEl.className = 'modal-backdrop';
    leaveModalEl.hidden = true;
    leaveModalEl.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-modal-title" aria-describedby="leave-modal-desc">
        <h2 id="leave-modal-title">¿Abandonar el caso actual?</h2>
        <p id="leave-modal-desc">Si retrocedes ahora, perderás el progreso de esta ronda y volverás al catálogo de casos.</p>
        <div class="modal-actions">
          <button type="button" class="button" data-modal-action="stay">Seguir en el caso</button>
          <button type="button" class="button ghost modal-leave-btn" data-modal-action="leave">Salir a los casos</button>
        </div>
      </div>`;
    leaveModalEl.addEventListener('click', e => {
      if (e.target === leaveModalEl) {
        closeLeaveModal();
        return;
      }
      const btn = e.target.closest('button[data-modal-action]');
      if (!btn) return;
      if (btn.dataset.modalAction === 'stay') {
        closeLeaveModal();
      } else if (btn.dataset.modalAction === 'leave') {
        closeLeaveModal();
        goToCases({ push: false, replace: true });
      }
    });
    leaveModalEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLeaveModal();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = [...leaveModalEl.querySelectorAll('button')];
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    document.body.appendChild(leaveModalEl);
  }
  if (!leaveModalEl.hidden) return;
  lastFocusedBeforeModal = document.activeElement;
  leaveModalEl.hidden = false;
  leaveModalEl.querySelector('button[data-modal-action="stay"]')?.focus();
}

function goToWelcome() {
  closeLeaveModal();
  stopTracePlayback();
  state.screen = 'welcome';
  state.case = null;
  state.plan = null;
  state.round = null;
  state.score = null;
  state.selected = null;
  state.prevPos = null;
  state.floor = 1;
  render();
}

function goToCases({ push = true, replace = false } = {}) {
  closeLeaveModal();
  stopTracePlayback();
  state.screen = 'cases';
  state.case = null;
  state.plan = null;
  state.round = null;
  state.score = null;
  state.selected = null;
  state.prevPos = null;
  state.floor = 1;
  if (push) history.pushState({ view: 'cases' }, '', currentUrl());
  else if (replace) history.replaceState({ view: 'cases' }, '', currentUrl());
  render();
}

async function openCase(id, { push = true } = {}) {
  closeLeaveModal();
  stopTracePlayback();
  state.case = state.cases.find(x => x.id === id);
  if (!state.case) {
    goToCases({ push: false, replace: true });
    return;
  }
  state.plan = await request(`/juego/escenarios/${id}/plano`);
  state.round = null;
  state.score = null;
  state.selected = null;
  state.prevPos = null;
  state.floor = 1;
  state.screen = 'case';
  if (push) history.pushState({ view: 'patient', caseId: id }, '', currentUrl());
  render();
}

async function start() {
  closeLeaveModal();
  stopTracePlayback();
  state.round = await request('/rondas', 'POST', { escenario: state.case.id });
  state.score = null;
  state.selected = null;
  state.prevPos = null;
  state.floor = 1;
  history.pushState({ view: 'round', caseId: state.case.id, roundId: state.round.id }, '', currentUrl());
}

async function choose() {
  stopTracePlayback();
  state.prevPos = state.round.posicion;
  state.round = await request(`/rondas/${state.round.id}/eleccion`, 'POST', { algoritmo: state.selected });
  state.floor = state.plan.nodos[state.round.posicion].piso;
}

async function advance() {
  state.prevPos = state.round.posicion;
  state.round = await request(`/rondas/${state.round.id}/avance`, 'POST');
  state.floor = state.plan.nodos[state.round.posicion]?.piso || state.floor;
  if (state.round.estado === 'eleccion') state.selected = null;
  if (state.round.estado === 'terminada') {
    state.score = await request(`/rondas/${state.round.id}/evaluacion`);
    history.replaceState({ view: 'result', caseId: state.case.id }, '', currentUrl());
  }
}

window.addEventListener('popstate', e => {
  if (isRoundActive()) {
    history.pushState({ view: 'round', caseId: state.case?.id, roundId: state.round?.id }, '', currentUrl());
    openLeaveModal();
    return;
  }
  if (state.round?.estado === 'terminada' || state.score) {
    goToCases({ push: false, replace: true });
    return;
  }
  const view = e.state?.view || (new URLSearchParams(location.search).has('data') ? 'cases' : 'welcome');
  if (view === 'welcome') {
    goToWelcome();
  } else if (view === 'patient' && e.state?.caseId) {
    action(() => openCase(e.state.caseId, { push: false }));
  } else {
    goToCases({ push: false });
  }
});

app.addEventListener('click', e => {
  if (state.busy) return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.previewMode) {
    state.previewMode = b.dataset.previewMode;
    const prevWrap = app.querySelector('#preview-minimap-wrap');
    if (prevWrap && state.round?.estado === 'eleccion') {
      app.querySelectorAll('button[data-preview-mode]').forEach(btn => {
        const active = btn.dataset.previewMode === state.previewMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      const isWeighted = state.case.nivel > 1;
      const expanded = state.previewMode === 'full';
      prevWrap.innerHTML = renderMultiFloorGraphSvg({
        plan: state.plan,
        round: state.round,
        mode: 'preview',
        isWeighted,
        wheelchair: state.case.movilidad_reducida,
        nodeName,
        expanded,
        describedById: 'preview-graph-summary',
      });
      const prevA11y = app.querySelector('#preview-graph-a11y');
      if (prevA11y) {
        prevA11y.innerHTML = renderMultiFloorGraphA11y({
          plan: state.plan,
          round: state.round,
          mode: 'preview',
          isWeighted,
          wheelchair: state.case.movilidad_reducida,
          nodeName,
          expanded,
          summaryId: 'preview-graph-summary',
          areaName: name,
          algorithm: state.selected,
        });
      }
    }
    b.focus();
    return;
  }
  if (b.dataset.algorithm) {
    state.selected = b.dataset.algorithm;
    const grid = app.querySelector('.option-grid');
    if (grid && state.round?.estado === 'eleccion') {
      grid.querySelectorAll('button[data-algorithm]').forEach(btn => {
        const active = btn.dataset.algorithm === state.selected;
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      const chooseBtn = app.querySelector('button[data-action="choose"]');
      if (chooseBtn) chooseBtn.disabled = !state.selected;
      const prevA11y = app.querySelector('#preview-graph-a11y');
      if (prevA11y) {
        prevA11y.innerHTML = renderMultiFloorGraphA11y({
          plan: state.plan,
          round: state.round,
          mode: 'preview',
          isWeighted: state.case.nivel > 1,
          wheelchair: state.case.movilidad_reducida,
          nodeName,
          expanded: state.previewMode === 'full',
          summaryId: 'preview-graph-summary',
          areaName: name,
          algorithm: state.selected,
        });
      }
    } else {
      render();
    }
    b.focus();
    return;
  }
  if (b.dataset.case) {
    action(() => openCase(b.dataset.case));
    return;
  }
  const a = b.dataset.action;
  if (a === 'cases') {
    goToCases({ push: true });
  }
  if (a === 'start') action(start);
  if (a === 'choose' && state.selected) action(choose);
  if (a === 'advance') action(advance);
  if (a === 'restart') action(start);
});

history.replaceState({ view: state.screen === 'cases' ? 'cases' : 'welcome' }, '', currentUrl());

request('/juego/casos').then(x => {
  state.cases = x;
  render();
}).catch(error);

render();

