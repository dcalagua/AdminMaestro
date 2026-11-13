import { useId, useState, type ReactNode } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';

/**
 * V6 · un buscador con lista (combobox WAI-ARIA) en lugar de un buscador más
 * un `select`: se escribe, se filtra y se elige con flechas y Enter (o con el
 * ratón). Nació en «Emitir factura» (elegir contrato) y se promovió a `ui` en F5.
 *
 * Cada opción ocupa dos líneas cortas: `primary` en negrita y `secondary` en
 * `text-caption` (ambas truncadas con su texto completo en `title`).
 *
 * @example
 * <Combobox label="Contrato" options={subs} value={id} onChange={setId}
 *   getKey={(s) => s.id} getText={(s) => s.code} renderPrimary={(s) => s.name} />
 */
export function Combobox<T>({
  label,
  listLabel,
  options,
  value,
  onChange,
  onOpenChange,
  getKey,
  getText,
  searchText,
  renderPrimary,
  renderSecondary,
  placeholder = 'Buscar…',
  emptyText = 'Nada coincide',
}: {
  /** Etiqueta visible del campo. */
  label: string;
  /** Nombre accesible de la lista. */
  listLabel: string;
  options: T[];
  /** Clave de la opción elegida ('' = ninguna). */
  value: string;
  onChange: (key: string) => void;
  /** Avisa al abrir/cerrar (p. ej. para que Escape cierre primero la lista y no el diálogo). */
  onOpenChange?: (open: boolean) => void;
  getKey: (option: T) => string;
  /** Texto que se muestra en el campo con la opción elegida. */
  getText: (option: T) => string;
  /** Textos en los que se busca (por defecto, `getText`). */
  searchText?: (option: T) => Array<string | null | undefined>;
  /** Primera línea de la opción (texto plano: también va al `title`). */
  renderPrimary: (option: T) => string;
  /** Segunda línea opcional. */
  renderSecondary?: (option: T) => ReactNode;
  placeholder?: string;
  emptyText?: string;
}) {
  const id = useId();
  const selected = options.find((o) => getKey(o) === value);
  const [query, setQuery] = useState('');
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(0);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const q = query.trim().toLocaleLowerCase('es');
  const haystack = searchText ?? ((o: T) => [getText(o)]);
  const matches = options.filter((o) => !q || haystack(o).some((v) => v?.toLocaleLowerCase('es').includes(q)));
  const pick = (o: T) => {
    onChange(getKey(o));
    setQuery('');
    setOpen(false);
  };
  const shown = open ? query : selected ? getText(selected) : query;
  const activeOption = matches[active];

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="ebim-label mb-1.5 block">
        {label}
      </label>
      <div className="relative">
        <MagnifyingGlassIcon
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && activeOption ? `${id}-opt-${getKey(activeOption)}` : undefined}
          autoComplete="off"
          className="ebim-input w-full pl-9"
          placeholder={placeholder}
          title={selected && !open ? getText(selected) : undefined}
          value={shown}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (value) onChange('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && open && activeOption) {
              e.preventDefault();
              pick(activeOption);
            } else if (e.key === 'Escape' && open) {
              setOpen(false);
            }
          }}
        />
      </div>
      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={listLabel}
          className="ebim-menu absolute left-0 right-0 top-full z-10 mt-1 max-h-[280px] overflow-y-auto"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-compact text-muted" role="presentation">
              {emptyText}
            </li>
          ) : (
            matches.map((o, i) => {
              const key = getKey(o);
              const primary = renderPrimary(o);
              return (
                <li
                  key={key}
                  id={`${id}-opt-${key}`}
                  role="option"
                  aria-selected={key === value}
                  className={`cursor-pointer rounded-md px-3 py-1.5 ${i === active ? 'bg-hover' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  // `mousedown` antes del `blur` del campo: si no, la lista se cierra sin elegir.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                >
                  <span className="block truncate text-compact font-semibold text-fg" title={primary}>
                    {primary}
                  </span>
                  {renderSecondary ? (
                    <span className="block truncate text-caption text-muted">{renderSecondary(o)}</span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
