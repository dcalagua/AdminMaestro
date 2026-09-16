# Autenticación M2M entre MasterAdmin y los SaaS

## 1. Qué presenta MasterAdmin

Un JWT **asimétrico** de vida corta, firmado server-side. El SaaS lo verifica
con la clave **pública** correspondiente.

```
Authorization: Bearer <JWT>
```

## 2. Por qué asimétrico y no HS256

Con un secreto compartido, cualquiera que pueda **verificar** un token puede
también **emitirlo**. Es decir, el propio producto podría fabricar tokens «de
MasterAdmin» y la auditoría dejaría de significar nada.

`platform.m2m_algorithm` contiene exactamente `RS256` y `ES256`. `none` y HS256
—los dos caminos clásicos para falsificar un JWT— no existen en el modelo.

## 3. Claims

```json
{
  "iss": "masteradmin.ebim",
  "aud": "ewm.ebim",
  "sub": "masteradmin-provisioning",
  "iat": 1789243200,
  "exp": 1789243500,
  "jti": "5f1c…",
  "scope": "provisioning:tenant:create",
  "actor_id": "10000000-0000-4000-a000-000000000002",
  "actor_role": "TECH_LEAD",
  "correlation_id": "9a7b…"
}
```

| Claim | Regla |
| --- | --- |
| `iss` | Configurable; por defecto `masteradmin.ebim` |
| `aud` | **Sin valor por defecto.** Cada producto declara la suya y MasterAdmin no la adivina |
| `sub` | El **sistema**, no la persona. Un CHECK rechaza que parezca un correo |
| `exp − iat` | ≤ 300 s, con techo aplicado en el código además del CHECK |
| `jti` | UUID único por emisión |
| `scope` | Obligatorio. El orquestador se niega a firmar sin alcance |
| `actor_id` | **Auditoría.** Dice quién pidió la operación |
| `actor_role` | **Auditoría.** NO autoriza por sí mismo |
| `correlation_id` | Permite cruzar un incidente entre los logs de ambos lados |

## 4. `actor_id` no es autorización

Esto merece decirse explícitamente al equipo del otro lado: **el SaaS no debe
decidir nada a partir de `actor_id` ni de `actor_role`.** La autorización ya
ocurrió en MasterAdmin, antes de firmar. Esos claims viajan para que el producto
pueda registrar en su propia bitácora quién originó el alta.

Si el SaaS empezara a autorizar por `actor_role`, estaría confiando en un valor
que MasterAdmin controla íntegramente, y dos sistemas tomarían la misma decisión
con criterios distintos.

## 5. Dónde vive la clave privada

En el almacén de secretos del servidor. La base guarda sólo su **nombre**:

```
credential_profiles.secret_ref = 'EWM_QAS_M2M_PRIVATE_KEY'
```

La Edge Function resuelve `Deno.env.get(secret_ref)`. El valor no entra en la
base de datos, ni en el repositorio, ni en el navegador, ni en la bitácora — ni
siquiera el **nombre** entra en `audit_logs` al crear un perfil, porque esa
tabla tiene lectura más amplia.

Formato esperado: **PKCS#8 en PEM**. Un formato incorrecto produce
`PRIVATE_KEY_INVALID`, un código estable, en vez de dejar escapar el mensaje del
runtime (que en algunos casos incluye fragmentos del material de clave).

## 6. Qué tiene que hacer el producto

1. Publicar la clave **pública** correspondiente (o su JWKS).
2. Verificar firma, `iss`, `aud`, `exp` y `jti` (anti-replay).
3. Exigir el `scope` de la operación.
4. Registrar `correlation_id`, `actor_id` y `actor_role` en su bitácora.
5. **No** autorizar a partir de `actor_role`.
6. Honrar `Idempotency-Key`: dos peticiones con la misma clave son **el mismo
   intento**, no dos altas.

## 7. Rotación

1. Cargar la clave nueva con un nombre nuevo (`EWM_QAS_M2M_PRIVATE_KEY_V2`).
2. Publicar la pública nueva en el producto, **junto a la anterior**.
3. Cambiar `secret_ref` en el perfil desde la consola.
4. Verificar la conexión.
5. Retirar la pública antigua del producto.

Como el TTL es ≤ 300 s, cinco minutos después del paso 3 no queda ningún token
vivo firmado con la clave anterior. No hace falta despliegue en ningún paso.

## 8. Configuración desde la consola

Plataforma → Integraciones SaaS → *(integración)* → Seguridad.

Issuer, audience, subject, algoritmo, TTL, scopes y hosts permitidos se editan
ahí. Lo único que no se administra desde la UI es el **valor** del secreto, que
por definición vive fuera.
