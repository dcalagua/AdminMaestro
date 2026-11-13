import { Link } from 'react-router-dom';
import { Badge, Card, LoadingState } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/format';
import { PRIORITY_LABEL, PRIORITY_TONE, inboxTarget } from './inboxModel';
import { useInbox } from './useInbox';

/**
 * V5 · F7 · La Bandeja resumida para el Resumen en móvil («de consulta»): lo
 * más urgente primero y el enlace a la Bandeja completa. Mismos datos y mismo
 * RLS que la campana y la pantalla Bandeja.
 */
export function InboxSummaryCard({ top = 5 }: { top?: number }) {
  const inbox = useInbox();
  if (!Object.values(inbox.audience).some(Boolean)) return null;
  const count = inbox.items.length;
  const shown = inbox.items.slice(0, top);

  return (
    <Card
      title="Bandeja"
      description={count === 0 ? undefined : `${formatNumber(count)} pendiente${count === 1 ? '' : 's'}, lo más urgente primero.`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span>{count > top ? `y ${formatNumber(count - top)} más` : ''}</span>
          <Link to="/bandeja" className="ebim-btn-secondary ebim-btn-sm">
            Ver toda la bandeja
          </Link>
        </div>
      }
    >
      {inbox.loading && count === 0 ? (
        <LoadingState label="Revisando lo que requiere tu atención…" rows={3} />
      ) : shown.length === 0 ? (
        <p className="px-5 py-6 text-center text-compact text-muted">Nada pendiente. Todo al día.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Lo más urgente" data-inbox-summary>
          {shown.map((item) => (
            <li key={item.key}>
              <Link to={inboxTarget(item)} className="flex items-start gap-3 px-5 py-3 transition-colors duration-fast hover:bg-hover">
                <Badge tone={PRIORITY_TONE[item.priority]} dot>
                  {PRIORITY_LABEL[item.priority]}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block text-compact font-semibold text-fg">{item.title}</span>
                  <span
                    className="block truncate text-caption text-muted"
                    title={[item.account?.name, item.app, item.ageText].filter(Boolean).join(' · ')}
                  >
                    {[item.account?.name, item.app, item.ageText].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
