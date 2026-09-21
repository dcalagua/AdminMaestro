/**
 * Superficie pública del módulo de provisioning.
 *
 * Todo lo que hay debajo es agnóstico del producto: ni un solo módulo conoce
 * EWM, eSupplier, TMS ni su tecnología. El comportamiento por producto vive en
 * `platform.product_integrations`, que es configuración administrable desde la
 * consola.
 */
export * from './types.ts';
export * from './url-guard.ts';
export * from './m2m.ts';
export * from './retry.ts';
export * from './errors.ts';
export * from './response.ts';
export * from './registry.ts';
export * from './cors.ts';
export { HttpM2mAdapter } from './adapters/http-m2m.ts';
export { ManualAdapter } from './adapters/manual.ts';
export { MockAdapter } from './adapters/mock.ts';
