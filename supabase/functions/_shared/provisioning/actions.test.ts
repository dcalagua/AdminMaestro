import { describe, it, expect } from 'vitest';
import { buildExecutionContext, permissionRpcFor, routeAction } from './actions';

/*
 * Enrutado de acciones del orquestador.
 *
 * Lo que más importa aquí es lo que NO cambia: una acción ausente o desconocida
 * sigue ejecutando PROVISION, exactamente como antes de las acciones nuevas
 * (spec §8, fila 11). Endurecerlo es una decisión aparte.
 */

describe('routeAction', () => {
  it.each([
    [undefined, 'PROVISION'],
    ['PROVISION', 'PROVISION'],
    ['CHECK_HEALTH', 'CHECK_HEALTH'],
    ['GET_STATUS', 'GET_STATUS'],
    ['REPLAY_CERTIFICATION', 'REPLAY_CERTIFICATION'],
  ])('%s → %s', (raw, expected) => {
    expect(routeAction(raw)).toBe(expected);
  });

  it('una acción desconocida sigue yendo a PROVISION (preservación)', () => {
    expect(routeAction('NO_EXISTE')).toBe('PROVISION');
    expect(routeAction(42)).toBe('PROVISION');
    expect(routeAction(null)).toBe('PROVISION');
    expect(routeAction('get_status')).toBe('PROVISION');
  });
});

describe('permissionRpcFor', () => {
  it('PROVISION y CHECK_HEALTH conservan su RPC de siempre', () => {
    expect(permissionRpcFor('PROVISION')).toEqual({
      rpc: 'can_execute_saas_provisioning',
      arg: 'p_request_id',
      bodyField: 'request_id',
    });
    expect(permissionRpcFor('CHECK_HEALTH')).toEqual({
      rpc: 'can_check_deployment_health',
      arg: 'p_deployment_target_id',
      bodyField: 'deployment_target_id',
    });
  });

  it('las acciones nuevas tienen su propia RPC booleana', () => {
    expect(permissionRpcFor('GET_STATUS')).toEqual({
      rpc: 'can_read_saas_provisioning',
      arg: 'p_request_id',
      bodyField: 'request_id',
    });
    expect(permissionRpcFor('REPLAY_CERTIFICATION')).toEqual({
      rpc: 'can_certify_saas_provisioning',
      arg: 'p_request_id',
      bodyField: 'request_id',
    });
  });
});

describe('buildExecutionContext', () => {
  it('el contexto sale SÓLO de la base: el cuerpo HTTP no puede aportar source/adapter', () => {
    const fromDb = {
      request: { id: 'r1' },
      source: { tenant: { id: 't-db' } },
      adapter: { key: 'GENERIC', capabilities: ['PROVISION'] },
    } as unknown as Parameters<typeof buildExecutionContext>[0];
    const context = buildExecutionContext(fromDb, { id: 'u1', role: 'TECH_LEAD' });
    expect(context.source).toBe(fromDb.source);
    expect(context.adapter).toBe(fromDb.adapter);
    expect(context.actor).toEqual({ id: 'u1', role: 'TECH_LEAD' });
    // La firma no acepta el cuerpo de la petición: no hay forma de mezclarlo.
    expect(buildExecutionContext.length).toBe(2);
  });
});
