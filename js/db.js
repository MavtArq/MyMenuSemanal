// ============================================================
//  db.js · Conexión con Supabase (PostgreSQL en la nube)
//
//  Además guarda en el móvil una copia de cada consulta para
//  poder ver los últimos datos cuando no hay conexión.
// ============================================================

import { SUPABASE_URL, SUPABASE_CLAVE } from './config.js';

export const cliente = supabase.createClient(SUPABASE_URL, SUPABASE_CLAVE, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Convierte la respuesta { data, error } de Supabase en datos, o lanza el error */
export async function datos(peticion) {
  const { data, error } = await peticion;
  if (error) throw error;
  return data;
}

export const tabla = nombre => cliente.from(nombre);
export const rpc = (funcion, args = {}) => datos(cliente.rpc(funcion, args));


// ---------- Caché para consultar sin conexión ----------

const PREFIJO = 'cache:';

export function esErrorDeRed(error) {
  return !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(String(error?.message ?? error));
}

function avisarConexion(hayConexion) {
  window.dispatchEvent(new CustomEvent('estado-conexion', { detail: hayConexion }));
}

/** Ejecuta una consulta de lectura; si falla por falta de red, devuelve la última copia guardada */
export async function leer(clave, consulta) {
  try {
    const resultado = await consulta();
    try { localStorage.setItem(PREFIJO + clave, JSON.stringify(resultado)); } catch { /* sin espacio o modo privado */ }
    avisarConexion(true);
    return resultado;
  } catch (error) {
    if (!esErrorDeRed(error)) throw error;
    let guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(PREFIJO + clave)); } catch { /* sin caché */ }
    if (guardado === null) throw error;
    avisarConexion(false);
    return guardado;
  }
}

export function borrarCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(PREFIJO)).forEach(k => localStorage.removeItem(k));
  } catch { /* nada que borrar */ }
}


// ---------- Errores en lenguaje humano ----------

const ERRORES_ACCESO = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos'],
  [/email not confirmed/i, 'Confirma tu correo antes de entrar (revisa la bandeja de entrada)'],
  [/already registered/i, 'Ya existe una cuenta con ese correo'],
  [/password should be at least/i, 'La contraseña debe tener al menos 6 caracteres'],
  [/rate limit|too many requests/i, 'Demasiados intentos. Espera unos minutos'],
  [/unable to validate email|invalid format/i, 'El correo no es válido'],
  [/jwt expired|refresh token/i, 'La sesión ha caducado. Vuelve a entrar'],
];

export function mensajeError(error) {
  if (esErrorDeRed(error)) return 'Sin conexión: no se pueden guardar cambios ahora';
  const mensaje = String(error?.message ?? error);
  switch (error?.code) {
    case '23505': return 'Ya existe un elemento con ese nombre';
    case '23503': return 'No se puede: está en uso (por ejemplo, en alguna receta)';
    case '23514': return 'Algún valor no es válido (revisa las cantidades)';
    case '23502': return 'Falta algún dato obligatorio';
    case '42501': return 'No tienes permiso para hacer eso';
    case 'P0001': return mensaje;   // mensajes propios lanzados con "raise exception"
  }
  for (const [patron, texto] of ERRORES_ACCESO) if (patron.test(mensaje)) return texto;
  return mensaje;
}
