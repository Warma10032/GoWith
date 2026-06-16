import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#211a17",
        muted: "#71675f",
        line: "#e5ded7",
        brand: "#d94f30",
        sage: "#68806a",
        map: "#edf1e9",
      },
      boxShadow: {
        card: "0 10px 24px rgba(41, 31, 24, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;

