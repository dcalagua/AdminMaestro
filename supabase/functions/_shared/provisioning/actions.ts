/**
 * Enrutado de acciones del orquestador.
 *
 * Puro y testeable a propósito: el handler HTTP sólo pregunta aquí qué acción
 * es y con qué RPC booleana se autoriza.
 *
 * Una acción ausente o desconocida sigue siendo PROVISION, como antes de que
 * existieran las acciones nuevas (spec §8, fila 11). Endurecerlo es una
 * decisión separada, no un efecto colateral de este cambio.
 */
export type OrchestratorAction = 'PROVISION' | 'CHECK_HEALTH' | 'GET_STATUS' | 'REPLAY_CERTIFICATION';

const ROUTED: readonly OrchestratorAction[] = ['CHECK_HEALTH', 'GET_STATUS', 'REPLAY_CERTIFICATION'];

export function routeAction(raw: unknown): OrchestratorAction {
  return typeof raw === 'string' && (ROUTED as readonly string[]).includes(raw)
    ? (raw as OrchestratorAction)
    : 'PROVISION';
}

export interface PermissionRpc {
  rpc: string;
  arg: string;
  bodyField: 'request_id' | 'deployment_target_id';
}

const PERMISSIONS: Record<OrchestratorAction, PermissionRpc> = {
  PROVISION: { rpc: 'can_execute_saas_provisioning', arg: 'p_request_id', bodyField: 'request_id' },
  CHECK_HEALTH: {
    rpc: 'can_check_deployment_health',
    arg: 'p_deployment_target_id',
    bodyField: 'deployment_target_id',
  },
  GET_STATUS: { rpc: 'can_read_saas_provisioning', arg: 'p_request_id', bodyField: 'request_id' },
  REPLAY_CERTIFICATION: {
    rpc: 'can_certify_saas_provisioning',
    arg: 'p_request_id',
    bodyField: 'request_id',
  },
};

export function permissionRpcFor(action: OrchestratorAction): PermissionRpc {
  return PERMISSIONS[action];
}
