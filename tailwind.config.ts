import type { Config } from 'tailwindcss';

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
        sunken: 'var(--sunken)',
        elevated: 'var(--elevated)',
        hover: 'var(--hover)',
        border: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        fg: { DEFAULT: 'var(--text)', 2: 'var(--text-2)' },
        muted: 'var(--muted)',
        disabled: 'var(--disabled)',
        focus: 'var(--focus)',
        scrim: 'var(--scrim)',
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
        // Paleta de datos (VISUAL_SYSTEM_V2 §6): `fill-chart-1`, `bg-chart-age-3`…
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
          'seq-100': 'var(--chart-seq-100)',
          'seq-200': 'var(--chart-seq-200)',
          'seq-300': 'var(--chart-seq-300)',
          'seq-400': 'var(--chart-seq-400)',
          'seq-500': 'var(--chart-seq-500)',
          'seq-600': 'var(--chart-seq-600)',
          'seq-700': 'var(--chart-seq-700)',
          'age-1': 'var(--chart-age-1)',
          'age-2': 'var(--chart-age-2)',
          'age-3': 'var(--chart-age-3)',
          'age-4': 'var(--chart-age-4)',
          pos: 'var(--chart-pos)',
          neg: 'var(--chart-neg)',
          total: 'var(--chart-total)',
          billed: 'var(--chart-billed)',
          'collected-2': 'var(--chart-collected-2)',
          muted: 'var(--chart-muted)',
          grid: 'var(--chart-grid)',
          baseline: 'var(--chart-baseline)',
          axis: 'var(--chart-axis)',
        },
      },
      // Escala tipográfica V2 (§2). El eje óptico opsz 40 de hero…h2 y las
      // mayúsculas de `text-micro` se fijan en index.css (@layer utilities).
      fontSize: {
        hero: ['56px', { lineHeight: '60px', letterSpacing: '-0.025em', fontWeight: '700' }],
        display: ['40px', { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '700' }],
        kpi: ['32px', { lineHeight: '38px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['28px', { lineHeight: '34px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h2: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        h3: ['16px', { lineHeight: '24px', letterSpacing: '-0.005em', fontWeight: '600' }],
        body: ['14px', { lineHeight: '22px' }],
        compact: ['13px', { lineHeight: '20px' }],
        caption: ['12px', { lineHeight: '16px', letterSpacing: '0.005em' }],
        micro: ['11px', { lineHeight: '16px', letterSpacing: '0.06em', fontWeight: '600' }],
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // §4.5: campos 11px, tarjeta de login 22px
        field: '11px',
        card: '14px',
        dialog: '18px',
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
        // Sombra teñida de marca: solo tarjetas de acceso y públicas (U-04).
        brand: 'var(--shadow-brand)',
        // §4.1: tres niveles; por modo en tokens.css (en oscuro la tarjeta no tiene sombra).
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        modal: 'var(--shadow-modal)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        overlay: 'var(--dur-overlay)',
      },
      backgroundImage: {
        'brand-grad': 'var(--hero-grad)',
        'auth-panel': 'var(--auth-panel)',
        auth: 'var(--auth-bg)',
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
} satisfies Config;
