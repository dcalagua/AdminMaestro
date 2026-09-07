/**
 * Formateo para la UI. Todo en español (regla de suite: mercado LATAM).
 *
 * No se convierte entre monedas en ningún punto: los agregados vienen agrupados
 * por `currency` desde la base. Un tipo de cambio implícito produce un número
 * que nadie puede auditar (ver docs/finance/COST_MARGIN_MODEL.md).
 */
const LOCALE = 'es-PE';
export function formatMoney(amount, currency = 'USD') {
    if (amount === null || amount === undefined)
        return '—';
    return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}
/** Compacta montos grandes para las tarjetas del dashboard (1,2 M). */
export function formatMoneyCompact(amount, currency = 'USD') {
    if (amount === null || amount === undefined)
        return '—';
    if (Math.abs(amount) < 10_000)
        return formatMoney(amount, currency);
    return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(amount);
}
export function formatNumber(value) {
    if (value === null || value === undefined)
        return '—';
    return new Intl.NumberFormat(LOCALE).format(value);
}
export function formatPercent(value, digits = 1) {
    if (value === null || value === undefined)
        return '—';
    return new Intl.NumberFormat(LOCALE, {
        style: 'percent',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(value);
}
export function formatDate(value) {
    if (!value)
        return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime()))
        return '—';
    return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(date);
}
export function formatDateTime(value) {
    if (!value)
        return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime()))
        return '—';
    return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
/** Suma los totales de un mapa `{ USD: 1000, PEN: 500 }` a texto legible. */
export function formatCurrencyMap(map) {
    if (!map || Object.keys(map).length === 0)
        return '—';
    return Object.entries(map)
        .map(([currency, amount]) => formatMoneyCompact(Number(amount), currency))
        .join(' · ');
}
