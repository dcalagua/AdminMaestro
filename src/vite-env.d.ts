/// <reference types="vite/client" />

/**
 * Tipado de las variables de entorno del cliente.
 *
 * Sólo se declaran las `VITE_*`: la `service_role` key y el token de la
 * Management API no llevan ese prefijo, no llegan al bundle y por tanto no
 * tienen entrada aquí ni pueden autocompletarse por error.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_ENV?: 'LOCAL' | 'DEV' | 'QAS' | 'PRD';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
