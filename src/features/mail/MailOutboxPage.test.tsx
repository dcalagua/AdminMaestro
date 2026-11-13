import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';

/*
 * Gobierno › Correos enviados. La pantalla pinta lo que decide la base (RLS) y
 * llama a las RPC / a mail-dispatch con la intención y nada más.
 */
const outboxHook = vi.fn();
const processMutate = vi.fn();
const resendMutateAsync = vi.fn();
const cancelMutateAsync = vi.fn();
const sendTestMutate = vi.fn();
const saveMutate = vi.fn();
const perms = { isSuperAdmin: true, canReadFinance: true };

vi.mock('./mailApi', () => ({
  useMailOutbox: () => outboxHook(),
  useMailSettings: () => ({ data: { business_mail_enabled: true, ops_recipients: ['ops@ebim.pe'] }, isLoading: false, error: null }),
  useProcessMailNow: () => ({ mutate: processMutate, isPending: false }),
  useResendMail: () => ({ mutateAsync: resendMutateAsync, isPending: false }),
  useCancelMail: () => ({ mutateAsync: cancelMutateAsync, isPending: false }),
  useSendTestMail: () => ({ mutate: sendTestMutate, isPending: false, error: null }),
  useSaveMailSettings: () => ({ mutate: saveMutate, isPending: false }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { email: 'operador@ebim.pe' } }, persona: 'EBIM' }) }));

import { MailOutboxPage } from './MailOutboxPage';

const ok = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() });
const NOW = new Date().toISOString();

function mail(over: Record<string, unknown>) {
  return {
    id: 'm-1', category: 'BUSINESS', event_type: 'PAYMENT_CONFIRMED', template_key: 'masteradmin-pago-confirmado',
    recipient_email: 'finanzas@ebim.pe', recipient_name: null, variables: {}, reference_label: 'INV-202611-0026',
    status: 'DELIVERED', status_detail: null, delivery_mode: 'allowlist', delivered_to: 'finanzas@ebim.pe', attempts: 1,
    resend_count: 0, next_attempt_at: NOW, mailhub_email_id: 'em-1', mailhub_status: 'delivered', last_error_code: null,
    sent_at: NOW, delivered_at: NOW, last_event_at: NOW, created_at: NOW, updated_at: NOW, organization_id: 'org-1',
    organization_name: 'Empresa Directa Alpha', tenant_id: null, tenant_name: null, invoice_id: 'inv-1',
    invoice_number: 'INV-202611-0026', payment_id: 'pay-1', ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <MailOutboxPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  perms.isSuperAdmin = true;
  perms.canReadFinance = true;
  outboxHook.mockReturnValue(
    ok([
      mail({}),
      mail({
        id: 'm-2', event_type: 'INVOICE_ISSUED', template_key: 'masteradmin-factura-emitida', status: 'HELD',
        recipient_email: 'administrador@chm.com.pe', delivered_to: null, mailhub_email_id: null, sent_at: null,
        status_detail: 'Retenido (QAS): chm.com.pe no está en los dominios permitidos', reference_label: 'INV-202611-0040',
      }),
      mail({
        id: 'm-3', event_type: 'TENANT_ACTIVATED', template_key: 'masteradmin-tenant-bienvenida', status: 'FAILED',
        recipient_email: 'jefe@ebim.pe', last_error_code: 'internal_error', status_detail: 'MailHub caído', mailhub_email_id: null,
      }),
      mail({
        id: 'm-4', category: 'AUTH', event_type: 'AUTH_INVITE', template_key: 'masteradmin-acceso-invitacion', status: 'BOUNCED',
        recipient_email: 'nadie@ebim.pe', organization_name: null, reference_label: 'nadie@ebim.pe',
      }),
    ]),
  );
});

describe('MailOutboxPage', () => {
  it('franja V6: entregados, con problemas y retenidos de QAS', () => {
    renderPage();
    const strip = screen.getByRole('region', { name: 'Resumen del correo' });
    expect(within(strip).getByText('Retenidos (QAS)')).toBeInTheDocument();
    expect(within(strip).getByText('Modo de entrega: allowlist')).toBeInTheDocument();
    expect(within(strip).getByText('Con problemas')).toBeInTheDocument();
  });

  it('cada fila con su evento, destinatario y estado tipado', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Correos del Admin Maestro' });
    expect(within(table).getByText('Pago confirmado')).toBeInTheDocument();
    expect(within(table).getByText('Retenido (QAS)')).toBeInTheDocument();
    expect(within(table).getByText('administrador@chm.com.pe')).toBeInTheDocument();
    expect(within(table).getByText('Entregado')).toBeInTheDocument();
  });

  it('las pestañas filtran: «Retenidos» deja solo lo que la salvaguarda de QAS no envió', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retenidos\b/ }));
    const table = screen.getByRole('table', { name: 'Correos del Admin Maestro' });
    expect(within(table).getByText('Factura emitida')).toBeInTheDocument();
    expect(within(table).queryByText('Pago confirmado')).not.toBeInTheDocument();
  });

  it('reenviar exige motivo y llama a mail_retry; un acceso rebotado no se reenvía desde aquí', async () => {
    resendMutateAsync.mockResolvedValue({ status: 'PENDING' });
    renderPage();
    const table = screen.getByRole('table', { name: 'Correos del Admin Maestro' });
    const buttons = within(table).getAllByRole('button', { name: 'Reenviar' });
    expect(buttons).toHaveLength(1); // m-3 (fallido); m-4 es de acceso
    await userEvent.click(buttons[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'MailHub caído');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reenviar' }));
    expect(resendMutateAsync).toHaveBeenCalledWith({ id: 'm-3', reason: 'MailHub caído' });
  });

  it('un retenido se puede cancelar', async () => {
    cancelMutateAsync.mockResolvedValue({ status: 'CANCELLED' });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Cliente de prueba');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar correo' }));
    expect(cancelMutateAsync).toHaveBeenCalledWith({ id: 'm-2', reason: 'Cliente de prueba' });
  });

  it('«Procesar ahora» dispara mail-dispatch', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Procesar ahora' }));
    expect(processMutate).toHaveBeenCalled();
  });

  it('la prueba de plantilla va al correo propio de EBIM', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Enviar a/)).toHaveValue('operador@ebim.pe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar prueba' }));
    expect(sendTestMutate).toHaveBeenCalledWith(
      { templateKey: 'masteradmin-acceso-invitacion', to: 'operador@ebim.pe' },
      expect.anything(),
    );
  });

  it('sin super admin ni finanzas: sin acciones ni prueba; la configuración es de solo lectura', () => {
    perms.isSuperAdmin = false;
    perms.canReadFinance = false;
    renderPage();
    expect(screen.queryByRole('button', { name: 'Reenviar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar prueba' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Resumen para operaciones')).toBeDisabled();
  });

  it('vacío: una línea, sin buscador', () => {
    outboxHook.mockReturnValue(ok([]));
    renderPage();
    expect(screen.getByText('Todavía no se envió ningún correo')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
