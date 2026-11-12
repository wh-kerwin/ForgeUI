import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LanguageContext, type Language } from "./languageContext";

export type { Language, LanguageContextValue } from "./languageContext";

const STORAGE_KEY = "forge-ui:language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh",
  );
  const changeLanguage = (next: Language) => {
    setLanguage(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      setLanguage: changeLanguage,
      toggleLanguage: () => changeLanguage(language === "zh" ? "en" : "zh"),
    }),
    [language],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
