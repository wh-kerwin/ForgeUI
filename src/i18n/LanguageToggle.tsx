import { Languages } from "lucide-react";
import { useLanguage } from "./LanguageProvider";

export function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();
  return <button className="language-toggle" onClick={toggleLanguage} aria-label={language === "zh" ? "Switch to English" : "切换为中文"}><Languages size={14} /><span>{language === "zh" ? "EN" : "中"}</span></button>;
}
