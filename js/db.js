// ============================================================
//  db.js · Conexión con SQLite y persistencia en el móvil
//
//  sql.js es SQLite compilado a WebAssembly. La base de datos se
//  trabaja en memoria y, tras cada cambio, el fichero .sqlite
//  completo se guarda en IndexedDB (el almacén del navegador).
// ============================================================

const VERSION_ESQUEMA = 1;

let SQL = null;   // la librería sql.js
let db = null;    // la base de datos abierta


// ---------- IndexedDB: dónde se guarda el fichero .sqlite ----------

function abrirIDB() {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open('menu-semanal', 1);
    peticion.onupgradeneeded = () => peticion.result.createObjectStore('ficheros');
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

async function idb(modo, accion) {
  const conexion = await abrirIDB();
  return new Promise((resolve, reject) => {
    const tx = conexion.transaction('ficheros', modo);
    const peticion = accion(tx.objectStore('ficheros'));
    tx.oncomplete = () => { conexion.close(); resolve(peticion.result); };
    tx.onerror = () => { conexion.close(); reject(tx.error); };
  });
}

const leerFichero = () => idb('readonly', almacen => almacen.get('db'));
const escribirFichero = bytes => idb('readwrite', almacen => almacen.put(bytes, 'db'));

// Las escrituras se encadenan para que nunca se guarde una versión antigua encima de una nueva
let colaGuardado = Promise.resolve();

export function guardar() {
  const bytes = db.export();
  db.exec('PRAGMA foreign_keys = ON');   // export() reabre la conexión y se pierden los PRAGMA
  colaGuardado = colaGuardado.then(() => escribirFichero(bytes));
  return colaGuardado;
}


// ---------- Apertura y esquema ----------

async function texto(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${ruta}`);
  return respuesta.text();
}

async function prepararEsquema() {
  db.exec(await texto('sql/schema.sql'));
  if (versionEsquema() < 1) {
    db.exec(await texto('sql/datos_iniciales.sql'));
  }
  // Aquí irán las migraciones futuras:  if (versionEsquema() < 2) { db.exec('ALTER TABLE ...') }
  db.exec(`PRAGMA user_version = ${VERSION_ESQUEMA}`);
}

export const versionEsquema = () => consultar('PRAGMA user_version')[0].user_version;

export async function abrir() {
  SQL = await initSqlJs({ locateFile: fichero => `vendor/${fichero}` });
  const bytes = await leerFichero();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  await prepararEsquema();
  await guardar();
}


// ---------- Consultas ----------

// Convierte { nombre: 'x' } en { ':nombre': 'x' }, que es lo que espera sql.js
function parametros(p) {
  if (Array.isArray(p)) return p;
  return Object.fromEntries(Object.entries(p).map(([clave, valor]) => [':' + clave, valor ?? null]));
}

/** SELECT → array de objetos { columna: valor } */
export function consultar(sql, p = {}) {
  const sentencia = db.prepare(sql);
  try {
    sentencia.bind(parametros(p));
    const filas = [];
    while (sentencia.step()) filas.push(sentencia.getAsObject());
    return filas;
  } finally {
    sentencia.free();
  }
}

/** INSERT / UPDATE / DELETE. Úsalo dentro de transaccion() para que se guarde. */
export function ejecutar(sql, p = {}) {
  const sentencia = db.prepare(sql);
  try {
    sentencia.run(parametros(p));
  } finally {
    sentencia.free();
  }
}

export const ultimoId = () => consultar('SELECT last_insert_rowid() AS id')[0].id;

/** Ejecuta fn() dentro de una transacción: o se aplica todo, o nada. Después guarda. */
export async function transaccion(fn) {
  db.exec('BEGIN');
  let resultado;
  try {
    resultado = fn();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  await guardar();
  return resultado;
}

/** Consola SQL de Ajustes: ejecuta cualquier SQL y devuelve [{ columns, values }] */
export async function consultaLibre(sql) {
  const resultados = db.exec(sql);
  const cambios = db.getRowsModified();
  await guardar();
  return { resultados, cambios };
}


// ---------- Copias de seguridad ----------

export function exportar() {
  const bytes = db.export();
  db.exec('PRAGMA foreign_keys = ON');
  return bytes;
}

export async function importar(bytes) {
  const nueva = new SQL.Database(bytes);
  try {
    nueva.exec('SELECT 1 FROM alimentos LIMIT 1; SELECT 1 FROM recetas LIMIT 1;');
  } catch {
    nueva.close();
    throw new Error('El fichero no es una copia de seguridad de Menú Semanal');
  }
  db.close();
  db = nueva;
  await prepararEsquema();
  await guardar();
}

export async function reiniciar() {
  db.close();
  db = new SQL.Database();
  await prepararEsquema();
  await guardar();
}


// ---------- Errores de SQLite en lenguaje humano ----------

export function mensajeError(error) {
  const m = String(error?.message ?? error);
  if (m.includes('UNIQUE')) return 'Ya existe un elemento con ese nombre';
  if (m.includes('FOREIGN KEY')) return 'No se puede: está en uso (por ejemplo, en alguna receta)';
  if (m.includes('CHECK')) return 'Algún valor no es válido (revisa las cantidades)';
  if (m.includes('NOT NULL')) return 'Falta algún dato obligatorio';
  return m;
}
