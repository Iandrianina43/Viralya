/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1629",
        accent: { DEFAULT: "#f0562b", dark: "#d8461f", light: "#fff1ec" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,22,41,.04), 0 8px 24px -12px rgba(16,22,41,.10)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
