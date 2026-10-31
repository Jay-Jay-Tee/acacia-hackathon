import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "adf.theme"; // also read by the pre-paint script in index.html

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  });

  useEffect(() => {
    apply(theme);
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
    if (theme !== "system") return;
    const m = media();
    const onChange = () => apply("system");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [theme]);

  // system → light → dark → system
  const cycle = useCallback(() => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system")), []);
  return [theme, cycle];
}
