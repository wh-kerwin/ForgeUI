import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "forge-ui:pinned-templates";

export function usePinnedTemplates() {
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as string[]; } catch { return []; }
  });

  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pinned)); }, [pinned]);

  const togglePinned = useCallback((id: string) => {
    setPinned((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }, []);

  return { pinned, togglePinned };
}
