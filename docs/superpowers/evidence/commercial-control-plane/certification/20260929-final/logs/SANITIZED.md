# Evidencia sanitizada

Este directorio conserva los logs crudos de la corrida `20260929-final`. Un único log fue
**sanitizado** después de la corrida para que el escáner de secretos del repositorio
(`npm run secrets:scan`) no tenga hallazgos en archivos versionados. No se cambió
ningún resultado.

| Log | Línea | Qué había | Qué hay |
|---|---|---|---|
| `esupplier-sql-and-golden.txt` | 692 | Valor devuelto por psql de `select set_config('request.jwt.claims', …)`: el JSON del claim de rol `service_role` que el test SQL de eSupplier fija en su transacción. Es un claim sin firmar: no es un JWT, ni una clave, ni una credencial. | `[NON_SECRET_TEST_ROLE_CLAIM]` |

- Paso: `esupplier sql-and-golden` (`CCP_KEEP_CONTAINER=1 bash supabase/tests/ccp/run_ccp_sql_tests.sh`
  en el worktree de eSupplier), rc=0 según `../steps.tsv`.
- Las otras 1549 líneas (asserts, NOTICE `ok — …`, resumen final) están sin tocar.
- sha256 del log crudo original: `1c40e35b8c2d784bc32ffc73ec55bae5c17840ac8eedc2adb221a8c56a2dd21f` (versionado en el historial Git previo a esta sanitización).
- sha256 del log sanitizado: `d8d85407314b12dcc959ce9e38219019bb2f81c5803839bdd695e5c13e2818a9`.
