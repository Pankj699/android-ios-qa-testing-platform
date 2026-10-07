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
          default: '#1E2638',
          subtle: '#263248',
        },
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
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', 'monospace']
      }
    },
  },
  plugins: [],
}
