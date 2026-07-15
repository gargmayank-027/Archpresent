/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["Cormorant Garamond", "Georgia", "serif"],
        mono: ["DM Mono", "Fira Code", "monospace"],
        sans: ["Instrument Sans", "system-ui", "sans-serif"],
      },
      colors: {
        stone: {
          50: "#f7f5f2",
          100: "#f0ece6",
          200: "#e2ddd8",
          300: "#c8c2b8",
          400: "#a09890",
          500: "#7a7570",
          600: "#5c5650",
          700: "#433e38",
          800: "#2d2927",
          900: "#1a1917",
        },
        amber: {
          50: "#fdf8ed",
          100: "#faefc5",
          200: "#f4d97a",
          300: "#e9bc40",
          400: "#d99f1e",
          500: "#c47b2a",
          600: "#a85f1e",
          700: "#874618",
          800: "#6b3518",
          900: "#5a2c16",
        },
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};
