/**
 * Acceso centralizado a la configuración de entorno.
 *
 * Regla de seguridad (prompt §5, contrato §14): sólo las variables con prefijo
 * `VITE_` llegan al bundle del browser. La `service_role` key y el token de la
 * Management API NO tienen ese prefijo y por tanto no pueden filtrarse aquí,
 * ni siquiera por accidente.
 */
function required(name, value) {
    if (!value || value.trim() === '') {
        throw new Error(`Falta la variable de entorno ${name}. Copia .env.example a .env.local y complétala ` +
            `con los valores de \`supabase status\`.`);
    }
    return value;
}
export const env = {
    supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
    supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
    appEnv: (import.meta.env.VITE_APP_ENV ?? 'LOCAL'),
    isProduction: import.meta.env.VITE_APP_ENV === 'PRD',
};
