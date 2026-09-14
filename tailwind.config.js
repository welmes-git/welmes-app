/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Graphik / Nantes first: if licensed files are ever added via @font-face under those
        // names they take over automatically; until then the free stand-ins render.
        sans: ["Graphik", '"Hanken Grotesk"', "Pretendard Variable", "Pretendard", "system-ui", "sans-serif"],
        serif: ["Nantes", "Newsreader", "Pretendard Variable", "Pretendard", "Georgia", "serif"],
        jp: ["Pretendard JP", "Pretendard", "system-ui", "sans-serif"],
        logo: ['"Cormorant Garamond"', "Georgia", "serif"],
      },
      colors: {
        // WELMES design tokens — see DESIGN.md. Prefer these over raw hex.
        canvas: "var(--wm-canvas)",
        sunken: "var(--wm-sunken)",
        ink: {
          900: "var(--wm-ink-900)",
          700: "var(--wm-ink-700)",
          500: "var(--wm-ink-500)",
          300: "var(--wm-ink-300)",
        },
        line: {
          DEFAULT: "var(--wm-line)",
          strong: "var(--wm-line-strong)",
          control: "var(--wm-line-control)",
        },
        signal: {
          error: "var(--wm-signal-error)",
          ok: "var(--wm-signal-ok)",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        // Faire uses one 4px radius (--radius-fs-component-default) for buttons, fields, cards and
        // dropdowns; modals and drawers are square. Every step collapses to it so old classes stay valid.
        xl: "4px",
        lg: "4px",
        md: "4px",
        sm: "4px",
        xs: "2px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        // The only elevation tier in the system: card hover, dropdowns, modals.
        hover: "0 1px 2px rgba(20,20,20,.04), 0 4px 12px -4px rgba(20,20,20,.10)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}