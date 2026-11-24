/**
 * editor.js — Editor de escenarios P7c.
 * Genera únicamente JSON válido según ModeloEscenario y validar_escenario.
 */

const root = document.querySelector('#editor-app');

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AREA_NAMES = {
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
};

const areaLabel = id => AREA_NAMES[id] || id;

const state = {
  schema: null,
  draft: {
    id: 'C11',
    nivel: 2,
    origen: 'recepcion_1',
    silla_ruedas: false,
    pisos_habilitados: [1, 2, 3],
    etapas: ['triaje', 'ginecologia'],
    eventos: [],
    costo: 'segundos',
    semilla: 11,
    hora_caso: '10:00',
    bloqueados_iniciales: [],
    heuristica_disponible: true,
    ascensor_a_segundos: 20,
    cambios_secciones: [],
  },
  validation: null,
  busy: false,
};

function buildPayload() {
  const d = state.draft;
  const cambiosConexiones = [];
  if (state.schema && Number(d.ascensor_a_segundos) !== 20) {
    for (const c of state.schema.conexiones_verticales) {
      if (c.grupo === 'ascensor_a') {
        cambiosConexiones.push({
          indice: c.indice,
          cambios: { segundos: Number(d.ascensor_a_segundos) },
        });
      }
    }
  }
  return {
    id: String(d.id || '').trim(),
    nivel: Number(d.nivel),
    origen: d.origen,
    silla_ruedas: Boolean(d.silla_ruedas),
    pisos_habilitados: [...d.pisos_habilitados].map(Number).sort((a, b) => a - b),
    etapas: [...d.etapas],
    eventos: d.eventos.map(ev => ({
      origen: ev.origen,
      etapas: [...ev.etapas],
      bloqueados: [...ev.bloqueados],
    })),
    costo: d.costo,
    semilla: Number(d.semilla),
    hora_caso: String(d.hora_caso || '').trim(),
    bloqueados_iniciales: [...d.bloqueados_iniciales],
    heuristica_disponible: Boolean(d.heuristica_disponible),
    cambios_conexiones: cambiosConexiones,
    cambios_secciones: d.cambios_secciones.map(cs => ({
      id: cs.id,
      cambios: { ...cs.cambios },
    })),
  };
}

function invalidate() {
  state.validation = null;
}

function renderValidationBox() {
  if (!state.validation) {
    return '<div class="editor-status pending">Pulsa <strong>Validar escenario</strong> para comprobar el JSON contra <code>ModeloEscenario</code> y <code>validar_escenario</code>. Solo podrás exportar un JSON válido.</div>';
  }
  if (state.validation.valido) {
    return '<div class="editor-status valid" role="status"><strong>✓ Escenario válido</strong><span>Cumple el esquema oficial y todas las reglas de conectividad, accesibilidad y horarios de <code>validar_escenario</code>. Ya puedes descargar o copiar el JSON.</span></div>';
  }
  const items = state.validation.errores.map(err => `<li>${esc(err)}</li>`).join('');
  return `<div class="editor-status invalid" role="alert"><strong>✕ Escenario con errores (${state.validation.errores.length})</strong><ul>${items}</ul></div>`;
}

function render() {
  if (!state.schema) return;
  const d = state.draft;
  const payload = buildPayload();
  const validJson = state.validation?.valido ? JSON.stringify(state.validation.escenario, null, 2) : JSON.stringify(payload, null, 2);
  const canExport = Boolean(state.validation?.valido);

  const areaOptions = state.schema.areas
    .map(a => `<option value="${esc(a.area)}">P${a.piso} · ${esc(areaLabel(a.area))}</option>`)
    .join('');

  const secOptions = state.schema.secciones
    .map(s => `<option value="${esc(s.id)}">P${s.piso} · ${esc(areaLabel(s.area))} ${s.id.split('_').at(-1)}</option>`)
    .join('');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Validador de escenarios (borradores JSON)</h1>
        <p>Construye y valida borradores JSON compatibles con <code>data/escenarios/</code> reutilizando <code>ModeloEscenario</code> y <code>validar_escenario</code>. Solo exporta JSON válido; para jugarse en el simulador, un borrador debe incorporarse al catálogo y calibrarse previamente.</p>
      </div>
    </div>

    <div class="layout editor-layout">
      <div class="stack">
        <section class="card editor-card">
          <h2>1. Configuración general</h2>
          <div class="editor-grid">
            <label class="ed-field">
              <span>Identificador</span>
              <input type="text" id="ed-id" value="${esc(d.id)}" placeholder="C11">
            </label>
            <label class="ed-field">
              <span>Nivel (1–4)</span>
              <select id="ed-nivel">
                ${[1, 2, 3, 4].map(n => `<option value="${n}" ${d.nivel === n ? 'selected' : ''}>Nivel ${n}</option>`).join('')}
              </select>
            </label>
            <label class="ed-field">
              <span>Unidad de costo</span>
              <select id="ed-costo">
                <option value="tramos" ${d.costo === 'tramos' ? 'selected' : ''}>tramos (uniforme)</option>
                <option value="segundos" ${d.costo === 'segundos' ? 'selected' : ''}>segundos (ponderado)</option>
              </select>
            </label>
            <label class="ed-field">
              <span>Hora del caso (HH:MM)</span>
              <input type="text" id="ed-hora" value="${esc(d.hora_caso)}" placeholder="10:00">
            </label>
            <label class="ed-field">
              <span>Semilla</span>
              <input type="number" id="ed-semilla" value="${d.semilla}" min="1" step="1">
            </label>
            <label class="ed-field">
              <span>Origen inicial</span>
              <select id="ed-origen">
                ${state.schema.secciones.map(s => `<option value="${esc(s.id)}" ${d.origen === s.id ? 'selected' : ''}>P${s.piso} · ${esc(areaLabel(s.area))} ${s.id.split('_').at(-1)}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="editor-checks">
            <label><input type="checkbox" id="ed-silla" ${d.silla_ruedas ? 'checked' : ''}> Movilidad reducida (silla de ruedas · sin escaleras)</label>
            <label><input type="checkbox" id="ed-heur" ${d.heuristica_disponible ? 'checked' : ''}> Heurística informativa disponible</label>
          </div>

          <div class="ed-subblock">
            <span class="ed-label">Pisos habilitados</span>
            <div class="editor-pills">
              ${state.schema.pisos.map(p => `
                <label class="ed-pill-check">
                  <input type="checkbox" data-piso="${p}" ${d.pisos_habilitados.includes(p) ? 'checked' : ''}>
                  Piso ${p}
                </label>`).join('')}
            </div>
          </div>
        </section>

        <section class="card editor-card">
          <h2>2. Etapas de destino</h2>
          <div class="ed-inline-add">
            <select id="ed-add-etapa-sel">${areaOptions}</select>
            <button type="button" class="button ghost ed-small-btn" data-ed-action="add-etapa">+ Añadir etapa</button>
          </div>
          <ol class="ed-list">
            ${d.etapas.map((area, idx) => `
              <li>
                <span><strong>Etapa ${idx + 1}:</strong> ${esc(areaLabel(area))} (<code>${esc(area)}</code>)</span>
                <button type="button" class="ed-del-btn" data-del-etapa="${idx}" aria-label="Quitar etapa ${idx + 1}">✕</button>
              </li>`).join('') || '<li class="muted">Sin etapas configuradas.</li>'}
          </ol>
        </section>

        <section class="card editor-card">
          <h2>3. Accesos, demoras y estado de secciones</h2>
          <div class="editor-checks">
            <label><input type="checkbox" data-bloq="ascensor_a" ${d.bloqueados_iniciales.includes('ascensor_a') ? 'checked' : ''}> Ascensor A bloqueado inicialmente</label>
            <label><input type="checkbox" data-bloq="ascensor_b" ${d.bloqueados_iniciales.includes('ascensor_b') ? 'checked' : ''}> Ascensor B bloqueado inicialmente</label>
          </div>
          <label class="ed-field" style="max-width:280px;margin-top:10px">
            <span>Tiempo de Ascensor A por piso (segundos; base = 20)</span>
            <input type="number" id="ed-asc-a-seg" value="${d.ascensor_a_segundos}" min="1" step="10">
          </label>

          <div class="ed-subblock">
            <span class="ed-label">Cerrar o saturar una sección</span>
            <div class="editor-grid">
              <label class="ed-field"><span>Sección</span><select id="ed-sec-id">${secOptions}</select></label>
              <label class="ed-field">
                <span>Estado</span>
                <select id="ed-sec-estado">
                  <option value="cerrada">cerrada</option>
                  <option value="saturada">saturada</option>
                </select>
              </label>
              <label class="ed-field"><span>Horario (use –)</span><input type="text" id="ed-sec-horario" value="08:00–12:00"></label>
              <label class="ed-field"><span>Espera (s, si saturada)</span><input type="number" id="ed-sec-espera" value="60" min="0" step="10"></label>
            </div>
            <button type="button" class="button ghost ed-small-btn" style="margin-top:8px" data-ed-action="add-sec-change">+ Añadir cambio de sección</button>
            <ul class="ed-list">
              ${d.cambios_secciones.map((cs, idx) => `
                <li>
                  <span><code>${esc(cs.id)}</code> → ${esc(JSON.stringify(cs.cambios))}</span>
                  <button type="button" class="ed-del-btn" data-del-sec="${idx}" aria-label="Quitar cambio de sección">✕</button>
                </li>`).join('') || '<li class="muted">Sin cambios de sección (todas abiertas).</li>'}
            </ul>
          </div>
        </section>

        <section class="card editor-card">
          <h2>4. Eventos dinámicos (opcional)</h2>
          <div class="editor-grid">
            <label class="ed-field"><span>Disparador (sección alcanzada)</span><select id="ed-ev-origen">${secOptions}</select></label>
            <label class="ed-field"><span>Nueva área destino</span><select id="ed-ev-area">${areaOptions}</select></label>
            <label class="ed-field">
              <span>Bloqueo tras evento</span>
              <select id="ed-ev-bloq">
                <option value="">Ninguno</option>
                <option value="ascensor_a">Ascensor A</option>
                <option value="ascensor_b">Ascensor B</option>
              </select>
            </label>
          </div>
          <button type="button" class="button ghost ed-small-btn" style="margin-top:8px" data-ed-action="add-evento">+ Añadir evento</button>
          <ul class="ed-list">
            ${d.eventos.map((ev, idx) => `
              <li>
                <span>En <code>${esc(ev.origen)}</code> → etapas: <code>${esc(ev.etapas.join(', '))}</code> · bloqueados: <code>${esc(ev.bloqueados.join(', ') || 'ninguno')}</code></span>
                <button type="button" class="ed-del-btn" data-del-ev="${idx}" aria-label="Quitar evento">✕</button>
              </li>`).join('') || '<li class="muted">Sin eventos dinámicos.</li>'}
          </ul>
        </section>
      </div>

      <div class="stack">
        <section class="card editor-card editor-preview-card">
          <h2>Validación y JSON generado</h2>
          ${renderValidationBox()}
          <div class="actions editor-actions">
            <button type="button" class="button" data-ed-action="validate" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Validando…' : 'Validar escenario'}</button>
            <button type="button" class="button ghost" data-ed-action="download" ${canExport ? '' : 'disabled'}>Descargar JSON</button>
            <button type="button" class="button ghost" data-ed-action="copy" ${canExport ? '' : 'disabled'}>Copiar JSON</button>
          </div>
          <pre id="ed-json-out" class="editor-json">${esc(validJson)}</pre>
        </section>
      </div>
    </div>`;
}

async function validateDraft() {
  state.busy = true;
  render();
  try {
    const res = await fetch('/editor/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    state.validation = await res.json();
  } catch (err) {
    state.validation = { valido: false, errores: [String(err.message || err)], escenario: null };
  } finally {
    state.busy = false;
    render();
  }
}

root.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'ed-id') state.draft.id = t.value;
  else if (t.id === 'ed-nivel') state.draft.nivel = Number(t.value);
  else if (t.id === 'ed-costo') state.draft.costo = t.value;
  else if (t.id === 'ed-hora') state.draft.hora_caso = t.value;
  else if (t.id === 'ed-semilla') state.draft.semilla = Number(t.value);
  else if (t.id === 'ed-origen') state.draft.origen = t.value;
  else if (t.id === 'ed-silla') state.draft.silla_ruedas = t.checked;
  else if (t.id === 'ed-heur') state.draft.heuristica_disponible = t.checked;
  else if (t.id === 'ed-asc-a-seg') state.draft.ascensor_a_segundos = Number(t.value);
  else if (t.dataset.piso) {
    const p = Number(t.dataset.piso);
    state.draft.pisos_habilitados = t.checked
      ? [...new Set([...state.draft.pisos_habilitados, p])].sort((a, b) => a - b)
      : state.draft.pisos_habilitados.filter(x => x !== p);
  } else if (t.dataset.bloq) {
    const g = t.dataset.bloq;
    state.draft.bloqueados_iniciales = t.checked
      ? [...new Set([...state.draft.bloqueados_iniciales, g])]
      : state.draft.bloqueados_iniciales.filter(x => x !== g);
  } else {
    return;
  }
  invalidate();
  render();
});

root.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.delEtapa !== undefined) {
    state.draft.etapas.splice(Number(b.dataset.delEtapa), 1);
    invalidate();
    render();
    return;
  }
  if (b.dataset.delSec !== undefined) {
    state.draft.cambios_secciones.splice(Number(b.dataset.delSec), 1);
    invalidate();
    render();
    return;
  }
  if (b.dataset.delEv !== undefined) {
    state.draft.eventos.splice(Number(b.dataset.delEv), 1);
    invalidate();
    render();
    return;
  }
  const act = b.dataset.edAction;
  if (act === 'add-etapa') {
    const area = root.querySelector('#ed-add-etapa-sel')?.value;
    if (area) {
      state.draft.etapas.push(area);
      invalidate();
      render();
    }
  } else if (act === 'add-sec-change') {
    const id = root.querySelector('#ed-sec-id')?.value;
    const estado = root.querySelector('#ed-sec-estado')?.value;
    const horario = root.querySelector('#ed-sec-horario')?.value || '08:00–12:00';
    const espera = Number(root.querySelector('#ed-sec-espera')?.value || 0);
    const cambios = estado === 'cerrada'
      ? { estado: 'cerrada', horario, motivo_cierre: 'Fuera de horario' }
      : { estado: 'saturada', espera_segundos: espera };
    state.draft.cambios_secciones = state.draft.cambios_secciones.filter(x => x.id !== id);
    state.draft.cambios_secciones.push({ id, cambios });
    invalidate();
    render();
  } else if (act === 'add-evento') {
    const origen = root.querySelector('#ed-ev-origen')?.value;
    const area = root.querySelector('#ed-ev-area')?.value;
    const bloq = root.querySelector('#ed-ev-bloq')?.value;
    state.draft.eventos.push({
      origen,
      etapas: [area],
      bloqueados: bloq ? [bloq] : [],
    });
    invalidate();
    render();
  } else if (act === 'validate') {
    await validateDraft();
  } else if (act === 'download' && state.validation?.valido) {
    const jsonText = JSON.stringify(state.validation.escenario, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.validation.escenario.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (act === 'copy' && state.validation?.valido) {
    await navigator.clipboard?.writeText(JSON.stringify(state.validation.escenario, null, 2));
  }
});

fetch('/editor/esquema')
  .then(r => r.json())
  .then(data => {
    state.schema = data;
    render();
  })
  .catch(err => {
    root.innerHTML = `<div class="card"><p>No se pudo cargar el esquema del editor: ${esc(err.message)}</p></div>`;
  });
