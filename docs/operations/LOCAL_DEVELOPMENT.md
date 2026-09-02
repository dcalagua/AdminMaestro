# Desarrollo local

## 1. Primer arranque

```bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"   # o `nvm use`
npm install
supabase start
cp .env.example .env.local
supabase status            # copiar API URL y anon key a .env.local
npm run db:reset           # migraciones desde cero + seed
npm run dev
```

Abre http://127.0.0.1:5173 y entra con `dcalagua@ebim.pe` / `Ebim.Demo2026!`.

## 2. Puertos

Este proyecto usa el rango **544xx**, no el 543xx por defecto.

**Por qué:** al iniciar, el puerto 54322 ya estaba ocupado por el stack local de
otro proyecto (`apt-supervisor`). Detenerlo habría interrumpido el trabajo de
alguien más, así que se movieron los puertos de **este** proyecto.

| Servicio | Puerto | URL |
|---|---|---|
| API (Kong) | 54421 | http://127.0.0.1:54421 |
| PostgreSQL | 54422 | `postgresql://postgres:postgres@127.0.0.1:54422/postgres` |
| Studio | 54423 | http://127.0.0.1:54423 |
| Mailpit | 54424 | http://127.0.0.1:54424 |
| Shadow DB | 54420 | — |
| Analytics | 54427 | — |

Si vuelve a haber colisión, edita los `port` de `supabase/config.toml`. **No
detengas el stack de otro proyecto** para liberar un puerto.

## 3. Flujo con migraciones

```bash
# Crear una migración nueva
supabase migration new descripcion_del_cambio

# Aplicar sólo las pendientes
supabase migration up --local

# Reconstruir TODO desde cero (lo que hace CI y lo que debes probar antes de
# dar por buena una migración)
npm run db:reset

# Regenerar los tipos TypeScript tras un cambio de schema
npm run db:types
```

> Una migración que sólo funciona con `migration up` sobre una base ya poblada
> **no está terminada**. El gate real es `db:reset` desde cero.

## 4. Ejecutar SQL directo

No hay `psql` instalado en el sistema; se usa el del contenedor:

```bash
docker exec -it supabase_db_ebim-control-plane psql -U postgres -d postgres
```

## 5. Tests

```bash
npm run db:test     # 52 tests pgTAP (estructura, RLS, negocio)
npm test            # 29 tests unitarios (Vitest)
npm run e2e         # 21 smoke E2E (Playwright)
```

Los E2E necesitan Supabase local **con el seed cargado**. Playwright levanta el
servidor de Vite por su cuenta (`webServer` en `playwright.config.ts`).

## 6. Gates completos antes de un commit

```bash
npm run typecheck && npm run lint && npm test && npm run build && \
npm run secrets:scan && npm run db:test
```

## 7. Problemas frecuentes

### `supabase start` falla con "port is already allocated"

Otro proyecto ocupa el puerto. Ver §2: cambia **tus** puertos, no detengas el
stack ajeno.

### Todo login devuelve 500 "Database error querying schema"

Las columnas de token de GoTrue en `auth.users` (`confirmation_token`,
`recovery_token`, `email_change*`, `phone_change*`, `reauthentication_token`)
deben ser `''`, **nunca NULL**: su driver las escanea como string. El seed ya lo
hace; si insertas usuarios a mano, replícalo. El síntoma es engañoso porque el
error no nombra ni el usuario ni la columna.

```bash
docker logs supabase_auth_ebim-control-plane 2>&1 | tail -20
```

### El contenedor de Supabase desaparece al cerrar la terminal

Ejecuta `supabase start` en primer plano una vez y deja que termine. Lanzarlo
con `nohup ... &` y matar el proceso padre hace que el CLI detenga los
contenedores al recibir la señal.

### Una consulta devuelve 0 filas y "debería" traer datos

Casi siempre es RLS haciendo su trabajo: el usuario no tiene alcance sobre esas
filas. Para confirmarlo, ejecuta la misma consulta como `postgres` en psql. Si
ahí sí hay datos, el problema es de alcance, no de la consulta — revisa
`docs/security/RBAC_RLS_MATRIX.md` antes de tocar una política.

### El build falla con "The class ... does not exist"

Tailwind no puede calcular opacidad sobre colores declarados como `var(--x)`
(p. ej. `bg-accent/25`). Define un token con su propia transparencia en
`tokens.css` y úsalo como `[color:var(--mi-token)]`.

## 8. Convenciones al escribir código

- **UI en español**, incluidos los mensajes de error (mercado LATAM).
- **Listados: un solo buscador general.** Prohibidos los paneles multi-campo
  (contrato §8). Tabs de estado sí.
- **Pantallas de detalle: `SectionTabs` centrados** con deep-link `#hash`.
- **Colores desde tokens**, nunca hex en componentes: el theming/white-label por
  tenant depende de ello.
- **`accent-deep` para texto**, `accent` para rellenos (contraste AA).
- **Nunca filtrar por seguridad en el cliente.** Si hace falta un filtro de
  alcance, va en una política RLS.
