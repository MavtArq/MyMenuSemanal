// ============================================================
//  modelo.js · Todas las consultas SQL de la aplicación
//
//  La interfaz (app.js) nunca escribe SQL: llama a estas funciones.
// ============================================================

import { consultar, ejecutar, transaccion, ultimoId } from './db.js';

const AHORA = "datetime('now', 'localtime')";


// ---------- Catálogos ----------

export const categorias = () => consultar('SELECT id, nombre FROM categorias ORDER BY nombre');
export const unidades = () => consultar('SELECT id, nombre, abreviatura FROM unidades ORDER BY id');
export const momentos = () => consultar('SELECT id, nombre FROM momentos ORDER BY orden');


// ---------- Despensa ----------

export const despensa = () =>
  consultar('SELECT * FROM v_despensa ORDER BY categoria, nombre COLLATE NOCASE');

export const alimento = id => consultar('SELECT * FROM v_despensa WHERE id = :id', { id })[0];

export function guardarAlimento(a) {
  return transaccion(() => {
    if (a.id) {
      ejecutar(`UPDATE alimentos
                   SET nombre = :nombre, categoria_id = :categoria_id,
                       unidad_id = :unidad_id, stock_minimo = :stock_minimo
                 WHERE id = :id`, a);
    } else {
      // El trigger trg_alimento_nuevo_en_despensa crea su fila en la despensa
      ejecutar(`INSERT INTO alimentos (nombre, categoria_id, unidad_id, stock_minimo)
                VALUES (:nombre, :categoria_id, :unidad_id, :stock_minimo)`, a);
      a.id = ultimoId();
    }
    ejecutar(`UPDATE despensa SET cantidad = :cantidad, actualizado = ${AHORA}
               WHERE alimento_id = :id`, a);
    return a.id;
  });
}

export const borrarAlimento = id =>
  transaccion(() => ejecutar('DELETE FROM alimentos WHERE id = :id', { id }));

export const ajustarStock = (id, delta) =>
  transaccion(() => ejecutar(`UPDATE despensa
                                 SET cantidad = MAX(0, cantidad + :delta), actualizado = ${AHORA}
                               WHERE alimento_id = :id`, { id, delta }));


// ---------- Recetas ----------

export const recetas = () => consultar(`
  SELECT r.id, r.nombre, r.raciones, COUNT(ri.alimento_id) AS ingredientes
    FROM recetas r
    LEFT JOIN receta_ingredientes ri ON ri.receta_id = r.id
   GROUP BY r.id
   ORDER BY r.nombre COLLATE NOCASE`);

export function receta(id) {
  const r = consultar('SELECT id, nombre, raciones, instrucciones FROM recetas WHERE id = :id', { id })[0];
  r.ingredientes = consultar(`
    SELECT ri.alimento_id, a.nombre, ri.cantidad, u.abreviatura AS unidad
      FROM receta_ingredientes ri
      JOIN alimentos a ON a.id = ri.alimento_id
      JOIN unidades  u ON u.id = a.unidad_id
     WHERE ri.receta_id = :id
     ORDER BY a.nombre COLLATE NOCASE`, { id });
  return r;
}

export function guardarReceta(r) {
  return transaccion(() => {
    if (r.id) {
      ejecutar('UPDATE recetas SET nombre = :nombre, raciones = :raciones, instrucciones = :instrucciones WHERE id = :id', r);
    } else {
      ejecutar('INSERT INTO recetas (nombre, raciones, instrucciones) VALUES (:nombre, :raciones, :instrucciones)', r);
      r.id = ultimoId();
    }
    // Se reescriben los ingredientes; si un alimento se repite, se suman sus cantidades
    ejecutar('DELETE FROM receta_ingredientes WHERE receta_id = :id', r);
    for (const ing of r.ingredientes) {
      ejecutar(`INSERT INTO receta_ingredientes (receta_id, alimento_id, cantidad)
                VALUES (:receta_id, :alimento_id, :cantidad)
                ON CONFLICT (receta_id, alimento_id) DO UPDATE SET cantidad = cantidad + excluded.cantidad`,
               { receta_id: r.id, ...ing });
    }
    return r.id;
  });
}

export const borrarReceta = id =>
  transaccion(() => ejecutar('DELETE FROM recetas WHERE id = :id', { id }));


// ---------- Menú semanal ----------

export const menuEntre = (desde, hasta) => consultar(`
  SELECT m.id, m.fecha, m.momento_id, m.raciones, m.cocinado, r.id AS receta_id, r.nombre
    FROM menu m
    JOIN recetas r ON r.id = m.receta_id
   WHERE m.fecha BETWEEN :desde AND :hasta
   ORDER BY m.fecha, m.id`, { desde, hasta });

export const planificar = plato => transaccion(() => ejecutar(`
  INSERT INTO menu (fecha, momento_id, receta_id, raciones)
  VALUES (:fecha, :momento_id, :receta_id, :raciones)`, plato));

export const quitarDelMenu = id =>
  transaccion(() => ejecutar('DELETE FROM menu WHERE id = :id', { id }));

/**
 * Marcar un plato como cocinado descuenta sus ingredientes de la despensa
 * (escalados a las raciones planificadas). Desmarcarlo los devuelve.
 */
export function marcarCocinado(id, cocinado) {
  return transaccion(() => {
    const [actual] = consultar('SELECT cocinado FROM menu WHERE id = :id', { id });
    if (!actual || Boolean(actual.cocinado) === cocinado) return;

    ejecutar(`
      UPDATE despensa
         SET cantidad = MAX(0, cantidad + :signo * (
               SELECT ri.cantidad * m.raciones * 1.0 / r.raciones
                 FROM menu m
                 JOIN recetas r              ON r.id = m.receta_id
                 JOIN receta_ingredientes ri ON ri.receta_id = r.id
                WHERE m.id = :id AND ri.alimento_id = despensa.alimento_id)),
             actualizado = ${AHORA}
       WHERE alimento_id IN (SELECT ri.alimento_id
                               FROM menu m
                               JOIN receta_ingredientes ri ON ri.receta_id = m.receta_id
                              WHERE m.id = :id)`,
      { id, signo: cocinado ? -1 : 1 });

    ejecutar('UPDATE menu SET cocinado = :cocinado WHERE id = :id', { id, cocinado: cocinado ? 1 : 0 });
  });
}


// ---------- Lista de la compra ----------

/**
 * Para cada alimento:
 *   necesario = suma de ingredientes de los platos NO cocinados entre dos fechas
 *   a_comprar = necesario + stock_minimo − lo que hay en la despensa
 * Solo aparecen los alimentos con a_comprar > 0.
 */
export const listaCompra = (desde, hasta) => consultar(`
  WITH necesidades AS (
    SELECT ri.alimento_id,
           SUM(ri.cantidad * m.raciones * 1.0 / r.raciones) AS necesario
      FROM menu m
      JOIN recetas r              ON r.id = m.receta_id
      JOIN receta_ingredientes ri ON ri.receta_id = r.id
     WHERE m.cocinado = 0
       AND m.fecha BETWEEN :desde AND :hasta
     GROUP BY ri.alimento_id
  )
  SELECT v.id, v.nombre, v.categoria, v.unidad, v.entera,
         COALESCE(n.necesario, 0)                                AS necesario,
         v.cantidad                                              AS en_despensa,
         v.stock_minimo,
         COALESCE(n.necesario, 0) + v.stock_minimo - v.cantidad  AS a_comprar,
         EXISTS (SELECT 1 FROM compra_marcados cm WHERE cm.alimento_id = v.id) AS marcado
    FROM v_despensa v
    LEFT JOIN necesidades n ON n.alimento_id = v.id
   WHERE COALESCE(n.necesario, 0) + v.stock_minimo - v.cantidad > 0.0001
   ORDER BY v.categoria, v.nombre COLLATE NOCASE`, { desde, hasta });

export const marcarEnCarro = (id, marcado) => transaccion(() => ejecutar(
  marcado ? 'INSERT OR IGNORE INTO compra_marcados (alimento_id) VALUES (:id)'
          : 'DELETE FROM compra_marcados WHERE alimento_id = :id', { id }));

/** Suma a la despensa lo comprado (items: [{ id, cantidad }]) y vacía el carro */
export const registrarCompra = items => transaccion(() => {
  for (const item of items) {
    ejecutar(`UPDATE despensa SET cantidad = cantidad + :cantidad, actualizado = ${AHORA}
               WHERE alimento_id = :id`, item);
  }
  ejecutar('DELETE FROM compra_marcados');
});
