import { Database, FileJson, LayoutDashboard, Library, PanelLeftClose, PanelLeftOpen, Settings2, Sparkles } from "lucide-react";
import type { AppRoute } from "../../app/routes";
import { BackupButton } from "./BackupButton";
import { DatabaseBackupManager } from "./DatabaseBackupManager";
import { UpdateButton } from "./UpdateButton";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageToggle } from "../../i18n/LanguageToggle";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { route: AppRoute; onNavigate: (route: AppRoute) => void; onNotice: (message: string) => void };

export function WorkbenchSidebar({ route, onNavigate, onNotice }: Props) {
  const { language } = useLanguage();
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem("forge-sidebar-collapsed") === "true");
  useEffect(() => { window.localStorage.setItem("forge-sidebar-collapsed", String(collapsed)); }, [collapsed]);
  const t = language === "zh" ? { overview: "总览", generate: "生成", templates: "模板库", settings: "连接与设置", business: "业务 API", openapi: "OpenAPI", models: "模型服务", healthy: "本地服务正常" } : { overview: "Overview", generate: "Generate", templates: "Templates", settings: "CONNECTIONS & SETTINGS", business: "Business API", openapi: "OpenAPI", models: "Model services", healthy: "Local services healthy" };
  const item = (target: AppRoute, icon: ReactNode, label: string) => <button className={`nav-link ${route === target ? "active" : ""}`} aria-label={label} title={collapsed ? label : undefined} onClick={() => onNavigate(target)}>{icon}<span>{label}</span></button>;
  return <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}><div className="sidebar-head"><div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><span>FORGE UI</span></div><button type="button" className="sidebar-toggle" aria-label={collapsed ? (language === "zh" ? "展开侧栏" : "Expand sidebar") : (language === "zh" ? "折叠侧栏" : "Collapse sidebar")} title={collapsed ? (language === "zh" ? "展开侧栏" : "Expand sidebar") : (language === "zh" ? "折叠侧栏" : "Collapse sidebar")} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div><nav>{item("overview", <LayoutDashboard size={17} />, t.overview)}{item("generate", <Sparkles size={17} />, t.generate)}{item("templates", <Library size={17} />, t.templates)}</nav><div className="nav-section"><span className="eyebrow">{t.settings}</span>{item("business", <Database size={17} />, t.business)}{item("openapi", <FileJson size={17} />, t.openapi)}{item("models", <Settings2 size={17} />, t.models)}</div><div className="side-footer"><div className="side-tools"><LanguageToggle /><BackupButton onNotice={onNotice} /><DatabaseBackupManager onNotice={onNotice} /><UpdateButton onNotice={onNotice} /></div><div className="side-health"><span className="status-dot" /><span>{t.healthy}</span></div></div></aside>;
}
