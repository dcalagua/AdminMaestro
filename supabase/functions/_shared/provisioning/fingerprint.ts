/**
 * Huella del cuerpo de creación.
 *
 * `createBodyText` es el ÚNICO sitio que serializa el cuerpo que se envía: el
 * adaptador lo usa para la petición y la certificación de replay para la
 * huella, así que las dos ven exactamente los mismos bytes.
 *
 * La huella es un SHA-256: permite comparar dos cuerpos sin guardar ninguno
 * (el cuerpo lleva datos personales como el correo del administrador).
 */
import type { ContractCodec, ProvisioningContext } from './types.ts';

export function createBodyText(codec: ContractCodec, context: ProvisioningContext): string {
  return JSON.stringify(codec.buildCreateBody(context));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
