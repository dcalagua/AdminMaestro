import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useImportCapabilityManifest } from '@/services/mutations';
import type { Json } from '@/types/database.types';

/** Respuesta de `import_capability_manifest`. `missing` = drift del registro. */
export interface ManifestImportResult {
  product?: string;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  aliases?: number;
  missing?: unknown[];
  import_id?: string;
}

/*
 * Sólo se comprueba que el texto sea JSON: la forma del manifiesto
 * (`ebim.capabilities/v1`, claves permitidas, códigos) la valida la RPC y su
 * error se muestra tal cual. Duplicar aquí esa regla la haría divergir.
 */
const schema = z.object({
  product_code: z.string().min(1, 'Elige el producto'),
  manifest: z
    .string()
    .trim()
    .min(2, 'Pega el manifiesto JSON')
    .refine((text) => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    }, 'No es un JSON válido'),
});

type Values = z.input<typeof schema>;

export function ImportManifestDialog({
  open,
  products,
  onClose,
  onImported,
}: {
  open: boolean;
  products: Array<{ code: string; short_name: string }>;
  onClose: () => void;
  onImported: (result: ManifestImportResult) => void;
}) {
  const toast = useToast();
  const importManifest = useImportCapabilityManifest();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { product_code: '', manifest: '' },
  });

  useEffect(() => {
    if (!open) return;
    importManifest.reset();
    form.reset({ product_code: '', manifest: '' });
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    const parsed = schema.parse(values);
    try {
      const result = await importManifest.mutateAsync({
        p_product_code: parsed.product_code,
        p_manifest: JSON.parse(parsed.manifest) as Json,
      });
      const summary = (result ?? {}) as ManifestImportResult;
      toast.success('Manifiesto importado', parsed.product_code);
      onImported(summary);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Importar manifiesto de capacidades"
      description="El manifiesto (ebim.capabilities/v1) lo publica cada producto. Se insertan las capacidades nuevas y se actualizan las existentes; las que el registro tiene y el manifiesto no, se informan como drift y NO se borran."
      submitLabel="Importar"
      busy={importManifest.isPending}
      error={importManifest.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <SelectField
        label="Producto"
        required
        placeholder="Elige el producto…"
        options={products.map((p) => ({ value: p.code, label: `${p.short_name} (${p.code})` }))}
        error={form.formState.errors.product_code}
        {...form.register('product_code')}
      />
      <TextAreaField
        label="Manifiesto JSON"
        required
        rows={12}
        className="font-mono"
        placeholder='{ "schema": "ebim.capabilities/v1", "productCode": "…", "capabilities": [ … ] }'
        error={form.formState.errors.manifest}
        {...form.register('manifest')}
      />
    </FormDialog>
  );
}
