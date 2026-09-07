/**
 * Edge Function: reconciliación proveedor ↔ local.
 *
 * Compara los cargos que el proveedor dice haber cobrado con los `payments` que
 * tenemos registrados, en un rango de fechas.
 *
 * DIAGNOSTICA, NO CORRIGE. No inserta pagos, no cierra facturas, no ajusta
 * importes. Un ajuste contable automático a partir de una comparación es
 * exactamente cómo se pierde la trazabilidad de un cierre: el número cuadra y
 * nadie sabe por qué. Lo que devuelve alimenta la pantalla de Reconciliación,
 * donde una persona decide.
 *
 * La única excepción deliberada: un cargo del proveedor que no existe localmente
 * PUEDE registrarse llamando explícitamente con `apply_missing = true`, y aun
 * entonces pasa por `register_provider_payment()`, con su idempotencia y su
 * auditoría.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  json, resolvePaymentProvider, toAccountConfig, ProviderError,
  type ChargeSummary,
} from '../_shared/payments/index.ts';

interface ReconcileBody {
  account_code?: string;
  from?: string;
  to?: string;
  /** Registrar los cargos del proveedor que falten en local. Por defecto NO. */
  apply_missing?: boolean;
}

interface Finding {
  status: 'OK' | 'REVIEW' | 'ERROR';
  kind:
    | 'MISSING_LOCAL' | 'MISSING_PROVIDER' | 'AMOUNT_MISMATCH'
    | 'STATUS_DRIFT' | 'REJECTED_EVENTS' | 'OK';
  detail: string;
  externalChargeId?: string | null;
  subscriptionCode?: string | null;
  amount?: number | null;
  currency?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA' }, 500);
  }

  // La reconciliación es información financiera: exige sesión y rol.
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'NO_AUTENTICADO' }, 401);
  }

  const asUser = createClient(supabaseUrl, anonKey, {
    db: { schema: 'platform' },
    global: { headers: { authorization: authHeader } },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'NO_AUTENTICADO' }, 401);

  // RLS decide: si no puede leer los eventos del proveedor, no es finanzas.
  const { error: probeError } = await asUser
    .from('provider_webhook_events')
    .select('id')
    .limit(1);
  if (probeError) {
    return json({ error: 'NO_AUTORIZADO: la reconciliación exige rol financiero' }, 403);
  }

  let body: ReconcileBody = {};
  try {
    body = (await req.json()) as ReconcileBody;
  } catch {
    body = {};
  }

  const to = body.to ?? new Date().toISOString();
  const from = body.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const accountCode = body.account_code ?? 'culqi-pe-test';

  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });

  const { data: accountRow } = await admin
    .from('payment_provider_accounts')
    .select('*')
    .eq('code', accountCode)
    .maybeSingle();

  if (!accountRow) return json({ error: 'CUENTA_PROVEEDOR_NO_ENCONTRADA' }, 404);

  const account = toAccountConfig(accountRow);

  let provider;
  try {
    provider = resolvePaymentProvider(account);
  } catch (error) {
    if (error instanceof ProviderError) {
      return json({ error: error.code, message: error.message }, error.httpStatus);
    }
    return json({ error: 'PROVEEDOR_NO_DISPONIBLE' }, 500);
  }

  const findings: Finding[] = [];

  // ---- 1. Cargos del proveedor vs. pagos locales ---------------------------
  let providerCharges: ChargeSummary[] = [];
  try {
    providerCharges = await provider.listCharges(from, to);
  } catch (error) {
    findings.push({
      status: 'ERROR',
      kind: 'MISSING_PROVIDER',
      detail:
        error instanceof ProviderError
          ? `No se pudo listar cargos del proveedor: ${error.message}`
          : 'No se pudo listar cargos del proveedor',
    });
  }

  const { data: localPayments } = await admin
    .from('payments')
    .select('id, reference, amount, currency, status, paid_at')
    .gte('paid_at', from)
    .lte('paid_at', to)
    .like('reference', 'culqi:%');

  const localByRef = new Map(
    (localPayments ?? []).map((p) => [String(p.reference), p]),
  );

  for (const charge of providerCharges) {
    const ref = `culqi:${charge.externalChargeId}`;
    const local = localByRef.get(ref);

    if (!local) {
      findings.push({
        status: 'REVIEW',
        kind: 'MISSING_LOCAL',
        detail: 'El proveedor registra un cargo que no existe en el Control Plane',
        externalChargeId: charge.externalChargeId,
        amount: charge.amount,
        currency: charge.currency,
      });

      if (body.apply_missing && charge.status === 'CONFIRMED' && charge.externalSubscriptionId) {
        // Incluso aquí se pasa por la RPC: idempotente y auditada.
        await admin.rpc('register_provider_payment', {
          p_provider_account_id: account.id,
          p_external_event_key: `reconcile:${charge.externalChargeId}`,
          p_event_type: 'reconciliation',
          p_external_charge_id: charge.externalChargeId,
          p_external_subscription_id: charge.externalSubscriptionId,
          p_amount: charge.amount,
          p_currency: charge.currency,
          p_paid_at: charge.paidAt,
          p_payload: { origin: 'payment-reconcile' },
        });
      }
      continue;
    }

    localByRef.delete(ref);

    if (Math.abs(Number(local.amount) - charge.amount) > 0.005 || local.currency !== charge.currency) {
      findings.push({
        status: 'ERROR',
        kind: 'AMOUNT_MISMATCH',
        detail: `Local ${local.amount} ${local.currency} vs proveedor ${charge.amount} ${charge.currency}`,
        externalChargeId: charge.externalChargeId,
      });
    }
  }

  // Lo que queda en el mapa es local sin contraparte en el proveedor.
  for (const [ref, local] of localByRef) {
    findings.push({
      status: 'REVIEW',
      kind: 'MISSING_PROVIDER',
      detail: 'Hay un pago local marcado como Culqi que el proveedor no reporta en el periodo',
      externalChargeId: ref.replace('culqi:', ''),
      amount: Number(local.amount),
      currency: String(local.currency),
    });
  }

  // ---- 2. Deriva de estado entre suscripción local y del proveedor ---------
  const { data: drift } = await admin
    .from('v_provider_reconciliation')
    .select('*')
    .neq('reconciliation_status', 'OK');

  for (const row of drift ?? []) {
    findings.push({
      status: row.reconciliation_status === 'ERROR' ? 'ERROR' : 'REVIEW',
      kind: row.last_error_code ? 'REJECTED_EVENTS' : 'STATUS_DRIFT',
      detail:
        row.last_error_message ??
        `Local ${row.local_status} vs proveedor ${row.provider_status}`,
      subscriptionCode: row.subscription_code,
    });
  }

  // ---- 3. Eventos rechazados: siempre merecen una mirada -------------------
  const { count: rejected } = await admin
    .from('provider_webhook_events')
    .select('id', { count: 'exact', head: true })
    .eq('provider_account_id', account.id)
    .eq('status', 'REJECTED')
    .gte('received_at', from);

  if ((rejected ?? 0) > 0) {
    findings.push({
      status: 'ERROR',
      kind: 'REJECTED_EVENTS',
      detail: `${rejected} evento(s) de webhook rechazados en el periodo`,
    });
  }

  if (findings.length === 0) {
    findings.push({ status: 'OK', kind: 'OK', detail: 'Proveedor y Control Plane cuadran' });
  }

  const overall = findings.some((f) => f.status === 'ERROR')
    ? 'ERROR'
    : findings.some((f) => f.status === 'REVIEW')
      ? 'REVIEW'
      : 'OK';

  return json({
    account: account.code,
    mode: provider.mode,
    period: { from, to },
    // En MOCK el proveedor no devuelve cargos: el resultado no es una garantía
    // de que todo cuadre, y decirlo aquí evita leerlo como tal.
    simulated: provider.mode === 'MOCK',
    overall,
    applied_missing: Boolean(body.apply_missing),
    findings,
  });
});
