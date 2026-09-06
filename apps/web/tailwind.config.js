/** @type {import('tailwindcss').Config} */
// Tokens du système de design Viralya (miroir des variables CSS de index.css).
// Palette : papier clair, encre, un accent bleu ; sémantique séparée (ok / warn / cost).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: "#EDEFF3", 2: "#F7F8FA" },
        ink: { DEFAULT: "#14171C", 2: "#3A404B" },
        muted: "#5B6270",
        rule: { DEFAULT: "#C9CED8", soft: "#DDE1E8" },
        accent: { DEFAULT: "#2A3EAF", dark: "#1F2F8C", light: "#E3E7F8", soft: "#E3E7F8" },
        cost: { DEFAULT: "#8A6210", soft: "#F3EBD6" },
        ok: { DEFAULT: "#2F6B3F", soft: "#DDEBDF" },
        warn: { DEFAULT: "#9A3B2E", soft: "#F2DEDA" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,23,28,.05), 0 6px 20px -14px rgba(20,23,28,.18)",
      },
      fontFamily: {
        sans: ["Archivo", "Helvetica Neue", "Arial", "sans-serif"],
        serif: ["Newsreader", "Georgia", "Times New Roman", "serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "Consolas", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
      },
    },
  },
  plugins: [],
};
