/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        nova: {
          bg: "#050811",
          card: "#0b1222",
          border: "#1e293b",
          cyan: "#00f0ff",
          purple: "#a855f7",
          blue: "#3b82f6",
          emerald: "#10b981",
          rose: "#f43f5e"
        }
      },
      boxShadow: {
        'hologram-cyan': '0 0 25px rgba(0, 240, 255, 0.45)',
        'hologram-purple': '0 0 25px rgba(168, 85, 247, 0.45)',
        'hologram-blue': '0 0 30px rgba(59, 130, 246, 0.5)',
      },
      animation: {
        'spin-slow': 'spin 12s linear infinite',
        'spin-reverse': 'spin-rev 16s linear infinite',
        'pulse-glow': 'pulse-glow 2.5s ease-in-out infinite',
      },
      keyframes: {
        'spin-rev': {
          '0%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(0deg)' }
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' }
        }
      }
    },
  },
  plugins: [],
};
