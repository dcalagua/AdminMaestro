import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckboxField,
  MoneyField,
  NumberField,
  SearchField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from './fields';

/*
 * Campos V2 (VISUAL_SYSTEM_V2 §5.1–5.2): etiqueta asociada, ayuda/error
 * enlazados por `aria-describedby`, `aria-invalid` en error, y el `ref`
 * reenviado al control nativo (React Hook Form registra por ref).
 */

describe('TextField', () => {
  it('asocia la etiqueta y enlaza la ayuda', () => {
    render(<TextField label="Razón social" hint="Como figura en el registro." />);
    const input = screen.getByLabelText('Razón social');
    const help = screen.getByText('Como figura en el registro.');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.getAttribute('aria-describedby')).toBe(help.id);
  });

  it('el error sustituye a la ayuda, se anuncia y marca el control', () => {
    render(<TextField label="Correo" hint="Ayuda" error={{ message: 'Correo inválido' }} />);
    const input = screen.getByLabelText('Correo');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Correo inválido');
    expect(screen.queryByText('Ayuda')).toBeNull();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('el asterisco de requerido es visual: el control anuncia required', () => {
    render(<TextField label="Código" required />);
    // El nombre accesible excluye el asterisco (aria-hidden).
    const input = screen.getByRole('textbox', { name: 'Código' });
    expect(input).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden');
  });

  it('con icono, prefijo o sufijo sigue siendo el mismo input etiquetado', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} label="Dominio" prefix="https://" suffix=".ebim.pe" />);
    const input = screen.getByLabelText('Dominio');
    expect(ref.current).toBe(input);
    expect(screen.getByText('https://')).toBeInTheDocument();
    expect(screen.getByText('.ebim.pe')).toBeInTheDocument();
  });

  it('reenvía el ref sin adornos (registro de React Hook Form)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} label="Nombre" />);
    expect(ref.current).toBe(screen.getByLabelText('Nombre'));
  });
});

describe('NumberField y MoneyField', () => {
  it('NumberField es numérico', () => {
    render(<NumberField label="Usuarios" />);
    expect(screen.getByLabelText('Usuarios')).toHaveAttribute('type', 'number');
  });

  it('MoneyField muestra el código ISO y lo incluye en el nombre accesible', () => {
    render(<MoneyField label="Precio" currency="PEN" />);
    const input = screen.getByRole('spinbutton', { name: 'Precio (PEN)' });
    expect(input).toHaveAttribute('step', '0.01');
    expect(screen.getByText('PEN')).toBeInTheDocument();
  });
});

describe('SelectField', () => {
  it('muestra placeholder y opciones, y marca el error', () => {
    render(
      <SelectField
        label="Moneda"
        placeholder="Elige…"
        options={[{ value: 'USD', label: 'USD' }]}
        error={{ message: 'Elige una moneda' }}
      />,
    );
    const select = screen.getByLabelText('Moneda');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('option', { name: 'Elige…' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una moneda');
  });
});

describe('TextAreaField', () => {
  it('etiqueta asociada y ayuda enlazada', () => {
    render(<TextAreaField label="Motivo" hint="Queda en auditoría." />);
    const area = screen.getByLabelText('Motivo');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAccessibleDescription('Queda en auditoría.');
  });
});

describe('CheckboxField', () => {
  it('la etiqueta y la ayuda describen la casilla', async () => {
    const user = userEvent.setup();
    render(<CheckboxField label="Enviar aviso" hint="Al correo del cliente." />);
    const box = screen.getByRole('checkbox', { name: /Enviar aviso/ });
    expect(box).toHaveAccessibleDescription('Al correo del cliente.');
    await user.click(screen.getByText('Enviar aviso'));
    expect(box).toBeChecked();
  });
});

describe('SwitchField', () => {
  it('es un role=switch con aria-checked y cambia al pulsar', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return <SwitchField label="Avisos por correo" hint="Inmediato" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Avisos por correo' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription('Inmediato');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('deshabilitado no cambia', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchField label="Modo" checked={false} onChange={onChange} disabled />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SearchField', () => {
  it('es un buscador con nombre accesible y botón para limpiar solo con texto', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [q, setQ] = useState('');
      return <SearchField value={q} onChange={setQ} placeholder="Buscar clientes…" />;
    }
    render(<Harness />);
    const box = screen.getByRole('searchbox', { name: 'Buscar clientes…' });
    expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).toBeNull();
    await user.type(box, 'andina');
    expect(box).toHaveValue('andina');
    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(box).toHaveValue('');
  });
});

describe('validación nativa en español (U-13)', () => {
  it('un required vacío muestra el error en el campo, no la burbuja del navegador', async () => {
    const user = userEvent.setup();
    render(
      <form>
        <TextField label="Nombre" required />
        <SelectField label="País" required placeholder="Elige…" options={[{ value: 'PE', label: 'Perú' }]} />
        <TextField label="Correo" type="email" defaultValue="no-es-correo" />
      </form>,
    );
    const name = screen.getByRole('textbox', { name: 'Nombre' });
    const country = screen.getByRole('combobox', { name: 'País' });
    const mail = screen.getByRole('textbox', { name: 'Correo' });
    const prevented = [name, country, mail].map((el) => {
      const ev = new Event('invalid', { cancelable: true });
      act(() => {
        el.dispatchEvent(ev);
      });
      return ev.defaultPrevented;
    });
    // Cancelar el evento suprime la burbuja nativa.
    expect(prevented).toEqual([true, true, true]);
    expect(await screen.findByText('Este campo es obligatorio.')).toBeInTheDocument();
    expect(screen.getByText('Elige una opción.')).toBeInTheDocument();
    expect(screen.getByText('Escribe un correo válido.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Este campo es obligatorio.');

    // Al corregir el valor el error se retira.
    await user.type(name, 'Andina');
    expect(screen.queryByText('Este campo es obligatorio.')).toBeNull();
    expect(name).not.toHaveAttribute('aria-invalid');
  });

  it('checkValidity enfoca el primer campo inválido y conserva el onChange del consumidor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <form>
        <TextField label="Primero" required onChange={onChange} />
        <TextField label="Segundo" required />
      </form>,
    );
    const first = screen.getByRole('textbox', { name: 'Primero' });
    const second = screen.getByRole('textbox', { name: 'Segundo' });
    act(() => {
      second.dispatchEvent(new Event('invalid', { cancelable: true }));
      first.dispatchEvent(new Event('invalid', { cancelable: true }));
    });
    expect(first).toHaveFocus();
    await user.type(first, 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('un error explícito (React Hook Form) manda sobre el nativo', () => {
    render(<TextField label="Código" required error={{ message: 'Código duplicado' }} />);
    const input = screen.getByRole('textbox', { name: 'Código' });
    act(() => {
      input.dispatchEvent(new Event('invalid', { cancelable: true }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Código duplicado');
  });
});
