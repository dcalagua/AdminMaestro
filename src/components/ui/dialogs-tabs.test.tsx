import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { FormDialog } from './FormDialog';
import { SectionTabs, StatusTabs } from './SectionTabs';

/*
 * E09 · Ciclo completo de teclado (spec §6.5, AC05). No basta con roles ARIA:
 * foco confinado, foco devuelto, Escape según estado, sin doble envío, acción
 * destructiva sin foco por defecto y tabs operables con flechas/Home/End.
 */

function ConfirmHarness({ onConfirm, tone = 'danger' as const, busy }: { onConfirm: () => void | Promise<unknown>; tone?: 'danger' | 'primary'; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Abrir confirmación</button>
      <button type="button">Fondo</button>
      <ConfirmDialog
        open={open}
        title="Archivar producto"
        message="Esta acción no se puede deshacer."
        confirmLabel="Archivar"
        tone={tone}
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

function FormHarness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Nuevo registro</button>
      <FormDialog open={open} title="Nuevo registro" busy={busy} onSubmit={() => undefined} onCancel={() => setOpen(false)}>
        <input aria-label="Nombre" />
        <input aria-label="Código" />
      </FormDialog>
    </div>
  );
}

describe('ConfirmDialog', () => {
  it('Tab y Shift+Tab no salen del modal', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={() => undefined} />);
    await user.click(screen.getByText('Abrir confirmación'));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 5; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('la acción destructiva NO recibe el foco por defecto', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={() => undefined} />);
    await user.click(screen.getByText('Abrir confirmación'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
  });

  it('el foco vuelve al activador al cerrar', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={() => undefined} />);
    const opener = screen.getByText('Abrir confirmación');
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('confirmación en curso: un doble clic produce UNA sola mutación', async () => {
    let resolve!: () => void;
    const mutation = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<ConfirmHarness onConfirm={mutation} />);
    fireEvent.click(screen.getByText('Abrir confirmación'));
    const confirm = screen.getByRole('button', { name: 'Archivar' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await act(async () => { resolve(); });
    expect(confirm).not.toBeDisabled();
  });

  it('Escape no cancela mientras la operación está en curso', () => {
    render(<ConfirmHarness onConfirm={() => undefined} busy />);
    fireEvent.click(screen.getByText('Abrir confirmación'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('el mensaje describe el diálogo', () => {
    render(<ConfirmHarness onConfirm={() => undefined} />);
    fireEvent.click(screen.getByText('Abrir confirmación'));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Esta acción no se puede deshacer.');
  });
});

describe('FormDialog', () => {
  it('enfoca el primer campo, confina Tab y devuelve el foco al cerrar', async () => {
    const user = userEvent.setup();
    render(<FormHarness />);
    const opener = screen.getByText('Nuevo registro');
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('Nombre'));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
  });

  it('Escape respeta el guardado en curso', () => {
    render(<FormHarness busy />);
    fireEvent.click(screen.getByText('Nuevo registro'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('SectionTabs', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  const tabs = [
    { id: 'general', label: 'General', content: <p>Panel general</p> },
    { id: 'seguridad', label: 'Seguridad', content: <p>Panel seguridad</p> },
    { id: 'auditoria', label: 'Auditoría', content: <p>Panel auditoría</p> },
  ];

  it('flechas, Home y End mueven foco y selección y actualizan el hash', async () => {
    const user = userEvent.setup();
    render(<SectionTabs tabs={tabs} />);
    const general = screen.getByRole('tab', { name: 'General' });
    general.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Seguridad' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Seguridad' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#seguridad');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Auditoría' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Auditoría' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel auditoría');
  });

  it('sólo la pestaña activa está en el orden de Tab (roving tabindex)', () => {
    render(<SectionTabs tabs={tabs} />);
    const all = screen.getAllByRole('tab');
    expect(all.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('un deep-link #hash existente sigue abriendo su pestaña', () => {
    window.location.hash = '#auditoria';
    render(<SectionTabs tabs={tabs} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel auditoría');
  });
});

describe('StatusTabs', () => {
  it('opera con flechas', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState<'ALL' | 'OPEN' | 'PAID'>('ALL');
      return (
        <StatusTabs value={v} onChange={setV} options={[{ id: 'ALL', label: 'Todas' }, { id: 'OPEN', label: 'Por cobrar' }, { id: 'PAID', label: 'Pagadas' }]} />
      );
    }
    render(<Harness />);
    screen.getByRole('tab', { name: 'Todas' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Por cobrar' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Por cobrar' })).toHaveFocus();
  });
});
