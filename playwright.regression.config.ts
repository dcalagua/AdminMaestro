import { defineConfig } from '@playwright/test';
import base from './playwright.executive.config';

/**
 * Suite E2E HEREDADA ejecutada contra el stack LOCAL dedicado (puerto 5209),
 * para comprobar regresiones de la mejora. Excluye lo que necesita Edge
 * Functions servidas (orquestador, golden GENERIC por HTTP, payment-setup) y la
 * certificación QAS opt-in: esos contratos se cubren por Vitest/pgTAP y por el
 * hash de los archivos protegidos.
 */
export default defineConfig({
  ...base,
  testDir: './e2e',
  testIgnore: [
    'executive/**',
    'v4-generic-orchestrator-golden.spec.ts',
    'v4-provisioning-orchestrator.spec.ts',
    'v4-ewm-qas-certification.spec.ts',
    'v3-2-payment-setup.spec.ts',
  ],
  outputDir: './test-results/regression',
});
