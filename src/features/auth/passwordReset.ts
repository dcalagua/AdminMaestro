import { supabase } from '@/lib/supabase';

/**
 * M5 · Restablecer la contraseña (spec §6.3).
 *
 * Supabase Auth envía al correo del TITULAR un enlace que vuelve a
 * `/bienvenida?mode=reset`, donde se fija la nueva contraseña. Nunca se le
 * entrega un enlace a un tercero.
 *
 * La respuesta es la MISMA exista o no la cuenta: el formulario no debe servir
 * para averiguar qué correos están registrados.
 */
export function welcomeUrl(mode?: 'reset'): string {
  const base = `${window.location.origin}/bienvenida`;
  return mode ? `${base}?mode=${mode}` : base;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: welcomeUrl('reset'),
  });
  // Un correo inexistente no produce error en Auth; un límite de envío sí.
  // Ninguno de los dos se traduce en «ese correo no existe».
  if (error) {
    throw new Error(
      'No se pudo enviar el enlace en este momento. Inténtalo de nuevo en unos minutos o pide ayuda al equipo de plataforma EBIM.',
    );
  }
}
