/**
 * Estado de una cuenta con punto de color (fase 12, §8 PT-LIST de usuarios):
 * el punto da el tono, el texto (siempre presente) da el significado. Una cuenta
 * desactivada va en gris: no es un error, es una decisión registrada.
 */
const DOT: Record<string, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-muted',
};

export function UserStatus({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  return (
    <span className="inline-flex items-center gap-2 text-compact font-semibold text-fg-2" data-user-status={tone}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]} ${tone === 'warn' ? 'ring-2 ring-warn-soft' : ''}`} />
      {label}
    </span>
  );
}
