import { describe, expect, it, vi } from 'vitest';
import {
  BAN_DURATION, grantRpc, handleUserAdmin, parseGrant, rpcFailure, type UserAdminDeps,
} from './admin.ts';

/**
 * M5 · `user-admin` con dependencias inyectadas: la base autoriza ANTES de tocar
 * Auth, el correo cae al enlace copiable cuando no hay SMTP, el acceso se aplica
 * con la RPC que corresponde, y ban/unban siguen a deactivate/reactivate.
 */

const ANDINA = '30000000-0000-4000-a000-000000000002';
const TENANT = '50000000-0000-4000-a000-000000000001';
const NEW_USER = '10000000-0000-4000-a000-0000000000a1';
const LINK = 'http://127.0.0.1:54721/auth/v1/verify?type=invite&redirect_to=x';

const orgGrant = { kind: 'ORG_MEMBERSHIP', role: 'PARTNER_SALES', organization_id: ANDINA };

function makeDeps(opts: {
  rpc?: Record<string, { data?: unknown; error?: { message: string } }>;
  invite?: 'ok' | 'fail';
  link?: 'ok' | 'fail';
  existing?: string | null;
  authUser?: { emailConfirmedAt: string | null; lastSignInAt: string | null } | null;
  banError?: boolean;
} = {}) {
  const calls: string[] = [];
  const deps: UserAdminDeps = {
    appUrl: 'https://masteradmin.ebim.test/',
    userRpc: vi.fn(async (fn: string) => {
      calls.push(`rpc:${fn}`);
      const r = opts.rpc?.[fn];
      return { data: r?.data ?? (fn === 'record_user_invitation' ? 'inv-1' : { ok: true }), error: r?.error ?? null };
    }),
    inviteUserByEmail: vi.fn(async () => {
      calls.push('auth:invite');
      return opts.invite === 'fail'
        ? { userId: null, error: { message: 'Error sending invite email', status: 500 } }
        : { userId: NEW_USER, error: null };
    }),
    generateInviteLink: vi.fn(async () => {
      calls.push('auth:link');
      return opts.link === 'fail'
        ? { userId: null, actionLink: null, error: { message: 'boom' } }
        : { userId: NEW_USER, actionLink: LINK, error: null };
    }),
    setBanned: vi.fn(async (_id: string, banned: boolean) => {
      calls.push(`auth:${banned ? 'ban' : 'unban'}`);
      return { error: opts.banError ? { message: 'x' } : null };
    }),
    getAuthUser: vi.fn(async () =>
      opts.authUser === undefined ? { emailConfirmedAt: null, lastSignInAt: null } : opts.authUser),
    findUserIdByEmail: vi.fn(async () => opts.existing ?? null),
  };
  return { deps, calls };
}

const post = (body: unknown) => ({ method: 'POST', bodyText: JSON.stringify(body) });

describe('user-admin · invite', () => {
  it('autoriza en la base, invita por correo con redirect a /bienvenida, aplica el acceso y registra la invitación', async () => {
    const { deps, calls } = makeDeps();
    const res = await handleUserAdmin(
      post({ action: 'invite', email: ' Nuevo@Andina.EBIM.test ', full_name: 'Nora Nueva', grant: orgGrant }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'INVITED', user_id: NEW_USER, delivery: 'EMAIL', grant_applied: true, invitation_id: 'inv-1' });
    expect(res.body).not.toHaveProperty('action_link');
    expect(calls).toEqual([
      'rpc:authorize_user_invitation', 'auth:invite', 'rpc:upsert_organization_membership', 'rpc:record_user_invitation',
    ]);
    expect(deps.inviteUserByEmail).toHaveBeenCalledWith('nuevo@andina.ebim.test', 'https://masteradmin.ebim.test/bienvenida', 'Nora Nueva');
    expect(deps.userRpc).toHaveBeenCalledWith('upsert_organization_membership', expect.objectContaining({
      p_user_id: NEW_USER, p_org_id: ANDINA, p_role: 'PARTNER_SALES',
    }));
    expect(deps.userRpc).toHaveBeenCalledWith('record_user_invitation', expect.objectContaining({
      p_email: 'nuevo@andina.ebim.test', p_user_id: NEW_USER, p_delivery: 'EMAIL',
    }));
  });

  it('sin SMTP (o si el correo falla) genera el enlace de invitación y lo devuelve para copiar', async () => {
    const { deps, calls } = makeDeps({ invite: 'fail' });
    const res = await handleUserAdmin(post({ action: 'invite', email: 'x@ebim.test', grant: orgGrant }), deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ delivery: 'LINK', action_link: LINK });
    expect(calls).toContain('auth:link');
    expect(deps.userRpc).toHaveBeenCalledWith('record_user_invitation', expect.objectContaining({ p_delivery: 'LINK' }));
  });

  it('si la base no autoriza, no se crea ninguna cuenta en Auth', async () => {
    const { deps, calls } = makeDeps({
      rpc: { authorize_user_invitation: { error: { message: 'NO_AUTORIZADO: solo el super admin EBIM concede roles de consola' } } },
    });
    const res = await handleUserAdmin(
      post({ action: 'invite', email: 'x@ebim.test', grant: { kind: 'PLATFORM_ROLE', role: 'EBIM_FINANCE' } }),
      deps,
    );
    expect(res).toEqual({
      status: 403,
      body: { error: 'NO_AUTORIZADO', message: 'solo el super admin EBIM concede roles de consola' },
    });
    expect(calls).toEqual(['rpc:authorize_user_invitation']);
  });

  it('un usuario existente no se reinvita: se le otorga el acceso', async () => {
    const { deps, calls } = makeDeps({ existing: NEW_USER });
    const res = await handleUserAdmin(
      post({ action: 'invite', email: 'x@ebim.test', grant: { kind: 'TENANT_MEMBERSHIP', role: 'TENANT_USER', tenant_id: TENANT } }),
      deps,
    );
    expect(res.body).toEqual({ status: 'EXISTING_USER', user_id: NEW_USER, grant_applied: true });
    expect(calls).toEqual(['rpc:authorize_user_invitation', 'rpc:upsert_tenant_membership']);
  });

  it('si el acceso falla tras crear la cuenta, lo informa sin perder la invitación', async () => {
    const { deps } = makeDeps({
      invite: 'fail',
      rpc: { upsert_organization_membership: { error: { message: 'USUARIO_INACTIVO: el usuario está desactivado' } } },
    });
    const res = await handleUserAdmin(post({ action: 'invite', email: 'x@ebim.test', grant: orgGrant }), deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ grant_applied: false, grant_error: 'USUARIO_INACTIVO', action_link: LINK });
  });

  it('si Auth no puede crear la invitación responde 502 sin enlace', async () => {
    const { deps } = makeDeps({ invite: 'fail', link: 'fail' });
    const res = await handleUserAdmin(post({ action: 'invite', email: 'x@ebim.test', grant: orgGrant }), deps);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('INVITACION_FALLIDA');
    expect(JSON.stringify(res.body)).not.toContain('verify');
  });

  it('valida correo y acceso antes de llamar a la base', async () => {
    const { deps, calls } = makeDeps();
    expect((await handleUserAdmin(post({ action: 'invite', email: 'no-es-correo', grant: orgGrant }), deps)).body.error)
      .toBe('EMAIL_INVALIDO');
    expect((await handleUserAdmin(post({ action: 'invite', email: 'a@b.co', grant: { kind: 'ROOT', role: 'X' } }), deps)).body.error)
      .toBe('ACCESO_INVALIDO');
    expect(calls).toEqual([]);
  });
});

describe('user-admin · resend', () => {
  it('reenvía solo invitaciones pendientes, autorizadas por la base', async () => {
    const { deps, calls } = makeDeps({
      invite: 'fail',
      rpc: { authorize_invitation_resend: { data: { ok: true, email: 'x@ebim.test', full_name: 'X' } } },
    });
    const res = await handleUserAdmin(post({ action: 'resend', user_id: NEW_USER }), deps);
    expect(res.body).toMatchObject({ status: 'RESENT', delivery: 'LINK', action_link: LINK });
    expect(calls).toEqual(['rpc:authorize_invitation_resend', 'auth:invite', 'auth:link', 'rpc:record_invitation_resend']);
  });

  it('una cuenta ya activada no recibe enlace (evita suplantación)', async () => {
    const { deps, calls } = makeDeps({ authUser: { emailConfirmedAt: '2026-10-01T00:00:00Z', lastSignInAt: null } });
    const res = await handleUserAdmin(post({ action: 'resend', user_id: NEW_USER }), deps);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVITACION_YA_ACEPTADA');
    expect(calls).not.toContain('auth:link');
  });
});

describe('user-admin · ban / unban', () => {
  it('ban: primero deactivate_user (la base decide) y después el baneo en Auth', async () => {
    const { deps, calls } = makeDeps({ rpc: { deactivate_user: { data: { org_memberships: 1 } } } });
    const res = await handleUserAdmin(post({ action: 'ban', user_id: NEW_USER, reason: 'salida' }), deps);
    expect(res.body).toMatchObject({ status: 'DEACTIVATED', auth_updated: true, summary: { org_memberships: 1 } });
    expect(calls).toEqual(['rpc:deactivate_user', 'auth:ban']);
    expect(deps.setBanned).toHaveBeenCalledWith(NEW_USER, true);
  });

  it('el último super admin no se banea: la base lo rechaza y Auth no se toca', async () => {
    const { deps, calls } = makeDeps({
      rpc: { deactivate_user: { error: { message: 'ULTIMO_SUPER_ADMIN: no se puede desactivar al último super admin activo' } } },
    });
    const res = await handleUserAdmin(post({ action: 'ban', user_id: NEW_USER, reason: 'x' }), deps);
    expect(res.status).toBe(403);
    expect(calls).toEqual(['rpc:deactivate_user']);
  });

  it('ban exige motivo; unban reactiva y quita el baneo', async () => {
    const { deps, calls } = makeDeps();
    expect((await handleUserAdmin(post({ action: 'ban', user_id: NEW_USER }), deps)).body.error).toBe('MOTIVO_REQUERIDO');
    const res = await handleUserAdmin(post({ action: 'unban', user_id: NEW_USER }), deps);
    expect(res.body).toMatchObject({ status: 'REACTIVATED', auth_updated: true });
    expect(calls).toEqual(['rpc:reactivate_user', 'auth:unban']);
  });

  it('si Auth falla tras desactivar, lo informa (la base ya cortó los accesos)', async () => {
    const { deps } = makeDeps({ banError: true });
    const res = await handleUserAdmin(post({ action: 'ban', user_id: NEW_USER, reason: 'x' }), deps);
    expect(res.body).toMatchObject({ auth_updated: false, auth_error: 'AUTH_NO_ACTUALIZADO' });
  });
});

describe('user-admin · protocolo', () => {
  it('rechaza método, cuerpo y acción inválidos', async () => {
    const { deps } = makeDeps();
    expect((await handleUserAdmin({ method: 'GET', bodyText: '' }, deps)).status).toBe(405);
    expect((await handleUserAdmin({ method: 'POST', bodyText: 'x'.repeat(17 * 1024) }, deps)).status).toBe(413);
    expect((await handleUserAdmin({ method: 'POST', bodyText: '[1]' }, deps)).body.error).toBe('CUERPO_INVALIDO');
    expect((await handleUserAdmin(post({ action: 'drop' }), deps)).body.error).toBe('ACCION_INVALIDA');
  });

  it('parseGrant normaliza y exige destino; grantRpc elige la RPC correcta', () => {
    expect(parseGrant({ kind: 'org_membership', role: 'partner_sales', organization_id: ANDINA }))
      .toEqual({ kind: 'ORG_MEMBERSHIP', role: 'PARTNER_SALES', organization_id: ANDINA });
    expect(parseGrant({ kind: 'ORG_MEMBERSHIP', role: 'ORG_ADMIN' })).toBeNull();
    expect(parseGrant({ kind: 'TENANT_MEMBERSHIP', role: 'TENANT_USER', tenant_id: 'no-uuid' })).toBeNull();
    expect(grantRpc({ kind: 'PLATFORM_ROLE', role: 'EBIM_FINANCE' }, NEW_USER)[0]).toBe('grant_platform_role');
    expect(grantRpc({ kind: 'PROVISIONING_ROLE', role: 'TECH_LEAD' }, NEW_USER)[0]).toBe('grant_provisioning_role');
  });

  it('rpcFailure mapea códigos a HTTP sin filtrar el texto crudo', () => {
    expect(rpcFailure({ message: 'MEMBRESIA_NO_ENCONTRADA: x' }).status).toBe(404);
    expect(rpcFailure({ message: 'ROL_NO_CORRESPONDE_ORGANIZACION: x' }).status).toBe(409);
    expect(rpcFailure({ message: 'connection refused' })).toEqual({
      status: 500, body: { error: 'ERROR_INTERNO', message: 'No se pudo completar la operación.' },
    });
    expect(BAN_DURATION).toBe('876000h');
  });
});
