# Auditoría de RLS y privilegios — V4

Medición contra la base local tras `npm run db:reset` limpio (2026-09-15).

## 1. Estado global del schema `platform`

| Métrica | Baseline (V3.2) | Tras V4 |
| --- | --- | --- |
| Tablas | 54 | 63 |
| Vistas | 22 | 24 |
| Funciones | 139 | 182 |
| Enums | 39 | 51 |
| Políticas RLS | 84 | 94 |

## 2. Invariantes verificados en la base, no leídos del código

```
Tablas sin RLS habilitada Y forzada .................. 0
SECURITY DEFINER sin search_path fijo ................ 0
Funciones ejecutables por `anon` ..................... 0
Escritura directa (I/U/D) para authenticated
  sobre las 9 tablas nuevas .......................... 0
Privilegio de columna sobre secret_ref/public_key_ref
  para authenticated/anon/PUBLIC ..................... 0
```

Las mismas comprobaciones están en `22_v4_provisioning_rbac.test.sql`, así que
una regresión futura sale en rojo y no hay que volver a auditar a mano.

## 3. Tablas nuevas

| Tabla | GRANT a `authenticated` | Política SELECT |
| --- | --- | --- |
| `platform_permissions` | SELECT | `true` — el catálogo de nombres no concede nada |
| `provisioning_role_permissions` | SELECT | `true` |
| `provisioning_role_members` | SELECT | propias, o super admin |
| `product_owners` | SELECT | propias, `product_owner.manage`, o productos con alcance |
| `product_integrations` | SELECT | `has_product_permission('platform.integration.read', producto)` |
| `credential_profiles` | SELECT **por columnas** | `has_product_permission('platform.credentials.read', producto)` |
| `saas_provisioning_requests` | SELECT | permiso sobre el producto, **o** tenant propio |
| `tenant_product_mappings` | SELECT | igual |
| `saas_provisioning_events` | SELECT | visibilidad de la solicitud padre |

`deployment_targets` conserva su política del baseline y **suma** una permisiva
(`deployment_targets_select_provisioning`): las políticas se combinan con OR, así
que un propietario técnico ve los destinos de su producto aunque no pertenezca a
ninguna de las organizaciones implicadas. La política existente no se tocó.

## 4. El privilegio de columna

```sql
grant select (
  id, code, name, saas_product_id, type, environment, secret_configured,
  algorithm, issuer, audience, token_ttl_seconds, enabled, created_at, updated_at
) on platform.credential_profiles to authenticated;
```

`secret_ref` y `public_key_ref` quedan fuera. Es un privilegio de **columna**,
no una política: una política permisiva escrita mañana no los abriría. Verificado
en el E2E contra PostgREST, incluido el super admin.

## 5. EXECUTE

Concedido a `authenticated` por **lista explícita** de 33 funciones. No se usó un
bucle sobre el schema, y no es un detalle de estilo: V2.1 y V3 revocaron a mano
el EXECUTE de las RPC de proveedor de pago, de `generate_commission_events` y de
las funciones de trigger. Un bucle genérico se lo habría devuelto en silencio.

**Así se descubrió**: el primer intento sí usó un bucle, y los tests 05, 16 y 20
del baseline lo detectaron en el acto.

Sólo `service_role`:

```
provisioning_execution_context   begin_saas_provisioning
complete_saas_provisioning       fail_saas_provisioning
record_provisioning_event        deployment_health_context
log_provisioning_config_change
```

Sin EXECUTE para nadie (funciones de trigger):

```
enforce_deployment_provisioning_coherence
enforce_saas_provisioning_transition
reject_hard_delete
```

PostgreSQL concede EXECUTE a PUBLIC en toda función nueva y el
`alter default privileges` del baseline **no lo evita en la práctica** —
comprobado: las tres aparecían accesibles para `anon` tras el reset. La
revocación explícita es lo que cierra el hueco.

## 6. `is_service_request()`

El primer intento comprobaba `current_user <> 'service_role'`. **No funciona**:
dentro de una función `SECURITY DEFINER`, `current_user` es el propietario
(postgres), no quien llama. `session_user` tampoco sirve: PostgREST conecta
siempre como `authenticator`.

La señal fiable es el claim `role` del JWT verificado. Un usuario normal no puede
falsificarlo: su token lleva `authenticated`.

## 7. Verificación de integridad

Las 37 migraciones del baseline se comprobaron por hash SHA-256 antes y después:
**todas intactas**. Ver `evidence/migrations-integrity.txt`.
