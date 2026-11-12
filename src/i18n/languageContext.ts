import { createContext, useContext } from "react";

export type Language = "zh" | "en";
export type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
};

export const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Safe outside a provider: isolated presentational components default to zh. */
export function useOptionalLanguage(): Language {
  return useContext(LanguageContext)?.language ?? "zh";
}
