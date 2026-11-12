/**
 * Tamaños de página de los listados (servidor y cliente). Vive aparte de
 * `services/financeRead` para que los componentes de UI no arrastren el cliente
 * de Supabase al importar el paginador.
 */
export const PAGE_SIZES = [25, 50, 100] as const;
