import { Database, FileJson, Settings2, Sparkles } from "lucide-react";
import type { AppRoute } from "../../app/routes";
import { BackupButton } from "./BackupButton";
import { DatabaseBackupManager } from "./DatabaseBackupManager";
import { UpdateButton } from "./UpdateButton";
import type { ReactNode } from "react";

type Props = { route: AppRoute; onNavigate: (route: AppRoute) => void; onNotice: (message: string) => void };

export function WorkbenchSidebar({ route, onNavigate, onNotice }: Props) {
  const item = (target: AppRoute, icon: ReactNode, label: string) => <button className={`nav-link ${route === target ? "active" : ""}`} onClick={() => onNavigate(target)}>{icon}{label}</button>;
  return <aside>
    <div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><span>FORGE UI</span></div>
    <div className="workspace"><span className="eyebrow">WORKSPACE</span><strong>本地工作台</strong><span className="muted">离线优先 · v0.1</span></div>
    <nav>{item("generate", <Sparkles size={17} />, "生成页面")}{item("business", <Database size={17} />, "业务连接")}{item("openapi", <FileJson size={17} />, "OpenAPI 文档")}{item("models", <Settings2 size={17} />, "模型配置")}</nav>
    <div className="side-footer"><BackupButton onNotice={onNotice} /><DatabaseBackupManager onNotice={onNotice} /><UpdateButton onNotice={onNotice} /><span className="status-dot" />本地服务正常</div>
  </aside>;
}
