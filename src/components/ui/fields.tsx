import { useId } from 'react';
import type { ReactNode } from 'react';

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
 * Anatomía fija (contrato §4.5 / U-04): la etiqueta va ENCIMA del input, la
 * ayuda debajo y el error sustituye a la ayuda. Se registran con React Hook
 * Form vía spread (`{...register('campo')}`), así que no envuelven el estado:
 * son presentación con accesibilidad, nada más.
 */

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className = '',
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: FieldIssue;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const message = error?.message;
  return (
    <div className={className}>
      <label className="ebim-label" htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {message ? (
        <p className="mt-1 text-xs text-danger" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextField({
  label,
  hint,
  error,
  className,
  ...input
}: InputProps & { label: string; hint?: string; error?: FieldIssue; className?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={input.required} className={className}>
      <input
        id={id}
        className="ebim-input"
        aria-invalid={error ? true : undefined}
        {...input}
      />
    </FieldShell>
  );
}

export function NumberField(
  props: InputProps & { label: string; hint?: string; error?: FieldIssue; className?: string },
) {
  return <TextField type="number" {...props} />;
}

export function SelectField({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  ...select
}: SelectProps & {
  label: string;
  hint?: string;
  error?: FieldIssue;
  className?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={select.required} className={className}>
      <select id={id} className="ebim-input" aria-invalid={error ? true : undefined} {...select}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...area
}: TextAreaProps & { label: string; hint?: string; error?: FieldIssue; className?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={area.required} className={className}>
      <textarea id={id} className="ebim-input min-h-[80px]" aria-invalid={error ? true : undefined} {...area} />
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  hint,
  className = '',
  ...input
}: InputProps & { label: string; hint?: string; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label className="flex items-start gap-2.5 text-sm text-fg" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-border accent-[color:var(--accent)]"
          {...input}
        />
        <span>
          <span className="font-medium">{label}</span>
          {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
        </span>
      </label>
    </div>
  );
}

/** Fila de dos columnas para formularios densos. Se apila en pantallas estrechas. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
