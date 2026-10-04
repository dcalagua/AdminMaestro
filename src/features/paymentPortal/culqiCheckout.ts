/**
 * Culqi Checkout v4 cargado bajo demanda.
 *
 * El PAN y el CVV se escriben en el formulario de Culqi, nunca en uno nuestro:
 * Checkout devuelve un token efímero (`tkn_…`) que la página manda al portal.
 * La llave PÚBLICA (`pk_…`) es pública por diseño y llega en el estado de
 * cuenta; la secreta nunca sale del servidor.
 *
 * API v4 (documentación de Culqi): `Culqi.publicKey`, `Culqi.settings({…})`,
 * `Culqi.options({…})`, `Culqi.open()` y la función global `window.culqi`
 * que el script invoca al terminar con `Culqi.token` o `Culqi.error`.
 */

export const CULQI_CHECKOUT_URL = 'https://checkout.culqi.com/js/v4';

interface CulqiGlobal {
  publicKey: string;
  settings: (s: Record<string, unknown>) => void;
  options?: (o: Record<string, unknown>) => void;
  open: () => void;
  close: () => void;
  token?: { id: string; email?: string } | null;
  error?: { user_message?: string; merchant_message?: string } | null;
}

declare global {
  interface Window {
    Culqi?: CulqiGlobal;
    culqi?: () => void;
  }
}

let loading: Promise<CulqiGlobal> | null = null;

export function loadCulqiCheckout(): Promise<CulqiGlobal> {
  if (window.Culqi) return Promise.resolve(window.Culqi);
  if (loading) return loading;
  loading = new Promise<CulqiGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CULQI_CHECKOUT_URL;
    script.async = true;
    script.onload = () => (window.Culqi ? resolve(window.Culqi) : reject(new Error('CHECKOUT_NO_DISPONIBLE')));
    script.onerror = () => {
      loading = null;
      reject(new Error('CHECKOUT_NO_DISPONIBLE'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface CheckoutRequest {
  publicKey: string;
  title: string;
  description: string;
  currency: string;
  /** Céntimos. Para guardar la tarjeta es solo informativo: tokenizar no cobra. */
  amountMinor: number;
}

export interface CheckoutToken {
  token: string;
  email: string | null;
}

/** Abre Checkout y resuelve con el token, o rechaza con el mensaje de Culqi para el titular. */
export async function openCulqiCheckout(req: CheckoutRequest): Promise<CheckoutToken> {
  const Culqi = await loadCulqiCheckout();
  return new Promise<CheckoutToken>((resolve, reject) => {
    Culqi.publicKey = req.publicKey;
    Culqi.settings({
      title: req.title,
      currency: req.currency,
      description: req.description,
      amount: req.amountMinor,
    });
    Culqi.options?.({ lang: 'auto', installments: false, paymentMethods: { tarjeta: true } });
    window.culqi = () => {
      const token = Culqi.token;
      const error = Culqi.error;
      Culqi.close();
      if (token?.id) resolve({ token: token.id, email: token.email ?? null });
      else reject(new Error(error?.user_message ?? 'No se pudo validar la tarjeta.'));
    };
    Culqi.open();
  });
}

/**
 * Modo de prueba (cuenta sin credenciales): token simulado `tkn_mock_…`.
 * `decline` y `3ds` en el token hacen que el proveedor simulado rechace o pida
 * autenticación, para poder ensayar los mensajes sin red.
 */
export function mockToken(outcome: 'approve' | 'decline' | '3ds'): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return outcome === 'approve' ? `tkn_mock_${rand}` : `tkn_mock_${outcome}_${rand}`;
}
