import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── LBG brand palette (CSS-Peeper, source-of-truth swatch) ──────────
        //   #000000  ink   — primary text
        //   #333333  deepMuted — secondary heading / strong meta
        //   #666666  muted — body meta, placeholders, secondary text
        //   #E8E8E8  page  — page bg + every border / divider / hover state
        //   #FAFAFA  surface — cards / inputs / modal / nav surfaces
        //   #FFFFFF  white — on-dark text
        //   #1C9FDA  sky   — brand logo, active nav, focus ring, OT/edited badge
        //   #116DFF  action / actionDeep / skyDeep — saturated CTA + selected option
        //   #0000EE  link  — link emphasis
        ink:        '#000000',
        deepMuted:  '#333333',
        link:       '#0000EE',
        action:     '#116DFF',
        actionDeep: '#116DFF',
        sky:        '#1C9FDA',
        skyDeep:    '#116DFF',
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
        // Two faces, each with its own role:
        //   Calps Sans      — body, headings, all lettering
        //   Cerebri Sans Pro — numerals only (.font-clock + clock family)
        // Calibri is the OS-native fallback (Windows + Office), then
        // system-ui. Helvetica/Arial intentionally absent.
        sans:    ['"Calps Sans"', 'Calibri', 'system-ui', 'sans-serif'],
        grotesk: ['"Calps Sans"', 'Calibri', 'system-ui', 'sans-serif'],
        clock:   ['"Cerebri Sans Pro"', '"Calps Sans"', 'Calibri', 'system-ui', 'sans-serif'],
      },
      // Off-scale size tokens — adds 10 / 11 / 13 px slots so call-sites stop
      // reaching for inline arbitrary values like text-[10px]. Tailwind's stock
      // text-xs (12px) and text-sm (14px) handle everything between; these
      // three exist for nav labels, stat captions, and micro annotations.
      fontSize: {
        'micro':   ['0.625rem', { lineHeight: '0.875rem' }], // 10px / 14px
        'tag':     ['0.6875rem',{ lineHeight: '0.9375rem' }], // 11px / 15px
        'caption': ['0.8125rem',{ lineHeight: '1.125rem'  }], // 13px / 18px
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
