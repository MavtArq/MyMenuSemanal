// ============================================================
//  modelo.js · Todas las operaciones con la base de datos
//
//  La interfaz (app.js) nunca habla con Supabase directamente:
//  llama a estas funciones. Las operaciones de varios pasos son
//  funciones SQL en el servidor (supabase/esquema.sql) y se
//  llaman con rpc(), así se ejecutan en una sola transacción.
// ============================================================

import { datos, leer, rpc, tabla, cliente } from './db.js';


// ---------- Hogar ----------

export const miHogar = () => leer('hogar', () =>
  datos(tabla('hogares').select('id, nombre, codigo_invitacion').maybeSingle()));

export const miembros = () => leer('miembros', () =>
  datos(tabla('miembros').select('user_id, email, unido').order('unido')));

export const crearHogar = nombre => rpc('crear_hogar', { p_nombre: nombre });
export const unirseHogar = codigo => rpc('unirse_hogar', { p_codigo: codigo });
export const salirHogar = () => rpc('salir_hogar');
export const regenerarCodigo = () => rpc('regenerar_codigo');


// ---------- Catálogos ----------

export const categorias = () => leer('categorias', () => datos(tabla('categorias').select('id, nombre').order('nombre')));
export const unidades = () => leer('unidades', () => datos(tabla('unidades').select('id, nombre, abreviatura').order('id')));
export const momentos = () => leer('momentos', () => datos(tabla('momentos').select('id, nombre').order('orden')));


// ---------- Despensa ----------

export const despensa = () => leer('despensa', () =>
  datos(tabla('v_despensa').select('*').order('categoria').order('nombre')));

export const alimento = id => datos(tabla('v_despensa').select('*').eq('id', id).single());

export const guardarAlimento = a => rpc('guardar_alimento', {
  p_id: a.id, p_nombre: a.nombre, p_categoria_id: a.categoria_id, p_unidad_id: a.unidad_id,
  p_stock_minimo: a.stock_minimo, p_cantidad: a.cantidad,
});

export const borrarAlimento = id => datos(tabla('alimentos').delete().eq('id', id));

export const ajustarStock = (id, delta) => rpc('ajustar_stock', { p_id: id, p_delta: delta });


// ---------- Recetas ----------

export const recetas = () => leer('recetas', () => datos(tabla('v_recetas').select('*').order('nombre')));

export const receta = id => datos(tabla('recetas')
  .select('id, nombre, raciones, instrucciones, ingredientes:receta_ingredientes(alimento_id, cantidad)')
  .eq('id', id).single());

export const guardarReceta = r => rpc('guardar_receta', {
  p_id: r.id, p_nombre: r.nombre, p_raciones: r.raciones,
  p_instrucciones: r.instrucciones, p_ingredientes: r.ingredientes,
});

export const borrarReceta = id => datos(tabla('recetas').delete().eq('id', id));


// ---------- Menú semanal ----------

export const menuEntre = (desde, hasta) => leer(`menu:${desde}`, async () => {
  const filas = await datos(tabla('menu')
    .select('id, fecha, momento_id, raciones, cocinado, receta_id, receta:recetas(nombre)')
    .gte('fecha', desde).lte('fecha', hasta)
    .order('fecha').order('id'));
  return filas.map(({ receta, ...plato }) => ({ ...plato, nombre: receta.nombre }));
});

export const planificar = plato => datos(tabla('menu').insert(plato));
export const quitarDelMenu = id => datos(tabla('menu').delete().eq('id', id));
export const marcarCocinado = (id, cocinado) => rpc('marcar_cocinado', { p_id: id, p_cocinado: cocinado });


// ---------- Lista de la compra ----------

export const listaCompra = (desde, hasta) => leer(`compra:${desde}:${hasta}`, () =>
  rpc('lista_compra', { p_desde: desde, p_hasta: hasta }));

export const marcarEnCarro = (id, marcado) => datos(marcado
  ? tabla('compra_marcados').upsert({ alimento_id: id }, { ignoreDuplicates: true })
  : tabla('compra_marcados').delete().eq('alimento_id', id));

export const registrarCompra = (desde, hasta) => rpc('registrar_compra', { p_desde: desde, p_hasta: hasta });


// ---------- Copias de seguridad ----------

export const exportarDatos = () => rpc('exportar_datos');
export const importarDatos = copia => rpc('importar_datos', { p_datos: copia });


// ---------- Tiempo real ----------

/** Llama a alCambiar() cada vez que alguien del hogar modifica algo */
export function escucharCambios(alCambiar) {
  const canal = cliente.channel('cambios-hogar')
    .on('postgres_changes', { event: '*', schema: 'public' }, alCambiar)
    .subscribe();
  return () => cliente.removeChannel(canal);
}
