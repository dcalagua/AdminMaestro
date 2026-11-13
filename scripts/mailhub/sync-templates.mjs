#!/usr/bin/env node
/**
 * Publica las plantillas `masteradmin-*` en EBIM MailHub a partir del catálogo
 * `supabase/functions/_shared/mail/catalog.ts`. Idempotente:
 *
 *   · plantilla inexistente en la app → se crea en TODAS las aplicaciones
 *     `masteradmin` (qas y prd) y se publica la versión 1;
 *   · plantilla con contenido distinto → nueva versión (borrador), se edita y
 *     se publica (la anterior queda archivada en el historial de MailHub);
 *   · sin cambios → no hace nada.
 *
 * El HTML y el texto los genera el MISMO renderizador del editor visual de
 * MailHub (`apps/web/src/lib/emailDesign.ts`) y se guarda el `design`: cada
 * plantilla se puede seguir editando por bloques en el panel.
 *
 * Uso (Node 24, con un JWT de un administrador de MailHub; nunca se imprime):
 *   MAILHUB_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1 \
 *   MAILHUB_ADMIN_JWT=… MAILHUB_REPO=../ebim-mail \
 *   node scripts/mailhub/sync-templates.mjs [--dry-run]
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FN = (process.env.MAILHUB_FUNCTIONS_URL ?? '').replace(/\/+$/, '');
const JWT = process.env.MAILHUB_ADMIN_JWT ?? '';
const SLUG = process.env.MAILHUB_APP_SLUG ?? 'masteradmin';
const REPO = resolve(process.env.MAILHUB_REPO ?? resolve(import.meta.dirname, '../../../ebim-mail'));
const DRY = process.argv.includes('--dry-run');

if (!FN.startsWith('https://') || !JWT) {
  console.error('Faltan MAILHUB_FUNCTIONS_URL (https) o MAILHUB_ADMIN_JWT');
  process.exit(2);
}

const { TEMPLATES, BRAND } = await import(pathToFileURL(resolve(import.meta.dirname, '../../supabase/functions/_shared/mail/catalog.ts')).href);
const { renderDesign, designToText } = await import(pathToFileURL(resolve(REPO, 'apps/web/src/lib/emailDesign.ts')).href);

async function api(method, path, body) {
  const res = await fetch(`${FN}/mailhub-admin${path}`, {
    method,
    headers: { authorization: `Bearer ${JWT}`, 'content-type': 'application/json', 'x-region': 'us-east-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new Error(`${method} ${path} → ${res.status} ${err.code ?? ''} ${err.message ?? ''} ${JSON.stringify(err.details ?? '')}`);
  }
  return json;
}

function designOf(t) {
  return {
    kind: 'mailhub-blocks',
    version: 1,
    brand: { headerText: BRAND.headerText, logoUrl: '', color: BRAND.color, footerText: BRAND.footerText },
    blocks: t.blocks.map((b, i) => ({
      id: `${t.key.replace('masteradmin-', 'ma-')}-${i + 1}`,
      ...(['heading', 'text', 'button'].includes(b.type) ? { align: 'left' } : {}),
      ...b,
    })),
  };
}

function versionOf(t) {
  const design = designOf(t);
  return {
    subject: t.subject,
    html: renderDesign(design),
    textBody: designToText(design),
    variables: t.variables.map((v) => ({ name: v.name, required: v.required, description: v.description })),
    sampleData: t.sample,
    design,
  };
}

// jsonb reordena las claves: se compara en forma canónica (claves ordenadas).
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v ?? null;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const apps = (await api('GET', `/applications?search=${encodeURIComponent(SLUG)}`)).data.filter((a) => a.slug === SLUG);
if (!apps.length) {
  console.error(`No existe la aplicación «${SLUG}» en MailHub`);
  process.exit(3);
}
console.log(`Aplicaciones: ${apps.map((a) => `${a.slug}/${a.environment}`).join(', ')}`);

const summary = { created: 0, updated: 0, unchanged: 0 };
for (const t of TEMPLATES) {
  const v = versionOf(t);
  // Validación previa con el motor de MailHub (escapa variables y avisa de las no declaradas).
  const preview = (await api('POST', '/templates/preview', { subject: v.subject, html: v.html, textBody: v.textBody, variables: v.variables, data: t.sample })).data;
  if (preview.undeclared?.length || preview.missing?.length) {
    throw new Error(`${t.key}: variables no declaradas ${preview.undeclared} / faltantes en la muestra ${preview.missing}`);
  }

  const missingApps = [];
  for (const app of apps) {
    const list = (await api('GET', `/templates?applicationId=${app.id}`)).data;
    const found = list.find((x) => x.key === t.key && x.application_id === app.id);
    if (!found) {
      missingApps.push(app.id);
      continue;
    }
    const detail = (await api('GET', `/templates/${found.id}`)).data;
    const published = detail.versions.find((x) => x.status === 'published');
    const current = published && {
      subject: published.subject,
      html: published.html,
      textBody: published.text_body,
      variables: published.variables,
      sampleData: published.sample_data,
      design: published.design,
    };
    if (current && same(current, v) && detail.name === t.name) {
      summary.unchanged += 1;
      continue;
    }
    console.log(`${DRY ? '[dry-run] ' : ''}actualizar ${t.key} en ${app.environment}`);
    if (DRY) continue;
    if (detail.name !== t.name || detail.description !== t.description) {
      await api('PATCH', `/templates/${found.id}`, { name: t.name, description: t.description });
    }
    let draft = detail.versions.find((x) => x.status === 'draft');
    if (!draft) {
      const after = (await api('POST', `/templates/${found.id}/versions`, {})).data;
      draft = after.versions.find((x) => x.status === 'draft');
    }
    await api('PATCH', `/template-versions/${draft.id}`, v);
    await api('POST', `/template-versions/${draft.id}/publish`, {});
    summary.updated += 1;
  }
  if (missingApps.length) {
    console.log(`${DRY ? '[dry-run] ' : ''}crear ${t.key} (${missingApps.length} ambiente/s)`);
    if (!DRY) {
      await api('POST', '/templates', {
        key: t.key,
        name: t.name,
        description: t.description,
        applicationId: missingApps[0],
        applicationIds: missingApps,
        version: v,
        publish: true,
      });
    }
    summary.created += missingApps.length;
  }
}
console.log(JSON.stringify(summary));
