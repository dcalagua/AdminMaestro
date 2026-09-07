import { createClient } from '@supabase/supabase-js';
import { env } from './env';
/**
 * Cliente Supabase del Control Plane.
 *
 * Usa la clave ANON/publicable: es pública por diseño y la seguridad real la da
 * RLS en PostgreSQL. La `service_role` key NUNCA aparece en el browser
 * (principio 8 del README de la suite y prompt §5).
 *
 * El esquema por defecto es `platform`: todo el plano de control vive ahí y
 * `public` queda vacío de negocio (contrato §1/§7).
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    db: { schema: 'platform' },
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'ebim-control-plane-auth',
    },
    global: {
        headers: { 'x-application-name': 'ebim-control-plane' },
    },
});
