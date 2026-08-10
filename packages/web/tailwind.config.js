/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./frontend/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // The vendored lead-generation UI (src/components/leads) leans on
        // font-serif for headings and font-mono for its table chrome. Point
        // them at faces the app actually loads rather than letting the browser
        // pick Times and Courier.
        serif: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // ── Lead-generation module theme ──────────────────────────────────
        // The vendored UI is written entirely against four colour names. It
        // ships a warm gold-on-ivory preset; these values re-skin it to
        // ContentFlow's palette instead, which is the whole point of the
        // module keeping its colours behind names. Do not add a bare `slate`
        // here — the module never uses one as a class, and defining it would
        // wipe out Tailwind's slate-50…950 scale that the rest of the app
        // depends on.
        /** Body text, headers, primary buttons. */
        ink: '#0f172a',
        /** Page ground and drawer background. */
        ivory: '#f8fafc',
        /** Accent: score bars, selected rows, badges. */
        gold: '#5b6cf9',
        /** Darker accent: links and clickable cells. */
        bronze: '#4a5be8',
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c3d66',
        },
        secondary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        'primary-blue': '#3B82F6',
        'dark-blue': '#2563EB',
        'light-gray-bg': '#F8FAFC',
        'text-dark': '#1E293B',
        'text-gray': '#64748B',
        'text-light-gray': '#94A3B8',
        'badge-green-bg': '#ECFDF5',
        'badge-green-text': '#059669',
        'border-gray': '#E2E8F0',
        'sidebar-dark': '#1E293B',
        'online-green': '#22C55E',
        'purple-accent': '#8B5CF6',
      },
      fontSize: {
        'h1': ['4.5rem', { lineHeight: '1.1', fontWeight: '700' }],
        'h2': ['3rem', { lineHeight: '1.2', fontWeight: '600' }],
        'body-large': ['1.25rem', { lineHeight: '1.6', fontWeight: '400' }],
        'body-reg': ['1rem', { lineHeight: '1.5', fontWeight: '400' }],
        'body-small': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
        'nav': ['1rem', { lineHeight: '1.5', fontWeight: '500' }],
        'btn': ['1rem', { lineHeight: '1.5', fontWeight: '600' }],
        'caption': ['0.75rem', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px',
        'full': '9999px',
      },
      boxShadow: {
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 10px 20px -4px rgba(0, 0, 0, 0.12), 0 4px 8px -2px rgba(0, 0, 0, 0.08)',
        'elevated': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'app-preview': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        'floating-icon': '0 4px 20px rgba(59, 130, 246, 0.15)',
      },
    },
  },
  plugins: [],
}
