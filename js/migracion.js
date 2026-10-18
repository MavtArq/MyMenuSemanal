// ============================================================
//  migracion.js · Lee la base de datos SQLite de la versión
//  anterior de la app (guardada en este navegador o en un
//  fichero .sqlite) y la convierte al formato de importar_datos.
//
//  sql.js solo se descarga si hace falta.
// ============================================================

function cargarScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.append(script);
  });
}

async function abrirSqlite(bytes) {
  if (!window.initSqlJs) await cargarScript('vendor/sql-wasm.js');
  const SQL = await initSqlJs({ locateFile: fichero => `vendor/${fichero}` });
  return new SQL.Database(bytes);
}

function filas(db, sql) {
  const [resultado] = db.exec(sql);
  if (!resultado) return [];
  return resultado.values.map(valores => Object.fromEntries(resultado.columns.map((c, i) => [c, valores[i]])));
}

/** Convierte un fichero SQLite de la versión anterior en { alimentos, recetas, menu } */
export async function sqliteAJson(bytes) {
  const db = await abrirSqlite(bytes);
  try {
    db.exec('SELECT 1 FROM alimentos LIMIT 1');
  } catch {
    db.close();
    throw new Error('El fichero no es una base de datos de Menú Semanal');
  }
  try {
    const ingredientes = filas(db, 'SELECT receta_id, alimento_id, cantidad FROM receta_ingredientes');
    return {
      alimentos: filas(db, `
        SELECT a.id, a.nombre, c.nombre AS categoria, u.abreviatura AS unidad,
               COALESCE(d.cantidad, 0) AS cantidad, a.stock_minimo
          FROM alimentos a
          JOIN unidades u ON u.id = a.unidad_id
          LEFT JOIN categorias c ON c.id = a.categoria_id
          LEFT JOIN despensa d ON d.alimento_id = a.id`),
      recetas: filas(db, 'SELECT id, nombre, raciones, instrucciones FROM recetas')
        .map(r => ({ ...r, ingredientes: ingredientes.filter(i => i.receta_id === r.id) })),
      menu: filas(db, `
        SELECT m.fecha, mo.nombre AS momento, m.receta_id, m.raciones, m.cocinado
          FROM menu m JOIN momentos mo ON mo.id = m.momento_id`),
    };
  } finally {
    db.close();
  }
}

/** Devuelve el fichero SQLite que guardó la versión anterior en este navegador, o null */
export function sqliteLocalAntiguo() {
  return new Promise(resolve => {
    const peticion = indexedDB.open('menu-semanal');
    peticion.onupgradeneeded = () => peticion.transaction.abort();   // no existía: no la creamos
    peticion.onerror = () => resolve(null);
    peticion.onsuccess = () => {
      const conexion = peticion.result;
      if (!conexion.objectStoreNames.contains('ficheros')) { conexion.close(); resolve(null); return; }
      const lectura = conexion.transaction('ficheros').objectStore('ficheros').get('db');
      lectura.onsuccess = () => { conexion.close(); resolve(lectura.result ?? null); };
      lectura.onerror = () => { conexion.close(); resolve(null); };
    };
  });
}
