import { HardDrive } from "lucide-react";
import { backupLocalDatabase } from "../../lib/tauri/storage";
import "./backup.css";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { onNotice: (message: string) => void; };

export function BackupButton({ onNotice }: Props) {
  const { language } = useLanguage();
  const label = language === "zh" ? "备份数据" : "Back up";
  async function backup() {
    try { const path = await backupLocalDatabase(); onNotice(`数据库备份已完成：${path}`); }
    catch { onNotice("数据库备份失败，请确认客户端具有本地数据目录写入权限"); }
  }
  return <button className="backup-button" aria-label={label} title={label} onClick={backup}><HardDrive size={14} /><span>{label}</span></button>;
}
