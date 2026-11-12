import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMyProfile } from '@/services/queries';
import { useAdminUpdateProfile } from '@/services/mutations';
import { useToast } from '@/components/ui/toast-context';
import { Card, ErrorState, LoadingState } from '@/components/ui/primitives';
import { TextField, FieldRow } from '@/components/ui/fields';
import { businessErrorMessage } from '@/lib/pgError';
import { supabase } from '@/lib/supabase';
import { passwordProblem } from '@/features/auth/welcomeSession';
import { Avatar } from '@/components/ui/Avatar';

/**
 * M5 · Configuración → «Mi perfil».
 *
 * Nombre, teléfono y cargo se guardan con `admin_update_profile` sobre uno
 * mismo (auditado); el correo y los roles no se editan aquí. El cambio de
 * contraseña verifica primero la actual y luego usa `auth.updateUser`.
 */
export function MyProfilePanel() {
  const { roles, refreshRoles } = useAuth();
  const userId = roles?.userId;
  const profile = useMyProfile(userId);
  const update = useAdminUpdateProfile();
  const toast = useToast();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');

  useEffect(() => {
    if (!profile.data) return;
    setFullName(profile.data.full_name ?? '');
    setPhone(profile.data.phone ?? '');
    setJobTitle(profile.data.job_title ?? '');
  }, [profile.data]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!userId) return;
    try {
      await update.mutateAsync({
        p_user_id: userId,
        p_full_name: fullName,
        p_phone: phone.trim() || undefined,
        p_job_title: jobTitle.trim() || undefined,
      });
      await refreshRoles();
      toast.success('Perfil actualizado', fullName);
    } catch {
      /* visible bajo el formulario */
    }
  }

  if (profile.isLoading) return <LoadingState variant="card" label="Cargando tu perfil…" />;
  if (profile.error) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Mis datos" description="Tu correo y tus roles los administra el equipo de plataforma.">
        <div className="flex items-center gap-4 border-b border-border px-4 py-4">
          <Avatar name={fullName || (profile.data?.email ?? roles?.email ?? '—')} mode="person" size="lg" />
          <div className="min-w-0">
            <p className="truncate text-h3 text-fg">{fullName || 'Sin nombre'}</p>
            <p className="truncate text-compact text-muted">{profile.data?.email ?? roles?.email ?? ''}</p>
          </div>
        </div>
        <form className="grid gap-4 p-4" onSubmit={(e) => void saveProfile(e)} aria-label="Mis datos">
          <TextField label="Correo" value={profile.data?.email ?? roles?.email ?? ''} disabled readOnly />
          <TextField label="Nombre completo" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <FieldRow>
            <TextField label="Teléfono" placeholder="+51 999 888 777" value={phone}
              onChange={(e) => setPhone(e.target.value)} />
            <TextField label="Cargo" placeholder="Jefe de compras" value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)} />
          </FieldRow>
          {update.error ? (
            <p role="alert" className="rounded-field bg-danger-soft px-3 py-2 text-compact text-danger">
              {businessErrorMessage(update.error)}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button type="submit" className="ebim-btn-primary" disabled={update.isPending}>
              {update.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Card>
      <ChangePasswordCard email={profile.data?.email ?? roles?.email ?? ''} />
    </div>
  );
}

function ChangePasswordCard({ email }: { email: string }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = current === '' ? 'Escribe tu contraseña actual.' : passwordProblem(next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Verifica la contraseña actual: una sesión abierta en un equipo ajeno no
      // basta para cambiarla.
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) {
        setError('La contraseña actual no es correcta.');
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) {
        setError('No se pudo cambiar la contraseña. Prueba con otra más larga, con letras y números.');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Contraseña actualizada', 'Úsala en tu próximo ingreso.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Contraseña" description="Al menos 8 caracteres, con letras y números.">
      <form className="grid gap-4 p-4" onSubmit={(e) => void submit(e)} aria-label="Cambiar contraseña">
        <TextField label="Contraseña actual" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} />
        <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} />
        <TextField label="Repite la nueva contraseña" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} />
        {error ? (
          <p role="alert" className="rounded-field bg-danger-soft px-3 py-2 text-compact text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button type="submit" className="ebim-btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </Card>
  );
}
