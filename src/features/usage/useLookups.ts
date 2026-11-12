import { useMemo } from 'react';
import { useProducts, useTenantOverview } from '@/services/queries';

/**
 * Nombres legibles de producto y tenant para tablas que solo traen ids.
 *
 * Es presentación: se une en el cliente con lo que RLS ya dejó leer. Un id que
 * no aparece (tenant fuera del alcance del usuario) se muestra abreviado, sin
 * inventarle un nombre.
 */
export function useLookups() {
  const products = useProducts();
  const tenants = useTenantOverview();

  return useMemo(() => {
    const productById = new Map<string, { code: string; name: string }>();
    for (const p of products.data ?? []) {
      productById.set(p.id, { code: p.code, name: p.short_name ?? p.code });
    }
    const tenantById = new Map<
      string,
      { name: string; slug: string; productId: string | null; productCode: string | null; tenantType: string | null }
    >();
    for (const t of tenants.data ?? []) {
      if (!t.tenant_id) continue;
      tenantById.set(t.tenant_id, {
        name: t.name ?? t.slug ?? t.tenant_id,
        slug: t.slug ?? '',
        productId: t.saas_product_id ?? null,
        productCode: t.product_code ?? null,
        tenantType: t.tenant_type ?? null,
      });
    }
    const short = (id: string) => `${id.slice(0, 8)}…`;
    return {
      products: products.data ?? [],
      tenants: tenants.data ?? [],
      productById,
      tenantById,
      productName: (id: string | null | undefined) => (id ? (productById.get(id)?.name ?? short(id)) : '—'),
      productCode: (id: string | null | undefined) => (id ? (productById.get(id)?.code ?? null) : null),
      tenantName: (id: string | null | undefined) => (id ? (tenantById.get(id)?.name ?? short(id)) : '—'),
      tenantOptions: (tenants.data ?? [])
        .filter((t) => t.tenant_id)
        .map((t) => ({
          value: t.tenant_id as string,
          label: `${t.name ?? t.slug} · ${t.product_short_name ?? t.product_code ?? ''}`,
        })),
      productOptions: (products.data ?? []).map((p) => ({ value: p.code, label: p.short_name ?? p.code })),
    };
  }, [products.data, tenants.data]);
}

export type Lookups = ReturnType<typeof useLookups>;
