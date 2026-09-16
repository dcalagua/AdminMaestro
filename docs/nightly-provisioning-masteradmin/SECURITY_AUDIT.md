# Auditoría de seguridad — V4

Lista de verificación de la fase, con el resultado medido y dónde se comprueba.

| # | Control | Resultado | Evidencia |
| --- | --- | --- | --- |
| 1 | MasterAdmin no se conecta a la BD de ningún SaaS | PASS | `DB_DIRECT` no existe en el enum (pgTAP 21) |
| 2 | No hay credenciales de SaaS en ninguna tabla | PASS | Ninguna columna password/private_key/dsn (pgTAP 21) |
| 3 | `secret_ref` guarda un nombre, no un valor | PASS | CHECK de forma; PEM/JWT/base64/`sk_live_` rechazados incluso como superusuario |
| 4 | `secret_ref` ilegible desde el navegador | PASS | Privilegio de columna; E2E contra PostgREST, incluido super admin |
| 5 | Lectura de la referencia auditada | PASS | `reveal_credential_secret_ref` + `audit_logs` |
| 6 | El nombre del secreto no entra en la bitácora | PASS | El diff de auditoría excluye `secret_ref` (pgTAP 22) |
| 7 | Autorización ANTES del privilegio | PASS | 401/403 con JWT válido; `service_role` sólo tras el gate (E2E) |
| 8 | Aislamiento entre propietarios de producto | PASS | Owner de EWM → 403 sobre eSupplier, y RLS le devuelve 1 integración |
| 9 | SSRF: esquemas, metadatos, rangos privados | PASS | 20 casos en pgTAP + 60 unitarios |
| 10 | SSRF: redirecciones | PASS | `redirect: 'manual'` + revalidación por salto |
| 11 | HTTPS obligatorio en DEMO/QAS/PRD | PASS | CHECK + guard + pgTAP |
| 12 | Sólo algoritmos asimétricos | PASS | Enum con RS256/ES256; `none` y HS256 no existen |
| 13 | TTL ≤ 300 s | PASS | CHECK + techo en código (m2m.test.ts) |
| 14 | `sub` es el sistema, no la persona | PASS | CHECK de forma + test de claims |
| 15 | `actor_id` es auditoría y no autoriza | PASS | Documentado en M2M.md §4; no se usa en ninguna decisión |
| 16 | Sin reintento en 400/401/403/409 | PASS | 33 unitarios de clasificación + adaptador |
| 17 | Misma `Idempotency-Key` en reintentos | PASS | Verificado sobre las cabeceras reales enviadas |
| 18 | Cinco clics → una solicitud | PASS | pgTAP + E2E |
| 19 | Sin DELETE físico | PASS | Trigger que bloquea incluso a `service_role` |
| 20 | Errores normalizados sin filtración | PASS | Redacción de JWT/PEM/conexión/stack; cuerpo crudo nunca guardado |
| 21 | MOCK bloqueado fuera de DEV | PASS | Trigger + precondiciones + registro (tres capas) |
| 22 | Sin escritura directa desde el navegador | PASS | Cero GRANT de I/U/D en las 9 tablas |
| 23 | RLS habilitada y forzada | PASS | 0 tablas sin forzar en todo el schema |
| 24 | `search_path` en toda función definer | PASS | 0 sin fijar |
| 25 | `anon` sin EXECUTE | PASS | 0 funciones |
| 26 | Sin secretos en el repositorio ni en el bundle | PASS | `secrets:scan` con 9 exenciones justificadas por línea |
| 27 | Sin llamadas a servicios reales | PASS | MOCK en DEV; HTTP_M2M contra doble de `fetch` |
| 28 | Migraciones históricas intactas | PASS | SHA-256 de las 37 verificado |

## Hallazgos corregidos durante la fase

Todos se descubrieron con las pruebas, no por revisión:

1. **Reapertura de EXECUTE ya revocados.** El primer intento concedía EXECUTE con
   un bucle sobre el schema, devolviendo permisos que V2.1 y V3 habían revocado a
   propósito. Detectado por los tests 05/16/20 del baseline. Corregido con lista
   explícita.

2. **Funciones de trigger accesibles para `anon`.** PostgreSQL concede EXECUTE a
   PUBLIC en cada función nueva y el `alter default privileges` no lo impedía.
   Detectado por el test 16. Corregido con revocación explícita.

3. **`current_user` no sirve para detectar `service_role`.** Dentro de una función
   `SECURITY DEFINER` es siempre el propietario. Detectado al invocar la Edge
   Function de verdad. Corregido con `is_service_request()`, que lee el claim del
   JWT verificado.

4. **Guard de idempotencia sin efecto.** La comprobación de la clave iba después
   del atajo «si el estado no cambia, salir», así que un UPDATE que sólo tocara la
   clave pasaba de largo. Detectado por pgTAP. Corregido moviéndola antes.

5. **RECORD no asignado (55000).** Leer un campo de un RECORD que nunca fue
   destino de un `INTO` lanza error en vez de devolver NULL — y el caso normal de
   un dedicado sin infraestructura es exactamente ese. Detectado por pgTAP y por
   la verificación de salud. Corregido ejecutando siempre el `SELECT INTO`.

6. **Texto libre aceptado como código de error.** `normalizeProviderCode`
   convertía espacios en guiones bajos, así que una frase entera pasaba como
   «código estable». Detectado por su propio test. Corregido rechazando espacios.

7. **El escáner de secretos sólo miraba la primera coincidencia por patrón y
   fichero**, ocultando tres hallazgos reales. Detectado al endurecerlo.
   Corregido recorriendo todas las coincidencias.

## Lo que esta fase NO certifica

- El contrato real de EWM, que no está confirmado.
- Que un SaaS real acepte la firma: se verifica con la clave pública generada en
  el propio test.
- El provisioning en QAS o PRD: no se ejecutó, y el secreto de firma no está
  cargado en ningún entorno.
