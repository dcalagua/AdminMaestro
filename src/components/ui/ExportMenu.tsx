import { useId, useRef, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { collectAllPages, downloadCsv, exportFilename, toCsv, type ExportColumn } from '@/lib/export';
import type { Page } from '@/services/financeRead';
import { EXPORT_LIMIT, EXPORT_PAGE_SIZE } from '@/services/financeRead';
import { formatNumber } from '@/lib/format';

/**
 * Exportación común (spec §10): el usuario elige explícitamente «Página actual»
 * o «Todos los resultados filtrados». El límite técnico se muestra ANTES de
 * exportar y una salida truncada se nombra `…-incompleto` — nunca completa.
 */
export function ExportMenu<Row>({
  filenameBase,
  columns,
  pageRows,
  total,
  fetchPage,
  rowKey,
}: {
  filenameBase: string;
  columns: ExportColumn<Row>[];
  pageRows: readonly Row[];
  total: number;
  fetchPage: (page: number, pageSize: number) => Promise<Page<Row>>;
  rowKey: (row: Row) => string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const overLimit = total > EXPORT_LIMIT;

  const exportPage = () => {
    downloadCsv(exportFilename(filenameBase, 'pagina'), toCsv(columns, pageRows));
    setMessage({ tone: 'ok', text: `Página actual exportada (${formatNumber(pageRows.length)} filas).` });
    setOpen(false);
    buttonRef.current?.focus();
  };

  const exportAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await collectAllPages(fetchPage, { pageSize: EXPORT_PAGE_SIZE, limit: EXPORT_LIMIT, rowKey });
      const base = result.complete ? filenameBase : `${filenameBase}-incompleto`;
      downloadCsv(exportFilename(base, 'todos'), toCsv(columns, result.rows));
      setMessage(
        result.complete
          ? { tone: 'ok', text: `Exportados los ${formatNumber(result.total)} resultados filtrados.` }
          : {
              tone: 'warn',
              text: `Exportación INCOMPLETA: ${formatNumber(result.rows.length)} de ${formatNumber(result.total)} filas (límite técnico ${formatNumber(EXPORT_LIMIT)}).`,
            },
      );
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: `No se generó el archivo: ${error instanceof Error ? error.message : 'error inesperado'}`,
      });
    } finally {
      setBusy(false);
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="ebim-btn-ghost h-9 px-3 text-xs"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={busy || undefined}
        disabled={busy || total === 0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <DownloadSimpleIcon size={16} aria-hidden />
        {busy ? 'Exportando…' : 'Exportar CSV'}
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 z-30 mt-1 w-72 rounded-field border border-border bg-card p-2 shadow-pop"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
        >
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent-soft"
            onClick={exportPage}
          >
            <span className="font-semibold text-fg">Página actual</span>
            <span className="block text-xs text-muted">{formatNumber(pageRows.length)} filas visibles</span>
          </button>
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent-soft"
            onClick={() => void exportAll()}
          >
            <span className="font-semibold text-fg">Todos los resultados filtrados</span>
            <span className="block text-xs text-muted">
              {formatNumber(total)} filas con los filtros actuales
            </span>
            {overLimit ? (
              <span className="mt-1 block text-xs font-semibold text-warn">
                Supera el límite de {formatNumber(EXPORT_LIMIT)}: el archivo saldrá marcado como incompleto.
              </span>
            ) : null}
          </button>
          <p className="px-3 pb-1 pt-2 text-[11px] text-muted">
            Sólo columnas visibles para tu rol. Importes con su moneda; texto protegido contra fórmulas.
          </p>
        </div>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`mt-2 max-w-xs rounded-md px-3 py-2 text-xs ${
            message.tone === 'ok'
              ? 'bg-ok-soft text-ok'
              : message.tone === 'warn'
                ? 'bg-warn-soft text-warn'
                : 'bg-danger-soft text-danger'
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
