import { QueryClient, hashKey, type QueryKey } from '@tanstack/react-query';

/**
 * Cliente de TanStack Query de la consola.
 *
 * `retry: 1`: un fallo de RLS (403/permiso denegado) no es transitorio, y
 * reintentarlo tres veces sólo retrasa el mensaje de error.
 *
 * E11 · aislamiento entre sesiones (spec §4.1): la caché vive en memoria del
 * navegador y NO la protege RLS. Cada clave se «firma» con la identidad de la
 * sesión (`sessionScope`), así que:
 *   · la sesión B nunca lee una entrada creada por la sesión A;
 *   · una respuesta tardía de A se escribe en una entrada de A que B no ve.
 * Las claves de las consultas no cambian (invalidateQueries sigue funcionando por
 * prefijo); sólo cambia su hash.
 */
const scopes = new WeakMap<QueryClient, { current: string }>();

/** Identidad dueña de la caché de `client` (`anon` sin sesión). */
export function getSessionScope(client: QueryClient): string {
  return scopes.get(client)?.current ?? 'anon';
}

/**
 * Cambia la identidad dueña de la caché. Devuelve `true` si cambió (A→B o
 * A→sin sesión). Un refresco de token de la MISMA identidad no cambia nada: no se
 * vacía la caché ni se pierden formularios.
 */
export function setSessionScope(client: QueryClient, userId: string | null): boolean {
  const scope = scopes.get(client);
  const next = userId ?? 'anon';
  if (!scope || next === scope.current) return false;
  scope.current = next;
  // Se cancela y se descarta todo lo de la identidad anterior: nada de sus
  // filas debe sobrevivir en memoria, ni siquiera bajo su propia firma.
  void client.cancelQueries();
  client.clear();
  return true;
}

export function createAppQueryClient(): QueryClient {
  const scope = { current: 'anon' };
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        queryKeyHashFn: (queryKey: QueryKey) => hashKey([scope.current, ...queryKey]),
      },
    },
  });
  scopes.set(client, scope);
  return client;
}
