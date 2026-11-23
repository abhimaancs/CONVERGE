// Shared design tokens for both themes.
// dark  → navy blue + indigo
// light → white + teal
// Each theme also carries a `mode` key so consumers don't need to pull it
// separately from context when building conditional styles.

export const themes = {
  dark: {
    mode: "dark",
    // backgrounds
    bg:         "#0a0f1e",   // deep navy page bg
    bgSurface:  "#111827",   // card / panel surface
    bgInput:    "#0d1425",   // input field bg
    bgTrace:    "#070c18",   // terminal / trace bg
    bgHover:    "#1e2a45",   // hover state

    // borders
    border:     "#1e3a5f",
    borderFocus:"#6366f1",   // indigo

    // text
    text:       "#e2e8f0",
    textMuted:  "#64748b",
    textDim:    "#94a3b8",

    // accent — indigo
    accent:     "#6366f1",
    accentHover:"#4f46e5",
    accentText: "#ffffff",

    // status
    successBg:  "#052e16",
    successBorder:"#166534",
    successText:"#4ade80",
    errorBg:    "#2d0f13",
    errorBorder:"#da3633",
    errorText:  "#fca5a5",

    // trace labels
    labelColor: "#818cf8",   // indigo-400

    // step dots on landing
    stepColor:  "#818cf8",
  },
  light: {
    mode: "light",
    bg:         "#f8fafc",
    bgSurface:  "#ffffff",
    bgInput:    "#f1f5f9",
    bgTrace:    "#f8fafc",
    bgHover:    "#e0f2f1",

    border:     "#cbd5e1",
    borderFocus:"#0d9488",   // teal

    text:       "#0f172a",
    textMuted:  "#64748b",
    textDim:    "#475569",

    accent:     "#0d9488",   // teal-600
    accentHover:"#0f766e",
    accentText: "#ffffff",

    successBg:  "#f0fdf4",
    successBorder:"#86efac",
    successText:"#166534",
    errorBg:    "#fef2f2",
    errorBorder:"#fca5a5",
    errorText:  "#991b1b",

    labelColor: "#0d9488",
    stepColor:  "#0d9488",
  },
};
