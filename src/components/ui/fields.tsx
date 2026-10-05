import { forwardRef, useId } from 'react';
import type { ReactNode } from 'react';
import { CaretDownIcon, MagnifyingGlassIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';

/**
 * Forma mínima de un error de campo: cualquier cosa con `message`.
 *
 * No se usa el `FieldError` de React Hook Form porque los campos que pasan por
 * `z.coerce` (números) producen un tipo distinto (`Merge<...>`) que no es
 * asignable a él. Ambos cumplen este contrato, y aquí solo se pinta el mensaje.
 */
export type FieldIssue = { message?: string } | undefined;

/**
 * Campos de formulario del Control Plane.
 *
 * Anatomía fija (contrato §4.5 / U-04, VISUAL_SYSTEM_V2 §5.1): la etiqueta va
 * ENCIMA del control, la ayuda debajo y el error sustituye a la ayuda. Se
 * registran con React Hook Form vía spread (`{...register('campo')}`), así que
 * no envuelven el estado: son presentación con accesibilidad, nada más. El
 * `ref` se reenvía al control nativo para que `register` funcione igual con o
 * sin adornos (icono, prefijo, sufijo).
 */

interface ShellProps {
  label: string;
  hint?: string;
  error?: FieldIssue;
  className?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className = '',
  children,
}: ShellProps & { id: string; required?: boolean; children: ReactNode }) {
  const message = error?.message;
  return (
    <div className={className}>
      <label className="ebim-label" htmlFor={id}>
        {label}
        {/* El asterisco es visual: el control ya anuncia `required`. */}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {message ? (
        <p id={`${id}-msg`} className="ebim-field-error flex items-start gap-1" role="alert">
          <WarningCircleIcon size={14} weight="bold" className="mt-px shrink-0" aria-hidden />
          <span>{message}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="ebim-help">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Vincula el control con su ayuda o error para lectores de pantalla. */
function describedBy(id: string, hint?: string, error?: FieldIssue): string | undefined {
  return error?.message || hint ? `${id}-msg` : undefined;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export interface TextFieldProps extends Omit<InputProps, 'prefix'>, ShellProps {
  /** Icono a la izquierda (Phosphor 16 px), p. ej. `<EnvelopeIcon size={16} />`. */
  icon?: ReactNode;
  /** Texto fijo antes de la cifra (código de moneda, `https://`). */
  prefix?: ReactNode;
  /** Texto o control al final (unidad, `%`, botón de mostrar). */
  suffix?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, icon, prefix, suffix, ...input },
  ref,
) {
  const generated = useId();
  const id = input.id ?? generated;
  const control = {
    id,
    ref,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, hint, error),
    ...input,
  };
  const adorned = icon != null || prefix != null || suffix != null;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={input.required} className={className}>
      {adorned ? (
        <div className="ebim-input-group">
          {icon != null ? (
            <span className="flex shrink-0 items-center pl-3 text-muted" aria-hidden>
              {icon}
            </span>
          ) : null}
          {prefix != null ? (
            <span className="ebim-input-addon border-r border-border bg-sunken" aria-hidden>
              {prefix}
            </span>
          ) : null}
          <input {...control} className={icon != null ? 'pl-2' : undefined} />
          {suffix != null ? <span className="ebim-input-addon">{suffix}</span> : null}
        </div>
      ) : (
        <input {...control} className="ebim-input" />
      )}
    </FieldShell>
  );
});

export const NumberField = forwardRef<HTMLInputElement, TextFieldProps>(function NumberField(props, ref) {
  return <TextField ref={ref} type="number" inputMode="decimal" {...props} />;
});

/**
 * Importe con el código ISO de la moneda como prefijo (§5.1, G-27: el código,
 * nunca solo el símbolo). La cifra usa dígitos tabulares por la regla global de
 * `input`. El código se anuncia junto a la etiqueta, no como texto suelto.
 */
export const MoneyField = forwardRef<
  HTMLInputElement,
  Omit<TextFieldProps, 'prefix'> & { currency: string }
>(function MoneyField({ currency, label, step = '0.01', ...props }, ref) {
  return (
    <TextField
      ref={ref}
      type="number"
      inputMode="decimal"
      step={step}
      label={label}
      aria-label={`${label} (${currency})`}
      prefix={currency}
      {...props}
    />
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  SelectProps &
    ShellProps & {
      placeholder?: string;
      options: Array<{ value: string; label: string }>;
    }
>(function SelectField({ label, hint, error, options, placeholder, className, ...select }, ref) {
  const generated = useId();
  const id = select.id ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={select.required} className={className}>
      <div className="relative">
        <select
          id={id}
          ref={ref}
          className="ebim-input ebim-input-select"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...select}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <CaretDownIcon
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaProps & ShellProps>(function TextAreaField(
  { label, hint, error, className, ...area },
  ref,
) {
  const generated = useId();
  const id = area.id ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={area.required} className={className}>
      <textarea
        id={id}
        ref={ref}
        className="ebim-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...area}
      />
    </FieldShell>
  );
});

export const CheckboxField = forwardRef<HTMLInputElement, InputProps & { label: string; hint?: string; className?: string }>(
  function CheckboxField({ label, hint, className = '', ...input }, ref) {
    const generated = useId();
    const id = input.id ?? generated;
    return (
      <div className={className}>
        <label
          className={`flex items-start gap-2 text-body text-fg ${input.disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
          htmlFor={id}
        >
          <input
            id={id}
            ref={ref}
            type="checkbox"
            className="ebim-checkbox"
            aria-describedby={hint ? `${id}-msg` : undefined}
            {...input}
          />
          <span>
            <span className="font-medium">{label}</span>
            {hint ? (
              <span id={`${id}-msg`} className="mt-0.5 block text-caption text-muted">
                {hint}
              </span>
            ) : null}
          </span>
        </label>
      </div>
    );
  },
);

/**
 * Interruptor de efecto inmediato (§5.2): preferencias on/off que se aplican al
 * pulsar, sin botón Guardar. Controlado; para un dato de formulario que se
 * envía con «Guardar» se usa `CheckboxField`.
 */
export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className = '',
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div>
        <label htmlFor={id} className={`text-body font-medium ${disabled ? 'text-disabled' : 'text-fg'}`}>
          {label}
        </label>
        {hint ? (
          <p id={`${id}-msg`} className="mt-0.5 text-caption text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-msg` : undefined}
        disabled={disabled}
        className="ebim-switch mt-0.5"
        onClick={() => onChange(!checked)}
      >
        <span className="ebim-switch-knob" />
      </button>
    </div>
  );
}

/**
 * Buscador de listado (§5.1, U-06): icono de lupa, `type="search"` y botón para
 * limpiar cuando hay texto. Ancho entre 240 y 480 px: nunca a lo ancho de la
 * tarjeta (A10). Es el ÚNICO filtro de texto de un listado.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar…',
  label,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Nombre accesible; por defecto, el placeholder. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={`ebim-input-group w-full min-w-[240px] max-w-[480px] ${className}`}>
      <span className="flex shrink-0 items-center pl-3 text-muted" aria-hidden>
        <MagnifyingGlassIcon size={16} />
      </span>
      <input
        type="search"
        className="pl-2 [&::-webkit-search-cancel-button]:hidden"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="mr-1 flex w-7 shrink-0 items-center justify-center self-center rounded-md py-1 text-muted hover:bg-hover hover:text-fg"
          aria-label="Limpiar búsqueda"
          onClick={() => onChange('')}
        >
          <XIcon size={14} weight="bold" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Fila de dos columnas para formularios densos. Se apila en pantallas estrechas. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
