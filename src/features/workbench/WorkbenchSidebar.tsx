import { Database, FileJson, LayoutDashboard, Library, Settings2, Sparkles } from "lucide-react";
import type { AppRoute } from "../../app/routes";
import { BackupButton } from "./BackupButton";
import { DatabaseBackupManager } from "./DatabaseBackupManager";
import { UpdateButton } from "./UpdateButton";
import type { ReactNode } from "react";
import { LanguageToggle } from "../../i18n/LanguageToggle";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { route: AppRoute; onNavigate: (route: AppRoute) => void; onNotice: (message: string) => void };

export function WorkbenchSidebar({ route, onNavigate, onNotice }: Props) {
  const { language } = useLanguage();
  const t = language === "zh" ? { workspace: "我的工作台", local: "本地优先 · v0.1", overview: "总览", generate: "生成", templates: "模板库", settings: "连接与设置", business: "业务 API", openapi: "OpenAPI", models: "模型服务", healthy: "本地服务正常" } : { workspace: "My workspace", local: "Local first · v0.1", overview: "Overview", generate: "Generate", templates: "Templates", settings: "CONNECTIONS & SETTINGS", business: "Business API", openapi: "OpenAPI", models: "Model services", healthy: "Local services healthy" };
  const item = (target: AppRoute, icon: ReactNode, label: string) => <button className={`nav-link ${route === target ? "active" : ""}`} onClick={() => onNavigate(target)}>{icon}{label}</button>;
  return <aside><div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><span>FORGE UI</span></div><div className="workspace"><span className="eyebrow">WORKSPACE</span><strong>{t.workspace}</strong><span className="muted">{t.local}</span></div><nav>{item("overview", <LayoutDashboard size={17} />, t.overview)}{item("generate", <Sparkles size={17} />, t.generate)}{item("templates", <Library size={17} />, t.templates)}</nav><div className="nav-section"><span className="eyebrow">{t.settings}</span>{item("business", <Database size={17} />, t.business)}{item("openapi", <FileJson size={17} />, t.openapi)}{item("models", <Settings2 size={17} />, t.models)}</div><div className="side-footer"><LanguageToggle /><BackupButton onNotice={onNotice} /><DatabaseBackupManager onNotice={onNotice} /><UpdateButton onNotice={onNotice} /><span className="status-dot" />{t.healthy}</div></aside>;
}
