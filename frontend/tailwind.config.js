/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: '#0A0D14',
        surface: {
          primary: '#131924',
          secondary: '#0E141E',
          nav: '#0D111A',
        },
        border: {
          DEFAULT: 'var(--border, #1E2638)',
          default: '#1E2638',
          subtle: '#263248',
        },
        background: 'var(--background, #080A0F)',
        foreground: 'var(--foreground, #FFFFFF)',
        card: {
          DEFAULT: 'var(--card, #0F1420)',
          foreground: 'var(--card-foreground, #FFFFFF)',
        },
        popover: {
          DEFAULT: 'var(--popover, #0F1420)',
          foreground: 'var(--popover-foreground, #FFFFFF)',
        },
        primary: {
          DEFAULT: 'var(--primary, #F59E0B)',
          foreground: 'var(--primary-foreground, #000000)',
        },
        secondary: {
          DEFAULT: 'var(--secondary, #141B2D)',
          foreground: 'var(--secondary-foreground, #FFFFFF)',
        },
        muted: {
          DEFAULT: 'var(--muted, #161D2D)',
          foreground: 'var(--muted-foreground, #94A3B8)',
        },
        destructive: {
          DEFAULT: 'var(--destructive, #EF4444)',
          foreground: 'var(--destructive-foreground, #FFFFFF)',
        },
        input: 'var(--input, #1E2638)',
        ring: 'var(--ring, #F59E0B)',
        success: 'var(--success, #10B981)',
        warning: 'var(--warning, #F59E0B)',
        accent: {
          DEFAULT: '#F59E0B',
          hover: '#D97706',
          subtle: '#261D10',
        },
        brand: {
          50: '#fffbeb',
          100: '#fef3c7',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          900: '#78350f',
        },
        qa: {
          pass: '#10b981',
          fail: '#ef4444',
          running: '#f59e0b',
          warning: '#f59e0b',
          dark: '#0a0d14',
          surface: '#131924',
          panel: '#0d111a'
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'JetBrains Mono', 'Courier New', 'monospace']
      },
      borderRadius: {
        'card': '24px',
        'stage': '22px',
        'wrap': '18px',
        'btn': '16px',
        'stat': '14px',
        'action': '12px',
      },
      boxShadow: {
        'glass': '0 20px 60px rgba(76, 61, 160, 0.10), 0 2px 6px rgba(76, 61, 160, 0.05)',
        'magic': '0 12px 30px rgba(194, 108, 246, 0.35)',
        'magic-hover': '0 16px 36px rgba(194, 108, 246, 0.45)',
        'art': '0 18px 40px rgba(124, 108, 246, 0.16)',
        'brand': '0 8px 22px rgba(124, 108, 246, 0.35)',
        'poster': '0 30px 70px rgba(76, 61, 160, 0.22)',
        'history': '0 10px 26px rgba(76, 61, 160, 0.10)',
        'history-hover': '0 18px 36px rgba(76, 61, 160, 0.18)',
      }
    },
  },
  plugins: [],
}
