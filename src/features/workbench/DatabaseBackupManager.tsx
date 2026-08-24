import { useEffect, useState } from "react";
import { ArchiveRestore, RefreshCw } from "lucide-react";
import { listDatabaseBackups, restoreDatabaseBackup, type DatabaseBackup } from "../../lib/tauri/storage";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { onNotice: (message: string) => void };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleString();
}

export function DatabaseBackupManager({ onNotice }: Props) {
  const { language } = useLanguage();
  const label = language === "zh" ? "管理备份" : "Backups";
  const [open, setOpen] = useState(false);
  const [backups, setBackups] = useState<DatabaseBackup[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setBackups(await listDatabaseBackups()); }
    catch (error) { onNotice(`读取数据库备份失败：${String(error)}`); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (open) refresh(); }, [open]);

  async function restore(fileName: string) {
    if (!window.confirm(`恢复备份「${fileName}」？当前数据会先自动备份，客户端建议随后重启。`)) return;
    setLoading(true);
    try {
      await restoreDatabaseBackup(fileName);
      onNotice("数据库已恢复；请重启客户端使所有页面重新加载");
      await refresh();
    } catch (error) { onNotice(`恢复数据库失败：${String(error)}`); }
    finally { setLoading(false); }
  }

  return <>
    <button className="backup-manage-button" aria-label={label} title={label} onClick={() => setOpen(true)}><ArchiveRestore size={14} /><span>{label}</span></button>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <section className="modal backup-manager" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">LOCAL BACKUPS</span><h2>数据库备份</h2></div><button className="icon-btn" onClick={() => setOpen(false)}>关闭</button></div>
        <p className="modal-intro">恢复前会自动创建当前数据库的安全备份。恢复操作不会读取或上传任何业务数据。</p>
        <div className="backup-toolbar"><button className="secondary" onClick={refresh} disabled={loading}><RefreshCw size={14} />刷新</button></div>
        <div className="backup-list">
          {backups.length === 0 && <span className="muted">暂无可用备份</span>}
          {backups.map((backup) => <div className="backup-entry" key={backup.fileName}><div><strong>{backup.fileName}</strong><span>{formatDate(backup.modifiedAt)} · {formatBytes(backup.sizeBytes)}</span></div><button className="secondary" onClick={() => restore(backup.fileName)} disabled={loading}>恢复</button></div>)}
        </div>
      </section>
    </div>}
  </>;
}
