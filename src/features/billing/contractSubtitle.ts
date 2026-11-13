/**
 * Subtítulo del contrato sin nombres repetidos (V6 · 3.4): «eSupplier by EBIM ·
 * Empresa Directa Alpha · Empresa Directa Alpha · eSupplier» → «eSupplier by EBIM
 * · Empresa Directa Alpha». Un tramo que ya está dicho (o que es el nombre corto
 * de la app, dentro del nombre con marca) no se repite.
 */
export function contractSubtitle(parts: {
  lockup?: string | null;
  shortName?: string | null;
  organization?: string | null;
  tenant?: string | null;
}): string {
  const out: string[] = [];
  const said = (piece: string) =>
    out.some((p) => p.toLowerCase() === piece.toLowerCase()) ||
    (parts.shortName && piece.toLowerCase() === parts.shortName.toLowerCase() && out.some((p) => p.toLowerCase().includes(piece.toLowerCase())));
  const push = (value: string | null | undefined) => {
    for (const piece of (value ?? '').split(' · ').map((x) => x.trim()).filter(Boolean)) {
      if (!said(piece)) out.push(piece);
    }
  };
  push(parts.lockup ?? parts.shortName);
  push(parts.organization);
  if (parts.tenant) push(parts.tenant);
  else out.push('nivel partner');
  return out.join(' · ');
}
