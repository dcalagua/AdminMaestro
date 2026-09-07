#!/usr/bin/env node
/**
 * Escáner de secretos del repositorio.
 *
 * Revisa los archivos versionados (git ls-files) buscando credenciales reales.
 * No es un sustituto de un secret scanner de CI, pero cierra el agujero más
 * común: pegar una clave en un archivo "temporal" que termina commiteado.
 *
 * También verifica el bundle compilado: `dist/` no puede contener la clave de
 * servicio ni ningún JWT con rol de servicio, aunque el código fuente esté
 * limpio (un `import.meta.env` mal nombrado la filtraría).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  { name: 'JWT con rol de servicio', re: /"role"\s*:\s*"service_role"/ },
  { name: 'Clave secreta de Supabase (sb_secret_)', re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'Supabase PAT (sbp_)', re: /\bsbp_[a-f0-9]{40,}/ },
  { name: 'Cadena de conexión PostgreSQL con contraseña', re: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]{3,}@/ },
  { name: 'Clave privada PEM', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Token de bot de Slack', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'Clave de API de Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Clave de API de OpenAI/Anthropic', re: /\b(?:sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]{24,}/ },
  { name: 'Client secret de Microsoft Graph', re: /MS_CLIENT_SECRET\s*=\s*["']?[A-Za-z0-9~._-]{20,}/ },

  // --- Proveedor de pago (Fases 09-10) ---
  // La clave SECRETA de Culqi jamás puede estar en el repo: vive en secrets del
  // servidor. La PÚBLICA (pk_) sí puede, y por eso no se busca.
  { name: 'Clave secreta de Culqi (sk_test_/sk_live_)', re: /\bsk_(?:test|live)_[A-Za-z0-9]{10,}/ },
  { name: 'Token de tarjeta de Culqi (tkn_)', re: /\btkn_(?:test|live)_[A-Za-z0-9]{10,}/ },
  // Un PAN de 13-19 dígitos con la estructura de una tarjeta. Se exigen
  // separadores o límites de palabra para no marcar cualquier número largo.
  { name: 'Posible PAN de tarjeta', re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/ },
  { name: 'CVV junto a datos de tarjeta', re: /["']?cvv["']?\s*[:=]\s*["']?[0-9]{3,4}["']?/i },
];

/** Archivos donde un placeholder es legítimo y no debe disparar el escáner. */
const ALLOWLIST = [/^\.env\.example$/, /^scripts\/secrets-scan\.mjs$/, /^docs\/.*\.md$/];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|eot|mp4|mov)$/i;

function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !BINARY_EXT.test(f));
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (!BINARY_EXT.test(full)) out.push(full);
  }
  return out;
}

const findings = [];

function scan(files, origin) {
  for (const file of files) {
    if (ALLOWLIST.some((re) => re.test(file))) continue;
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { name, re } of PATTERNS) {
      const match = content.match(re);
      if (match) {
        const line = content.slice(0, match.index).split('\n').length;
        findings.push({ file, line, name, origin });
      }
    }
  }
}

scan(trackedFiles(), 'repositorio');
scan(walk('dist'), 'bundle compilado');

// Comprobación estructural: ninguna variable de servidor puede llevar prefijo
// VITE_, porque ese prefijo es exactamente lo que la mete en el bundle.
if (existsSync('.env.example')) {
  const example = readFileSync('.env.example', 'utf8');
  for (const line of example.split('\n')) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.+)$/);
    if (m && /service|secret|token|password|_pat\b/i.test(m[1])) {
      findings.push({
        file: '.env.example',
        line: 0,
        name: `Variable de servidor expuesta al cliente: ${m[1]}`,
        origin: 'configuración',
      });
    }
  }
}

if (findings.length === 0) {
  console.log('SECRETS_SCAN: PASS — sin credenciales detectadas en el repositorio ni en el bundle.');
  process.exit(0);
}

console.error('SECRETS_SCAN: FAIL');
for (const f of findings) {
  console.error(`  [${f.origin}] ${f.file}:${f.line} — ${f.name}`);
}
process.exit(1);
