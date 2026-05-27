import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── LB brand palette (May 2026 design system) ──────────────
        //   #000000  primary text + status badge text on light bg
        //   #00698B  link emphasis · stronger border accent · react-select selection bg
        //   #FFFFFF  text/border on dark/accent surfaces
        //   #E8E8E8  page background · all borders · dividers · hover states
        //   #1C9FDA  LB logo · active nav · focus ring · OT/edited label · section action links
        //   #00698B  deep accent (skyDeep)
        //   #191919  secondary text + dashboard timesheet hours (muted)
        //   #FAFAFA  card / panel / input / modal / nav surfaces
        ink:        '#000000',
        link:       '#00698B',
        action:     '#00698B',
        actionDeep: '#00698B',
        sky:        '#1C9FDA',
        skyDeep:    '#00698B',
        muted:      '#191919',
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
        // Body face is Familjen Grotesk; Calibri is the OS-native fallback
        // (Windows + Office), then system-ui. Helvetica/Arial intentionally
        // removed per design system. Clock/widget face is Be Vietnam Pro.
        sans:    ['"Familjen Grotesk"', 'Calibri', 'system-ui', 'sans-serif'],
        grotesk: ['"Familjen Grotesk"', 'Calibri', 'system-ui', 'sans-serif'],
        clock:   ['"Be Vietnam Pro"', '"Familjen Grotesk"', 'Calibri', 'system-ui', 'sans-serif'],
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
      // Spec: shadows off by default, with documented exceptions —
      //   • shadow-md kept so Dashboard tile :hover still lifts
      //   • shadow-lg kept so modal panels still float above the page
      none:     'none',
      sm:       'none',
      DEFAULT:  'none',
      md:       '0 4px 6px -1px rgba(0, 0, 0, 0.10), 0 2px 4px -2px rgba(0, 0, 0, 0.10)',
      lg:       '0 10px 15px -3px rgba(0, 0, 0, 0.10), 0 4px 6px -4px rgba(0, 0, 0, 0.10)',
      xl:       'none',
      '2xl':    'none',
      inner:    'none',
    },
  },
  plugins: [],
} satisfies Config
