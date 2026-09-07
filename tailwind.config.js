/**
 * Tokens de marca EBIM.
 *
 * Los colores NO se escriben como hex en los componentes: se leen de variables CSS
 * (`src/app/tokens.css`) para permitir theming/white-label por tenant — contrato §4.3/§4.4.
 *
 * Regla AA (contrato §4.4): `accent` = fills/barras · `accent-deep` = TEXTO sobre fondo claro.
 */
export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    darkMode: ['class', '[data-theme="dark"]'],
    theme: {
        extend: {
            colors: {
                accent: {
                    DEFAULT: 'var(--accent)',
                    deep: 'var(--accent-deep)',
                    soft: 'var(--accent-soft)',
                    fg: 'var(--accent-fg)',
                },
                accent2: 'var(--accent2)',
                bg: 'var(--bg)',
                card: 'var(--card)',
                elevated: 'var(--elevated)',
                border: 'var(--border)',
                fg: 'var(--text)',
                muted: 'var(--muted)',
                ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
                warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
                danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
                info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
            },
            fontFamily: {
                sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
            borderRadius: {
                // §4.5: campos 11px, tarjeta de login 22px
                field: '11px',
                card: '14px',
                login: '22px',
            },
            spacing: {
                // Tokens de densidad (contrato §4.4) — reflejados en data-density del <html>
                'pad-y': 'var(--pad-y)',
                'pad-x': 'var(--pad-x)',
            },
            height: {
                control: 'var(--control-h)',
                row: 'var(--row-h)',
            },
            minHeight: {
                control: 'var(--control-h)',
            },
            boxShadow: {
                brand: '0 30px 80px -40px rgba(24, 93, 74, 0.5)',
                card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
                pop: '0 12px 32px -12px rgba(16, 24, 40, 0.22)',
            },
            backgroundImage: {
                'brand-grad': 'var(--hero-grad)',
                sidebar: 'var(--sidebar)',
            },
            keyframes: {
                // §4.6 — animación "gira y para": una vuelta y se detiene, en bucle
                spinStop: {
                    '0%': { transform: 'rotate(0deg)' },
                    '55%': { transform: 'rotate(360deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                },
            },
            animation: {
                'spin-stop': 'spinStop 3.6s cubic-bezier(.66,0,.2,1) infinite',
            },
        },
    },
    plugins: [],
};
