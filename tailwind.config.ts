import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── LB brand palette (per spec) ──────────────
        // role hints in the spec:
        //   #000000  text, shadow
        //   #0000EE  text, border        (link emphasis)
        //   #FFFFFF  text, border        (on-dark surfaces)
        //   #E8E8E8  background, text, border  (page bg, subtle border)
        //   #3B82F6  background, border  (CTA bg)
        //   #1C9FDA  border, text        (LB sky brand text/accent)
        //   #666666  text, border        (muted text)
        //   #116DFF  text, border        (hover, deep accent)
        //   #FAFAFA  background          (card surface)
        //   #3078BE  border              (strong border)
        ink:        '#000000',
        link:       '#0000EE',
        action:     '#3B82F6',
        actionDeep: '#116DFF',
        sky:        '#1C9FDA',   // LB primary brand text/accent
        skyDeep:    '#3078BE',
        muted:      '#666666',
        page:       '#E8E8E8',
        surface:    '#FAFAFA',

        // Keep the old `brand` alias so existing classes still work
        brand: {
          DEFAULT: '#1c9fda',
          50:  '#e8f6fd',
          100: '#c5e8f9',
          200: '#8dd2f4',
          300: '#55bcee',
          400: '#2aabe4',
          500: '#1c9fda',
          600: '#1480b0',
          700: '#0f5f83',
          800: '#0a3f57',
          900: '#05202b',
        },
      },
      fontFamily: {
        sans:    ['"Familjen Grotesk"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        grotesk: ['"Familjen Grotesk"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        clock:   ['Barlow', '"Familjen Grotesk"', '"Helvetica Neue"', 'system-ui', 'sans-serif'],
      },
    },
    // ── Brand directive (May 2026): fully square + no shadows ──────────────
    // Every rounded-* and shadow-* utility resolves to 0 / none so the entire
    // app shares a crisp rectangular silhouette without per-component edits.
    // `rounded-full` intentionally stays a circle so the push-mute toggle and
    // status pills still render as ovals; everything else is square.
    borderRadius: {
      none:     '0',
      sm:       '0',
      DEFAULT:  '0',
      md:       '0',
      lg:       '0',
      xl:       '0',
      '2xl':    '0',
      '3xl':    '0',
      full:     '9999px',
    },
    boxShadow: {
      none:     'none',
      sm:       'none',
      DEFAULT:  'none',
      md:       'none',
      lg:       'none',
      xl:       'none',
      '2xl':    'none',
      inner:    'none',
    },
  },
  plugins: [],
} satisfies Config
