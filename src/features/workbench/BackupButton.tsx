import { HardDrive } from "lucide-react";
import { backupLocalDatabase } from "../../lib/tauri/storage";
import "./backup.css";

type Props = { onNotice: (message: string) => void; };

export function BackupButton({ onNotice }: Props) {
  async function backup() {
    try { const path = await backupLocalDatabase(); onNotice(`数据库备份已完成：${path}`); }
    catch { onNotice("数据库备份失败，请确认客户端具有本地数据目录写入权限"); }
  }
  return <button className="backup-button" onClick={backup}><HardDrive size={14} />备份本地数据</button>;
}
