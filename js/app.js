// ============================================================
//  app.js · Interfaz: pinta las pantallas y responde al usuario
// ============================================================

import * as db from './db.js';
import * as m from './modelo.js';


// ---------- Utilidades ----------

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

// Escapa el texto del usuario antes de meterlo en HTML
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const num = n => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

// Cantidades a comprar: enteras hacia arriba (3 huevos, no 2,5) o con 2 decimales
const redondear = (n, entera) => entera ? Math.ceil(n - 1e-9) : Math.round(n * 100) / 100;

const vacio = texto => `<p class="vacio">${texto}</p>`;

function agrupar(filas, clave) {
  const grupos = new Map();
  for (const fila of filas) {
    if (!grupos.has(fila[clave])) grupos.set(fila[clave], []);
    grupos.get(fila[clave]).push(fila);
  }
  return grupos;
}

function aviso(texto, error = false) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.toggle('error', error);
  el.classList.add('visible');
  clearTimeout(aviso.temporizador);
  aviso.temporizador = setTimeout(() => el.classList.remove('visible'), 3000);
}

// Ejecuta una acción y, si SQLite protesta, lo muestra en lenguaje humano
async function intentar(accion, mensajeOk) {
  try {
    await accion();
    if (mensajeOk) aviso(mensajeOk);
    return true;
  } catch (error) {
    console.error(error);
    aviso(db.mensajeError(error), true);
    return false;
  }
}


// ---------- Fechas (siempre en hora local, formato AAAA-MM-DD) ----------

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const desdeIso = s => { const [a, mes, d] = s.split('-').map(Number); return new Date(a, mes - 1, d); };
const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const lunesDe = d => sumarDias(d, -((d.getDay() + 6) % 7));

const fmtDia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
const fmtCorto = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });


// ---------- Navegación entre pantallas ----------

const estado = {
  vista: 'menu',
  semana: lunesDe(new Date()),
  compra: [],
};

const TITULOS = {
  menu: 'Menú semanal', recetas: 'Recetas', despensa: 'Despensa',
  compra: 'Lista de la compra', ajustes: 'Ajustes',
};

const PINTAR = {
  menu: pintarMenu, recetas: pintarRecetas, despensa: pintarDespensa,
  compra: pintarCompra, ajustes: pintarAjustes,
};

function mostrar(vista) {
  estado.vista = vista;
  $$('.vista').forEach(v => v.classList.toggle('activa', v.id === `vista-${vista}`));
  $$('.pestanas button').forEach(b => b.classList.toggle('activa', b.dataset.vista === vista));
  $('#titulo').textContent = TITULOS[vista];
  refrescar();
  window.scrollTo(0, 0);
}

function refrescar() {
  PINTAR[estado.vista]();
  actualizarContadorCompra();
}

function actualizarContadorCompra() {
  const n = m.listaCompra(iso(new Date()), iso(sumarDias(new Date(), 6))).length;
  const el = $('#contador-compra');
  el.hidden = n === 0;
  el.textContent = n;
}


// ============================================================
//  MENÚ SEMANAL
// ============================================================

function pintarMenu() {
  const inicio = estado.semana;
  const fin = sumarDias(inicio, 6);
  $('#semana-titulo').textContent = `${fmtCorto.format(inicio)} – ${fmtCorto.format(fin)}`;

  const platos = m.menuEntre(iso(inicio), iso(fin));
  const momentos = m.momentos();
  const hoy = iso(new Date());

  let html = '';
  for (let i = 0; i < 7; i++) {
    const dia = sumarDias(inicio, i);
    const fecha = iso(dia);
    html += `<article class="tarjeta dia ${fecha === hoy ? 'hoy' : ''}"><h2>${esc(fmtDia.format(dia))}</h2>`;
    for (const momento of momentos) {
      const suyos = platos.filter(p => p.fecha === fecha && p.momento_id === momento.id);
      html += `<div class="momento"><span class="momento-nombre">${esc(momento.nombre)}</span><div class="platos">`;
      html += suyos.map(p => `
        <div class="plato ${p.cocinado ? 'cocinado' : ''}">
          <label title="Marcar como cocinado">
            <input type="checkbox" data-cocinar="${p.id}" ${p.cocinado ? 'checked' : ''}>
            <span>${esc(p.nombre)} <small>· ${p.raciones} rac.</small></span>
          </label>
          <button class="icono peque" data-quitar="${p.id}" aria-label="Quitar del menú">×</button>
        </div>`).join('');
      html += `<button class="enlace peque" data-anadir="${fecha}|${momento.id}">+ Añadir</button></div></div>`;
    }
    html += '</article>';
  }
  $('#lista-dias').innerHTML = html;
}

$('#semana-anterior').addEventListener('click', () => { estado.semana = sumarDias(estado.semana, -7); pintarMenu(); });
$('#semana-siguiente').addEventListener('click', () => { estado.semana = sumarDias(estado.semana, 7); pintarMenu(); });
$('#semana-actual').addEventListener('click', () => { estado.semana = lunesDe(new Date()); pintarMenu(); });

$('#lista-dias').addEventListener('click', async e => {
  const boton = e.target.closest('button');
  if (!boton) return;
  if (boton.dataset.quitar) {
    await intentar(() => m.quitarDelMenu(Number(boton.dataset.quitar)));
    refrescar();
  } else if (boton.dataset.anadir) {
    const [fecha, momento] = boton.dataset.anadir.split('|');
    abrirPlato(fecha, Number(momento));
  }
});

$('#lista-dias').addEventListener('change', async e => {
  const id = e.target.dataset.cocinar;
  if (!id) return;
  const cocinado = e.target.checked;
  await intentar(() => m.marcarCocinado(Number(id), cocinado),
    cocinado ? 'Ingredientes descontados de la despensa' : 'Ingredientes devueltos a la despensa');
  refrescar();
});

function abrirPlato(fecha, momentoId) {
  const recetas = m.recetas();
  if (!recetas.length) {
    aviso('Primero crea alguna receta');
    mostrar('recetas');
    return;
  }
  const dlg = $('#dlg-plato');
  const f = dlg.querySelector('form');
  const momento = m.momentos().find(x => x.id === momentoId);
  $('#plato-titulo').textContent = `${momento.nombre} · ${fmtDia.format(desdeIso(fecha))}`;
  f.elements.receta.innerHTML = recetas
    .map(r => `<option value="${r.id}" data-raciones="${r.raciones}">${esc(r.nombre)}</option>`).join('');
  f.elements.raciones.value = recetas[0].raciones;
  f.elements.fecha.value = fecha;
  f.elements.momento.value = momentoId;
  dlg.showModal();
}

$('#dlg-plato form').elements.receta.addEventListener('change', e => {
  e.target.form.elements.raciones.value = e.target.selectedOptions[0].dataset.raciones;
});

$('#dlg-plato form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const ok = await intentar(() => m.planificar({
    fecha: f.fecha.value,
    momento_id: Number(f.momento.value),
    receta_id: Number(f.receta.value),
    raciones: Number(f.raciones.value),
  }));
  if (ok) { e.target.closest('dialog').close(); refrescar(); }
});


// ============================================================
//  RECETAS
// ============================================================

function pintarRecetas() {
  const filtro = $('#buscar-receta').value.trim().toLowerCase();
  const lista = m.recetas().filter(r => r.nombre.toLowerCase().includes(filtro));
  $('#lista-recetas').innerHTML = lista.length
    ? lista.map(r => `
        <li><button class="fila" data-receta="${r.id}">
          <span><strong>${esc(r.nombre)}</strong>
          <small>${r.raciones} raciones · ${r.ingredientes} ingredientes</small></span>
          <span class="flecha">›</span>
        </button></li>`).join('')
    : vacio(filtro ? 'Ninguna receta coincide con la búsqueda.' : 'Aún no hay recetas. Pulsa + para crear la primera.');
}

$('#buscar-receta').addEventListener('input', pintarRecetas);
$('#nueva-receta').addEventListener('click', () => abrirReceta(null));
$('#lista-recetas').addEventListener('click', e => {
  const boton = e.target.closest('[data-receta]');
  if (boton) abrirReceta(Number(boton.dataset.receta));
});

let alimentosReceta = [];   // alimentos disponibles en los desplegables de ingredientes

function opcionesAlimentos(seleccionado) {
  return '<option value="">Elige un alimento…</option>' + alimentosReceta
    .map(a => `<option value="${a.id}" ${a.id === seleccionado ? 'selected' : ''}>${esc(a.nombre)} (${esc(a.unidad)})</option>`)
    .join('');
}

function filaIngrediente(ing = {}) {
  const li = document.createElement('li');
  li.innerHTML = `
    <select data-campo="alimento">${opcionesAlimentos(ing.alimento_id)}</select>
    <input data-campo="cantidad" type="number" min="0" step="any" inputmode="decimal" placeholder="Cant." value="${ing.cantidad ?? ''}">
    <button type="button" class="icono peque" data-quitar-ingrediente aria-label="Quitar ingrediente">×</button>`;
  return li;
}

function abrirReceta(id) {
  alimentosReceta = m.despensa();
  const r = id ? m.receta(id) : { nombre: '', raciones: 2, instrucciones: '', ingredientes: [] };
  const f = $('#dlg-receta form');
  f.reset();
  f.elements.ident.value = r.id ?? '';
  f.elements.nombre.value = r.nombre;
  f.elements.raciones.value = r.raciones;
  f.elements.instrucciones.value = r.instrucciones ?? '';
  $('#receta-titulo').textContent = id ? 'Editar receta' : 'Nueva receta';
  $('#receta-borrar').hidden = !id;
  const ul = $('#lista-ingredientes');
  ul.replaceChildren(...r.ingredientes.map(filaIngrediente));
  if (!r.ingredientes.length) ul.append(filaIngrediente());
  $('#dlg-receta').showModal();
}

$('#anadir-ingrediente').addEventListener('click', () => $('#lista-ingredientes').append(filaIngrediente()));

$('#lista-ingredientes').addEventListener('click', e => {
  if (e.target.closest('[data-quitar-ingrediente]')) e.target.closest('li').remove();
});

// Crear un alimento sin salir de la receta: al guardarlo queda elegido en una fila
$('#crear-alimento').addEventListener('click', () => abrirAlimento(null, nuevoId => {
  alimentosReceta = m.despensa();
  for (const select of $$('#lista-ingredientes select')) {
    const elegido = Number(select.value) || null;
    select.innerHTML = opcionesAlimentos(elegido);
  }
  const libre = $$('#lista-ingredientes select').find(s => !s.value);
  if (libre) libre.value = nuevoId;
  else $('#lista-ingredientes').append(filaIngrediente({ alimento_id: nuevoId }));
}));

$('#dlg-receta form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const ingredientes = [];
  for (const li of $$('#lista-ingredientes li')) {
    const alimento_id = Number($('[data-campo=alimento]', li).value);
    const cantidad = Number($('[data-campo=cantidad]', li).value);
    if (!alimento_id) continue;
    if (!(cantidad > 0)) { aviso('Indica la cantidad de cada ingrediente', true); return; }
    ingredientes.push({ alimento_id, cantidad });
  }
  const ok = await intentar(() => m.guardarReceta({
    id: Number(f.ident.value) || null,
    nombre: f.nombre.value.trim(),
    raciones: Number(f.raciones.value),
    instrucciones: f.instrucciones.value.trim() || null,
    ingredientes,
  }), 'Receta guardada');
  if (ok) { $('#dlg-receta').close(); refrescar(); }
});

$('#receta-borrar').addEventListener('click', async () => {
  const f = $('#dlg-receta form').elements;
  if (!confirm(`¿Borrar la receta «${f.nombre.value}»? También se quitará de los menús donde esté.`)) return;
  const ok = await intentar(() => m.borrarReceta(Number(f.ident.value)), 'Receta borrada');
  if (ok) { $('#dlg-receta').close(); refrescar(); }
});


// ============================================================
//  DESPENSA
// ============================================================

function pintarDespensa() {
  const filtro = $('#buscar-alimento').value.trim().toLowerCase();
  const soloBajos = $('#solo-bajos').checked;
  const lista = m.despensa()
    .filter(a => a.nombre.toLowerCase().includes(filtro))
    .filter(a => !soloBajos || a.bajo_minimo);

  if (!lista.length) {
    $('#lista-despensa').innerHTML = vacio(filtro || soloBajos
      ? 'No hay alimentos que coincidan.'
      : 'La despensa está vacía. Pulsa + para añadir alimentos.');
    return;
  }

  let html = '';
  for (const [categoria, alimentos] of agrupar(lista, 'categoria')) {
    html += `<h3 class="grupo">${esc(categoria)}</h3><ul class="lista">`;
    html += alimentos.map(a => `
      <li class="fila-despensa ${a.bajo_minimo ? 'bajo' : ''}">
        <button class="fila-texto" data-editar="${a.id}">
          <strong>${esc(a.nombre)}</strong>
          <small>${a.stock_minimo > 0 ? `mínimo ${num(a.stock_minimo)} ${esc(a.unidad)}` : 'sin mínimo'}</small>
        </button>
        <div class="contador">
          <button class="icono" data-ajustar="${a.id}" data-delta="${-a.paso}" aria-label="Quitar ${num(a.paso)} ${esc(a.unidad)}">−</button>
          <span>${num(a.cantidad)} <small>${esc(a.unidad)}</small></span>
          <button class="icono" data-ajustar="${a.id}" data-delta="${a.paso}" aria-label="Añadir ${num(a.paso)} ${esc(a.unidad)}">+</button>
        </div>
      </li>`).join('');
    html += '</ul>';
  }
  $('#lista-despensa').innerHTML = html;
}

$('#buscar-alimento').addEventListener('input', pintarDespensa);
$('#solo-bajos').addEventListener('change', pintarDespensa);
$('#nuevo-alimento').addEventListener('click', () => abrirAlimento(null));

$('#lista-despensa').addEventListener('click', async e => {
  const boton = e.target.closest('button');
  if (!boton) return;
  if (boton.dataset.editar) abrirAlimento(Number(boton.dataset.editar));
  if (boton.dataset.ajustar) {
    await intentar(() => m.ajustarStock(Number(boton.dataset.ajustar), Number(boton.dataset.delta)));
    refrescar();
  }
});

let alGuardarAlimento = null;   // callback opcional (lo usa el diálogo de recetas)

function abrirAlimento(id, alGuardar = null) {
  alGuardarAlimento = alGuardar;
  const f = $('#dlg-alimento form');
  f.reset();
  f.elements.categoria.innerHTML = '<option value="">Sin categoría</option>' +
    m.categorias().map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  f.elements.unidad.innerHTML =
    m.unidades().map(u => `<option value="${u.id}">${esc(u.nombre)} (${esc(u.abreviatura)})</option>`).join('');

  const a = id ? m.alimento(id) : null;
  f.elements.ident.value = a?.id ?? '';
  f.elements.nombre.value = a?.nombre ?? '';
  f.elements.categoria.value = a?.categoria_id ?? '';
  if (a) f.elements.unidad.value = a.unidad_id;
  f.elements.cantidad.value = a?.cantidad ?? 0;
  f.elements.minimo.value = a?.stock_minimo ?? 0;
  $('#alimento-titulo').textContent = a ? 'Editar alimento' : 'Nuevo alimento';
  $('#alimento-borrar').hidden = !a;
  $('#dlg-alimento').showModal();
}

$('#dlg-alimento form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  let id;
  const ok = await intentar(async () => {
    id = await m.guardarAlimento({
      id: Number(f.ident.value) || null,
      nombre: f.nombre.value.trim(),
      categoria_id: Number(f.categoria.value) || null,
      unidad_id: Number(f.unidad.value),
      cantidad: Number(f.cantidad.value),
      stock_minimo: Number(f.minimo.value),
    });
  }, 'Alimento guardado');
  if (!ok) return;
  $('#dlg-alimento').close();
  alGuardarAlimento?.(id);
  refrescar();
});

$('#alimento-borrar').addEventListener('click', async () => {
  const f = $('#dlg-alimento form').elements;
  if (!confirm(`¿Borrar «${f.nombre.value}»?`)) return;
  const ok = await intentar(() => m.borrarAlimento(Number(f.ident.value)), 'Alimento borrado');
  if (ok) { $('#dlg-alimento').close(); refrescar(); }
});


// ============================================================
//  LISTA DE LA COMPRA
// ============================================================

function pintarCompra() {
  const desde = $('#compra-desde').value;
  const hasta = $('#compra-hasta').value;
  estado.compra = m.listaCompra(desde, hasta).map(i => ({ ...i, cantidad: redondear(i.a_comprar, i.entera) }));

  const marcados = estado.compra.filter(i => i.marcado).length;
  $('#registrar-compra').disabled = marcados === 0;
  $('#registrar-compra').textContent = marcados ? `Añadir ${marcados} a la despensa` : 'Añadir marcados a la despensa';
  $('#compartir-lista').disabled = estado.compra.length === 0;

  if (!estado.compra.length) {
    $('#lista-compra').innerHTML = vacio('No hace falta comprar nada 🎉<br><small>Planifica menús o define stocks mínimos en la despensa.</small>');
    return;
  }

  let html = '';
  for (const [categoria, items] of agrupar(estado.compra, 'categoria')) {
    html += `<h3 class="grupo">${esc(categoria)}</h3><ul class="lista">`;
    html += items.map(i => {
      const detalle = [
        i.necesario > 0 && `menús: ${num(i.necesario)}`,
        `tienes: ${num(i.en_despensa)}`,
        i.stock_minimo > 0 && `mínimo: ${num(i.stock_minimo)}`,
      ].filter(Boolean).join(' · ');
      return `
        <li class="item-compra ${i.marcado ? 'marcado' : ''}">
          <label>
            <input type="checkbox" data-marcar="${i.id}" ${i.marcado ? 'checked' : ''}>
            <span class="texto"><strong>${esc(i.nombre)}</strong><small>${detalle}</small></span>
            <span class="cantidad">${num(i.cantidad)} ${esc(i.unidad)}</span>
          </label>
        </li>`;
    }).join('');
    html += '</ul>';
  }
  $('#lista-compra').innerHTML = html;
}

$('#compra-desde').addEventListener('change', pintarCompra);
$('#compra-hasta').addEventListener('change', pintarCompra);

$('#lista-compra').addEventListener('change', async e => {
  const id = e.target.dataset.marcar;
  if (!id) return;
  await intentar(() => m.marcarEnCarro(Number(id), e.target.checked));
  pintarCompra();
});

$('#registrar-compra').addEventListener('click', async () => {
  const comprados = estado.compra.filter(i => i.marcado);
  await intentar(() => m.registrarCompra(comprados), `${comprados.length} alimentos añadidos a la despensa`);
  refrescar();
});

$('#compartir-lista').addEventListener('click', async () => {
  const texto = '🛒 Lista de la compra\n' + estado.compra
    .map(i => `${i.marcado ? '✔' : '•'} ${i.nombre}: ${num(i.cantidad)} ${i.unidad}`).join('\n');
  try {
    if (navigator.share) await navigator.share({ title: 'Lista de la compra', text: texto });
    else { await navigator.clipboard.writeText(texto); aviso('Lista copiada al portapapeles'); }
  } catch (error) {
    if (error.name !== 'AbortError') aviso('No se pudo compartir la lista', true);
  }
});


// ============================================================
//  AJUSTES
// ============================================================

function pintarAjustes() {
  $('#info-version').textContent = `Versión del esquema de la base de datos: ${db.versionEsquema()}`;
}

$('#btn-ajustes').addEventListener('click', () => mostrar(estado.vista === 'ajustes' ? 'menu' : 'ajustes'));

$('#exportar').addEventListener('click', () => {
  const blob = new Blob([db.exportar()], { type: 'application/x-sqlite3' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `menu-semanal-${iso(new Date())}.sqlite`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
});

$('#importar').addEventListener('change', async e => {
  const fichero = e.target.files[0];
  e.target.value = '';
  if (!fichero || !confirm('Se sustituirán TODOS los datos actuales por los del fichero. ¿Continuar?')) return;
  const bytes = new Uint8Array(await fichero.arrayBuffer());
  await intentar(() => db.importar(bytes), 'Copia de seguridad restaurada');
  refrescar();
});

$('#ejecutar-sql').addEventListener('click', async () => {
  const sql = $('#consola-sql').value.trim();
  if (!sql) return;
  const salida = $('#resultado-sql');
  try {
    const { resultados, cambios } = await db.consultaLibre(sql);
    salida.innerHTML = resultados.map(({ columns, values }) => `
      <div class="tabla-sql"><table>
        <thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${values.map(fila => `<tr>${fila.map(v => `<td>${v === null ? '<i>NULL</i>' : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="nota">${values.length} filas</p>`).join('')
      || `<p class="nota">Hecho. Filas modificadas: ${cambios}</p>`;
  } catch (error) {
    salida.innerHTML = `<p class="error-sql">${esc(error.message)}</p>`;
  }
});

$('#borrar-todo').addEventListener('click', async () => {
  if (!confirm('Se borrarán todos los alimentos, recetas y menús. ¿Seguro?')) return;
  if (!confirm('Última oportunidad: esta acción no se puede deshacer.')) return;
  await intentar(() => db.reiniciar(), 'Datos borrados');
  mostrar('menu');
});


// ============================================================
//  Arranque
// ============================================================

// Botones "Cancelar" de todos los diálogos
$$('[data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$$('.pestanas button').forEach(b => b.addEventListener('click', () => mostrar(b.dataset.vista)));

async function iniciar() {
  try {
    await db.abrir();
  } catch (error) {
    console.error(error);
    $('#cargando').textContent = `No se pudo abrir la base de datos: ${error.message}`;
    return;
  }
  $('#cargando').remove();
  $('#compra-desde').value = iso(new Date());
  $('#compra-hasta').value = iso(sumarDias(new Date(), 6));
  mostrar('menu');

  // Pide al navegador que no borre los datos aunque falte espacio
  navigator.storage?.persist?.();

  // Service worker: permite instalar la app y usarla sin conexión
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(error => console.warn('Sin modo offline:', error));
  }
}

iniciar();
