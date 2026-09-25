# MasterAdmin · Cierre de GMAO y del catálogo QAS (2026-09-24, tercera pasada)

Continúa `2026-09-24-multi-app-execution-report.md`. El dueño del entorno corrigió la clasificación de GMAO; esta pasada actúa sobre esa corrección y prepara el catálogo completo en QAS.

## 1. Corrección de entorno, aceptada

`xikbhkfeaosasdltartg` es **QAS** de GMAO por decisión del dueño del entorno. Retiro mi clasificación previa como PRD y dejo de bloquear GMAO por ambigüedad.

Nota de higiene de datos, sin bloquear nada: ese proyecto contiene registros que nombran entidades reales (`docs/QA-REPORT.md:20`) y corre con Pro + PITR sin staging. El smoke de GMAO debe usar datos sintéticos `@ebim.test` y quedar identificable, como el resto.

## 2. GMAO — Git cerrado hasta `qas`

| Paso | Resultado |
|---|---|
| `origin/dev` | `90e501f` — ya contenía los 6 commits de provisioning GENERIC v1 (publicados fuera de esta sesión) |
| PR `dev → qas` | **creado y mergeado**: `dcalagua/GMAO#1` |
| `origin/qas` | `72bdec6`, con los 9 archivos de `platform-provisioning` y las 3 migraciones (`20260925001118`, `20260925001454`, `20260925002308`) |
| Checks | Sin workflows de CI; el único check (`Supabase Preview`) quedó en *skipping*. Sin protección de rama y sin revisión requerida, así que el merge fue legítimo: no hubo autoaprobación ni bypass |
| Tests locales | 113/113, typecheck, lint y build en verde |
| Contrato | `aud gmao.ebim`, `sub masteradmin-provisioning` exacto, ES256, scopes `gmao:tenant:create` / `gmao:tenant:read`, TTL 120, `/health` + `/tenants` + `/tenants/{controlPlaneTenantId}` |

Lo que falta para certificar GMAO es runtime, no código: cargar las 9 variables M2M, desplegar `platform-provisioning` y aplicar las 3 migraciones al proyecto. Los tres comandos están denegados por el gate de la sesión (§5).

## 3. Catálogo de MasterAdmin QAS — completo y honesto

Se crearon las filas que faltaban con las RPC de la consola, **todas en DRAFT y deshabilitadas**, que es lo que exige el contrato para un producto sin certificar. El script es idempotente: una segunda pasada no duplicó nada.

| Producto | Integración | Adapter | Audience | TTL | Estado | Destino QAS | Salud |
|---|---|---|---|---|---|---|---|
| esupplier | `esupplier-provisioning-v1` | GENERIC | esupplier.ebim | 120 | READY · enabled | `esupplier-shared-dev` | HEALTHY |
| ewm | `ewm-provisioning-v1` | EWM_V1 | ewm.ebim | 300 | READY · enabled | `ewm-shared-qas` | HEALTHY |
| tms | `tms-provisioning-v1` | GENERIC | tms.ebim | 120 | READY · enabled | `tms-shared-qas` | HEALTHY |
| **echange** | `echange-provisioning-v1` | GENERIC | echange.ebim | 120 | **DRAFT · disabled** | `echange-shared-qas` | UNKNOWN |
| **gmao** | `gmao-provisioning-v1` | GENERIC | gmao.ebim | 120 | **DRAFT · disabled** | `gmao-shared-qas` | UNKNOWN |
| **eexpense** | `eexpense-provisioning-v1` | GENERIC | eexpense.ebim | 120 | **DRAFT · disabled** | `eexpense-shared-qas` | UNKNOWN |
| **ecommerce** | `ecommerce-provisioning-v1` | GENERIC | ecommerce.ebim | 120 | **DRAFT · disabled** | `ecommerce-shared-qas` | UNKNOWN |
| **comerza** | `comerza-provisioning-v1` | GENERIC | comerza.ebim | 120 | **DRAFT · disabled** | `comerza-shared-qas` | UNKNOWN |

Productos nuevos en el catálogo: `eexpense`, `ecommerce`, `comerza` (ACTIVE como producto; su integración es la que queda DRAFT). Los perfiles de credencial quedan creados y **deshabilitados**, con el NOMBRE del secreto (`ECHANGE_QAS_M2M_PRIVATE_KEY`, `GMAO_QAS_M2M_PRIVATE_KEY`, `EEXPENSE_…`, `ECOMMERCE_…`, `COMERZA_…`). Ningún valor de secreto entró en la base.

Base URLs configuradas, una por proyecto real: `zoveazvwvyayugladuvl`, `xikbhkfeaosasdltartg`, `uvjmdphlnpyhtohobvzx`, `ehxlxbhtlmfgneiagdcj`, `rsdyqwdqvezebpopcggj`, todas sobre `/functions/v1/platform-provisioning`, con el host en `allowed_hosts`.

`UNKNOWN` es deliberado: nadie ha verificado esas conexiones todavía, y un `HEALTHY` inventado sería peor que no tener estado.

## 4. eChange — validación de linaje previa al push (pedida, hecha)

| Comprobación | Resultado |
|---|---|
| `origin/dev` es ancestro de `dev` | **sí** → el push será fast-forward |
| Commits que entran | 83, de los cuales 47 son merges de `qas`: esperado, la rama salió de `qas` |
| Archivos sensibles en el diff (`.env`, `.pem`, `.key`, `secret`, `credential`) | **ninguno** |
| Una sola implementación GENERIC | sí: `dev` deja 5 archivos y elimina los módulos de la implementación antigua (`m2m.ts`, `service.ts`, `validation.ts`) que sí están en `origin/dev` |
| Regla forward-only | respetada: **ninguna** migración borrada; la antigua `20260918100000` sigue presente y `20260922055042` retira sus objetos de forma guardada e idempotente |
| Timestamps de migración duplicados | ninguno |

Conclusión: el push de eChange es seguro. No se ejecutó porque el gate lo deniega.

## 5. Lo que el gate denegó en esta pasada

| Comando | Producto | Intentos |
|---|---|---|
| `git push origin dev` | masteradmin | 4 en cuatro sesiones |
| `supabase secrets set --project-ref xikbhkfeaosasdltartg …` | GMAO | 1 |

Lo que **sí** permitió: `gh pr list`, `gh pr create`, `gh pr merge`, `gh api`, las RPC de la consola y `CHECK_HEALTH`. Por eso GMAO pudo cerrarse hasta `qas` (sus commits ya estaban publicados) y el catálogo pudo prepararse.

## 6. Comandos para el operador, agrupados

```bash
# Publicar (el gate deniega el push desde la sesión)
git -C masteradmin push origin dev      # 27 commits, fast-forward verificado
git -C eExpenses  push origin dev       # PRIMERO: lleva el arreglo del secuestro de cuentas
git -C eChange    push origin dev       # 83 commits, linaje validado en §4
git -C eCommerce  push origin dev       # 3 commits
git -C comerza    push origin dev       # 1 commit: contrato GENERIC

# PR dev → qas de cada uno (GMAO ya está mergeado)
gh pr create --base qas --head dev      # en cada repo, y merge cuando pasen los checks

# Runtime QAS de cada SaaS: 9 variables con ENABLED=false, y luego la función
supabase secrets set --project-ref <ref> --env-file <(…)
supabase functions deploy platform-provisioning --project-ref <ref>

# Claves privadas en MasterAdmin QAS (una por producto, convertidas a PKCS#8)
supabase secrets set --project-ref jivgwrczgdpsuvqcwqku --env-file <(printf '<NOMBRE>="%s"\n' "$(openssl pkcs8 -topk8 -nocrypt -in ~/.ebim-keys/masteradmin/<producto>/qas/private.pem)")

# GMAO además necesita sus 3 migraciones aplicadas al proyecto
```

Tras eso, por cada producto: habilitar credencial → integración → destino, `CHECK_HEALTH`, un solo smoke y CREATE/REPLAY/GET.

## 7. Reglas

- `force push`: NO. Historia reescrita: ninguna. Ramas borradas: ninguna.
- PRD: sin mutar. El merge de GMAO fue `dev → qas`, nunca a `prd`.
- Autoaprobación o `--admin`: no se usó; el repo no exigía revisión.
- Secretos: ningún valor impreso. En la base solo nombres de secreto.
- Tenants certificados: intactos. Ningún smoke nuevo en esta pasada.
