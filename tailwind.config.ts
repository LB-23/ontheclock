import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
    },
  },
  plugins: [],
} satisfies Config
