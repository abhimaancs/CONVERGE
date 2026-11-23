"use client";

import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("converge-theme");
    if (saved === "light" || saved === "dark") {
      setMode(saved);
    }
  }, []);

  // Apply data-theme to <html> so CSS variables cascade everywhere
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode, mounted]);

  function toggle() {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      localStorage.setItem("converge-theme", next);
      return next;
    });
  }

  // Avoid flash: render with dark until hydrated
  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
