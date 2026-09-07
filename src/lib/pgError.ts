/**
 * Traducción de errores de PostgreSQL/PostgREST a mensajes de usuario.
 *
 * Las RPCs de `platform` levantan errores con un prefijo canónico en mayúsculas
 * (`ADMIN_EMAIL_REQUERIDO: ...`, `NO_AUTORIZADO: ...`). Ese prefijo es útil para
 * pruebas y logs, pero no para una persona: aquí se separa el código del texto
 * y se traduce lo que Postgres devuelve por su cuenta (violaciones de unicidad,
 * de FK, permisos) a algo accionable en español (U-13).
 *
 * NO se inventa autorización aquí: si la base dice 42501, la operación ya fue
 * rechazada en el servidor. Esto solo decide cómo contarlo.
 */

export interface BusinessError {
  /** Código canónico de negocio (`NO_AUTORIZADO`) o `null` si es un error de infraestructura. */
  code: string | null;
  /** Mensaje listo para mostrar. */
  message: string;
  /** SQLSTATE, cuando PostgREST lo expone. */
  sqlState?: string;
}

interface SupabaseLikeError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** `CODIGO_CANONICO: resto del mensaje` -> partes. */
const CANONICAL = /^([A-Z][A-Z0-9_]{2,}):\s*(.+)$/s;

/** SQLSTATE que Postgres genera solo, sin pasar por nuestras RPCs. */
const SQLSTATE_MESSAGES: Record<string, string> = {
  '23505': 'Ya existe un registro con ese valor único. Revisa el código o el identificador.',
  '23503': 'El registro referenciado no existe o fue eliminado.',
  '23502': 'Falta un dato obligatorio.',
  '23514': 'La operación viola una regla de negocio de la base de datos.',
  '42501': 'No tienes permisos para realizar esta operación.',
  '22007': 'Una de las fechas no es válida.',
  PGRST301: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

export function parseBusinessError(error: unknown): BusinessError {
  if (error == null) {
    return { code: null, message: 'Ocurrió un error inesperado.' };
  }

  const raw = error as SupabaseLikeError & { message?: string };
  const text = typeof raw.message === 'string' ? raw.message.trim() : String(error);
  const sqlState = typeof raw.code === 'string' ? raw.code : undefined;

  const match = CANONICAL.exec(text);
  if (match) {
    return { code: match[1], message: match[2].trim(), sqlState };
  }

  if (sqlState && SQLSTATE_MESSAGES[sqlState]) {
    // El texto crudo de Postgres (`duplicate key value violates ...`) no le sirve
    // a nadie en pantalla, pero sí en la consola del navegador.
    return { code: sqlState, message: SQLSTATE_MESSAGES[sqlState], sqlState };
  }

  return { code: null, message: text || 'Ocurrió un error inesperado.', sqlState };
}

/** Atajo para pintar el mensaje sin exponer el prefijo técnico. */
export function businessErrorMessage(error: unknown): string {
  return parseBusinessError(error).message;
}

/** `true` si la base rechazó por autorización, no por datos. */
export function isAuthorizationError(error: unknown): boolean {
  const parsed = parseBusinessError(error);
  return (
    parsed.sqlState === '42501' ||
    parsed.code === 'NO_AUTORIZADO' ||
    parsed.code === 'LIVE_NO_AUTORIZADO' ||
    parsed.code === 'DOMINIO_OPERADOR_BLOQUEADO' ||
    parsed.code === 'ORGANIZACION_PLATAFORMA_PROTEGIDA'
  );
}
