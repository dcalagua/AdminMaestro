import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { EbimLockup } from './EbimMark';

interface State {
  error: Error | null;
}

/**
 * Error boundary de la aplicación.
 *
 * Muestra el mensaje del error pero NUNCA el stack en producción: un stack
 * expone rutas internas y nombres de módulos que no aportan al usuario.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ebim-control-plane] error no capturado', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="ebim-card w-full max-w-lg p-8 text-center">
          <div className="mb-5 flex justify-center">
            <EbimLockup appName="Control Plane" />
          </div>
          <h1 className="text-lg font-bold text-fg">Algo salió mal</h1>
          <p className="mt-2 text-sm text-muted">
            La consola encontró un error inesperado. Puedes recargar la página; si el problema
            persiste, comparte el detalle con el equipo de plataforma.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-field bg-[color:var(--bg)] p-3 text-left text-xs text-danger">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="ebim-btn-primary mt-5"
            onClick={() => window.location.reload()}
          >
            Recargar la consola
          </button>
        </div>
      </div>
    );
  }
}
