import { useCallback, useEffect, useState } from 'react';
import {
  callPortal,
  readLinkToken,
  type PortalInvoice,
  type PortalReceipt,
  type PortalStatement,
} from './portalApi';
import { openCulqiCheckout } from './culqiCheckout';
import { PortalShell, LinkProblem, PortalSkeleton } from './PortalLayout';
import { MockCardDialog } from './MockCardDialog';
import { Statement } from './PortalStatement';
import { type TokenRequest, type Phase } from './portalModel';

/**
 * Portal de pago PÚBLICO (`/pagar#<token>`) — spec §2.4 y §3.1.
 *
 * Fuera de RequireAuth/AppShell: quien paga no tiene cuenta en MasterAdmin. El
 * token del enlace se lee del fragmento `#` y se manda en el cuerpo a la Edge
 * Function `pay-portal`; la página nunca habla con PostgREST.
 *
 * Lo que la página NO muestra nunca: ids internos (factura, cuenta, enlace),
 * códigos técnicos ni el id completo del cargo. Los mensajes de error son los
 * que devuelve el portal, ya escritos para el cliente; el código solo elige
 * el icono y el título de la tarjeta de error.
 *
 * Diseño (fase 07, PT-PUBLIC): cabecera de marca, estado de cuenta con el
 * total pendiente destacado, facturas como tarjetas, pago automático con la
 * explicación de confianza y comprobante con check animado. Los clientes
 * pagan desde el celular: todo se apila en una columna bajo `sm`.
 */

export function PaymentPortalPage() {
  const [token] = useState(() => readLinkToken());
  const [phase, setPhase] = useState<Phase>(() =>
    token
      ? { kind: 'loading' }
      : {
          kind: 'error',
          code: 'ENLACE_INVALIDO',
          message: 'Este enlace de pago no es válido. Pide uno nuevo a tu contacto en EBIM.',
        },
  );
  const [busyInvoice, setBusyInvoice] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [receipt, setReceipt] = useState<(PortalReceipt & { simulated: boolean }) | null>(null);
  const [tokenRequest, setTokenRequest] = useState<TokenRequest | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await callPortal<PortalStatement>('statement', { token });
    setPhase(res.ok ? { kind: 'ready', statement: res.data } : { kind: 'error', code: res.error, message: res.message });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Pide un token de tarjeta según el modo de la cuenta. */
  const requestCardToken = useCallback(
    async (req: Omit<TokenRequest, 'resolve' | 'reject'>): Promise<string | null> => {
      if (req.checkout.mode !== 'MOCK') {
        if (!req.checkout.public_key) return null;
        const res = await openCulqiCheckout({
          publicKey: req.checkout.public_key,
          title: req.title,
          description: req.description,
          currency: req.currency,
          amountMinor: req.amountMinor,
        });
        return res.token;
      }
      return new Promise<string | null>((resolve, reject) =>
        setTokenRequest({
          ...req,
          resolve: (t) => resolve(t),
          reject: (m) => (m ? reject(new Error(m)) : resolve(null)),
        }),
      );
    },
    [],
  );

  async function pay(invoice: PortalInvoice) {
    if (!token || !invoice.checkout) return;
    setNotice(null);
    setReceipt(null);
    setBusyInvoice(invoice.id);
    try {
      const amountMinor = Math.round(invoice.balance * 100);
      let sourceToken: string | null;
      try {
        sourceToken = await requestCardToken({
          title: 'EBIM',
          description: `Factura ${invoice.number}`,
          currency: invoice.currency,
          amountMinor,
          checkout: invoice.checkout,
        });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo validar la tarjeta.' });
        return;
      }
      if (!sourceToken) return;
      const res = await callPortal<{ receipt: PortalReceipt; simulated: boolean }>('charge', {
        token,
        invoice_id: invoice.id,
        source_token: sourceToken,
      });
      if (!res.ok) {
        setNotice({ tone: 'error', text: res.message });
      } else {
        setReceipt({ ...res.data.receipt, simulated: res.data.simulated });
      }
      await load();
    } finally {
      setBusyInvoice(null);
    }
  }

  return (
    <PortalShell>
      {phase.kind === 'loading' ? (
        <PortalSkeleton />
      ) : phase.kind === 'error' ? (
        <LinkProblem
          code={phase.code}
          message={phase.message}
          onRetry={
            phase.code === 'RED' || phase.code === 'ERROR_INTERNO'
              ? () => {
                  setPhase({ kind: 'loading' });
                  void load();
                }
              : undefined
          }
        />
      ) : (
        <Statement
          statement={phase.statement}
          busyInvoice={busyInvoice}
          notice={notice}
          receipt={receipt}
          onPay={(inv) => void pay(inv)}
          token={token!}
          requestCardToken={requestCardToken}
          reload={load}
        />
      )}

      <MockCardDialog request={tokenRequest} onClose={() => setTokenRequest(null)} />
    </PortalShell>
  );
}
