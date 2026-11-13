import { describe, expect, it } from 'vitest';
import { AUTH_TEMPLATES, buildAuthEmails, ttlText, verifyLink, type AuthHookPayload } from './auth-hook';
import { placeholdersOf, templateByKey } from './catalog';

const ctx = {
  supabaseUrl: 'https://ref.supabase.co/',
  appUrl: 'https://adminmaestro.pages.dev',
  webhookId: 'msg_2a',
  linkTtlMinutes: 60,
};

function payload(type: string, extra: Partial<AuthHookPayload['email_data']> = {}, user: Partial<AuthHookPayload['user']> = {}): AuthHookPayload {
  return {
    user: { id: 'u1', email: 'ana@ebim.pe', user_metadata: { full_name: 'Ana Torres' }, ...user },
    email_data: {
      token: '123456',
      token_hash: 'hash-actual',
      token_new: '654321',
      token_hash_new: 'hash-nuevo',
      redirect_to: 'https://adminmaestro.pages.dev/bienvenida',
      site_url: 'https://adminmaestro.pages.dev',
      email_action_type: type,
      ...extra,
    },
  };
}

describe('enlace de verificación', () => {
  it('se arma como {{ .ConfirmationURL }} de Supabase (token_hash, tipo, redirect)', () => {
    const url = new URL(verifyLink(ctx, 'abc', 'invite', 'https://adminmaestro.pages.dev/bienvenida'));
    expect(url.origin + url.pathname).toBe('https://ref.supabase.co/auth/v1/verify');
    expect(url.searchParams.get('token')).toBe('abc');
    expect(url.searchParams.get('type')).toBe('invite');
    expect(url.searchParams.get('redirect_to')).toBe('https://adminmaestro.pages.dev/bienvenida');
  });
  it('sin redirect válido vuelve a la consola', () => {
    expect(new URL(verifyLink(ctx, 'abc', 'recovery', 'javascript:alert(1)')).searchParams.get('redirect_to')).toBe(ctx.appUrl);
  });
  it('validez en palabras', () => {
    expect(ttlText(60)).toBe('1 hora');
    expect(ttlText(1440)).toBe('24 horas');
    expect(ttlText(15)).toBe('15 minutos');
  });
});

describe('buildAuthEmails', () => {
  it.each(['invite', 'recovery', 'magiclink', 'signup'])('%s → una plantilla con enlace y sin código', (type) => {
    const plan = buildAuthEmails(payload(type), ctx);
    expect(plan.kind).toBe('send');
    if (plan.kind !== 'send') return;
    expect(plan.emails).toHaveLength(1);
    const [mail] = plan.emails;
    expect(mail.to).toBe('ana@ebim.pe');
    expect(mail.templateKey).toBe(AUTH_TEMPLATES[type as keyof typeof AUTH_TEMPLATES]);
    expect(mail.variables.enlace).toContain('token=hash-actual');
    expect(mail.variables).not.toHaveProperty('codigo');
    expect(mail.variables.nombre).toBe('Ana Torres');
    expect(mail.idempotencyKey).toBe(`masteradmin-auth-msg_2a-${type}`);
    // Lo que se guarda no lleva el enlace.
    expect(mail.loggedVariables).not.toHaveProperty('enlace');
  });

  it('cambio de correo seguro: dos correos con los hashes CRUZADOS', () => {
    const plan = buildAuthEmails(payload('email_change', {}, { new_email: 'ana@grupoebim.com' }), ctx);
    if (plan.kind !== 'send') throw new Error('esperaba envío');
    const [actual, nuevo] = plan.emails;
    expect(actual.to).toBe('ana@ebim.pe');
    expect(actual.variables.enlace).toContain('token=hash-nuevo');
    expect(nuevo.to).toBe('ana@grupoebim.com');
    expect(nuevo.variables.enlace).toContain('token=hash-actual');
    expect(actual.idempotencyKey).not.toBe(nuevo.idempotencyKey);
  });

  it('cambio de correo sin «secure change»: un solo correo a la dirección nueva', () => {
    const plan = buildAuthEmails(payload('email_change', { token_hash_new: '' }, { new_email: 'ana@grupoebim.com' }), ctx);
    if (plan.kind !== 'send') throw new Error('esperaba envío');
    expect(plan.emails.map((m) => m.to)).toEqual(['ana@grupoebim.com']);
  });

  it('reautenticación: código, sin enlace; el código no se guarda', () => {
    const plan = buildAuthEmails(payload('reauthentication'), ctx);
    if (plan.kind !== 'send') throw new Error('esperaba envío');
    expect(plan.emails[0].variables.codigo).toBe('123456');
    expect(plan.emails[0].loggedVariables).not.toHaveProperty('codigo');
  });

  it('avisos y tipos sin plantilla se aceptan sin enviar', () => {
    expect(buildAuthEmails(payload('password_changed_notification'), ctx).kind).toBe('skip');
    expect(buildAuthEmails(payload('invite', { token_hash: '' }), ctx).kind).toBe('skip');
  });

  it('sin nombre, el saludo usa el correo', () => {
    const plan = buildAuthEmails(payload('invite', {}, { user_metadata: {} }), ctx);
    if (plan.kind !== 'send') throw new Error('esperaba envío');
    expect(plan.emails[0].variables.nombre).toBe('ana@ebim.pe');
  });

  it('cada correo de acceso trae TODAS las variables que su plantilla usa', () => {
    const cases: Array<[string, Partial<AuthHookPayload['user']>]> = [
      ['invite', {}], ['recovery', {}], ['magiclink', {}], ['signup', {}], ['reauthentication', {}],
      ['email_change', { new_email: 'ana@grupoebim.com' }],
    ];
    for (const [type, user] of cases) {
      const plan = buildAuthEmails(payload(type, {}, user), ctx);
      if (plan.kind !== 'send') throw new Error(type);
      for (const mail of plan.emails) {
        const tpl = templateByKey(mail.templateKey);
        expect(tpl, mail.templateKey).toBeDefined();
        for (const name of placeholdersOf(tpl!)) expect(mail.variables, `${type}:${name}`).toHaveProperty(name);
      }
    }
  });
});
